"""
providers/meta/adapter.py — the FIRST provider plugged into the Marketing
Event Engine.

Deliberately thin: every piece of Meta-specific knowledge (payload shape,
user-data hashing, currency conversion, HTTP send, error classification)
already exists in app.services.meta_capi and is battle-tested in
production — this adapter is a translation layer over that module, not a
reimplementation. No business logic (order status, merge state, retry
policy) lives here — that is, and stays, the engine's job.

build_payload() delegates to meta_capi.build_purchase_event so a
shadow-mode payload is byte-for-byte comparable to what the legacy flow
would have sent for the same order — the actual basis for validating
shadow-mode parity before any store is promoted to 'active'.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models.marketing import MetaAdsConfig
from app.services import meta_capi
from app.services.marketing_engine.providers.base import ErrorCategory, ProviderResult


@dataclass
class MetaProviderConfig:
    """Everything MetaProvider needs from meta_ads_configs — no Meta config field the engine core has to know about."""
    pixel_id: str
    access_token: str
    currency: str
    exchange_rate: float
    access_token_version: str  # last 4 chars only — enough to identify "which token" for a replay audit, never the secret itself


class MetaProvider:
    name = "meta"
    version = "meta_capi_v1"

    def resolve_config(self, db: Session, store_id: str) -> Optional[MetaProviderConfig]:
        """Mirrors the exact 'usable config' check already used by the legacy queue (app.api.v1.meta_ads._handle_claimed_row) — same bar, not a looser or stricter one."""
        config = db.query(MetaAdsConfig).filter(MetaAdsConfig.store_id == store_id).first()
        if not config or not config.pixel_id or not config.access_token or len(config.access_token) < 15:
            return None
        return MetaProviderConfig(
            pixel_id=config.pixel_id,
            access_token=config.access_token,
            currency=config.currency or "DZD",
            exchange_rate=config.exchange_rate or 1.0,
            access_token_version=config.access_token[-4:],
        )

    def config_snapshot(self, config: MetaProviderConfig) -> dict[str, Any]:
        return {
            "pixel_id": config.pixel_id,
            "currency": config.currency,
            "exchange_rate": config.exchange_rate,
            "access_token_version": config.access_token_version,
        }

    def build_payload(self, canonical_payload: dict[str, Any], order: Any, config: MetaProviderConfig) -> dict[str, Any]:
        """
        Delegates entirely to meta_capi.build_purchase_event — the exact
        function the legacy flow already calls — so nothing about the
        Purchase payload shape, event_id derivation, or currency conversion
        is duplicated or could silently drift from the proven
        implementation.
        """
        return meta_capi.build_purchase_event(
            order,
            client_ip=canonical_payload.get("ip"),
            user_agent=canonical_payload.get("user_agent"),
            ad_currency=config.currency,
            exchange_rate=config.exchange_rate,
        )

    def send(self, payload: dict[str, Any], config: MetaProviderConfig) -> ProviderResult:
        """
        Not invoked anywhere yet — no worker exists to call it at this
        stage of the rollout. Delegates to meta_capi.send_events, the same
        network call the legacy queue already makes, so send behavior
        (retries within one call, circuit breaker, relay fallback) is
        identical, not reimplemented.
        """
        order_id = None
        custom_data = payload.get("custom_data")
        if isinstance(custom_data, dict):
            order_id = custom_data.get("order_id")

        result = meta_capi.send_events(
            config.pixel_id, config.access_token, [payload],
            store_label=None, order_label=order_id,
        )
        error_category_raw = result.get("error_category")
        return ProviderResult(
            success=bool(result.get("success")),
            http_status=result.get("http_status"),
            api_response={k: v for k, v in result.items() if k != "success"},
            error_message=result.get("error"),
            error_category=ErrorCategory(error_category_raw) if error_category_raw in ErrorCategory._value2member_map_ else None,
            retryable=bool(result.get("retryable")),
            latency_ms=result.get("latency_ms"),
        )

    def classify_error(self, result: ProviderResult) -> ErrorCategory:
        """Fallback classifier for when send() couldn't already attach an error_category (e.g. a raised exception) — mirrors meta_capi.py's own http-status-based classification, not a new scheme."""
        if result.error_category is not None:
            return result.error_category
        if result.http_status is None:
            return ErrorCategory.NETWORK_ERROR
        if 400 <= result.http_status < 500:
            return ErrorCategory.API_4XX
        if result.http_status >= 500:
            return ErrorCategory.API_5XX
        return ErrorCategory.OTHER


PROVIDER = MetaProvider()
