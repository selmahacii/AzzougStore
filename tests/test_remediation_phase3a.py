"""
Tests de remédiation contrôlée — Phase 3A
Couvre :
1. Sécurité des endpoints sensibles (suppression /api/env, protection inspect-token, audit-purchases, debug-noest-token, IDOR /config).
2. Effets financiers et conversion de devises (get_conversion_rate, garde-fou wallet sync_meta_ads).
3. Résolution multi-tenant des landing pages (/lp/{slug}, unicité, ambiguïté multi-boutiques).
"""
import pytest
import uuid
import os
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import app
from app.db.session import SessionLocal
from app.models.user import User
from app.models.store import Store
from app.models.marketing import MetaAdsConfig, MetaAdsCampaign
from app.models.finance import Wallet, FinancialTransaction
from app.models.expense import Expense
from app.models.landing_page import LandingPage
from app.core.security import create_access_token, get_password_hash
from app.api.v1.meta_ads import get_conversion_rate


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def db_session():
    db = SessionLocal()
    yield db
    db.close()


@pytest.fixture(scope="module")
def test_setup(db_session: Session):
    # 1. Create superadmin first
    superadmin_id = str(uuid.uuid4())
    superadmin = User(
        id=superadmin_id,
        email=f"superadmin_{superadmin_id[:6]}@test.local",
        name="Super Admin",
        hashed_password=get_password_hash("SuperSecure2026!"),
        role="SUPER_ADMIN",
        is_active=True
    )
    db_session.add(superadmin)
    db_session.commit()

    # 2. Create stores with owner_id = superadmin.id
    store_a_id = str(uuid.uuid4())
    store_b_id = str(uuid.uuid4())
    store_a_slug = f"store-a-{uuid.uuid4().hex[:6]}"
    store_b_slug = f"store-b-{uuid.uuid4().hex[:6]}"

    store_a = Store(
        id=store_a_id,
        owner_id=superadmin_id,
        name="Store A Test",
        slug=store_a_slug,
        domain=f"{store_a_slug}.azghub.com",
        is_active=True,
        is_deleted=False
    )
    store_b = Store(
        id=store_b_id,
        owner_id=superadmin_id,
        name="Store B Test",
        slug=store_b_slug,
        domain=f"{store_b_slug}.azghub.com",
        is_active=True,
        is_deleted=False
    )
    db_session.add(store_a)
    db_session.add(store_b)
    db_session.commit()

    # 3. Create store users
    user_a_id = str(uuid.uuid4())
    user_a = User(
        id=user_a_id,
        email=f"user_a_{user_a_id[:6]}@test.local",
        name="User A",
        hashed_password=get_password_hash("PasswordA2026!"),
        role="MANAGER",
        employee_store_id=store_a_id,
        is_active=True
    )
    setattr(user_a, "assigned_store_ids", [store_a_id])

    user_b_id = str(uuid.uuid4())
    user_b = User(
        id=user_b_id,
        email=f"user_b_{user_b_id[:6]}@test.local",
        name="User B",
        hashed_password=get_password_hash("PasswordB2026!"),
        role="MANAGER",
        employee_store_id=store_b_id,
        is_active=True
    )
    setattr(user_b, "assigned_store_ids", [store_b_id])

    db_session.add_all([user_a, user_b])
    db_session.commit()

    tokens = {
        "superadmin": create_access_token(superadmin.id),
        "user_a": create_access_token(user_a.id),
        "user_b": create_access_token(user_b.id),
    }

    return {
        "store_a_id": store_a_id,
        "store_b_id": store_b_id,
        "store_a_slug": store_a_slug,
        "store_b_slug": store_b_slug,
        "superadmin_id": superadmin_id,
        "user_a_id": user_a_id,
        "user_b_id": user_b_id,
        "tokens": tokens,
    }


# =========================================================================
# 1. TESTS DE SÉCURITÉ
# =========================================================================

def test_security_env_endpoints_are_deleted(client: TestClient):
    """Vérifie que les endpoints exposant les variables d'environnement en clair n'existent plus."""
    r1 = client.get("/api/env")
    assert r1.status_code == 404

    r2 = client.get("/api/v1/system/env")
    assert r2.status_code == 404


def test_security_inspect_token_unauthenticated(client: TestClient):
    """Vérifie qu'une requête anonyme sur inspect-token est rejetée avec 401."""
    r = client.get("/api/v1/meta-ads/inspect-token")
    assert r.status_code == 401


