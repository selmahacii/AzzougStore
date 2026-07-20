# TikTok Ads Enterprise — Documentation technique

Intégration TikTok Ads server-side, architecturée en miroir de l'intégration Meta Ads (`app/services/meta_capi.py` + `app/services/meta_analytics_engine.py`). Statut : parité complète avec Meta Ads atteinte (audit de production terminé) ; travail local uniquement, aucun commit/push/déploiement effectué.

## Catalog Feed Enterprise

Dernier écart de parité comblé — `app/services/tiktok_catalog.py` :
- **PULL** : `GET /tiktok-ads/catalog-feed` (public, JSON) — flux toujours à jour, interrogé directement par TikTok Catalog Manager, même rôle que le CSV `/meta-ads/catalog-feed`.
- **PUSH** : `sync_catalog_incremental()` — appels Catalog API (create/update/delete) uniquement pour les produits modifiés depuis leur dernier sync réussi (comparaison `Product.updated_at` vs dernier `TikTokCatalogSyncLog.completed_at`), avec file durable + circuit breaker + retry (état séparé de `tiktok_capi.py`, endpoints TikTok différents = pannes indépendantes).
- **Validation** avant envoi (`validate_catalog_item`) — image absolue, prix > 0, sku_id/title/link présents — jamais un item invalide envoyé pour découvrir l'erreur côté TikTok.
- **Catalog Health** : `GET /tiktok-ads/catalog-health` — produits suivis, succès/échecs/en attente, répartition par catégorie d'erreur, dernière synchro réussie, latence moyenne, taux de réussite.
- **Mapping ERP → TikTok** : sku_id (SKU ou id produit), item_group_id, title, description, availability (calculé depuis stock réel − stock réservé, jamais fabriqué), price/currency, link, image_link + additional_image_link, brand (repli sur le nom de la boutique), category, inventory, gtin (uniquement si un code-barres existe — jamais inventé).

## Architecture

