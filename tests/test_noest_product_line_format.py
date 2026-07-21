"""
Regression test for the concise Noest carrier product/variant format
(2026-07-21): the confirmatrice-facing item.variant_details stays verbose
("P1: Couleur: Noir | P2: Couleur: Noir") — that's for humans reading the
order detail. What gets uploaded to Noest must be short and grouped by
identical variant, e.g. "cv:noir x2" instead of repeating the full product
name and the internal P1/P2 unit breakdown on the carrier's parcel label.
"""
from app.api.v1.orders import _noest_product_shortcode, _noest_variant_values, _build_noest_product_line


class _FakeItem:
    def __init__(self, product_name, variant_details, quantity):
        self.product_name = product_name
        self.variant_details = variant_details
        self.quantity = quantity


def test_shortcode_skips_french_particles():
    assert _noest_product_shortcode("Coussin de Voyage") == "cv"


def test_shortcode_falls_back_when_no_letters_found():
    assert _noest_product_shortcode("123") == "123"[:3]


def test_variant_values_strip_group_names_and_unit_prefixes():
    assert _noest_variant_values("P1: Couleur: Noir | P2: Couleur: Noir") == ["noir", "noir"]


def test_variant_values_handle_multi_group_single_unit():
    assert _noest_variant_values("Couleur: Bleu, Taille: XL") == ["bleu / xl"]


def test_variant_values_empty_when_none():
    assert _noest_variant_values(None) == []


def test_build_line_groups_identical_variants_into_one_entry():
    item = _FakeItem("Coussin de Voyage", "P1: Couleur: Noir | P2: Couleur: Noir", 2)
    assert _build_noest_product_line(item) == "cv:noir x2"


def test_build_line_keeps_distinct_variants_separate():
    item = _FakeItem("Coussin de Voyage", "P1: Couleur: Noir | P2: Couleur: Gris", 2)
    line = _build_noest_product_line(item)
    assert "cv:noir x1" in line
    assert "cv:gris x1" in line


def test_build_line_without_variant_falls_back_to_shortcode_and_quantity():
    item = _FakeItem("Coussin de Voyage", None, 3)
    assert _build_noest_product_line(item) == "cv x3"
