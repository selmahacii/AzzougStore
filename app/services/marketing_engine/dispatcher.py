"""
dispatcher.py — turns a (store_id, business_event) pair into the list of
(ProviderEventMapping, MarketingProvider) to fan out to.

Reads provider_event_mappings (data-driven, editable without a deploy) and
dynamically discovers installed provider adapters by walking the
providers/ package. Contains ZERO provider-name conditionals — adding a
provider never touches this file, only adds a new providers/<name>/adapter.py
and a provider_event_mappings row.
"""
from __future__ import annotations

import importlib
import logging
import pkgutil
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.marketing_event import ProviderEventMapping
from app.services.marketing_engine import providers as providers_pkg
from app.services.marketing_engine.providers.base import MarketingProvider

logger = logging.getLogger("app.marketing_engine.dispatcher")

_provider_registry: Optional[dict[str, MarketingProvider]] = None


def discover_providers(*, force_reload: bool = False) -> dict[str, MarketingProvider]:
    """
    Walks app/services/marketing_engine/providers/<name>/adapter.py for
    every subpackage and picks up its module-level `PROVIDER` instance.
    Cached after the first call (the provider set is fixed at process
    start); pass force_reload=True in tests that register a fake provider
    package under providers/ at runtime.

    A subpackage without an adapter.py (e.g. a provider scaffolded but not
    yet implemented) is silently skipped, not an error — lets Part 11-style
    "prepare TikTok's architecture without implementing HTTP calls yet"
    ship as an empty/stub adapter without breaking discovery.
    """
    global _provider_registry
    if _provider_registry is not None and not force_reload:
        return _provider_registry

    registry: dict[str, MarketingProvider] = {}
    for module_info in pkgutil.iter_modules(providers_pkg.__path__):
        if not module_info.ispkg:
            continue
        try:
            adapter_module = importlib.import_module(f"{providers_pkg.__name__}.{module_info.name}.adapter")
        except ModuleNotFoundError:
            logger.debug("[Dispatcher] providers.%s has no adapter.py yet — skipped", module_info.name)
            continue
        provider = getattr(adapter_module, "PROVIDER", None)
        if provider is None:
            logger.warning("[Dispatcher] providers.%s.adapter has no module-level PROVIDER instance — skipped", module_info.name)
            continue
        registry[provider.name] = provider
    _provider_registry = registry
    return registry


def resolve_mappings(db: Session, *, store_id: str, business_event: str) -> list[ProviderEventMapping]:
    """
    Store-specific mapping (store_id = this store) overrides the default
    one (store_id IS NULL) for the same (provider, business_event); the
    default is used whenever no override exists. One row per provider is
    returned — never two competing mappings for the same provider.
    """
    rows = (
        db.query(ProviderEventMapping)
        .filter(
            ProviderEventMapping.business_event == business_event,
            ProviderEventMapping.enabled.is_(True),
            # NOTE: store_id.in_([store_id, None]) would silently match
            # NEITHER row when store_id is NULL — SQL's IN() compares with
            # equality, and `NULL = NULL` is never true. Must be an
            # explicit OR against IS NULL.
            or_(ProviderEventMapping.store_id == store_id, ProviderEventMapping.store_id.is_(None)),
        )
        .all()
    )
    by_provider: dict[str, ProviderEventMapping] = {}
    for row in rows:
        current = by_provider.get(row.provider)
        if current is None or (current.store_id is None and row.store_id is not None):
            by_provider[row.provider] = row
    return list(by_provider.values())


def dispatch_mappings_for_event(
    db: Session, *, store_id: str, business_event: str
) -> list[tuple[ProviderEventMapping, MarketingProvider]]:
    """
    The function engine.py actually calls: each enabled mapping paired with
    its registered provider adapter. A mapping referencing a provider with
    no adapter installed is logged and skipped rather than raising — a
    misconfigured mapping must never block every other provider's delivery.
    """
    providers = discover_providers()
    result: list[tuple[ProviderEventMapping, MarketingProvider]] = []
    for mapping in resolve_mappings(db, store_id=store_id, business_event=business_event):
        provider = providers.get(mapping.provider)
        if provider is None:
            logger.warning(
                "[Dispatcher] mapping references unregistered provider=%s (business_event=%s, store=%s) — skipped",
                mapping.provider, business_event, store_id,
            )
            continue
        result.append((mapping, provider))
    return result
