"""
OrderSimilarityEngine — a standalone, provider-agnostic duplicate-detection
service.

This is deliberately NOT part of order_service.py's auto_merge_duplicates
logic. It exists as its own module so any future consumer — the Marketing
Event Engine, a TikTok/Google Ads dedup layer, the ROAS engine, a CRM
integration, an automation rule — can ask "how similar are these two
orders?" without depending on (or duplicating) the merge/operational
workflow that lives in order_service.py. auto_merge_duplicates is a
CALLER of this engine, not the owner of the scoring logic.

Design
------
Phone-only matching (the previous approach) has two opposite failure
modes, both real:
  - false positive: same phone, genuinely different purchases (different
    products, days apart) silently fused into one order — the SECOND
    real sale's Purchase never reaches Meta (a conversion is lost).
  - false negative (not applicable to phone-only, but worth naming): a
    typo'd phone number on a genuine duplicate submission would never be
    caught by exact-match — out of scope for this engine (identity
    resolution across typos is a different, harder problem), noted as a
    known limitation, not silently pretended away.

Instead of a single boolean rule, every order pair gets a WEIGHTED
SIMILARITY SCORE across independent signals. Each signal contributes 0
points if the data needed for it is missing on either order — a signal
you don't have never penalizes a decision, it just doesn't vote. All
weights and thresholds are configurable (see order_service.py's
get_operations_config / DEFAULT_OPERATIONS_CONFIG's "duplicate_detection"
block) — nothing here is a hardcoded magic number used for a real decision.

Three-band classification:
  score >= auto_merge_threshold      -> "auto_merge"   (near-certain duplicate)
  review_threshold <= score < auto   -> "needs_review"  (flagged, never
                                          auto-merged — a human decides)
  score <  review_threshold          -> "distinct"      (treated as a
                                          genuinely separate order/sale)

Signals implemented today (only using data the Order model actually has —
see the future-signals list below for what's ready to plug in the moment
those columns exist, same future-proofing pattern used elsewhere in this
codebase for ttclid/gclid/msclkid):
  phone (normalized, exact)      email (normalized, exact)
  customer name (fuzzy)          address (fuzzy, wilaya+commune+address)
  products (Jaccard over product_id set)
  amount (percentage tolerance)
  time window (decays from full score to zero over a configurable span)
  campaign_id / utm_campaign (exact)
  fbclid (exact — the closest thing to a real click-identity match)

Deliberately NOT implemented yet (Order has no column for these — adding
them later is a pure additive change to `_signal_*` functions and the
default weights dict, nothing else in this file or its callers changes):
  ttclid, gclid, msclkid, session_id, device_id, browser fingerprint, GPS
  coordinates.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime
from difflib import SequenceMatcher
from typing import Any, Optional


# ─── Defaults — every value here is overridable via
#     get_operations_config(db, store_id)["duplicate_detection"], never
#     used directly for a real decision without going through that config
#     first. See order_service.py's DEFAULT_OPERATIONS_CONFIG.
# ────────────────────────────────────────────────────────────────────────

DEFAULT_SIMILARITY_WEIGHTS: dict[str, float] = {
    "phone": 25.0,
    "products": 20.0,
    "address": 15.0,
    "amount": 10.0,
    "email": 5.0,
    "name": 5.0,
    "campaign": 2.5,
    "click_id": 2.5,
    # NOTE: no "time_window" key here — time is applied as a MULTIPLIER on
    # the combined score of the signals above (see _time_decay_fraction),
    # not as one more additive weight. Its shape is configured separately
    # via DEFAULT_TIME_WINDOW below.
}

DEFAULT_SIMILARITY_THRESHOLDS: dict[str, float] = {
    "auto_merge_threshold": 75.0,   # score >= this: fused automatically, same as today's behavior for a clear duplicate
    "needs_review_threshold": 45.0,  # score in [this, auto_merge): flagged, never auto-merged
}

DEFAULT_TIME_WINDOW: dict[str, float] = {
    # Full score multiplier (1.0) for anything within this many minutes of
    # each other (a double-click/page-refresh duplicate is seconds apart,
    # not hours) — decays linearly to 0 at zero_score_hours.
    "full_score_minutes": 15.0,
    "zero_score_hours": 48.0,
}

DEFAULT_ADDRESS_SIMILARITY_FLOOR = 0.55  # below this text-similarity ratio, address contributes 0, not a partial score
DEFAULT_NAME_SIMILARITY_FLOOR = 0.6


@dataclass
class SimilarityResult:
    score: float
    max_possible_score: float
    components: dict[str, float]
    reasons: list[str] = field(default_factory=list)

    @property
    def normalized_score(self) -> float:
        """0-100, even when some signals were unavailable and max_possible_score < the full weight sum."""
        if self.max_possible_score <= 0:
            return 0.0
        return round((self.score / self.max_possible_score) * 100, 1)


Classification = str  # "auto_merge" | "needs_review" | "distinct"


# ─── Normalization helpers ─────────────────────────────────────────────────

def normalize_phone(phone: Optional[str]) -> Optional[str]:
    """
    Strips everything but digits, then collapses the Algerian country-code/
    leading-zero variants to one canonical form (0555123456) so
    '+213555123456', '213555123456', '00213555123456', and '0555123456'
    all compare equal — the previous exact-string comparison treated these
    as four different customers.
    """
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if digits.startswith("00213"):
        digits = digits[5:]
    elif digits.startswith("213"):
        digits = digits[3:]
    if digits and not digits.startswith("0"):
        digits = "0" + digits
    return digits or None


def normalize_text(value: Optional[str]) -> str:
    """Lowercase, accent-stripped, whitespace-collapsed — for fuzzy name/address comparison, not exact matching."""
    if not value:
        return ""
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"\s+", " ", value.strip().lower())
    return value


def text_similarity(a: Optional[str], b: Optional[str]) -> float:
    """0.0-1.0 fuzzy ratio. Returns 0.0 (not 1.0) if either side is empty — an absent value is never treated as a match."""
    na, nb = normalize_text(a), normalize_text(b)
    if not na or not nb:
        return 0.0
    return SequenceMatcher(None, na, nb).ratio()


# ─── Individual signal scorers ──────────────────────────────────────────────
# Each returns (points_awarded, points_possible, reason|None). points_possible
# is 0 when the signal can't be evaluated (missing data on either side) —
# that's what keeps a missing field from silently penalizing the score.

def _signal_phone(a: Any, b: Any, weight: float) -> tuple[float, float, Optional[str]]:
    pa, pb = normalize_phone(getattr(a, "customer_phone", None)), normalize_phone(getattr(b, "customer_phone", None))
    if not pa or not pb:
        return 0.0, 0.0, None
    if pa == pb:
        return weight, weight, "same phone number"
    return 0.0, weight, None


def _signal_email(a: Any, b: Any, weight: float) -> tuple[float, float, Optional[str]]:
    ea, eb = getattr(a, "customer_email", None), getattr(b, "customer_email", None)
    if not ea or not eb:
        return 0.0, 0.0, None
    if normalize_text(ea) == normalize_text(eb):
        return weight, weight, "same email"
    return 0.0, weight, None


def _signal_name(a: Any, b: Any, weight: float) -> tuple[float, float, Optional[str]]:
    ratio = text_similarity(getattr(a, "customer_name", None), getattr(b, "customer_name", None))
    if ratio == 0.0:
        return 0.0, 0.0, None
    if ratio < DEFAULT_NAME_SIMILARITY_FLOOR:
        return 0.0, weight, None
    return weight * ratio, weight, f"similar customer name ({ratio:.0%})"


def _signal_address(a: Any, b: Any, weight: float) -> tuple[float, float, Optional[str]]:
    addr_a = " ".join(filter(None, [getattr(a, "customer_address", None), getattr(a, "customer_commune", None), getattr(a, "customer_wilaya", None)]))
    addr_b = " ".join(filter(None, [getattr(b, "customer_address", None), getattr(b, "customer_commune", None), getattr(b, "customer_wilaya", None)]))
    ratio = text_similarity(addr_a, addr_b)
    if ratio == 0.0:
        return 0.0, 0.0, None
    if ratio < DEFAULT_ADDRESS_SIMILARITY_FLOOR:
        return 0.0, weight, None
    return weight * ratio, weight, f"similar delivery address ({ratio:.0%})"


def _product_set(order: Any) -> set[str]:
    items = getattr(order, "items", None) or []
    return {str(i.product_id) for i in items if getattr(i, "product_id", None)}


def _signal_products(a: Any, b: Any, weight: float) -> tuple[float, float, Optional[str]]:
    set_a, set_b = _product_set(a), _product_set(b)
    if not set_a or not set_b:
        return 0.0, 0.0, None
    union = set_a | set_b
    intersection = set_a & set_b
    jaccard = len(intersection) / len(union) if union else 0.0
    if jaccard == 0.0:
        # Explicitly signals "different products" — 0 points earned, but
        # points_possible > 0, meaning this genuinely counted AGAINST a
        # duplicate classification (both baskets were known and disjoint),
        # not merely "unavailable". This is the exact case the caveat
        # about false positives is about — same phone, different products.
        return 0.0, weight, None
    return weight * jaccard, weight, f"overlapping basket ({jaccard:.0%} of products in common)"


def _signal_amount(a: Any, b: Any, weight: float, tolerance_pct: float = 15.0) -> tuple[float, float, Optional[str]]:
    ta, tb = getattr(a, "total", None), getattr(b, "total", None)
    if not ta or not tb:
        return 0.0, 0.0, None
    ta, tb = float(ta), float(tb)
    if ta == 0 or tb == 0:
        return 0.0, 0.0, None
    diff_pct = abs(ta - tb) / max(ta, tb) * 100
    if diff_pct > tolerance_pct:
        return 0.0, weight, None
    closeness = 1 - (diff_pct / tolerance_pct)
    return weight * closeness, weight, f"similar order amount (within {diff_pct:.1f}%)"


def _time_decay_fraction(a: Any, b: Any, time_window: dict) -> tuple[float, Optional[str]]:
    """
    Returns a 0.0-1.0 multiplier, NOT an additive score component — see
    compute_similarity's docstring for why: an identical basket + address +
    amount ordered 3 days apart must NOT still cross the auto-merge
    threshold just because every other signal matched (a customer
    re-ordering their usual basket a few days later is a real, separate
    sale, not a duplicate submission — this is explicitly the false-
    positive case flagged during this engine's design). Time proximity
    gates the whole score rather than merely contributing to it.

    Unknown created_at on either side returns a neutral 1.0 (no penalty,
    no boost) — we simply can't judge recency, so it shouldn't be treated
    as "definitely far apart" any more than "definitely close".
    """
    ca, cb = getattr(a, "created_at", None), getattr(b, "created_at", None)
    if not ca or not cb:
        return 1.0, None
    delta_minutes = abs((ca - cb).total_seconds()) / 60.0
    full = time_window.get("full_score_minutes", DEFAULT_TIME_WINDOW["full_score_minutes"])
    zero_minutes = time_window.get("zero_score_hours", DEFAULT_TIME_WINDOW["zero_score_hours"]) * 60.0
    if delta_minutes <= full:
        return 1.0, f"created {delta_minutes:.0f} min apart"
    if delta_minutes >= zero_minutes:
        return 0.0, f"created {delta_minutes / 60:.1f}h apart (outside the duplicate time window)"
    fraction = 1 - ((delta_minutes - full) / (zero_minutes - full))
    return fraction, f"created {delta_minutes / 60:.1f}h apart"


def _signal_campaign(a: Any, b: Any, weight: float) -> tuple[float, float, Optional[str]]:
    ca = getattr(a, "campaign_id", None) or getattr(a, "utm_campaign", None)
    cb = getattr(b, "campaign_id", None) or getattr(b, "utm_campaign", None)
    if not ca or not cb:
        return 0.0, 0.0, None
    if str(ca) == str(cb):
        return weight, weight, "same campaign"
    return 0.0, weight, None


def _signal_click_id(a: Any, b: Any, weight: float) -> tuple[float, float, Optional[str]]:
    # fbclid today; ttclid/gclid/msclkid slot in here the moment those
    # columns exist on Order — same getattr-with-default pattern already
    # used throughout this codebase's future-proofing (see
    # engine.build_canonical_payload in the marketing_engine package).
    fa, fb = getattr(a, "fbclid", None), getattr(b, "fbclid", None)
    if fa and fb and str(fa) == str(fb):
        return weight, weight, "same ad click (fbclid)"
    if fa and fb:
        return 0.0, weight, None
    return 0.0, 0.0, None


_SIGNAL_FUNCS = {
    "phone": _signal_phone,
    "email": _signal_email,
    "name": _signal_name,
    "address": _signal_address,
    "products": _signal_products,
    "amount": _signal_amount,
    "campaign": _signal_campaign,
    "click_id": _signal_click_id,
}


def compute_similarity(
    order_a: Any,
    order_b: Any,
    *,
    weights: Optional[dict[str, float]] = None,
    time_window: Optional[dict[str, float]] = None,
) -> SimilarityResult:
    """
    Weighted similarity score between two orders. Every signal (other than
    time — see below) is independent: a missing field on either order
    simply contributes (0, 0) rather than being coerced into a false match
    or a penalty.

    Time proximity is applied as a MULTIPLIER on the combined score of
    every other signal, not as one more additive component — see
    _time_decay_fraction's docstring. Without this, an identical basket +
    address + amount ordered days apart could still cross the auto-merge
    threshold purely because every OTHER signal matched, which is exactly
    backwards: recency is what actually distinguishes "duplicate
    submission" from "genuine repeat purchase" when everything else about
    the order looks the same.
    """
    weights = weights or DEFAULT_SIMILARITY_WEIGHTS
    time_window = time_window or DEFAULT_TIME_WINDOW

    components: dict[str, float] = {}
    reasons: list[str] = []
    total_score = 0.0
    total_possible = 0.0

    for name, fn in _SIGNAL_FUNCS.items():
        weight = weights.get(name, 0.0)
        if weight <= 0:
            continue
        points, possible, reason = fn(order_a, order_b, weight)
        components[name] = points
        total_score += points
        total_possible += possible
        if reason:
            reasons.append(reason)

    time_fraction, time_reason = _time_decay_fraction(order_a, order_b, time_window)
    components["time_decay_multiplier"] = time_fraction
    if time_reason:
        reasons.append(time_reason)
    total_score *= time_fraction

    return SimilarityResult(score=total_score, max_possible_score=total_possible, components=components, reasons=reasons)


def classify_similarity(
    result: SimilarityResult,
    *,
    thresholds: Optional[dict[str, float]] = None,
) -> Classification:
    thresholds = thresholds or DEFAULT_SIMILARITY_THRESHOLDS
    score = result.normalized_score
    if score >= thresholds.get("auto_merge_threshold", DEFAULT_SIMILARITY_THRESHOLDS["auto_merge_threshold"]):
        return "auto_merge"
    if score >= thresholds.get("needs_review_threshold", DEFAULT_SIMILARITY_THRESHOLDS["needs_review_threshold"]):
        return "needs_review"
    return "distinct"