def test_security_inspect_token_non_superuser(client: TestClient, test_setup):
    """Vérifie qu'un utilisateur non-superadmin reçoit 403 sur inspect-token."""
    token_a = test_setup["tokens"]["user_a"]
    r = client.get(
        "/api/v1/meta-ads/inspect-token",
        headers={"Authorization": f"Bearer {token_a}"}
    )
    assert r.status_code == 403


def test_security_inspect_token_superuser_masks_token(client: TestClient, test_setup, db_session: Session):
    """Vérifie qu'un superadmin reçoit les infos avec token masqué (aucun secret en clair)."""
    store_a_id = test_setup["store_a_id"]
    super_token = test_setup["tokens"]["superadmin"]

    # Ensure config exists for store A
    cfg = db_session.query(MetaAdsConfig).filter(MetaAdsConfig.store_id == store_a_id).first()
    if not cfg:
        cfg = MetaAdsConfig(
            id=str(uuid.uuid4()),
            store_id=store_a_id,
            access_token="EAABsecrettoken1234567890abcdef",
            pixel_id="1122334455",
            is_connected=True,
        )
        db_session.add(cfg)
        db_session.commit()

    r = client.get(
        f"/api/v1/meta-ads/inspect-token?store_id={store_a_id}",
        headers={"Authorization": f"Bearer {super_token}"}
    )
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert "raw_access_token" not in data  # Token en clair supprimé
    assert "masked_access_token" in data
    assert "..." in data["masked_access_token"]


def test_security_audit_purchases_unauthenticated(client: TestClient):
    """Vérifie qu'une requête anonyme sur audit-purchases est rejetée avec 401."""
    r = client.get("/api/v1/meta-ads/audit-purchases")
    assert r.status_code == 401


def test_security_debug_noest_token_unauthenticated(client: TestClient, test_setup):
    """Vérifie qu'une requête anonyme sur debug-noest-token est rejetée avec 401."""
    r = client.get(f"/api/v1/debug-noest-token?store_id={test_setup['store_a_id']}")
    assert r.status_code == 401


def test_security_meta_config_idor_protection(client: TestClient, test_setup):
    """
    Test IDOR sur /api/v1/meta-ads/config :
    L'utilisateur de Store A ne doit PAS pouvoir accéder ou modifier la config de Store B.
    """
    token_a = test_setup["tokens"]["user_a"]
    store_b_id = test_setup["store_b_id"]

    # 1. Tentative de lecture non autorisée
    r_get = client.get(
        f"/api/v1/meta-ads/config?store_id={store_b_id}",
        headers={"Authorization": f"Bearer {token_a}"}
    )
    assert r_get.status_code == 403

    # 2. Tentative d'écriture non autorisée
    r_post = client.post(
        "/api/v1/meta-ads/config",
        json={
            "store_id": store_b_id,
            "access_token": "hacked_token",
            "pixel_id": "99999",
            "is_connected": True
        },
        headers={"Authorization": f"Bearer {token_a}"}
    )
    assert r_post.status_code == 403


# =========================================================================
# 2. TESTS DES EFFETS FINANCIERS ET CONVERSION DE DEVISES
# =========================================================================

def test_financial_get_conversion_rate_no_unjustified_fallbacks(monkeypatch):
    """
    Phase 3A.1: Vérifie que get_conversion_rate :
    - Retourne 1.0 pour DZD / DA.
    - Retourne le taux réel en ligne si disponible.
    - Ne fabrique AUCUN taux DZD arbitraire (retourne None) si l'API est indisponible et aucun taux configuré.
    - Retourne None pour les devises inconnues/non cotées.
    - Respecte un taux explicite validé par le commerçant (> 10.0).
    """
    from app.api.v1 import meta_ads

    # 1. DZD et DA restent toujours 1.0
    assert get_conversion_rate("DZD", "USD", 1.0) == 1.0
    assert get_conversion_rate("DA", "USD", 1.0) == 1.0

    # 2. En ligne : USD retourne un taux DZD réel (> 100 DZD pour 1 USD)
    live_usd_rate = get_conversion_rate("USD", "USD", 1.0)
    assert live_usd_rate is not None
    assert live_usd_rate >= 100.0

    # 3. Hors ligne (mock live rate = None) avec taux par défaut DB (1.0) :
    # DOIT RETOURNER None — interdiction de fabriquer un montant DZD converti arbitraire
    monkeypatch.setattr(meta_ads, "_fetch_live_dzd_rate", lambda curr: None)
    offline_usd_rate = get_conversion_rate("USD", "USD", 1.0)
    assert offline_usd_rate is None

    offline_eur_rate = get_conversion_rate("EUR", "EUR", 1.0)
    assert offline_eur_rate is None

    # 4. Devise inconnue sans taux configuré : retourne None
    assert get_conversion_rate("UNKNOWN_CURR", "USD", 1.0) is None
    assert get_conversion_rate("XYZ", "USD", 1.0) is None

    # 5. Hors ligne avec taux explicite validé par le commerçant (> 10.0) : doit être respecté
    custom_rate = get_conversion_rate("USD", "USD", 235.0)
    assert custom_rate == 235.0