```
Storefront (navigateur, anonyme)
   │  ttq.track (Pixel) ──────────────┐
   │                                   │ même event_id → dédup TikTok
   └─ POST /api/v1/tiktok-ads/events ──┘
              │
              ▼
      app/api/v1/tiktok_ads.py (send_tiktok_event)
              │  BackgroundTasks (zéro latence shopper)
              ▼
      app/services/tiktok_capi.py
        ├─ build_tiktok_user()      → hashing PII (réutilise meta_capi.py)
        ├─ send_events()            → circuit breaker + retry immédiat
        └─ _log_send()              → écrit tiktok_capi_logs AVANT le réseau
              │
              ▼
      tiktok_capi_logs (queued → processing → retry/pending_retry → success/failed)
              │
              ▼
      retry_pending_events() (sweep périodique, même contrat que Meta)
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `app/models/marketing.py` (`TikTokCapiLog`) | File durable — même contrat que `MetaCapiLog`, index composite dès le jour 1 |
| `alembic/versions/b9f144d96c03_tiktok_capi_logs.py` | Migration (testée local uniquement) |
| `app/services/tiktok_capi.py` | Events API, Pixel dédup, circuit breaker, retry engine, EMQ |
| `app/services/tiktok_analytics_engine.py` | Learning Score, Signal Quality, Funnel — source unique de vérité |
| `app/api/v1/tiktok_ads.py` | Endpoints (config, sync, campagnes, events, diagnostics, signal-quality, funnel, kpi-validation) |
| `app/api/v1/ads_comparison.py` | Comparatif Meta ↔ TikTok |

## Ce qui est réutilisé de Meta (pas dupliqué)

- **Hashing PII** (`normalize_email`, `normalize_phone`, `normalize_name`, `_sha256`) — `app/services/meta_capi.py`, importé directement.
- **`resolve_metrics_time_window()`** — étendu avec un paramètre `cutover_date` (défaut = date Meta, rétrocompatible) pour que TikTok passe sa propre date de lancement sans dupliquer la logique de résolution de fenêtre.
- **`compute_learning_score()` / `compute_component_scores()` / `meta_health_label()` / `classify()`** — fonctions pures opérant sur un dict de métriques déjà calculées, aucun couplage à Meta.

## Ce qui est volontairement séparé (pas partagé)

- **Circuit breaker / client HTTP** : implémentation propre à `tiktok_capi.py`, même pattern que Meta (5 échecs consécutifs → ouverture, cooldown 60s) mais état séparé. Retoucher le circuit breaker de Meta (juste audité et stabilisé) pour le partager aurait ajouté un risque de régression sans gain fonctionnel — décision documentée, pas un oubli.
- **Requêtes SQL** (`_compute_status_metrics`, `_compute_match_quality_sample`, etc.) : `TikTokCapiLog` et `MetaCapiLog` sont deux tables distinctes avec des colonnes différentes — un partage exigerait une couche de requête paramétrée par plateforme qui n'existe pas encore.

## Event Match Quality — pondération contexte COD

Mêmes principes que Meta, poids adaptés au vocabulaire TikTok :

| Champ | Poids | Classification |
|---|---|---|
| `phone` | 3.0 | required |
| `external_id` | 2.5 | required |
| `ttclid` | 2.0 | recommended |
| `ttp` | 2.0 | recommended |
| `ip` | 1.5 | recommended |
| `user_agent` | 1.5 | recommended |
| `email` | 1.0 | **not_applicable** (jamais collecté au checkout COD) |
| `first_name` / `last_name` | 0.5 chacun | recommended |

Un email absent ne pénalise donc jamais un score déjà bon — il apparaît dans `not_applicable`, jamais dans `missing`.

## Événements supportés (TikTok Events API v1.3)

| Nom interne | Nom TikTok |
|---|---|
| PageView | PageView |
| ViewContent | ViewContent |
| Search | Search |
| AddToWishlist | AddToWishlist |
| AddToCart | AddToCart |
| InitiateCheckout | InitiateCheckout |
| AddPaymentInfo | AddPaymentInfo |
| PlaceOrder | PlaceAnOrder |
| Purchase | CompletePayment |
| CompleteRegistration | CompleteRegistration |
| Lead | Contact |

## Paramètres envoyés (quand disponibles)

`event_id`, `event_time`, `value`, `currency` (DZD), `order_id`, `phone` (hashé), `external_id` (hashé), `ttclid`, `ttp`, `ip`, `user_agent`, `email` (hashé), `content_id`, `content_name`, `price`, `quantity`.

## Endpoints

| Route | Auth | Rôle |
|---|---|---|
| `GET/POST /tiktok-ads/config` | admin | Configuration boutique |
| `POST /tiktok-ads/sync` | admin | Sync Reporting API (spend/insights) |
| `GET /tiktok-ads/campaigns` | admin | Attribution/ROAS/CPA/CTR/CPC/CPM (déjà existant avant ce chantier) |
| `POST /tiktok-ads/events` | **publique** | Relais Events API — appelé par le navigateur anonyme |
| `GET /tiktok-ads/diagnostics` | admin | Rapport de santé (config, delivery 7j/30j, EMQ, Learning Score) |
| `GET /tiktok-ads/signal-quality` | admin | Signal Quality Center |
| `GET /tiktok-ads/funnel` | admin | Funnel Analytics (PageView → CompletePayment) |
| `GET /tiktok-ads/kpi-validation` | admin | Validation ERP ↔ TikTok (commandes réelles vs Purchase acceptés) |
| `GET /tiktok-ads/campaigns/{id}/ads` | admin | Détail par annonce (Ad Group + Ad) — `TikTokAdsAdInsight` |
| `GET /tiktok-ads/catalog-feed` | **publique** | Flux catalogue JSON — interrogé par TikTok Catalog Manager |
| `POST /tiktok-ads/catalog-sync` | admin | Sync incrémentale push (Catalog API) |
| `GET /tiktok-ads/catalog-health` | admin | Tableau de bord Catalog Health |
| `GET /ads-comparison/summary` | admin | Comparatif Meta ↔ TikTok côte à côte |

## Sécurité

Audit identique à Meta : 12 routes admin (config, sync, campagnes, diagnostics, catalog...) n'avaient aucune vérification serveur — corrigées. `/events` et `/catalog-feed` restent délibérément publiques (appelées respectivement par le shopper anonyme et par les serveurs de TikTok, jamais par un compte admin).

## Tests

39 tests dédiés TikTok/comparatif (`test_tiktok_capi.py`, `test_tiktok_capi_retry_engine.py`, `test_tiktok_analytics_engine.py`, `test_tiktok_ads_auth_coverage.py`, `test_ads_comparison.py`, `test_tiktok_ads_insights_models.py`, `test_tiktok_catalog.py`), dans une suite globale de 224 tests passants, zéro régression Meta.

## Parité Meta — audit final

✅ Pixel, Events API, Campaigns, Ad Groups, Ads, Spend/Impressions/Reach/Clicks, CPC/CPM/CTR/CPA, ROAS/Revenue/Purchases, Conversions, Attribution, Diagnostics, Errors, Catalog — tous au même niveau que Meta Ads.

⚠️ Améliorations futures non essentielles (ni Meta ni TikTok ne les ont actuellement — dépasseraient la parité, pas un manque) : Learning Status, Optimization Goal, Budget, Bid Strategy, Delivery Status, gestion d'Audience (custom audiences).

❌ Offline Events : non applicable — le besoin est déjà couvert par le relais Events API existant (Meta a lui-même abandonné son ancienne Offline Conversions API au profit de la CAPI).

## Reste à faire (non bloquant)

- Dashboard frontend : les endpoints `/diagnostics`, `/signal-quality`, `/funnel`, `/kpi-validation`, `/campaigns/{id}/ads`, `/catalog-health` et `/ads-comparison/summary` ne sont pas encore branchés sur `src/components/admin/modules/tiktok-ads-dashboard.tsx`.
- Conversion Optimization Center dédié TikTok (bottleneck detection) — pas encore construit.
- Attribution par produit lié manuellement (`TikTokAdsCampaign.product_id` n'existe pas encore, contrairement à `MetaAdsCampaign.product_id`) — empêche la réutilisation directe de `_match_campaign_orders` de Meta pour le repli produit.
