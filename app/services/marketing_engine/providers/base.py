"""
providers/base.py — the ONE interface every ad-platform adapter implements.

The engine and dispatcher only ever talk to this Protocol, never to a
concrete provider class. Adding Snapchat/Pinterest/LinkedIn/Microsoft Ads
later means writing a new providers/<name>/adapter.py implementing this
Protocol plus a provider_event_mappings row — nothing here, in dispatcher.py,
or in engine.py changes.
"""
from __future__ import annotations

import enum
from dataclasses import dataclass
from typing import Any, Optional, Protocol, runtime_checkable

from sqlalchemy.orm import Session


class ErrorCategory(str, enum.Enum):
    """Same shape as the categories already proven useful on meta_capi_logs
    (network_timeout | network_error | api_4xx | api_5xx | other) — lets a
    provider-agnostic dashboard split "network unreachable" from "the
    provider rejected the request" without knowing which provider it was."""
    NETWORK_TIMEOUT = "network_timeout"
    NETWORK_ERROR = "network_error"
    API_4XX = "api_4xx"
    API_5XX = "api_5xx"
    OTHER = "other"


@dataclass
class ProviderResult:
    """
    What every adapter's send() returns. Fully describes success/failure
    without the caller (the future worker) needing any provider-specific
    knowledge to decide whether to retry.
    """
    success: bool
    http_status: Optional[int] = None
    api_response: Optional[dict[str, Any]] = None
    error_message: Optional[str] = None
    error_category: Optional[ErrorCategory] = None
    retryable: bool = False
    latency_ms: Optional[int] = None


class MarketingProviderError(Exception):
    """
    Raised when an adapter cannot even build a payload (missing required
    order data, unsupported provider_event). Distinct from a network/API
    failure, which is a ProviderResult(success=False) return value, never
    an exception — build_payload failures are a data/config problem, send()
    failures are an operational one, and callers must be able to tell them
    apart without parsing an error string.
    """


class ProviderNotConfiguredError(MarketingProviderError):
    """
    Raised (or, more commonly, signaled by resolve_config() returning None
    — see below) when a store has no usable config for this provider.
    Callers must treat this as "skip this provider for this store", never
    as an error to retry.
    """


@runtime_checkable
class MarketingProvider(Protocol):
    """
    Every adapter implements exactly this surface. No method here ever
    receives a BusinessEvent enum value or an order STATUS — only the
    canonical payload the engine already built, the raw Order ORM object
    (read-only, for provider-specific fields the canonical payload
    deliberately doesn't carry), and whatever config resolve_config() gave
    it. A provider adapter physically cannot contain business/merge/fraud
    logic because it never receives the information needed to make that
    decision — the engine has already made it before the adapter is ever
    called.
    """

    name: str

    def resolve_config(self, db: Session, store_id: str) -> Optional[Any]:
        """
        This provider's own config for the given store, or None if
        unconfigured/incomplete. The adapter alone decides what "usable
        config" means for its platform (e.g. Meta requires pixel_id +
        access_token of a minimum length) — the engine only checks for
        None vs. not-None.
        """
        ...

    def config_snapshot(self, config: Any) -> dict[str, Any]:
        """
        A replayable, NEVER-SECRET summary of the config actually used
        (pixel/advertiser id, api version, a token *version* marker such
        as its last 4 characters — never the raw token). Stored on the
        event row so a replay years later reuses the historical config
        identity instead of whatever happens to be configured today.
        """
        ...

    def build_payload(self, canonical_payload: dict[str, Any], order: Any, config: Any) -> dict[str, Any]:
        """
        Canonical payload -> this provider's wire format. May read `order`
        for provider-specific fields the canonical payload deliberately
        omits (e.g. Meta's exact user_data hashing), but must never make a
        network call or write to the database — pure transformation.
        """
        ...

    def send(self, payload: dict[str, Any], config: Any) -> ProviderResult:
        """
        The actual network call. Not invoked anywhere in the codebase yet
        at this stage of the rollout (no worker exists to call it) — safe
        to implement fully, since nothing currently triggers it.
        """
        ...

    def classify_error(self, result: ProviderResult) -> ErrorCategory:
        """
        Maps a raw failure to ErrorCategory for the (future) retry policy.
        Adapters are encouraged to delegate to existing provider-specific
        classifiers (e.g. app.services.meta_capi.analyze_meta_response)
        instead of reimplementing pattern matching.
        """
        ...