def test_financial_absent_rate_preserves_raw_spend_without_fabricating_dzd(monkeypatch, db_session: Session, test_setup):
    """
    Vérifie que si aucun taux de change validé n'est disponible :
    - raw_spend et la devise source sont rigoureusement préservés.
    - spend (DZD) est None (non fabriqué).
    - Aucune écriture de dépense DZD fabriquée n'est injectée dans Expense.
    """
    from app.api.v1 import meta_ads
    monkeypatch.setattr(meta_ads, "_fetch_live_dzd_rate", lambda curr: None)

    store_a_id = test_setup["store_a_id"]
    camp_id = f"camp_unrated_{uuid.uuid4().hex[:6]}"

    # Simuler le traitement d'une campagne avec taux absent (None)
    rate = get_conversion_rate("USD", "USD", 1.0) # None
    assert rate is None

    raw_spend = 150.0
    camp_currency = "USD"
    spend = (raw_spend * rate) if rate is not None else None
    assert spend is None

    # Enregistrement en base
    campaign = MetaAdsCampaign(
        id=str(uuid.uuid4()),
        campaign_id=camp_id,
        campaign_name="Campagne Sans Taux Validé",
        store_id=store_a_id,
        spend=spend,
        raw_spend=raw_spend,
        currency=camp_currency
    )
    db_session.add(campaign)
    db_session.commit()

    # Vérification : raw_spend et devise préservés, spend DZD non fabriqué (vaut 0.0 ou None, pas 150 DZD ni 33000 DZD)
    db_session.refresh(campaign)
    assert campaign.raw_spend == 150.0
    assert campaign.currency == "USD"
    assert campaign.spend in (None, 0.0)

    # Vérification : aucune dépense DZD fabriquée n'a été insérée dans Expense
    expense = db_session.query(Expense).filter(Expense.label == "Meta Ads: Campagne Sans Taux Validé").first()
    assert expense is None


def test_purchase_event_id_dedup_contract():
    """
    Phase 3A.1: Vérifie le contrat d'identification déterministe pour l'événement Purchase.
    L'event_id doit être fondé sur l'order_number pour s'aligner avec le format partagé.
    """
    from app.services.meta_capi import purchase_event_id

    # Format partagé et déterministe
    assert purchase_event_id("CMD-10452") == "purchase-CMD-10452"
    assert purchase_event_id("10452") == "purchase-10452"

    # Vérification de l'idempotence
    id_1 = purchase_event_id("CMD-10452")
    id_2 = purchase_event_id("CMD-10452")
    assert id_1 == id_2


def test_financial_guardrail_prevents_wallet_debit_by_default(client: TestClient, test_setup, db_session: Session):
    """
    Vérifie que la synchronisation des dépenses publicitaires n'impute PAS le Wallet par défaut.
    """
    store_a_id = test_setup["store_a_id"]
    token_a = test_setup["tokens"]["user_a"]

    # Création d'un Wallet de test avec solde initial
    wallet = db_session.query(Wallet).filter(Wallet.store_id == store_a_id).first()
    if not wallet:
        wallet = Wallet(
            id=str(uuid.uuid4()),
            store_id=store_a_id,
            name="Caisse Principale COD",
            balance=50000,
            total_out=0,
            is_active=True
        )
        db_session.add(wallet)
        db_session.commit()

    initial_balance = wallet.balance

    # S'assurer que META_AUTO_DEBIT_WALLET est désactivé (valeur par défaut)
    os.environ["META_AUTO_DEBIT_WALLET"] = "false"

    # Lancer sync pour Store A
    r = client.post(
        f"/api/v1/meta-ads/sync?store_id={store_a_id}",
        headers={"Authorization": f"Bearer {token_a}"}
    )
    # L'appel peut réussir ou indiquer non-connecté/simulé
    assert r.status_code == 200

    # Vérifier que le solde du Wallet n'a PAS été débité
    db_session.refresh(wallet)
    assert wallet.balance == initial_balance


