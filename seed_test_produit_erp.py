import os
import uuid
from sqlalchemy import create_engine, text
import json
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)

def seed():
    with engine.connect() as conn:
        # Get stores
        res = conn.execute(text("SELECT id, name FROM stores"))
        stores = res.fetchall()
        if not stores:
            print("No stores found to seed landing page.")
            return
        
        for store in stores:
            store_id = store[0]
            store_name = store[1]
            print(f"Processing store: {store_name} ({store_id})")
            
            # 1. Create or get the product 'test produit ERP'
            prod_slug = "test-produit-erp"
            prod_id = f"prod-{uuid.uuid4().hex[:12]}"
            
            # Check if product exists
            p_res = conn.execute(
                text("SELECT id FROM products WHERE store_id = :store_id AND slug = :slug"),
                {"store_id": store_id, "slug": prod_slug}
            )
            p_row = p_res.fetchone()
            
            if p_row:
                actual_prod_id = p_row[0]
                print(f"Product '{prod_slug}' already exists with ID: {actual_prod_id}")
            else:
                actual_prod_id = prod_id
                conn.execute(
                    text("""
                        INSERT INTO products (id, store_id, name, slug, sku, price, compare_price, cost_price, stock, is_active, images, tags, pack_items, pack_charges, allowed_carriers)
                        VALUES (:id, :store_id, :name, :slug, :sku, :price, :compare_price, :cost_price, :stock, :is_active, :images, :tags, :pack_items, :pack_charges, :allowed_carriers)
                    """),
                    {
                        "id": actual_prod_id,
                        "store_id": store_id,
                        "name": "test produit ERP",
                        "slug": prod_slug,
                        "sku": "ERP-TEST",
                        "price": 0,
                        "compare_price": 0,
                        "cost_price": 0,
                        "stock": 999,
                        "is_active": True,
                        "images": json.dumps([]),
                        "tags": json.dumps(["test"]),
                        "pack_items": json.dumps([]),
                        "pack_charges": json.dumps([]),
                        "allowed_carriers": json.dumps([])
                    }
                )
                print(f"Created product 'test produit ERP' with ID: {actual_prod_id}")
            
            # 2. Create or update landing page 'test-produit-erp'
            lp_slug = "test-produit-erp"
            lp_id = str(uuid.uuid4())
            
            # Check if landing page exists
            lp_res = conn.execute(
                text("SELECT id FROM landing_pages WHERE store_id = :store_id AND slug = :slug"),
                {"store_id": store_id, "slug": lp_slug}
            )
            lp_row = lp_res.fetchone()
            
            stats = [
                {"value": 12000, "suffix": "+", "label": "Clients satisfaits"},
                {"value": 98, "suffix": "%", "label": "Avis positifs"},
                {"value": 48, "suffix": "h", "label": "Délai livraison"}
            ]
            
            benefits = [
                {"icon": "Zap", "title": "Performance", "desc": "Traitement ultra-rapide et automatisé."},
                {"icon": "ShieldCheck", "title": "Sécurisé", "desc": "Vos données d'entreprise hautement sécurisées."},
                {"icon": "Clock", "title": "Support 24/7", "desc": "Une assistance technique DZ à votre écoute."}
            ]
            
            steps = [
                {"step": "01", "title": "Initialisation", "desc": "Configuration immédiate de votre espace de démonstration."},
                {"step": "02", "title": "Intégration", "desc": "Importation facile de vos données produits et stocks."},
                {"step": "03", "title": "Déploiement", "desc": "Prise en main fluide avec notre interface intuitive."}
            ]
            
            testimonials = [
                {"name": "Mourad A.", "location": "Alger", "text": "Ce module ERP a complètement restructuré notre logistique et notre calcul de ROAS.", "stars": 5},
                {"name": "Lydia S.", "location": "Oran", "text": "Intégration Meta Ads impeccable, ROAS calculé en temps réel. Exceptionnel !", "stars": 5}
            ]
            
            faq = [
                {"question": "Comment tester le produit ?", "answer": "Il s'agit d'une page de démonstration présentant les fonctionnalités du système ERP."},
                {"question": "Le support est-il disponible ?", "answer": "Oui, notre équipe technique vous accompagne à chaque étape du déploiement."}
            ]
            
            lp_data = {
                "store_id": store_id,
                "product_id": actual_prod_id,
                "slug": lp_slug,
                "mode": "product",
                "is_active": True,
                "headline": "test produit ERP",
                "subtitle": "La solution ERP ultime pour propulser votre boutique e-commerce. Suivi de stock, Meta Ads, ROAS et gestion des livreurs réunis dans une interface moderne.",
                "badge_text": "Démo Produit",
                "cta_label": "Commander maintenant",
                "cta2_label": "Nous contacter",
                "image_url": "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&auto=format&fit=crop&q=60",
                "cta_headline": "Prêt à optimiser vos opérations ?",
                "cta_subtitle": "Rejoignez plus de 12 000 clients satisfaits et propulsez votre commerce dès aujourd'hui.",
                "product_name": "test produit ERP",
                "product_desc": "Profitez de notre système de test produit ERP pour évaluer l'ensemble des modules d'achats, upsell, livreurs et ROAS.",
                "price": 0,
                "compare_price": 0,
                "primary_color": "#6C5CE7",
                "template": "premium",
                "benefits": json.dumps(benefits),
                "testimonials": json.dumps(testimonials),
                "steps": json.dumps(steps),
                "stats": json.dumps(stats),
                "faq": json.dumps(faq),
                "gallery": json.dumps([]),
                "phone": "+213 555 12 34 56"
            }
            
            if lp_row:
                actual_lp_id = lp_row[0]
                print(f"Landing page '{lp_slug}' already exists with ID: {actual_lp_id}. Updating...")
                conn.execute(
                    text("""
                        UPDATE landing_pages
                        SET product_id = :product_id, headline = :headline, subtitle = :subtitle,
                            badge_text = :badge_text, cta_label = :cta_label, cta2_label = :cta2_label,
                            image_url = :image_url, cta_headline = :cta_headline, cta_subtitle = :cta_subtitle,
                            product_name = :product_name, product_desc = :product_desc, price = :price,
                            compare_price = :compare_price, primary_color = :primary_color, template = :template,
                            benefits = :benefits, testimonials = :testimonials, steps = :steps, stats = :stats,
                            faq = :faq, gallery = :gallery, phone = :phone, is_active = :is_active
                        WHERE id = :id
                    """),
                    {**lp_data, "id": actual_lp_id}
                )
            else:
                actual_lp_id = lp_id
                print(f"Creating landing page '{lp_slug}' with ID: {actual_lp_id}")
                conn.execute(
                    text("""
                        INSERT INTO landing_pages (id, store_id, product_id, slug, mode, is_active, headline, subtitle,
                                                   badge_text, cta_label, cta2_label, image_url, cta_headline, cta_subtitle,
                                                   product_name, product_desc, price, compare_price, primary_color, template,
                                                   benefits, testimonials, steps, stats, faq, gallery, phone)
                        VALUES (:id, :store_id, :product_id, :slug, :mode, :is_active, :headline, :subtitle,
                                :badge_text, :cta_label, :cta2_label, :image_url, :cta_headline, :cta_subtitle,
                                :product_name, :product_desc, :price, :compare_price, :primary_color, :template,
                                :benefits, :testimonials, :steps, :stats, :faq, :gallery, :phone)
                    """),
                    {**lp_data, "id": actual_lp_id}
                )
                
            conn.commit()
            print(f"Successfully seeded landing page '{lp_slug}' for store '{store_name}'")

if __name__ == "__main__":
    seed()
