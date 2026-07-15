# AzzougShop — Documentation Technique & Guide de Migration Backend

**Public visé** : ingénieur senior n'ayant jamais vu ce projet, chargé de migrer le backend FastAPI hors de Hugging Face Spaces (vers Railway, Koyeb, un VPS, etc.) sans perte de données ni casse d'architecture.

**Méthode** : chaque affirmation de ce document a été vérifiée directement dans le code source (chemins de fichiers et numéros de ligne cités), pas déduite ou supposée. Là où une incertitude subsiste, elle est explicitement signalée comme telle plutôt que présentée comme un fait.

---

## 1. Architecture générale

### 1.1 Vue d'ensemble

Le projet est un monorepo contenant deux applications déployées **séparément**, sur deux hébergeurs différents :

| Composant | Techno | Hébergement actuel | Rôle |
|---|---|---|---|
| **Frontend** | Next.js 15.5.15 (App Router, Turbopack) | **Vercel** | Storefront multi-boutique, back-office admin/confirmatrice/livreur, landing pages, proxy API |
| **Backend** | FastAPI (Python 3.11) | **Hugging Face Spaces** (Docker SDK) | API REST, logique métier, intégrations tierces, tâches de fond |
| **Base de données** | PostgreSQL | Externe (probablement Neon, voir §1.4) | Source de vérité unique, multi-tenant par `store_id` |
| **Cache/Sessions** | Redis | Censé tourner sur le même conteneur HF, **mais ne tourne pas réellement en production actuellement** (voir §11 — finding critique) | Rate limiting, refresh tokens |
| **Stockage médias** | Cloudinary (si configuré) sinon disque local éphémère du conteneur | Cloudinary (externe) | Images produits, bannières, landing pages |
| **File de tâches** | Celery + Redis (défini dans le code, `app/celery_app.py`/`app/worker.py`) | **Non actif en production** (voir §5.6, §13) | Réassignation auto des commandes inactives (5 min), sync stock (ad hoc) |

### 1.2 Frontend

- Framework : Next.js 15.5.15, TypeScript, Tailwind CSS.
- Routing : App Router (`src/app/`). Trois grandes zones :
  - `src/app/[slug]/page.tsx` — storefront public d'une boutique (résolution par slug de domaine, via middleware).
  - `src/app/lp/[slug]/page.tsx` — landing pages (voir §8).
  - Zone admin/agent (montée conditionnellement selon rôle authentifié) — `src/components/app/admin-app.tsx` et dérivés, incluant les interfaces confirmatrice (`src/components/agent/agent-dashboard.tsx`) et livreur (`src/components/livreur/livreur-dashboard.tsx`).
- Le frontend **ne parle jamais directement à Postgres, Cloudinary, Meta ou Noest** — tout passe par le backend FastAPI. Deux exceptions ponctuelles où le frontend a ses propres routes Next.js qui appellent directement des API tierces avec une clé côté serveur : `src/app/api/noest/*/route.ts` et `src/app/api/yalidine/*/route.ts` (proxys minces vers Noest/Yalidine, avec le header `x-internal-key`, voir §7).
- Proxy générique vers le backend : `src/app/api/[...path]/route.ts` — capture toute requête `/api/v1/*` (et le reste non pris par une route Next.js plus spécifique) côté navigateur et la relaie server-side vers l'URL du backend (résolue par `src/lib/utils.ts::getBackendUrl()`), en transmettant cookies et headers. C'est le point de passage obligé de **toute** communication navigateur → backend pour les données applicatives.
- `src/middleware.ts` — résolution multi-tenant par domaine (voir §2.3), injection d'identité utilisateur pour les routes de page (pas les routes API), redirections `azghub.com/{slug}` → `{slug}.azghub.com`.

### 1.3 Backend