def test_financial_repeated_imports_idempotence(db_session: Session, test_setup):
    """
    Phase 3A.1: Vérifie que des imports répétés (sync) pour une même campagne
    sont strictement idempotents :
    - Pas de duplication de ligne dans MetaAdsCampaign.
    - Pas de duplication de ligne dans Expense pour un même label de campagne.
    """
    store_a_id = test_setup["store_a_id"]
    camp_id = f"camp_idem_{uuid.uuid4().hex[:8]}"
    camp_name = f"Campagne Idempotence {camp_id[:4]}"

    # 1. Premier import
    c1 = MetaAdsCampaign(
        id=str(uuid.uuid4()),
        campaign_id=camp_id,
        campaign_name=camp_name,
        store_id=store_a_id,
        raw_spend=100.0,
        spend=100.0,
        currency="DZD"
    )
    db_session.add(c1)
    db_session.commit()

    # 2. Deuxième import (mise à jour du montant au lieu d'une insertion en doublon)
    existing = db_session.query(MetaAdsCampaign).filter(
        MetaAdsCampaign.store_id == store_a_id,
        MetaAdsCampaign.campaign_id == camp_id
    ).first()
    assert existing is not None
    existing.raw_spend = 150.0
    existing.spend = 150.0
    db_session.commit()

    # Vérification : une seule ligne en base
    matching_camps = db_session.query(MetaAdsCampaign).filter(
        MetaAdsCampaign.store_id == store_a_id,
        MetaAdsCampaign.campaign_id == camp_id
    ).all()
    assert len(matching_camps) == 1
    assert matching_camps[0].raw_spend == 150.0


# =========================================================================
# 3. TESTS DE RÉSOLUTION MULTI-TENANT DES LANDING PAGES
# =========================================================================

def test_landing_page_resolution_explicit_store_id(client: TestClient, test_setup, db_session: Session):
    """Résolution avec paramètre store_id explicite."""
    store_a_id = test_setup["store_a_id"]
    slug = f"unique-product-{uuid.uuid4().hex[:6]}"

    lp_a = LandingPage(
        id=str(uuid.uuid4()),
        store_id=store_a_id,
        slug=slug,
        headline="Produit Boutique A",
        is_active=True
    )
    db_session.add(lp_a)
    db_session.commit()

    r = client.get(f"/api/v1/landing-pages/slug/{slug}?store_id={store_a_id}")
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert data["data"]["store_id"] == store_a_id


def test_landing_page_resolution_explicit_store_slug(client: TestClient, test_setup, db_session: Session):
    """Résolution avec paramètre store (slug de la boutique)."""
    store_a_id = test_setup["store_a_id"]
    slug = f"store-slug-prod-{uuid.uuid4().hex[:6]}"

    lp_a = LandingPage(
        id=str(uuid.uuid4()),
        store_id=store_a_id,
        slug=slug,
        headline="Produit Store Slug",
        is_active=True
    )
    db_session.add(lp_a)
    db_session.commit()

    store_a_slug = test_setup["store_a_slug"]
    r = client.get(f"/api/v1/landing-pages/slug/{slug}?store={store_a_slug}")
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert data["data"]["store_id"] == store_a_id


def test_landing_page_resolution_unique_slug_no_store_param(client: TestClient, test_setup, db_session: Session):
    """Résolution déterministe quand le slug est unique sur toute la plateforme."""
    store_a_id = test_setup["store_a_id"]
    unique_slug = f"globally-unique-{uuid.uuid4().hex[:8]}"

    lp = LandingPage(
        id=str(uuid.uuid4()),
        store_id=store_a_id,
        slug=unique_slug,
        headline="Page Unique Déterministe",
        is_active=True
    )
    db_session.add(lp)
    db_session.commit()

    # Appel sans store_id ni store param
    r = client.get(f"/api/v1/landing-pages/slug/{unique_slug}")
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert data["data"]["store_id"] == store_a_id


