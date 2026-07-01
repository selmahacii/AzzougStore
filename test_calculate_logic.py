import sys
import os
import unittest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Setup path to import app modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.db.base_class import Base
from app.models.delivery_partner import DeliveryPartner, DeliveryFeeGrid
from app.models.product import Product
from app.api.v1.delivery_partners import calculate_delivery_fee

class TestDeliveryCalculation(unittest.TestCase):
    def setUp(self):
        # Create an in-memory SQLite database
        self.engine = create_engine("sqlite:///:memory:")
        TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        Base.metadata.create_all(bind=self.engine)
        self.db = TestingSessionLocal()

        # Seed standard delivery partner (Yalidine)
        self.partner = DeliveryPartner(
            id="yalidine-partner-uuid",
            store_id="store-1",
            carrier_id="yalidine",
            name="Yalidine",
            is_active=True,
            fee_home=600.0,
            fee_relay=300.0
        )
        self.db.add(self.partner)

        # Seed a standard wilaya fee grid entry for Alger (wilaya_id 16)
        # Yalidine Alger: Home 500 DA, Desk 250 DA
        self.grid = DeliveryFeeGrid(
            id="grid-entry-1",
            partner_id="yalidine-partner-uuid",
            wilaya_id=16,
            home_fee=500,
            office_fee=250
        )
        self.db.add(self.grid)

        # Seed Product 1: Standard product (no custom delivery fees)
        self.product_std = Product(
            id="prod-standard",
            store_id="store-1",
            name="Standard Product",
            slug="standard-product",
            price=1500,
            is_active=True
        )
        self.db.add(self.product_std)

        # Seed Product 2: Product with Free Shipping
        self.product_free = Product(
            id="prod-free-shipping",
            store_id="store-1",
            name="Free Shipping Product",
            slug="free-shipping-product",
            price=2000,
            is_active=True,
            delivery_fees={"is_free": True}
        )
        self.db.add(self.product_free)

        # Seed Product 3: Product with Custom Rates (Alger Home 200, Desk 100)
        self.product_custom = Product(
            id="prod-custom-rates",
            store_id="store-1",
            name="Custom Rates Product",
            slug="custom-rates-product",
            price=3000,
            is_active=True,
            delivery_fees={
                "is_free": False,
                "fees": {
                    "yalidine": {
                        "16": { "home": 200, "desk": 100 }
                    }
                }
            }
        )
        self.db.add(self.product_custom)

        self.db.commit()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)

    def test_fallback_to_grid_and_flat(self):
        # Case A: Standard product with Alger (wilaya 16). Should use carrier grid (Home 500)
        res = calculate_delivery_fee(
            partner_id="yalidine-partner-uuid",
            wilaya_id="Alger",
            delivery_type="home",
            product_ids="prod-standard",
            db=self.db
        )
        self.assertTrue(res["success"])
        self.assertEqual(res["data"]["fee"], 500.0)

        # Case B: Standard product with Oran (wilaya 31, no grid entry). Should use carrier flat (Home 600)
        res = calculate_delivery_fee(
            partner_id="yalidine-partner-uuid",
            wilaya_id="Oran",
            delivery_type="home",
            product_ids="prod-standard",
            db=self.db
        )
        self.assertTrue(res["success"])
        self.assertEqual(res["data"]["fee"], 600.0)

    def test_free_shipping_product(self):
        # Free shipping product should yield 0.0 fee
        res = calculate_delivery_fee(
            partner_id="yalidine-partner-uuid",
            wilaya_id="Alger",
            delivery_type="home",
            product_ids="prod-free-shipping",
            db=self.db
        )
        self.assertTrue(res["success"])
        self.assertEqual(res["data"]["fee"], 0.0)

    def test_custom_rates_product(self):
        # Custom rates product: Alger Home should be 200, Alger Desk should be 100
        res_home = calculate_delivery_fee(
            partner_id="yalidine-partner-uuid",
            wilaya_id="Alger",
            delivery_type="home",
            product_ids="prod-custom-rates",
            db=self.db
        )
        self.assertTrue(res_home["success"])
        self.assertEqual(res_home["data"]["fee"], 200.0)

        res_desk = calculate_delivery_fee(
            partner_id="yalidine-partner-uuid",
            wilaya_id="Alger",
            delivery_type="desk",
            product_ids="prod-custom-rates",
            db=self.db
        )
        self.assertTrue(res_desk["success"])
        self.assertEqual(res_desk["data"]["fee"], 100.0)

    def test_multiple_products_combination(self):
        # Case A: Standard product (Alger Home 500) + Custom product (Alger Home 200)
        # Should take the maximum -> 500
        res = calculate_delivery_fee(
            partner_id="yalidine-partner-uuid",
            wilaya_id="Alger",
            delivery_type="home",
            product_ids="prod-standard,prod-custom-rates",
            db=self.db
        )
        self.assertTrue(res["success"])
        self.assertEqual(res["data"]["fee"], 500.0)

        # Case B: Free shipping product (0) + Custom product (Alger Home 200)
        # Should take the maximum -> 200
        res = calculate_delivery_fee(
            partner_id="yalidine-partner-uuid",
            wilaya_id="Alger",
            delivery_type="home",
            product_ids="prod-free-shipping,prod-custom-rates",
            db=self.db
        )
        self.assertTrue(res["success"])
        self.assertEqual(res["data"]["fee"], 200.0)

        # Case C: Free shipping product (0) + Free shipping product (0)
        # Should take the maximum -> 0
        res = calculate_delivery_fee(
            partner_id="yalidine-partner-uuid",
            wilaya_id="Alger",
            delivery_type="home",
            product_ids="prod-free-shipping,prod-free-shipping",
            db=self.db
        )
        self.assertTrue(res["success"])
        self.assertEqual(res["data"]["fee"], 0.0)

if __name__ == "__main__":
    unittest.main()