- Framework : FastAPI 0.110.0, Python 3.11, SQLAlchemy 2.0.28 (ORM synchrone, pas d'async DB), Alembic 1.13.1 pour les migrations.
- Point d'entrée : `app/main.py` — instancie l'app, enregistre ~30 routers sous `/api/v1/*` (produits, commandes, clients, stock, finance, marketing, meta_ads, etc.), plus deux routers "carrier proxy" hors `/api/v1` : `/api/yalidine` et `/api/noest`.
- Pas de `lifespan=` — le projet utilise le style `@app.on_event("startup")` legacy (5 handlers séquentiels, voir §5).
- Structure : `app/models/` (27 fichiers, SQLAlchemy ORM), `app/schemas/` (Pydantic), `app/api/v1/` (routers), `app/api/carriers/` (Noest/Yalidine), `app/services/` (logique métier : `order_service.py`, `meta_capi.py`, `noest_sync.py`, `inventory_service.py`, `salary_service.py`, etc.), `app/core/` (config, sécurité, tenant, encryption, rate limiting, redis, error handlers).

**⚠️ Répertoire piège** : un dossier `backend/` existe à la racine du repo, contenant une copie complète et autonome (`alembic/`, `app/`, `tests/`, `uploads/`, **`venv/`**) de l'application. La présence d'un `venv/` local confirme que c'est un artefact de développement local, probablement une copie antérieure ou un test d'environnement isolé. **Aucun Dockerfile ni script de démarrage n'y fait référence** — ce n'est pas ce qui est déployé. Le code source de vérité est à la racine du repo, sous `app/`. Ne pas migrer/déployer le contenu de `backend/`.

### 1.4 Base de données

- PostgreSQL. La résolution de l'URL de connexion (`app/core/config.py`) essaie dans l'ordre : `DATABASE_URL` → `POSTGRES_URL_NON_POOLING` → `POSTGRES_URL` → construction depuis `POSTGRES_SERVER`/`POSTGRES_PORT`/`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` (défauts locaux) → fallback SQLite (`sqlite:///../prisma/dev.db`, jamais utilisé en production).
- Les noms `POSTGRES_URL_NON_POOLING` / `POSTGRES_URL` sont la convention Vercel/Neon — l'hypothèse la plus probable est que la base est hébergée sur **Neon** (Postgres serverless), mais ceci n'a pas été confirmé directement dans le code (aucune référence explicite à "neon.tech" trouvée) — **à vérifier auprès de qui détient l'accès aux secrets HuggingFace avant la migration.**
- La base est **totalement indépendante de Hugging Face** — c'est un service externe. La migration du backend n'affecte pas la base de données tant que la nouvelle instance backend pointe vers la même `DATABASE_URL`.

### 1.5 Toutes les communications entre services

| De | Vers | Protocole | Authentification |
|---|---|---|---|
| Navigateur | Frontend (Vercel) | HTTPS | Cookie `__session`/`__refresh` |
| Frontend (Vercel, server-side) | Backend (HF) | HTTPS | Cookie transmis tel quel, ou header `x-internal-key` pour les appels serveur-à-serveur sans session |
| Navigateur | Meta (Pixel) | HTTPS, direct, ne passe PAS par le backend | — |
| Backend | PostgreSQL | TCP/TLS (psycopg2) | Credentials dans `DATABASE_URL` |
| Backend | Redis | TCP | Aucune (pas de mot de passe configuré par défaut) — **actuellement injoignable en production**, voir §11 |
| Backend | Meta Graph API (CAPI) | HTTPS | Access token par boutique (`MetaAdsConfig.access_token`, chiffré) — **handshake TLS bloqué par l'infrastructure HF**, voir §6 |
| Backend | Cloudinary | HTTPS (SDK `cloudinary`) | `CLOUDINARY_URL` ou triplet `CLOUDINARY_CLOUD_NAME`/`_API_KEY`/`_API_SECRET` |
| Backend | Noest API | HTTPS | Token/GUID par boutique (`DeliveryPartner.api_config_encrypted`) |
| Backend | Yalidine API | HTTPS | Token par boutique, même mécanisme |
| Next.js middleware | Backend | HTTPS | `x-internal-key` (résolution de domaine, sans session utilisateur disponible à ce niveau) |

### 1.6 Diagramme Mermaid

```mermaid
flowchart TB
    subgraph Client["Client / Navigateur"]
        Browser["Navigateur (client, confirmatrice, livreur, admin)"]
    end

    subgraph Vercel["Vercel — Frontend Next.js"]
        MW["middleware.ts — résolution domaine → store_id, injection identité"]
        Proxy["/api/[...path]/route.ts — proxy générique vers backend"]
        Pages["Pages: storefront [slug], /lp/[slug], admin/agent/livreur"]
    end

    subgraph HF["Hugging Face Spaces — Backend FastAPI (Docker)"]
        API["app/main.py — ~30 routers /api/v1/*"]
        Tenant["TenantMiddleware — filtre store_id"]
        Services["services/: order_service, meta_capi, noest_sync, inventory_service..."]
        BgLoop["asyncio background_loop() — Noest sync 10min, reminders 120s, Meta CAPI retry sweep"]
        Redis[("Redis — rate limiting + refresh tokens\n⚠️ injoignable en prod actuellement")]
    end

    subgraph External["Services externes"]
        PG[("PostgreSQL\n(Neon probable, à confirmer)")]
        Cloudinary["Cloudinary — images"]
        Meta["Meta Graph API\n⚠️ TLS bloqué depuis HF"]
        Noest["Noest API — livraison"]
        Yalidine["Yalidine API — livraison"]
    end

    Browser -->|HTTPS, cookie __session| Pages
    Browser -->|Pixel direct, ne passe PAS par le backend| Meta
    Pages --> MW
    MW -->|x-internal-key, résolution domaine| API
    Pages -->|fetch /api/v1/*| Proxy
    Proxy -->|cookie ou x-internal-key| API
    API --> Tenant
    Tenant --> Services
    Services --> PG
    Services -->|upload image| Cloudinary
    Services -->|CAPI Purchase/ViewContent/...| Meta
    Services -->|dispatch colis| Noest
    Services -->|dispatch colis| Yalidine
    API --> Redis
    BgLoop --> Services
    API -.->|démarré au boot, asyncio.create_task| BgLoop
```

---

## 2. Architecture multi-tenant

### 2.1 Principe général

Le modèle `Store` (`app/models/store.py`, table `stores`) est la racine de la multi-tenance. La quasi-totalité des tables métier portent une colonne `store_id` (liste exhaustive en §3). L'isolation entre boutiques repose sur **deux mécanismes complémentaires** :

1. **Isolation automatique au niveau ORM** (`app/core/tenant.py`) — un hook SQLAlchemy `do_orm_execute` (`set_tenant_isolation_event`) intercepte **chaque SELECT** et y ajoute une clause `with_loader_criteria(Base, store_id == <tenant courant>)` sur toute entité possédant un attribut `store_id`. C'est une isolation globale, appliquée automatiquement, qu'un développeur ne peut pas oublier d'ajouter manuellement dans une requête.
2. **`TenantMiddleware`** (`app/core/tenant.py`, `BaseHTTPMiddleware`) — lit le header `X-Store-Id` (ou `X-Resolved-Store-Id` si le `Host` n'est pas un domaine de la plateforme), positionne un `contextvars.ContextVar` (`tenant_store_id`) pour la durée de la requête, le réinitialise en `finally`.

**Bypass pour SUPER_ADMIN/ADMIN** : dans `app/api/deps.py::get_current_user()` (lignes 80-87), si le rôle résolu est `SUPER_ADMIN` ou `ADMIN`, le code positionne `tenant_store_id.set("SUPER_ADMIN_MODE")` et `db.info["skip_tenant_isolation"] = True`. Le hook `tenant.py` vérifie explicitement ce flag et cette valeur sentinelle pour désactiver le filtrage automatique — ces deux rôles voient donc toutes les boutiques sans filtre. Le même bypass est utilisé manuellement dans `app/main.py` pour les tâches de démarrage/fond qui doivent parcourir toutes les boutiques (recovery CAPI, diagnostic stores, etc.).

### 2.2 Pour chaque boutique

| Donnée | Où elle vit | Chiffrement |
|---|---|---|
| **Store** | Table `stores` — `id`, `slug` (unique), `domain` (unique, nullable), `owner_id`, `theme_config` (JSON), `operations_config` (JSON — règles métier NRP, fusion doublons), `marketing_config` (JSON chiffré) | `marketing_config` chiffré partiellement (voir ci-dessous) |
| **Domaine** | `Store.domain` (unique) — ex. `trustshop.azghub.com`, ou domaine personnalisé | — |
| **Landing Pages** | Table `landing_pages`, FK `store_id` (`ondelete=CASCADE`) | — |
| **Produits** | Table `products`, FK `store_id`, contrainte unique `(store_id, slug)` | — |
| **Pixel Meta** | **Deux emplacements distincts, à ne pas confondre** — voir §2.4 | Partiellement (le token) |
| **Access Token Meta** | Idem — soit `Store.marketing_config['fb_access_token']`, soit `MetaAdsConfig.access_token` | Oui (Fernet), voir §2.4 |
| **Dataset / Business ID Meta** | **Absent du modèle de données actuel.** `MetaAdsConfig` a `ad_account_id`, `pixel_id`, `domain_verification_tag`, mais pas de champ dataset/business ID dédié. Si ces identifiants sont utilisés ailleurs dans le code applicatif (dashboard Meta Ads), ils n'ont pas été localisés dans les modèles — probablement absents ou stockés ad hoc dans un champ JSON non documenté. **À vérifier si cette donnée est réellement utilisée avant la migration.** |
| **Noest** | Table `delivery_partners` (une ligne par boutique par transporteur, `carrier_id`/`code = "noest"`) — credentials (`api_token`, `guid`) dans `api_config_encrypted` (Text, JSON sérialisé via `encrypt_dict`/`decrypt_dict`) | Oui si `ENCRYPTION_KEY` est définie, **fallback silencieux en clair sinon** |
| **Livreur** | Pas de table dédiée par boutique — un `User` avec `role="LIVREUR"` est lié à une commande via `Order.livreur_id`, pas via une affectation boutique à l'avance. Voir §2.5. | — |
| **Paramètres** | `Store.theme_config`, `Store.operations_config` (JSON libres) | — |
| **Utilisateurs** | Table `users`, liaison à une/plusieurs boutiques via `employee_store_id` (mono-boutique) ou `assigned_store_scope`/`assigned_store_ids` (multi-boutique, voir §2.5) | — |
| **Permissions** | Champ `role` texte libre sur `User` (`SUPER_ADMIN`, `ADMIN`, `MANAGER`, `CONFIRMATEUR`, `LIVREUR`, `MARKETER`, `CUSTOMER`) — pas de table de permissions granulaires, la logique d'autorisation est codée en dur dans chaque endpoint (`if current_user.role not in [...]`) | — |

### 2.3 Résolution de domaine personnalisé → boutique

1. Le client accède à `trustshop.azghub.com` (ou un domaine custom).
2. `src/middleware.ts::resolveDomainToStore(hostname)` — vérifie d'abord un cache mémoire local (`domainCache`, TTL 5 min, par instance edge Next.js), sinon appelle le backend : `GET /api/v1/stores/lookup/domain?domain=trustshop.azghub.com` avec header `x-internal-key`.
3. Backend (`app/api/v1/stores.py:270-293`) — cherche `Store` où `domain == X OR slug == X`, retourne `{storeId, storeSlug}` ou 404.
4. Le middleware pose les headers `x-store-id`/`x-store-slug` sur la réponse et réécrit le chemin interne vers `/{storeSlug}/...` (sauf pour `/lp/*`, qui reçoit plutôt `store_id`/`store` en query params — voir §8).
5. Pour les appels API backend qui suivent (`x-store-id` devient le `X-Store-Id` que lit `TenantMiddleware` côté backend).

### 2.4 Précision importante — Pixel Meta stocké à deux endroits différents

Ce point mérite d'être signalé clairement car il peut prêter à confusion pendant une migration ou un audit :

- **`Store.marketing_config`** (JSON chiffré via `EncryptedJSON`, qui ne chiffre que la clé `fb_access_token` à l'intérieur du JSON, le reste — `facebook_pixel_id`, `tiktok_pixel_id`, etc. — reste en clair) : c'est le pixel utilisé pour le **tracking client côté storefront/landing page** (injection du script `fbq(...)`, voir §8.2).
- **`MetaAdsConfig`** (table séparée `meta_ads_configs`, une ligne par boutique, `access_token` chiffré via `EncryptedString`) : c'est la configuration utilisée par le **module de reporting/sync Meta Ads** (`app/api/v1/meta_ads.py`) et par l'**envoi CAPI serveur** (`app/services/meta_capi.py`).

Ces deux configurations peuvent théoriquement diverger (pixel ID différent, token différent) si elles ne sont pas maintenues en synchronisation manuellement — il n'y a pas de mécanisme automatique qui les garde alignées.

### 2.5 Livreur vs Confirmatrice — deux modèles d'affectation différents

- **CONFIRMATEUR/MANAGER** — accès gouverné par `employee_store_id` (boutique unique) OU `assigned_store_scope="ALL"` (toutes boutiques) OU `assigned_store_scope="SPECIFIC"` + `assigned_store_ids` (liste de boutiques). Utilisé dans la logique d'auto-assignation des commandes (`app/services/order_service.py`, ~ligne 390).
- **LIVREUR** — n'utilise **pas** `employee_store_id`/`assigned_store_scope` pour le contrôle d'accès. Il ne voit que les commandes où `Order.livreur_id == son_id` directement (`app/api/v1/orders.py:80-83`), et ses transitions de statut autorisées sont restreintes à `SHIPPED`/`DELIVERED`/`RETURNED`/`CANCELLED` sans droit de réaffectation. Son "périmètre boutique" est donc implicite et par commande, pas une liste configurée à l'avance.

---

## 3. Base de données

27 fichiers de modèles sous `app/models/`, tous enregistrés dans `app/models/__init__.py` (import explicite requis pour qu'Alembic/`create_all` les détecte — **tout nouveau modèle doit être ajouté à ce fichier**, sinon sa table ne sera jamais créée).

### 3.1 Tables centrales

#### `stores` (classe `Store`)
Racine multi-tenant. `id`, `name`, `slug` (unique), `domain` (unique, nullable), `theme_config`/`operations_config`/`social_links` (JSON), `marketing_config` (**EncryptedJSON**, chiffre uniquement `fb_access_token`), `owner_id` (FK → `users.id`), `assignment_logic`/`auto_reassign_minutes`/`assignment_active` (règles d'auto-affectation des commandes).
Relations : `owner`, `employees`, `products`, `orders`, `customers`, `promotions`, `wallets`, `financial_transactions`, `audit_logs`, `reviews`, `warehouses`, `suppliers`, `purchases`, `returns`, `expenses`, `delivery_partners` (cascade delete-orphan sur cette dernière).

#### `users` (classe `User`)
`id`, `email` (unique), `hashed_password`, `role` (texte libre, défaut `"CONFIRMATEUR"`), `employee_store_id` (FK → `stores.id`), `assigned_store_scope` (`ALL`|`SPECIFIC`), `assigned_store_ids` (JSON liste), `assigned_product_ids` (JSON liste), `payment_type`/`payment_amount` (rémunération), `tracking_code` (unique — code affilié pour attribution marketing).
Relations : `owned_stores`, `employee_store`, `assigned_orders`, `audit_logs`.

#### `products` (classe `Product`)
`id`, `store_id` (FK, contrainte unique composite avec `slug`), `price`/`compare_price`/`cost_price` (Integer, DA), `stock`/`reserved_stock`/`low_stock_threshold`, `images` (JSON liste), **`variants`** (JSON, non typé au niveau modèle — forme réelle définie côté frontend `src/lib/types.ts::ProductVariant` : `{id?, name, value, sku?, stock?, reserved?, price?, image?, color?, priceModifier?}`), `delivery_fees` (JSON — `{is_free, fees: {carrier_id: {wilaya_id: {home, desk}}}}`), plus ~20 colonnes de coût de production (`prod_*`) pour un usage de fabrication interne.
Relations : `store`, `stock_movements` (cascade), `reviews` (cascade), `order_items`, `delivery_partners` (via table d'association `product_delivery_partners`).

#### `orders` (classe `Order`) + `order_items` (classe `OrderItem`)
`id`, `store_id` (FK), `order_number` (unique — référence client), `store_sequence_number` (numéro séquentiel par boutique pour l'affichage admin), `status` (texte libre : `NEW`/`ASSIGNED`/`CALLED`/`CONFIRMED`/`SHIPPED`/`DELIVERED`/`RETURNED`/`CANCELLED`/`MERGED`/`ABANDONED`), `assigned_to` (FK → `users.id`, confirmatrice), `livreur_id` (FK → `users.id`, livreur), `carrier_id` (FK → `delivery_partners.id`), `tracking_number`, colonnes d'attribution complètes (`utm_source/medium/campaign/content/term`, `campaign_id`/`adset_id`/`ad_id`, `fbclid`/`fbp`/`fbc`), `is_abandoned_cart`/`recovered_at`, `parent_order_id` (fusion de doublons), `nrp_count`/`next_callback_time`.
`OrderItem` : snapshot au moment de la commande (`product_name`, `unit_price`, `variant_details` JSON) — ne dépend pas de l'état actuel du produit.
Relations : `store`, `assignee`, `livreur`, `customer`, `items` (cascade), `events` (cascade — historique), `carrier`.

#### `meta_capi_logs` (classe `MetaCapiLog`)
File d'attente persistante des évènements Meta Conversions API. `id`, `store_id` (FK), `order_id` (String, **pas de contrainte FK réelle déclarée**), `event_name`, `event_id`, **`status`** (`success`|`error`|`pending_retry`|`failed`), `error_message`/`error_category`, `payload` (JSON — évènement complet, rejouable tel quel), **`retry_count`**, **`next_retry_at`**, `latency_ms`.
Voir §6 pour le flux complet.

#### `landing_pages` (classe `LandingPage`)
`id`, `store_id` (FK, `ondelete=CASCADE`), `product_id` (FK → `products.id`, `ondelete=SET NULL`, nullable), `slug`, `mode` (`product`|`standalone`), `views`/`orders` (compteurs), contenu marketing complet (`headline`, `benefits`/`testimonials`/`steps`/`stats`/`faq`/`gallery` en JSON), `tracking_config` (JSON — `{pixel_id, event_name}`, **distinct** du pixel de `Store.marketing_config`, voir note ci-dessous).

#### `delivery_partners` (classe `DeliveryPartner`) + `delivery_fee_grids` + `product_delivery_partners`
`id`, `store_id` (FK, `ondelete=CASCADE`), `carrier_id` (mappé à la colonne DB `"code"` — ex. `"noest"`, `"yalidine"`), `api_config_encrypted` (**Text brut, PAS le type `EncryptedString`/`EncryptedJSON`** malgré son nom — voir finding critique en §12).

### 3.2 Autres tables (rôle, relations, clés étrangères)

| Table | Classe | Rôle | FK principales |
|---|---|---|---|
| `audit_logs` | `AuditLog` | Journal d'audit générique (diff JSON avant/après) | `actor_id`→users, `store_id`→stores |
| `customers` | `Customer` | Client final, agrégé par téléphone par boutique | `store_id`→stores |
| `wilaya_delivery_fees` | `WilayaDeliveryFee` | Grille tarifaire de livraison par wilaya (58 lignes, globale, pas de `store_id`) | aucune |
| `expenses` | `Expense` | Dépenses (marketing, loyer, salaires...) | `store_id`→stores, `wallet_id`→wallets, `created_by`→users |
| `wallets` | `Wallet` | Portefeuille (banque/cash/mobile/COD) par boutique | `store_id`→stores |
| `financial_transactions` | `FinancialTransaction` | Mouvements financiers (paiement COD, disbursement...) | `store_id`→stores, `wallet_id`→wallets |
| `internal_deliveries` | `InternalDelivery` | Une ligne par commande livrée en interne (livreur) | `driver_id`→users, `order_id`→orders (unique) |
| `notifications` | `Notification` | Notifications in-app | `user_id`→users (nullable = broadcast admin), `store_id`→stores, `order_id`→orders |
| `partner_api_keys`, `partner_webhooks` | `PartnerApiKey`, `PartnerWebhook` | Accès API tiers / webhooks sortants par boutique | `store_id`→stores |
| `payroll_records` | `PayrollRecord` | Paie mensuelle par utilisateur (contrainte unique `user_id`+`period`) | `user_id`→users |
| `pos_sessions`, `pos_sales`, `pos_sale_items` | `POSSession`, `POSSale`, `POSSaleItem` | Point de vente physique | `store_id`→stores, `user_id`→users, `product_id`→products |
| `promotions` | `Promotion` | Codes promo | `store_id`→stores |
| `purchases`, `purchase_items` | `Purchase`, `PurchaseItem` | Bons de commande fournisseur | `store_id`→stores, `supplier_id`→suppliers, `warehouse_id`→warehouses |
| `returns`, `return_items` | `Return`, `ReturnItem` | Retours fournisseur | `store_id`, `supplier_id`, `warehouse_id`, `purchase_id`(nullable) |
| `reviews` | `Review` | Avis produits | `product_id`→products (`SET NULL`), `store_id`→stores |
| `order_statuses` | `OrderStatusConfig` | Statuts personnalisables par boutique | `store_id`→stores |
| `stock_movements` | `StockMovement` | Historique de tout mouvement de stock (RESTOCK/ORDER_RESERVE/ORDER_CONFIRM/ORDER_RELEASE/RETURN_RESTOCK/MANUAL_ADJUSTMENT) | `product_id`→products, `order_id`→orders(nullable), `actor_id`→users |
| `suppliers` | `Supplier` | Fournisseurs | `store_id`→stores |
| `upsell_rules`, `upsell_offers`, `upsell_commissions` | idem | Règles et commissions d'upsell | `store_id`, `product_id`, `order_id`, `user_id` |
| `warehouses` | `Warehouse` | Entrepôts | `store_id`→stores |
| `marketing_channels`, `message_templates`, `marketing_automations`, `marketing_logs`, `store_visitors`, `marketing_campaigns` | (dans `marketing.py`) | Marketing multicanal (WhatsApp/Instagram/SMS/Email), tracking visiteurs | `store_id`→stores |
| `meta_ads_configs` | `MetaAdsConfig` | Config Meta Ads (une par boutique, `store_id` unique) — `access_token` **EncryptedString**, `ad_account_id`, `pixel_id` | `store_id`→stores (unique) |
| `tiktok_ads_configs`, `tiktok_ads_campaigns` | idem pour TikTok | Même structure que Meta | `store_id`→stores |
| `meta_ads_campaigns` | `MetaAdsCampaign` | Cache local des campagnes Meta (spend, impressions, reach) | `store_id`→stores |

**Points d'attention relationnels** :
- `MetaCapiLog.order_id`, `FinancialTransaction.created_by`, `PayrollRecord.generated_by`/`paid_by` sont des colonnes String **sans contrainte FK réelle** malgré leur nom — aucune intégrité référentielle appliquée par la base pour ces champs.
- `DeliveryPartner.api_config_encrypted` : voir le finding critique en §12 — ce n'est pas un `EncryptedString`/`EncryptedJSON`, c'est un `Text` brut.

### 3.3 Emplacements récapitulatifs (réponse directe aux points demandés)

- **Pixels** : `Store.marketing_config['facebook_pixel_id']` (storefront) et `MetaAdsConfig.pixel_id` (module Ads).
- **Tokens Meta** : `Store.marketing_config['fb_access_token']` (chiffré) et `MetaAdsConfig.access_token` (chiffré, `EncryptedString`).
- **Landing Pages** : table `landing_pages`.
- **Commandes** : table `orders` + `order_items`.
- **Utilisateurs** : table `users`.
- **Boutiques** : table `stores`.
- **Évènements CAPI** : table `meta_capi_logs`.

---

## 4. Variables d'environnement

### 4.1 Backend — via `app/core/config.py` (classe `Settings`, pydantic-settings)

| Variable | Obligatoire ? | Utilisée où | Impact si absente |
|---|---|---|---|
| `PROJECT_NAME` | Non (défaut `"AzzougShop Industrial API"`) | config.py, main.py, logging | Titre/logger par défaut |
| `API_V1_STR` | Non (défaut `/api/v1`) | config.py, main.py, rate_limit.py | Préfixe API par défaut |
| `VERSION` | Non (défaut `1.0.0`) | config.py, main.py | Version par défaut |
| `POSTGRES_SERVER`/`PORT`/`USER`/`PASSWORD`/`DB` | Non (défauts locaux) | Construction d'URL de secours | Utilisés seulement si aucune `DATABASE_URL`/`POSTGRES_URL*` n'est fournie |
| **`DATABASE_URL`** | **Effectivement obligatoire en prod** | `app/db/session.py` — moteur créé à l'import | Sans elle ni `POSTGRES_URL*`, fallback SQLite local — **inadapté en production**, l'app démarrerait sur une base vide et isolée |
| `POSTGRES_URL_NON_POOLING` / `POSTGRES_URL` | Non | Alternative à `DATABASE_URL` (convention Vercel/Neon) | Ignorées si absentes |
| **`SECRET_KEY`** | **Obligatoire en production** (`ENVIRONMENT=production`) | `app/core/security.py` — signature JWT | Dev : défaut non sécurisé `"CHANGE_ME_IN_PRODUCTION"` (faille — JWT signés avec une clé connue publiquement). Prod : `_validate_production_settings()` lève une `ValueError` au démarrage si la valeur par défaut est encore active → **le serveur refuse de démarrer** |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Non (défaut 60) | security.py | Expiration token à 60 min par défaut |
| **`INTERNAL_API_KEY`** | **Obligatoire en production** | `app/api/deps.py` — bypass serveur-à-serveur | Dev : défaut `"development_key"` (prévisible). Prod : lève `ValueError` au démarrage si défaut inchangé → **échec de démarrage** |
| **`ENCRYPTION_KEY`** | **Obligatoire en production** | `app/core/encryption.py` (lu directement via `os.environ`, pas via `settings`) | Absente : chiffrement Fernet désactivé, les colonnes `EncryptedString`/`EncryptedJSON` (tokens Meta/TikTok, `fb_access_token`) sont stockées **en clair**, dégradation silencieuse, pas de crash. Prod : lève `ValueError` au démarrage si absente → échec de démarrage |
| `ENVIRONMENT` | Non (défaut `"development"`) | error_handlers.py, gate des validations prod | Mode dev par défaut ; les vérifications strictes ci-dessus (`SECRET_KEY`/`INTERNAL_API_KEY`/`ENCRYPTION_KEY` obligatoires) sont **entièrement sautées** si non positionnée à `"production"` |
| `BACKEND_CORS_ORIGINS` | Non (défaut `localhost:3000,3016`) | main.py — CORS | Origines autorisées limitées à localhost ; `"*"` en prod fait lever une erreur au démarrage |
| `REDIS_HOST` / `REDIS_PORT` | Non (défauts `localhost`/`6379`) | redis.py, rate_limit.py, session.py, et calcul de `CELERY_BROKER_URL`/`CELERY_RESULT_BACKEND` | Voir §11 — dégradation silencieuse pour le rate limiting, **casse fonctionnelle réelle** pour le refresh token |

### 4.2 Backend — lues directement via `os.environ`/`os.getenv` (hors classe `Settings`)

| Variable | Obligatoire ? | Utilisée où | Impact si absente |
|---|---|---|---|
| `NOEST_SYNC_INTERVAL_MINUTES` | Non (défaut `"10"`) | `noest_sync.py:45` | Intervalle de sync Noest à 10 min |
| `REMINDER_SCAN_INTERVAL_SECONDS` | Non (défaut `"120"`) | `noest_sync.py:46` | Scan des rappels toutes les 120s |
| `DISABLE_BACKGROUND_SYNC` | Non (valeur `"1"` pour désactiver) | `noest_sync.py:271` | Si absente, la boucle de fond démarre normalement |
| `META_CAPI_CONNECT_TIMEOUT` | Non (défaut `"5.0"`) | `meta_capi.py:99` | Timeout de connexion CAPI à 5s |
| `META_CAPI_READ_TIMEOUT` | Non (défaut `"15.0"`) | `meta_capi.py:100` | Timeout de lecture CAPI à 15s |
| `META_CAPI_QUEUE_ALERT_THRESHOLD` | Non (défaut `"100"`) | `meta_capi.py:981` | Seuil d'alerte de file d'attente CAPI |
| `UPLOAD_DIR` | Non (défaut `"uploads"`) | `upload.py:23` | Dossier local de fallback si Cloudinary absent — **éphémère sur un hébergeur sans disque persistant** |
| `CLOUDINARY_URL` | Non | `upload.py` | Si absent/invalide, tente les 3 variables suivantes |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Non (mais l'un des deux jeux requis pour la persistance des images) | `upload.py` | Si aucun jeu complet n'est configuré, upload en fallback disque local éphémère, avertissement loggé |
| `NEXT_PUBLIC_API_URL` / `BACKEND_URL` | Non | `upload.py:71` — construction d'URL absolue pour fichiers uploadés localement | Chaîne de fallback : `BACKEND_URL` → `SPACE_ID` → headers de requête → `http://localhost:8003` |
| `SPACE_ID` | Non | `upload.py:76-79` | Variable auto-injectée par Hugging Face Spaces — **disparaît après la migration**, voir §14 |

### 4.3 Scripts utilitaires racine (hors API, migrations/seeds ad hoc)

Une trentaine de scripts (`fix_*.py`, `seed_*.py`, `check_*.py`, `debug_*.py`) à la racine lisent `DATABASE_URL` directement sans passer par `Settings` — la plupart plantent immédiatement si elle est absente. Non utilisés par l'API en production, mais à connaître si l'équipe de migration en dépend pour des opérations ponctuelles.

### 4.4 Frontend (Next.js) — pour référence, contexte de migration

| Variable | Utilisée où | Rôle |
|---|---|---|
| `BACKEND_URL` | `src/middleware.ts`, `src/app/api/[...path]/route.ts`, `src/lib/utils.ts` | URL directe du backend pour le proxying serveur — **c'est la variable à changer en priorité lors de la migration** |
| `NEXT_PUBLIC_API_URL` | idem | URL publique de fallback |
| `VERCEL_URL` | idem | URL de déploiement Vercel auto-injectée, fallback de dernier recours |
| `INTERNAL_API_KEY` | `middleware.ts`, `route.ts`, routes Yalidine/Noest | Doit être **identique** côté frontend et backend |
| `SECRET_KEY` / `JWT_SECRET` | `src/lib/jwt-core.ts` | Doit correspondre à la logique de vérification JWT — voir §9 |

⚠️ **Finding annexe (hors scope migration mais à signaler)** : `src/app/api/noest/label/route.ts` contient une valeur de fallback codée en dur pour `NOEST_API_TOKEN` (un token qui ressemble à un vrai secret). C'est une odeur de secret committé en clair dans le code source — à faire auditer/révoquer séparément, indépendamment de la migration.

---

## 5. Démarrage de l'application

### 5.1 Absence de `lifespan` — style legacy `@app.on_event`

Le projet **n'utilise pas** de `lifespan` context manager. Pas de fichier `startup.py` séparé non plus — tout est inline dans `app/main.py`, sous forme de 5 handlers `@app.on_event("startup")` distincts, exécutés **séquentiellement dans l'ordre de déclaration** :

1. **`run_db_migrations()`** — patchs de schéma ad hoc en SQL brut (hors Alembic), avec `try/except: pass` généralisé (échecs silencieux, typiquement "colonne déjà existante"). Inclut un backfill de `store_sequence_number` pour toute commande où il est `NULL`.
2. **`start_background_sync()`** — `asyncio.create_task(background_loop())` (voir §5.4), fire-and-forget, ne bloque pas le démarrage.
3. **`resume_pending_queues()`** — attend 3 secondes, puis lance en tâche de fond un sweep immédiat de la file CAPI (`[StartupRecovery]` dans les logs) si des évènements `pending_retry` existent.
4. **`create_initial_superadmin()`** — upsert d'un compte `SUPER_ADMIN` fixe (`nadjibazzoug@gmail.com`) : le crée s'il n'existe pas, sinon réinitialise mot de passe/rôle/statut actif à chaque démarrage.
5. **`log_database_stores()`** — rapport diagnostic (`[StartupDiag]`) : liste chaque boutique avec ses produits et landing pages.

**Aucun handler de shutdown** — les tâches de fond ne sont pas annulées proprement à l'arrêt.

### 5.2 Middlewares (ordre d'exécution réel, extérieur → intérieur)

`VercelPrefixMiddleware` → `RequestLoggingMiddleware` → `TenantMiddleware` → `DistributedRateLimitMiddleware` → `CORSMiddleware`.

(Note : Starlette applique les middlewares dans l'ordre **inverse** de leur enregistrement via `add_middleware()` pour le chemin de requête — l'ordre ci-dessus est l'ordre d'exécution réel, pas l'ordre d'écriture dans le code.)

`VercelPrefixMiddleware` mérite une attention particulière en migration : c'est un middleware ASGI brut (pas `BaseHTTPMiddleware`) qui retire un préfixe `/_/backend` du chemin et positionne `scope["root_path"]`, spécifiquement pour fonctionner derrière un proxy Vercel. **Ce comportement est probablement à revoir/désactiver si le nouveau hébergeur n'est plus proxifié de la même façon par Vercel** (à vérifier selon la configuration finale — voir §14).

### 5.3 Alembic

- `alembic/env.py` ignore l'URL du fichier `alembic.ini` et utilise `settings.DATABASE_URL` au runtime.
- Applique `SET lock_timeout TO '3s'` avant migration (sauf SQLite) — échoue rapidement plutôt que de bloquer d'autres requêtes tenant si un verrou exclusif n'est pas obtenu en 3s.
- 32 fichiers de révision sous `alembic/versions/`, incluant une fusion de heads (`6e53c68d4928_merge_heads.py`) — l'historique a déjà connu des conflits de head.

**Séquence de démarrage `start.sh`** (celle réellement utilisée, voir §5.6) :
1. Boucle d'attente Postgres (`SELECT 1` via SQLAlchemy, `sleep 3` entre tentatives).
2. Détection de l'état du schéma : `has_alembic` (table `alembic_version` existe), `has_users` (base pré-hydratée sans tracking Alembic), ou `fresh`.
3. Branchement :
   - `has_alembic` → `alembic upgrade head`. **En cas d'échec, ne bloque PAS le démarrage** — exécute `alembic stamp head --purge` (marque la version comme à jour sans modifier le schéma) et continue quand même.
   - `has_users` → `alembic stamp head` seul (pas de migration réelle exécutée).
   - `fresh` → crée le schéma complet via `Base.metadata.create_all()` directement depuis les modèles SQLAlchemy (contournant Alembic), puis stamp.
4. `exec uvicorn app.main:app --host 0.0.0.0 --port 8000`.

⚠️ **Ce design tolère délibérément les échecs de migration** en les "stamps-over" plutôt que de faire planter le conteneur — c'est un compromis explicite (disponibilité > cohérence stricte du schéma), mais cela signifie qu'une dérive de schéma silencieuse est possible si `upgrade head` échoue et se fait "stamper" sans que personne ne le remarque. **Point de vigilance pour la migration : vérifier l'état réel du schéma en base avant de considérer que les migrations sont "à jour".**

### 5.4 Background tasks — Noest sync + reminders + Meta CAPI retry (même boucle)

**Un seul `asyncio.create_task`**, pas APScheduler, pas de threading séparé : `background_loop()` dans `app/services/noest_sync.py`, démarré une fois au boot.

- Boucle `while True`, `await asyncio.sleep(REMINDER_SCAN_INTERVAL_SECONDS)` (défaut 120s) en fin d'itération.
- **À chaque tick** (120s) : `scan_due_reminders()` — notifie les confirmatrices des rappels dus.
- **Tous les `NOEST_SYNC_INTERVAL_MINUTES`** (défaut 10 min, via un accumulateur interne) :
  - `sync_noest_once()` — poll groupé (un POST par boutique) des commandes `SHIPPED` avec tracking, vers `/api/public/get/trackings/info`. Mappe les statuts terminaux Noest vers les statuts internes via `order_service.update_order` (donc déclenche COD, restock, commissions, notifications identiquement à une mise à jour manuelle).
  - `scan_payroll_reminder()` — rappel mensuel de paie.
  - **`await asyncio.to_thread(retry_pending_events)`** — **c'est exactement le mécanisme de planification du sweep de retry Meta CAPI**, voir §6.
- Chaque sous-tâche est dans son propre `try/except` — un échec Noest ne bloque pas les autres.
- `DISABLE_BACKGROUND_SYNC=1` désactive toute la boucle (retour anticipé) — utilisé en test/CI.

Le sweep CAPI est aussi déclenché une seconde fois, indépendamment, par `resume_pending_queues()` au démarrage (§5.1, point 3). Les deux points d'appel sont protégés par un **`threading.Lock`** partagé (`_sweep_lock`) à acquisition non-bloquante, pour éviter une race si les deux se chevauchent.

### 5.5 Circuit breaker Meta CAPI

Décrit en détail en §6. Résumé : après 5 échecs de connexion consécutifs, les tentatives immédiates sont suspendues 60s, le client HTTP pooled est détruit et reconstruit à la prochaine tentative pour éviter de réutiliser un socket keep-alive corrompu.

### 5.6 ⚠️ Découverte critique — deux Dockerfiles, un seul est réellement déployé

Le repo contient **deux** Dockerfiles avec un comportement de démarrage radicalement différent :

| | `Dockerfile` (racine, primaire) | `Dockerfile.hf` |
|---|---|---|
| Port exposé | 8000 | 7860 |
| Démarre Redis ? | Non | Oui (`redis-server --daemonize yes`) |
| Démarre Celery worker ? | Non | Oui (`celery worker -Q main-queue,heavy-queue --detach`) |
| Démarre Celery beat ? | Non | Oui (`celery beat --detach`) |
| Script utilisé | `start.sh` (attente DB, gestion d'échec de migration) | `start_hf.sh` (pas d'attente DB, pas de `set -e`, `alembic upgrade head` inconditionnel) |

Le `README.md` (frontmatter Hugging Face) déclare `app_port: 8000` — ce qui **correspond au `Dockerfile` primaire, pas à `Dockerfile.hf`** (qui utiliserait 7860, la convention standard des Spaces HF).

**Preuve à l'exécution** : tous les logs observés sur ce projet montrent de façon répétée `Redis unavailable for rate limiting: Error 111 connecting to localhost:6379. Connection refused.` — ce qui ne serait **pas possible** si `Dockerfile.hf`/`start_hf.sh` était réellement utilisé, puisque ce script démarre Redis localement en premier.

**Conclusion vérifiée** : Hugging Face Spaces construit et exécute le `Dockerfile` **primaire** (port 8000), pas `Dockerfile.hf`. Par conséquent :
- Redis ne tourne pas en production actuellement.
- Celery worker et Celery beat ne tournent pas non plus.
- La tâche planifiée `auto-reassign-inactive-orders-every-5-min` (réaffectation automatique des commandes inactives après 2h) **ne s'exécute jamais** en production actuellement.
- Le seul appel `.delay()` observé dans le code (`sync_store_inventory.delay(store.id)` à la création d'une boutique, `app/api/v1/stores.py:212`) est entouré d'un `try/except: pass` (commentaire : *"Celery may not be running in dev"*) — échoue donc silencieusement, sans effet visible, sans erreur remontée.

Ce point est central pour la section Risques (§15) et pour comprendre pourquoi certains comportements observés en production (déconnexions après ~60 minutes, tâches de réaffectation qui ne se déclenchent jamais) sont liés à Redis étant indisponible plutôt qu'à un bug applicatif — voir §11 pour l'analyse complète.

### 5.7 Cloudinary

Voir §10 pour le détail. En résumé côté démarrage : aucune initialisation bloquante — si `CLOUDINARY_URL` (ou le triplet `CLOUDINARY_CLOUD_NAME`/`_API_KEY`/`_API_SECRET`) n'est pas valide, un `WARNING` est loggé au démarrage et chaque upload individuel bascule sur le disque local du conteneur (éphémère).

---

## 6. Meta CAPI — flux complet

### 6.1 Flux, du navigateur à Meta

```
Navigateur (client sur le storefront/landing page)
    │
    ├──► Meta Pixel (fbq('track', ...)) ── DIRECT, ne passe JAMAIS par le backend
    │
    └──► POST /api/v1/meta-ads/events (mirroring CAPI pour ViewContent/AddToCart/InitiateCheckout)
              │
              ▼
         Backend FastAPI (app/api/v1/meta_ads.py)
              │
              ▼
         app/services/meta_capi.py :: send_events()
              │
              ├─► Succès (200 + events_received) ──► MetaCapiLog.status = "success"
              │
              └─► Échec ──► retryable ?
                        │
                        ├─► Oui (timeout/connexion/5xx) ──► MetaCapiLog créé/mis à jour,
                        │                                    status="pending_retry",
                        │                                    next_retry_at = maintenant + backoff
                        │
                        └─► Non (4xx définitif) ──► status="error" (pas de retry)

         [Boucle de fond, toutes les NOEST_SYNC_INTERVAL_MINUTES (défaut 10 min)]
              │
              ▼
         retry_pending_events() ──► pre-flight probe (DNS+TCP+TLS) ──► circuit ouvert ?
                        │                                                    │
                        │                                                   Oui ──► bulk defer,
                        │                                                            retry_count NON incrémenté
                        │
                        Non ──► tentative réelle par évènement dû (next_retry_at <= now)
                                       │
                                       ├─► succès ──► status="success"
                                       │
                                       └─► échec ──► retry_count += 1
                                                          │
                                                          ├─► retry_count < 6 ──► reprogrammé (backoff)
                                                          │
                                                          └─► retry_count >= 6 ──► status="failed" (TERMINAL,
                                                                                     plus jamais retenté)
```

Pour le **Purchase** spécifiquement, le flux diverge légèrement : l'évènement Pixel est envoyé côté navigateur immédiatement après la réponse de création de commande (`src/components/storefront/checkout-form.tsx`, `mirrorToCapi: false` — ne repasse pas par `/meta-ads/events`), tandis que la moitié CAPI est émise **directement côté backend** au moment de la création de la commande, avec le même `event_id` partagé (`purchase-{order.id}`) pour permettre à Meta de dédupliquer les deux signaux.

### 6.2 Queue et statuts

Table `meta_capi_logs` (voir §3.1). Quatre statuts :
- `success` — livré à Meta, `events_received` renseigné.
- `error` — échec définitif non-retryable (ex. token invalide, 4xx).
- `pending_retry` — en attente de nouvelle tentative, `next_retry_at` définit quand.
- `failed` — **statut terminal**. Atteint après 6 tentatives réelles (`retry_count >= _MAX_QUEUE_RETRIES = 6`). Le sweep de retry ne requête que `status == "pending_retry"` — **un évènement `failed` n'est plus jamais repris automatiquement**, il est définitivement perdu pour Meta (mais reste en base pour audit/inspection manuelle).

### 6.3 Backoff

`_QUEUE_BACKOFF_MINUTES = [1, 5, 20, 60, 180, 480]` — soit 1min, 5min, 20min, 1h, 3h, 8h entre tentatives successives (~13.5h de fenêtre totale avant d'atteindre le statut `failed`).

### 6.4 Circuit breaker

Après **5 échecs de connexion consécutifs**, le circuit "s'ouvre" : les tentatives immédiates sont suspendues pendant 60 secondes, et le client HTTP `httpx` pooled est **détruit et reconstruit** à la prochaine tentative (pour éviter de réutiliser un socket keep-alive potentiellement corrompu par les échecs précédents).

**Comportement important pour la compréhension des logs** : si le sweep périodique tombe pendant que le circuit est ouvert, les évènements dus sont **bulk-déférés en un seul lot** (`"circuit breaker open: bulk deferred"`) **sans incrémenter `retry_count`** — cela évite de gaspiller le budget de retry limité sur des tentatives vouées à l'échec pendant que le réseau est bloqué, mais signifie aussi qu'un évènement peut rester indéfiniment en `pending_retry` sans jamais atteindre le statut `failed`, tant que le circuit est systématiquement ouvert à chaque passage du sweep.

### 6.5 Statut `pending_retry` vs `failed` — implications pratiques

Une fraction significative des évènements accumulés (observé en production : des files de 1000 à 3000+ évènements en attente) a très probablement déjà atteint le statut `failed` compte tenu de la persistance du blocage réseau observé sur plusieurs jours — **il n'existe actuellement aucun compteur/dashboard exposant le nombre d'évènements réellement `failed` par opposition à `pending_retry`**, ce qui serait une amélioration utile à ajouter indépendamment de la migration.

### 6.6 Client HTTP

Un unique `httpx.Client` pooled, réutilisé entre appels (`app/services/meta_capi.py`), avec :
- Transport diagnostique custom forçant la résolution IPv4 uniquement et un clamp de MSS TCP.
- Timeouts configurables séparés connect/read (`META_CAPI_CONNECT_TIMEOUT`/`META_CAPI_READ_TIMEOUT`).
- Le client est re-récupéré (`_get_client()`) à **chaque tentative** dans la boucle de retry immédiat (pas une seule fois avant la boucle) — correction appliquée suite à un bug où un client détruit en cours de boucle par le circuit breaker causait `RuntimeError: Cannot send a request, as the client has been closed` sur les tentatives suivantes de la même boucle.

### 6.7 Endpoint de santé

`GET /api/v1/meta-ads/health?store_id=...` — probe live DNS+TCP+TLS vers `graph.facebook.com`, état du circuit breaker, statistiques de file, validité du token (`debug_token`), accessibilité du pixel, versions runtime (Python/OpenSSL/httpx/httpcore/certifi).

`GET /api/v1/meta-ads/connectivity-test` — diagnostic à 6 sondes (stdlib TLS brut, httpx HTTP/1.1, urllib, hôte de contrôle httpbin.org, TCP port 80 seul) — **c'est cet endpoint qui a permis de confirmer avec certitude que le blocage TLS est spécifique à Meta et à l'infrastructure Hugging Face**, pas un bug de code (voir résultats détaillés dans l'historique de ce projet — TCP se connecte en quelques ms, TLS échoue systématiquement après ~8s de timeout, alors qu'un hôte de contrôle différent réussit en 21ms dans le même processus).

### 6.8 Cause racine du blocage TLS (contexte pour la migration)

**Ce n'est pas un bug de code.** Trois implémentations HTTP/TLS indépendantes (stdlib Python `ssl`, `httpx`, `urllib`) échouent identiquement (DNS et TCP réussissent en quelques ms, la négociation TLS elle-même expire après ~8s), alors qu'un hôte de contrôle différent (httpbin.org) réussit instantanément dans le même environnement. C'est la signature caractéristique d'un filtrage réseau au niveau SNI ou d'un blocage de plage IP appliqué sur l'infrastructure partagée de Hugging Face, ciblant spécifiquement les domaines Meta. **C'est précisément le problème que cette migration doit résoudre** — un hébergeur sans cette restriction réseau résoudra ce point sans aucun changement de code.

---

## 7. Noest — fonctionnement complet

### 7.1 Stockage des credentials

Une ligne dans `delivery_partners` par boutique par transporteur (`carrier_id`/`code = "noest"`). Les credentials (`api_token`, `guid`) sont un JSON stocké dans `api_config_encrypted` (colonne `Text`), chiffré/déchiffré via `encrypt_dict`/`decrypt_dict` (`app/core/encryption.py`). **Si `ENCRYPTION_KEY` n'est pas définie, fallback silencieux en JSON clair** — voir le finding critique en §12 sur l'incohérence de ce champ avec le typage `EncryptedString`/`EncryptedJSON` utilisé ailleurs.

### 7.2 Dispatch (commande confirmée → colis créé chez Noest)

Endpoint : `POST /api/noest/parcels` (`app/api/carriers/noest.py`) — action **manuelle**, pas automatique à la confirmation d'une commande.

1. Récupération et déchiffrement du token/guid de la boutique.
2. Résolution de la wilaya : `map_wilaya_name_to_id()` — normalisation accents/casse/caractères arabes, correspondance contre une liste statique de 58 wilayas, défaut à 16 (Alger) si aucune correspondance.
3. Résolution de la commune : `find_best_commune_match()` — récupère (et cache en mémoire pour la durée du process) la liste réelle des communes depuis l'API Noest (`GET /api/public/get/communes?wilaya_id=`), puis tente dans l'ordre : (0) table de correspondance explicite `EXPLICIT_MAPPING` (~35 cas connus de divergence orthographique), (1) correspondance exacte normalisée, (2) correspondance par sous-chaîne, (3) correspondance floue (`difflib`, seuil 0.8), (4) fallback sur l'override même sans correspondance vue.
4. Construction du payload (`user_guid`, `reference`, `client`, `phone`, `adresse`, `wilaya_id`, `commune`, `montant`, `produit`, `remarque`, `type_id`, `stop_desk`, `poids`) et `POST /api/public/create/order`.
5. Logique de retry intégrée : en cas d'erreur de validation du code de bureau relais, retente une fois avec la casse inversée ; en cas d'erreur de commune, retente une fois avec un fallback (`wilaya` ou `"Chef-lieu"`).
6. Au succès : `order.tracking_number` renseigné, `order.status` → `"SHIPPED"` (sauf si déjà `SHIPPED`/`DELIVERED`), et invariant appliqué : un colis transporteur et un `livreur_id` interne ne peuvent jamais coexister — si un livreur interne était assigné, il est retiré et un évènement d'audit est journalisé.

### 7.3 Retour de statut (Noest → ERP)

Deux mécanismes, tous deux routés via `order_service.update_order()` (jamais une écriture directe de `order.status`) — donc paiement COD, restock retour, palier client, notifications, commissions et salaires se déclenchent identiquement quelle que soit la source de la mise à jour :

1. **Webhook** — `POST /api/noest/webhook` : parse `tracking`/`statut`, mappe via une petite table (`livré`→`DELIVERED`, `retourné`→`RETURNED`, `en route`/`collecté`→`SHIPPED`), retrouve la commande par `tracking_number`.
2. **Sync par polling** — dans la même boucle de fond que le CAPI (§5.4), toutes les `NOEST_SYNC_INTERVAL_MINUTES` (défaut 10 min). Ne poll que les boutiques ayant un partenaire Noest actif **et** au moins une commande `SHIPPED` avec tracking — zéro appel API sinon. Tous les trackings d'une boutique sont groupés en un seul `POST /api/public/get/trackings/info`. Seuls les statuts terminaux sont mappés (`_TERMINAL_MAP`) — les états intermédiaires sont ignorés, la commande reste `SHIPPED` jusqu'au statut final. Un verrou ligne (`with_for_update`) protège contre une course avec une modification manuelle simultanée par une confirmatrice.

### 7.4 Paiement / rappels / réconciliation COD

Il n'existe **pas** d'appel dédié Noest de "confirmation de paiement COD" — l'ERP traite le passage à `DELIVERED` lui-même comme le déclencheur du paiement. Dans `order_service.py::update_order()`, si `new_status == "DELIVERED" and old_status != "DELIVERED"`, `_record_delivery_payment()` est appelée : crée une `FinancialTransaction` (type `PAYMENT`, référence `COD-{order_number}`) contre le `Wallet` de la boutique, incrémente `balance`/`total_in` du montant total de la commande. Si la commande était une récupération de panier abandonné, une transaction de type `DISBURSEMENT` déduit également les frais de récupération du même wallet.

Effet net : que `DELIVERED` provienne du webhook, du polling 10 minutes, ou d'un changement manuel par le staff, c'est le **même chemin de code unique** qui marque le colis livré **et** encaisse le cash COD dans le wallet de la boutique.

---

## 8. Landing Pages

### 8.1 Comment elles sont servies

Route Next.js : `src/app/lp/[slug]/page.tsx`, Server Component.

### 8.2 Comment elles trouvent leur boutique

Priorité stricte, dans cet ordre :
1. `searchParams.store_id` — un UUID injecté par `src/middleware.ts` lorsqu'il résout le hostname vers une boutique via `resolveDomainToStore()` et réécrit `/lp/{slug}` en y ajoutant `store_id`/`store`. Le commentaire dans le code est explicite : **"We NEVER let a user-provided ?store= override the domain-resolved tenant"**.
2. Fallback (dev local uniquement) — si aucun `store_id` n'est présent, la page fetch `GET /api/v1/stores` (toutes les boutiques) et matche par slug via `?store=`, ou prend la première boutique par défaut.
3. Si aucune résolution possible → `notFound()`.

### 8.3 Comment elles récupèrent leurs produits

Pas d'appel séparé. `GET /api/v1/landing-pages/slug/{slug}?store_id={storeId}` (avec ISR `revalidate: 10`) retourne un objet unique qui **embarque déjà** le produit lié (`lp.product`, si `product_id` est défini) — nom, prix, images, variants, `delivery_fees`. Toute la page se construit depuis cette seule réponse.

### 8.4 Comment elles récupèrent leur Pixel

**Appel totalement séparé** : `GET /api/v1/meta-ads/config?store_id={storeId}` (donc `MetaAdsConfig`, pas `Store.marketing_config` — voir la distinction en §2.4). Le résultat est passé à `<StorefrontIntegrations config={metaAdsConfig} />` (`src/components/storefront/store-integrations.tsx`), qui injecte le script Facebook Pixel standard (`fbq('init', pixel_id)`, `fbq('track', 'PageView')`) via `next/script` en `strategy="afterInteractive"`, plus une balise `facebook-domain-verification` si configurée.

Note : l'endpoint `landing-pages/slug/{slug}` **n'inclut aucune config pixel** dans sa réponse — c'est délibérément deux appels séparés.

### 8.5 Comment elles appellent le backend

Uniquement en lecture côté serveur (SSR, deux `fetch` : landing page + config pixel). Les interactions utilisateur ultérieures (ajout panier, checkout) passent par le proxy générique `/api/[...path]` côté client, comme le reste du storefront.

### 8.6 Différence avec le storefront principal (`src/app/[slug]/page.tsx`)

Le storefront résout sa boutique depuis le segment d'URL `slug` lui-même (déjà réécrit par le middleware pour les domaines non-LP), fetch aussi la config pixel de la même façon, mais résout en plus un **utilisateur connecté** côté serveur via le cookie `__session` (`initialUser`) — la page LP passe toujours `initialUser={null}`, les landing pages étant conçues pour du trafic publicitaire anonyme, sans hydratation de session.

---

## 9. Authentification

### 9.1 Cookies

- `__session` — access token JWT, `httponly=True`, `samesite="lax"`, `secure=(ENVIRONMENT=="production")`, `max_age=ACCESS_TOKEN_EXPIRE_MINUTES*60` (défaut 60 min).
- `__refresh` — refresh token (UUID opaque), mêmes attributs, `max_age` fixé à 7 jours en dur à chaque point d'émission.

### 9.2 JWT

- Librairie : **python-jose**, algorithme **HS256**, signé avec `SECRET_KEY`.
- Payload : `{exp, sub: user_id, iss: "multistore-platform", role, email, storeId}`.
- Hash de mot de passe : **bcrypt** brut (pas passlib), `bcrypt.checkpw`/`bcrypt.hashpw`.

### 9.3 Refresh — mécanisme et ⚠️ dépendance critique à Redis

`app/core/session.py` — les refresh tokens sont des UUID opaques dont **l'unique preuve de validité vit dans Redis** (pas de table en base) :
- `create_refresh_token()` — stocke `{user_id, used: False}` sous `auth:refresh:{token_id}` (TTL 7j), ajoute l'id à un set `auth:user_tokens:{user_id}`.
- `rotate_refresh_token()` — rotation à usage unique avec détection de réutilisation : si le token a déjà été marqué `used`, c'est traité comme un **signal de compromission** → révocation de **toutes** les sessions de l'utilisateur.
- **Si Redis est injoignable** : `create_refresh_token()` retourne un UUID jamais stocké ; `rotate_refresh_token()` retourne `(uuid4(), "")` — un `user_id` vide. Le prochain appel à `/auth/refresh` avec ce token cherchera `User.id == ""`, ne trouvera personne, et retournera 401 + effacement des cookies.

**Conséquence directement vérifiable dans ce projet** : Redis étant confirmé injoignable en production (§5.6, §11), **le rafraîchissement de session est actuellement cassé pour tous les utilisateurs** — chaque utilisateur est forcé de se reconnecter entièrement toutes les **60 minutes** (durée de vie de l'access token), quel que soit l'état des cookies eux-mêmes. C'est une cause structurelle des déconnexions inattendues observées, indépendante de tout bug de transmission de cookie.

### 9.4 Bypass interne serveur-à-serveur

`x-internal-key` (doit égaler `INTERNAL_API_KEY`) + `x-user-id` optionnel :
- Avec `x-user-id` et clé valide → agit en tant que cet utilisateur précis.
- Avec clé valide seule (pas de `x-user-id`) → agit en tant que "utilisateur système" (premier `SUPER_ADMIN` trouvé, sinon premier utilisateur).
- Avec `x-user-id` mais clé invalide → **401 immédiat** ("Direct API access with forged X-User-Id is forbidden") — ce header ne peut jamais être usurpé silencieusement.

**Usage légitime** : le middleware Next.js n'a pas de session navigateur disponible (résolution de domaine, appels edge) — ce mécanisme lui permet d'appeler le backend avec une identité de confiance sans JWT. Dangereux uniquement si `INTERNAL_API_KEY` fuite, car il octroie un accès effectivement superutilisateur.

### 9.5 Rôles

`SUPER_ADMIN` / `ADMIN` (accès total, bypass tenant), `MANAGER` (scope boutique unique via `employee_store_id`), `CONFIRMATEUR` (rôle par défaut, gestion de commandes selon scope boutique), `LIVREUR` (accès par commande assignée uniquement, transitions de statut restreintes), `MARKETER` (rôle d'attribution/affiliation, pas d'opérations boutique), `CUSTOMER` (client final, créé à l'auto-inscription publique).

### 9.6 Middlewares

`app/api/deps.py::get_current_user()` — résolution dans l'ordre : bypass interne avec `x-user-id` → bypass interne sans `x-user-id` (utilisateur système) → JWT/cookie classique. `get_current_active_user()` (401 si inactif), `get_current_user_optional()` (retourne `None` au lieu de lever, pour les endpoints à comportement mixte invité/connecté), `get_current_active_superuser()` (403 sauf SUPER_ADMIN/ADMIN).

Côté frontend, `src/middleware.ts` laisse passer `/api/v1/*` et `/api/auth/*` sans intervention (le backend gère tout), mais pour les routes de **page**, décode le JWT du cookie `__session` **sans vérifier la signature** (pas de crypto disponible côté edge runtime — la vérification réelle est faite côté FastAPI) pour injecter `x-user-id`/`x-user-role`/`x-user-store-id` en headers, à l'usage des Server Components et du proxy `/api/auth`.

---

## 10. Upload

### 10.1 Cloudinary

SDK `cloudinary` (Python), configuré via `CLOUDINARY_URL` (format `cloudinary://key:secret@cloud_name`) ou le triplet `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET`. Utilisé pour les images produits et médias de landing pages/bannières.

### 10.2 Fallback local

Si Cloudinary n'est pas configuré (ou que l'upload Cloudinary échoue à l'exécution), le fichier est écrit sur le disque local du conteneur (`UPLOAD_DIR`, défaut `./uploads`), servi ensuite via `GET /api/v1/upload/files/{filename}`.

**⚠️ Sur un hébergeur au disque éphémère (Hugging Face Spaces actuellement) — et potentiellement le nouvel hébergeur selon son type — tout fichier stocké en fallback local est perdu à chaque redémarrage du conteneur.** C'est un problème déjà identifié et documenté dans les échanges précédents avec l'équipe sur ce projet.

### 10.3 Ce qui utilise l'upload

Images produits (`POST /upload/image`, ≤10 Mo, jpeg/png/webp/gif/avif), médias bannière/landing page (`POST /upload/media`, images ≤10 Mo ou vidéos ≤100 Mo).

---

## 11. Redis — analyse complète

### 11.1 Où il est utilisé exactement

Trois usages, dans quatre fichiers (`app/core/redis.py`, `app/core/rate_limit.py`, `app/core/session.py`, consommateurs dans `app/api/v1/auth.py`) :

1. **Rate limiting** (`app/core/rate_limit.py`) — limites par IP (3000 GET/min, 600 write/min), par utilisateur (600 write/min), par plan boutique, et anti-brute-force sur l'authentification (actuellement désactivé au niveau de l'appel dans `/auth`, mais toujours actif pour `/auth/refresh`). Implémenté en fenêtre glissante atomique via `INCR`+`TTL`+`EXPIRE`.
2. **Stockage des refresh tokens** (`app/core/session.py`) — **Redis est l'unique source de vérité**, aucune table en base ne sauvegarde cet état. Voir §9.3.
3. **Rien d'autre** — pas de cache produit/page, pas de Celery en pratique (le broker Celery est configuré pour pointer vers Redis, mais Celery ne tourne pas en production, voir §5.6), pas de pub/sub.

Note : `app/core/tenant.py` mentionne Redis uniquement dans des **commentaires** hypothétiques — la résolution de domaine n'est pas réellement mise en cache par Redis côté backend (le cache existe côté frontend, en mémoire locale par instance edge Next.js, `middleware.ts::domainCache`, TTL 5 min).

### 11.2 Que se passe-t-il lorsqu'il est absent

Code exact : `app/core/rate_limit.py::_get_redis()` tente un `ping()` ; toute exception déclenche le log `"Redis unavailable for rate limiting: %s. Using in-memory fallback."`, positionne un flag module-level `_redis_unavailable = True` (arrête de retenter pour la durée du process), et retourne `None`.

- **Rate limiting** → bascule sur `_mem_sliding_window_check()`, un dictionnaire en mémoire protégé par `threading.Lock`, par processus. **Correct pour une seule instance** (le code le confirme explicitement en commentaire : *"works for single-instance deployments like HF Spaces"*). **Dégradé pour un déploiement multi-instances** : chaque réplique a ses propres compteurs indépendants — un client répondant sur N répliques obtient effectivement N× la limite prévue. C'est une dégradation de la protection anti-abus, pas une rupture de correction fonctionnelle pour un utilisateur légitime.
- **Refresh tokens** → **cassé sans condition**, dès une seule instance. Pas de fallback mémoire pour les refresh tokens (contrairement au rate limiting) — voir mécanisme exact en §9.3. Chaque utilisateur est forcé à une reconnexion complète toutes les 60 minutes.

### 11.3 Composants réellement dépendants de Redis

| Composant | Dépendance | Sévérité si Redis absent |
|---|---|---|
| Rate limiting | Optionnelle (dégrade en mode mono-instance, cassée en multi-instances) | Faible à 1 instance, moyenne à N instances (sécurité, pas correction) |
| Refresh token / session | **Obligatoire** pour la correction fonctionnelle | **Élevée** — déconnexions forcées toutes les 60 min, indépendamment du nombre de répliques |
| Celery (broker) | Le broker est configuré pour pointer vers Redis, mais Celery lui-même ne tourne pas en production (§5.6) | N/A actuellement, mais si Celery était activé sur le nouvel hébergeur, Redis deviendrait nécessaire pour cette fonctionnalité |

**Recommandation directe pour la migration** : provisionner un Redis persistant et accessible sur le nouvel hébergeur est un prérequis pour corriger le problème de déconnexion, indépendamment du choix de migrer ou non le reste. Ce n'est pas une amélioration optionnelle, c'est la correction d'un bug de correction fonctionnelle actif.

---

## 12. Dépendances externes

| Service | Rôle précis | Obligatoire pour le fonctionnement de base ? |
|---|---|---|
| **Meta Graph API** | Réception des évènements Conversions API (ViewContent/AddToCart/InitiateCheckout/Purchase) pour l'optimisation publicitaire ; lecture des campagnes/insights pour le dashboard Meta Ads | Non pour le fonctionnement de l'ERP lui-même (les commandes se créent indépendamment), mais critique pour la performance publicitaire — **actuellement bloqué depuis Hugging Face, voir §6.8** |
| **Cloudinary** | Stockage persistant des images produits/bannières | Non techniquement obligatoire (fallback disque local existe), mais **fonctionnellement indispensable** pour ne pas perdre les images à chaque redémarrage |
| **Noest** | Transporteur de livraison — création de colis, suivi, statuts | Oui pour les boutiques qui l'utilisent comme transporteur principal |
| **Yalidine** | Second transporteur, même rôle que Noest | Oui pour les boutiques qui l'utilisent |
| **PostgreSQL** | Base de données unique, source de vérité de tout le système | **Absolument obligatoire** |
| **Redis** | Rate limiting + refresh tokens (voir §11) | **Obligatoire pour un fonctionnement correct** (actuellement absent en production, cause des déconnexions) |
| **Sentry** | Présent dans `requirements.txt` (`sentry_sdk`) et référencé dans `app/core/error_handlers.py` (appels `capture_exception`) | **Non actif** — `sentry_sdk.init()` n'est appelé nulle part dans le code, donc ces appels sont des no-op silencieux. Dépendance installée mais inerte. |
| **Vercel** | Hébergement du frontend Next.js | Oui, mais **totalement indépendant** de la migration du backend |

**⚠️ Finding critique — `DeliveryPartner.api_config_encrypted` n'est pas réellement chiffré au niveau ORM** : contrairement à `Store.marketing_config` (EncryptedJSON) et `MetaAdsConfig.access_token`/`TikTokAdsConfig.access_token` (EncryptedString), la colonne stockant les credentials Noest/Yalidine est un `Text` brut. Le nom de la colonne et un commentaire dans le code (*"stored as plain JSON text (no encryption key required in dev)"*) suggèrent qu'un chiffrement applicatif via `encrypt_dict`/`decrypt_dict` est censé être appliqué manuellement par le service (`app/api/carriers/noest.py::_creds()` semble faire ce déchiffrement), mais ce n'est **pas garanti par le typage de la colonne** — une écriture directe en base (script, migration manuelle) pourrait facilement y stocker du JSON en clair sans que rien ne l'empêche au niveau du modèle. **À vérifier explicitement avant la migration : les tokens Noest/Yalidine actuellement en base sont-ils chiffrés ou en clair ?** (Dépend uniquement de si `ENCRYPTION_KEY` était définie au moment de leur écriture ET si le code appelant a effectivement utilisé `encrypt_dict`.)

---

## 13. Hébergement — ce qui dépend réellement de Hugging Face

### 13.1 Dépendances directes à Hugging Face

- **`SPACE_ID`** (variable auto-injectée par HF) — utilisée dans `app/api/v1/upload.py` pour construire l'URL publique des fichiers uploadés en fallback local (`https://{space}.hf.space`). **Disparaît après migration** — remplacée naturellement par `BACKEND_URL`/`NEXT_PUBLIC_API_URL` (déjà prioritaires dans la chaîne de fallback, donc aucun changement de code requis, juste s'assurer que ces variables sont bien positionnées sur le nouvel hébergeur).
- **`README.md` frontmatter** (`title`, `emoji`, `sdk: docker`, `app_port: 8000`) — spécifique au système de build HF Spaces, sans effet sur un autre hébergeur (peut être laissé tel quel ou supprimé, inoffensif).
- **`Dockerfile.hf` / `start_hf.sh`** — variante Hugging-Face-spécifique (Redis+Celery embarqués dans le même conteneur). **Confirmé non utilisée actuellement** (§5.6) — si l'équipe de migration décide de vouloir Celery fonctionnel sur le nouvel hébergeur, cette variante peut servir de base, mais avec Redis externalisé plutôt qu'embarqué dans le même conteneur (bonne pratique générale, pas spécifique à HF).
- **Le blocage réseau TLS vers Meta** (§6.8) — c'est une restriction de l'infrastructure réseau partagée de Hugging Face Spaces elle-même, pas une configuration explicite du projet. **C'est la motivation principale de cette migration.**

### 13.2 Totalement indépendant de Hugging Face

- Toute la logique applicative (`app/api/`, `app/services/`, `app/models/`) — code Python standard, aucune dépendance à une API Hugging Face.
- La base de données PostgreSQL — hébergée séparément (probablement Neon, à confirmer), continue de fonctionner sans changement.
- Cloudinary — service externe indépendant.
- Le frontend Next.js/Vercel — complètement séparé, communique avec le backend uniquement via `BACKEND_URL`.
- Le `Dockerfile` primaire (celui réellement utilisé) — image Docker standard `python:3.11-slim`, déployable sur n'importe quel hébergeur supportant Docker (Railway, Koyeb, Render, VPS avec Docker, etc.) sans modification.
- Alembic, les modèles SQLAlchemy, la logique de démarrage (`start.sh`) — génériques, aucune dépendance HF.

---

## 14. Migration — ce qu'il faut faire précisément

### 14.1 Ce qui doit être déplacé

1. **Le conteneur backend** — construire et déployer l'image depuis le `Dockerfile` **primaire** (racine du repo, port 8000) sur le nouvel hébergeur. Ne pas utiliser `Dockerfile.hf` tel quel (il embarque Redis/Celery dans le même conteneur, ce qui n'est généralement pas la meilleure pratique pour un hébergeur non-HF — préférer un Redis externalisé, managé ou en conteneur séparé).
2. **Toutes les variables d'environnement listées en §4.1 et §4.2**, en particulier :
   - `DATABASE_URL` (ou `POSTGRES_URL_NON_POOLING`) — **valeur identique**, la base ne bouge pas.
   - **`SECRET_KEY`** — **valeur strictement identique**, sinon tous les JWT existants (sessions actives) deviennent invalides instantanément à la bascule (déconnexion de tous les utilisateurs actifs, sans perte de données mais avec interruption de service ressentie).
   - **`ENCRYPTION_KEY`** — **valeur strictement identique**, sinon tous les tokens Meta/TikTok chiffrés (`MetaAdsConfig.access_token`, `TikTokAdsConfig.access_token`, `Store.marketing_config['fb_access_token']`) deviennent **définitivement illisibles** (le déchiffrement échoue, `decrypt_string`/`decrypt_dict` retombent sur un fallback JSON-clair qui échoue aussi puisque la donnée est un blob chiffré, pas du JSON — la donnée est perdue, pas juste inaccessible temporairement, sauf à la ressaisir manuellement).
   - **`INTERNAL_API_KEY`** — **valeur strictement identique**, sinon le proxy Next.js (Vercel) ne peut plus authentifier ses appels serveur-à-serveur vers le nouveau backend (résolution de domaine cassée, entre autres).
   - `CLOUDINARY_URL` (ou triplet) — identique si on veut conserver l'accès aux mêmes images déjà uploadées.
   - Toutes les autres variables de §4.1/§4.2, avec leurs valeurs actuelles.
3. **Un Redis persistant et accessible** (§11) — à provisionner sur le nouvel hébergeur (managé ou conteneur dédié), avec `REDIS_HOST`/`REDIS_PORT` pointant vers lui. **C'est l'occasion de corriger le bug de déconnexion identifié en §9.3/§11**, qui n'est pas spécifique à Hugging Face mais qui n'a jamais été résolu faute de Redis fonctionnel.
4. **`BACKEND_URL`/`NEXT_PUBLIC_API_URL` côté Vercel** — à mettre à jour vers la nouvelle URL du backend, une fois celui-ci déployé et vérifié.

### 14.2 Ce qui reste inchangé

- Le frontend Next.js sur Vercel — aucune modification de code requise, seulement la variable d'environnement d'URL backend.
- La base de données PostgreSQL — aucune migration de données nécessaire si l'hébergeur de la base ne change pas (seule la connexion réseau depuis le nouveau backend doit être vérifiée : IP whitelisting éventuel côté fournisseur DB à mettre à jour si le nouvel hébergeur a une IP sortante différente).
- Cloudinary — aucun changement, les images déjà uploadées restent accessibles via leurs URLs Cloudinary existantes stockées en base.
- Le code applicatif lui-même (`app/`) — aucune réécriture nécessaire pour le déplacement en tant que tel (les seuls changements de code utiles seraient des améliorations indépendantes, comme réactiver Celery correctement si souhaité, ou ajouter un compteur d'évènements CAPI `failed`).
- Alembic/les migrations — s'appliquent identiquement, `start.sh` gère déjà la détection d'état de schéma de façon hébergeur-agnostique.

### 14.3 Ce qui ne doit surtout pas être modifié pendant la migration

- **`SECRET_KEY`, `ENCRYPTION_KEY`, `INTERNAL_API_KEY`** — ne jamais en générer de nouvelles au moment de la migration, même par précaution "sécurité". Toujours réutiliser les valeurs exactes actuellement configurées sur Hugging Face. Une régénération doit être un projet séparé, planifié, avec une procédure de rotation (ré-chiffrement des données existantes), pas un effet de bord de la migration.
- **Le contenu de `app/models/`** — toute modification de schéma pendant la migration complique inutilement la validation "rien n'a changé, juste l'hébergeur a bougé". Traiter la migration et toute évolution de schéma comme deux projets séparés.
- **La logique de `start.sh`** (tolérance aux échecs de migration) — ne pas la durcir en `set -e` strict sans concertation, c'est un choix délibéré de disponibilité qui a ses raisons (documentées en §5.3), même si imparfait.
- **Ne pas migrer/déployer le contenu du dossier `backend/`** — ce n'est pas le code source de vérité (voir §1.3).

---

## 15. Risques

### 15.1 Perte de secrets (le risque le plus critique)

Si `SECRET_KEY`, `ENCRYPTION_KEY` ou `INTERNAL_API_KEY` sont perdus, mal copiés, ou régénérés par erreur pendant la migration :
- `SECRET_KEY` différent → tous les JWT actifs deviennent invalides instantanément. Impact : tous les utilisateurs connectés sont déconnectés simultanément à la bascule. Pas de perte de données, mais interruption de service perçue pour tout le monde en même temps.
- `ENCRYPTION_KEY` différent ou absent → tous les tokens Meta/TikTok stockés chiffrés deviennent **irrécupérables**. Impact : toutes les boutiques doivent reconfigurer leur intégration Meta Ads/TikTok Ads manuellement (ressaisir les tokens d'accès). Pas de perte de commandes/produits/clients, mais perte réelle d'une configuration qui devra être refaite à la main.
- `INTERNAL_API_KEY` différent → le frontend Vercel ne peut plus authentifier ses appels serveur-à-serveur (résolution de domaine notamment) tant que la variable n'est pas synchronisée des deux côtés. Symptôme : storefronts inaccessibles par domaine personnalisé.

**Mitigation** : copier ces trois valeurs directement depuis les secrets Hugging Face Spaces existants vers le nouvel hébergeur, sans les retaper manuellement (risque de faute de frappe) — les récupérer via l'interface HF Spaces (Settings → Repository secrets) et les coller telles quelles.

### 15.2 Redis absent ou mal configuré sur le nouvel hébergeur

Comme documenté en §11, l'absence de Redis casse silencieusement le refresh de session (déconnexions forcées toutes les 60 minutes) sans qu'aucune erreur ne soit visible côté utilisateur autre que "je dois me reconnecter souvent". **Ce risque existe déjà aujourd'hui** — la migration est l'occasion de le corriger en provisionnant un Redis fonctionnel, pas de le reproduire à l'identique sur le nouvel hébergeur.

### 15.3 Confusion avec le dossier `backend/` dupliqué

Un ingénieur non familier du projet pourrait raisonnablement supposer que `backend/` (avec son propre `alembic/`, `app/`, `venv/`) est une variante ou une version plus récente du code, et migrer/déployer le mauvais dossier. Vérifié : aucun Dockerfile ni script n'y fait référence — le code de vérité est à la racine, sous `app/`. **Mitigation** : documenter/renommer clairement ce dossier (`backend.OLD/` ou équivalent) avant que quelqu'un d'autre ne le touche, ou le supprimer après confirmation qu'il ne contient rien d'unique.

### 15.4 Confusion entre `Dockerfile` et `Dockerfile.hf`

Comme détaillé en §5.6, ces deux fichiers ont des comportements de démarrage radicalement différents (l'un démarre Redis/Celery localement, l'autre non). Utiliser le mauvais sur le nouvel hébergeur changerait le comportement de production de façon non-intentionnelle (par exemple, si `Dockerfile.hf` est utilisé par erreur, Celery beat commencerait soudainement à réaffecter automatiquement les commandes inactives après 2h — un comportement qui n'existe pas actuellement en production et qui surprendrait les confirmatrices). **Mitigation** : décider explicitement et documenter lequel des deux devient la référence sur le nouvel hébergeur, et supprimer ou clairement marquer l'autre comme obsolète.

### 15.5 IP sortante différente — accès base de données et services tiers

Si la base de données (probablement Neon) ou Cloudinary appliquent un allowlisting d'IP source, la nouvelle IP sortante du backend (Railway/Koyeb/VPS) devra être ajoutée avant la bascule, sous peine de coupure d'accès à la base au premier démarrage. À vérifier explicitement — aucune preuve dans le code que cet allowlisting existe actuellement, mais c'est une pratique courante à ne pas découvrir en production.

### 15.6 Schéma de base potentiellement en dérive silencieuse

Comme noté en §5.3, `start.sh` "stamp" la version Alembic même quand `upgrade head` échoue, plutôt que de faire planter le déploiement. Si cela s'est déjà produit dans le passé sur ce projet, l'état réel du schéma Postgres pourrait diverger de ce que les fichiers de migration `alembic/versions/` décrivent. **Mitigation avant migration** : sur la base de production actuelle, comparer explicitement `alembic current` avec `alembic heads`, et idéalement faire un diff de schéma réel (ex. via `alembic check` si la version le supporte, ou un outil externe) plutôt que de faire confiance aveuglément à la table `alembic_version`.

### 15.7 Downtime pendant la bascule DNS/URL

Le frontend Vercel pointe vers `BACKEND_URL`. Le changement de cette variable et son redéploiement ne sont pas instantanés (propagation de variable d'environnement + rebuild Vercel). Prévoir une fenêtre de bascule où l'ancien backend HF reste actif en parallèle jusqu'à confirmation que le nouveau fonctionne, plutôt qu'un couper-remplacer immédiat — la base de données étant partagée, les deux backends peuvent cohabiter brièvement sans conflit tant qu'aucune migration de schéma n'est en cours simultanément.

### 15.8 File CAPI en attente au moment de la bascule

Au moment de la migration, il y aura très probablement des milliers d'évènements `meta_capi_logs` en statut `pending_retry` (accumulés à cause du blocage TLS actuel). Le nouveau backend, une fois démarré, exécutera le sweep de démarrage (`resume_pending_queues`, §5.1) et tentera de tous les traiter d'un coup — si le nouvel hébergeur a effectivement un accès réseau débloqué vers Meta, cela peut générer un pic soudain de milliers d'appels sortants vers l'API Graph en quelques minutes. Vérifier que cela ne déclenche pas de rate-limiting côté Meta lui-même (limites d'appels par token/app) — envisager de traiter ce backlog progressivement plutôt que de laisser le sweep automatique tout envoyer d'un coup si le volume est très important.

### 15.9 Tâches de fond dupliquées si l'ancien et le nouveau backend tournent simultanément

La boucle de fond (`background_loop`, §5.4) et le sweep CAPI n'ont pas de coordination inter-processus au-delà du `threading.Lock` local à un seul process — si l'ancien backend (HF) et le nouveau tournent en parallèle pendant la fenêtre de bascule (§15.7) et pointent tous les deux vers la **même base de données**, les deux exécuteront indépendamment la sync Noest, les rappels, et le sweep CAPI, avec un risque de doublons (notifications envoyées deux fois, tentatives CAPI envoyées deux fois vers Meta pour le même évènement — bien que Meta déduplique par `event_id`, donc ce cas précis est probablement sans conséquence grave). **Mitigation** : couper `DISABLE_BACKGROUND_SYNC=1` sur l'ancien backend HF dès que le nouveau backend est validé et avant de le laisser tourner en parallèle plus longtemps que nécessaire pour la validation.