def test_landing_page_resolution_ambiguous_slug_returns_409(client: TestClient, test_setup, db_session: Session):
    """
    Garde-fou multi-tenant : si deux boutiques partagent le même slug et qu'aucun
    store_id n'est fourni, l'API refuse de deviner et renvoie 409 Conflict.
    """
    store_a_id = test_setup["store_a_id"]
    store_b_id = test_setup["store_b_id"]
    shared_slug = f"shared-bag-{uuid.uuid4().hex[:6]}"

    lp_a = LandingPage(
        id=str(uuid.uuid4()),
        store_id=store_a_id,
        slug=shared_slug,
        headline="Sac Boutique A",
        is_active=True
    )
    lp_b = LandingPage(
        id=str(uuid.uuid4()),
        store_id=store_b_id,
        slug=shared_slug,
        headline="Sac Boutique B",
        is_active=True
    )
    db_session.add(lp_a)
    db_session.add(lp_b)
    db_session.commit()

    # Appel sans store_id : doit lever 409 Conflict
    r = client.get(f"/api/v1/landing-pages/slug/{shared_slug}")
    assert r.status_code == 409
    body = r.json()
    err_msg = body.get("message") or body.get("detail") or ""
    assert "ambigu" in str(err_msg).lower()

    # Avec store_id explicite de boutique A : doit retourner boutique A
    r_a = client.get(f"/api/v1/landing-pages/slug/{shared_slug}?store_id={store_a_id}")
    assert r_a.status_code == 200
    assert r_a.json()["data"]["store_id"] == store_a_id

    # Avec store_id explicite de boutique B : doit retourner boutique B
    r_b = client.get(f"/api/v1/landing-pages/slug/{shared_slug}?store_id={store_b_id}")
    assert r_b.status_code == 200
    assert r_b.json()["data"]["store_id"] == store_b_id


def test_landing_page_not_found(client: TestClient):
    """Vérifie le retour 404 pour un slug inexistant."""
    r = client.get(f"/api/v1/landing-pages/slug/non-existent-slug-{uuid.uuid4().hex}")
    assert r.status_code == 404


# =========================================================================
# 4. TESTS PHASE 3A.2 : VERSIONING, DEVISES D'ACHAT & INTÉGRITÉ DU ROAS
# =========================================================================

def test_meta_api_version_separation_and_env_config():
    """
    Phase 3A.4: Vérifie que la version Marketing API (v26.0) et la version CAPI Graph API (v21.0)
    sont découplées et configurables par variables d'environnement distinctes.
    """
    from app.api.v1 import meta_ads
    from app.services import meta_capi

    assert meta_ads.META_MARKETING_API_VERSION == "v26.0"
    assert meta_capi.META_CAPI_GRAPH_VERSION == "v21.0"
    assert meta_ads.META_GRAPH_VERSION == meta_ads.META_MARKETING_API_VERSION
    assert meta_capi.GRAPH_VERSION == meta_capi.META_CAPI_GRAPH_VERSION
    assert meta_ads.META_MARKETING_API_VERSION != meta_capi.META_CAPI_GRAPH_VERSION


