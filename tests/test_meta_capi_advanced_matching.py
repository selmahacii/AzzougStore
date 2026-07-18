"""
Regression test for a real production bug found via live data audit
(2026-07-18): order ABN-20260715-A4C468 on the "Chic Outfit" store,
customer_name="عصنون صالح" (Arabic script) — a completely normal,
extremely common case for Algerian customers.

normalize_name()/normalize_city() used `re.sub(r"[^a-z]", "", ...)`,
keeping ONLY ASCII a-z. Arabic (and any non-Latin script) has no
composed diacritics for _strip_accents' NFD decomposition to remove, so
the "[^a-z]" filter deleted every single character, reducing the name to
an empty string and silently sending fn=None/ln=None to Meta — while the
live Signal Quality Center showed exactly this: "Prénom" and "Nom"
field coverage at 0% for a sample where 84.6% of the customer_name
values were genuinely present in the database.

Meta's Advanced Matching spec (developers.facebook.com/docs/marketing-api/
conversions-api/parameters/customer-information-parameters) hashes the
lowercase, trimmed UTF-8 bytes — it does NOT require Latin script. The
"a-z only" restriction was never part of Meta's actual requirement.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.meta_capi import normalize_name, normalize_city, _sha256


def test_arabic_name_is_no_longer_wiped_to_none():
    """The exact real production case: order ABN-20260715-A4C468."""
    result = normalize_name("عصنون صالح")
    assert result is not None
    assert result == _sha256("عصنونصالح")  # lowercase (no-op for Arabic) + whitespace stripped, then hashed


def test_arabic_city_is_no_longer_wiped_to_none():
    result = normalize_city("الجزائر")
    assert result is not None


def test_mixed_arabic_latin_city_still_prefers_the_latin_suffix():
    """Existing behavior (unrelated to this fix) must be preserved: "· " separator still splits."""
    result = normalize_city("القبة · Kouba")
    assert result == _sha256("kouba")


def test_latin_names_still_normalize_and_strip_accents_as_before():
    assert normalize_name("José García") == _sha256("josegarcia")
    assert normalize_name("Jean-Luc") == _sha256("jeanluc")


def test_empty_and_none_still_return_none():
    assert normalize_name(None) is None
    assert normalize_name("") is None
    assert normalize_name("   ") is None