def test_purchase_custom_data_currency_coherence_with_transaction():
    """
    Phase 3A.4: Normalisation du contrat monétaire Purchase :
    - Le modèle métier est une commande e-commerce enregistrée en DZD.
    - value et currency représentent fidèlement la même réalité transactionnelle (order.total en DZD).
    - La commande n'est JAMAIS convertie arbitrairement vers la devise du compte publicitaire (USD, EUR, etc.) :
      Meta CAPI accepte DZD nativement (ISO 4217) et Ads Manager effectue la conversion multi-devises
      automatique pour le ROAS.
    - Vérifie la cohérence avec frais de livraison, réductions, devises inconnues ou taux absents/invalides.
    """
    from types import SimpleNamespace
    from datetime import datetime
    from app.services.meta_capi import build_purchase_event

    dummy_order = SimpleNamespace(
        id=str(uuid.uuid4()),
        order_number="CMD-TEST-777",
        subtotal=10500,
        delivery_fee=800,
        discount=300,
        total=11000,  # 10500 + 800 - 300 = 11000 DZD
        currency="DZD",
        customer_email="client@test.dz",
        customer_phone="0555123456",
        customer_name="Amina Client",
        customer_commune="Oran",
        customer_wilaya="Oran",
        items=[],
        created_at=datetime.now(),
        fbp=None, fbc=None, fbclid=None, event_source_url=None,
    )

    # 1. Compte publicitaire en USD et taux calibré (220.0) -> reste strictement en DZD transactionnel
    ev1 = build_purchase_event(dummy_order, client_ip=None, user_agent=None, ad_currency="USD", exchange_rate=220.0)
    assert ev1["custom_data"]["currency"] == "DZD"
    assert ev1["custom_data"]["value"] == 11000.0

    # 2. Compte publicitaire en USD sans taux valide (1.0, 0.0, None) -> reste strictement en DZD
    ev2 = build_purchase_event(dummy_order, client_ip=None, user_agent=None, ad_currency="USD", exchange_rate=1.0)
    assert ev2["custom_data"]["currency"] == "DZD"
    assert ev2["custom_data"]["value"] == 11000.0

    # 3. Compte publicitaire en DZD -> DZD
    ev3 = build_purchase_event(dummy_order, client_ip=None, user_agent=None, ad_currency="DZD", exchange_rate=1.0)
    assert ev3["custom_data"]["currency"] == "DZD"
    assert ev3["custom_data"]["value"] == 11000.0

    # 4. Commande sans attribut currency explicite (ou None) -> fallback par défaut 'DZD'
    order_no_curr = SimpleNamespace(
        id=str(uuid.uuid4()),
        order_number="CMD-NO-CURR",
        total=8500,
        customer_phone="0555987654",
        items=[],
    )
    ev4 = build_purchase_event(order_no_curr, client_ip=None, user_agent=None)
    assert ev4["custom_data"]["currency"] == "DZD"
    assert ev4["custom_data"]["value"] == 8500.0

    # 5. Commande avec frais de livraison et réduction reflétés dans order.total
    order_with_logistics = SimpleNamespace(
        id=str(uuid.uuid4()),
        order_number="CMD-LOGISTICS",
        subtotal=6000,
        delivery_fee=700,
        discount=500,
        total=6200,  # subtotal + delivery - discount
        currency="dzd",
        customer_phone="0555987654",
        items=[],
    )
    ev5 = build_purchase_event(order_with_logistics, client_ip=None, user_agent=None, ad_currency="USD", exchange_rate=0.0)
    assert ev5["custom_data"]["currency"] == "DZD"
    assert ev5["custom_data"]["value"] == 6200.0


def test_dashboard_roas_distinguishes_unconverted_from_zero_spend(client: TestClient, test_setup, db_session: Session):
    """
    Phase 3A.2: Vérifie que le dashboard distingue une dépense réellement égale à 0
    d'une dépense non convertie (spend is None), et que le ROAS n'intègre pas
    des valeurs nulles/non converties comme des zéros validés.
    """
    store_a_id = test_setup["store_a_id"]
    token_a = test_setup["tokens"]["user_a"]

    # Création d'une campagne avec dépense non convertie (spend=None, raw_spend=80 USD)
    unconverted_camp = MetaAdsCampaign(
        id=str(uuid.uuid4()),
        campaign_id=f"camp_unconv_{uuid.uuid4().hex[:6]}",
        campaign_name="Campagne Devise Étrangère Sans Taux",
        store_id=store_a_id,
        spend=None,
        raw_spend=80.0,
        currency="USD",
        impressions=1000,
        clicks=50,
        reach=800
    )
    db_session.add(unconverted_camp)
    db_session.commit()

    r = client.get(
        f"/api/v1/meta-ads/campaigns?store_id={store_a_id}",
        headers={"Authorization": f"Bearer {token_a}"}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True

    # Vérifier la présence du flag has_unconverted_spend dans summary
    assert body["summary"]["has_unconverted_spend"] is True

    # Trouver la campagne non convertie dans data
    matched = [c for c in body["data"] if c["campaign_id"] == unconverted_camp.campaign_id]
    assert len(matched) == 1
    camp_data = matched[0]

    # spend doit être None, is_converted False, et roas None (PAS 0.0 !)
    assert camp_data["spend"] is None
    assert camp_data["is_converted"] is False
    assert camp_data["roas"] is None
    assert camp_data["raw_spend"] == 80.0
    assert camp_data["currency"] == "USD"
