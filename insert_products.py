import uuid
import random
import re
from app.db.session import SessionLocal
from app.models.product import Product

db = SessionLocal()
store_id = '7cdfc527-ea35-4bdb-acd3-d6f8646b6d47'

products_data = [
    {
        "name": "Coussin de voyage ergonomique à mémoire de forme",
        "description": "Coussin en U pour le cou, ultra confortable pour les longs trajets en avion ou en voiture. Mousse à mémoire de forme de haute qualité.",
        "price": 2500,
        "compare_price": 3500,
        "cost_price": 1200,
        "stock": 150
    },
    {
        "name": "Masque de sommeil occultant 3D",
        "description": "Masque de nuit 100% occultant, conception 3D pour ne pas presser les yeux. Idéal pour un sommeil réparateur en voyage.",
        "price": 1200,
        "compare_price": 1800,
        "cost_price": 400,
        "stock": 300
    },
    {
        "name": "Bouchons d'oreilles en silicone réutilisables",
        "description": "Bouchons d'oreilles isolants phoniques, parfaits pour dormir dans l'avion ou le train. Vendus avec boîte de transport.",
        "price": 800,
        "compare_price": 1200,
        "cost_price": 200,
        "stock": 500
    },
    {
        "name": "Repose-pieds de voyage gonflable",
        "description": "Repose-pieds gonflable pour soulager les jambes lourdes pendant les vols. Facile à gonfler et à ranger.",
        "price": 3200,
        "compare_price": 4500,
        "cost_price": 1500,
        "stock": 85
    },
    {
        "name": "Couverture de voyage compacte et douce",
        "description": "Couverture polaire ultra-douce et légère, se replie dans sa pochette pour servir de coussin.",
        "price": 3800,
        "compare_price": 5000,
        "cost_price": 1800,
        "stock": 120
    },
    {
        "name": "Organisateur de valise (Lot de 6 cubes)",
        "description": "Set de 6 pochettes de rangement pour optimiser l'espace de votre valise et garder vos vêtements bien pliés.",
        "price": 4500,
        "compare_price": 6000,
        "cost_price": 2200,
        "stock": 200
    },
    {
        "name": "Trousse de toilette suspendue imperméable",
        "description": "Trousse de voyage multi-compartiments avec crochet de suspension, imperméable et très pratique.",
        "price": 2800,
        "compare_price": 4000,
        "cost_price": 1100,
        "stock": 140
    },
    {
        "name": "Pèse-bagage électronique portable",
        "description": "Balance numérique pour valise, évitez les frais d'excédent de bagage à l'aéroport. Précision de 10g.",
        "price": 1500,
        "compare_price": 2200,
        "cost_price": 600,
        "stock": 250
    },
    {
        "name": "Adaptateur de prise universel avec ports USB",
        "description": "Adaptateur de voyage international (UK, US, EU, AUS) avec 2 ports USB de charge rapide.",
        "price": 2900,
        "compare_price": 4200,
        "cost_price": 1300,
        "stock": 180
    },
    {
        "name": "Bouteille d'eau pliable en silicone",
        "description": "Gourde rétractable de 500ml, sans BPA. Parfaite pour passer la sécurité de l'aéroport à vide et la remplir ensuite.",
        "price": 2100,
        "compare_price": 3000,
        "cost_price": 900,
        "stock": 110
    },
    {
        "name": "Coussin lombaire gonflable",
        "description": "Soutien ergonomique pour le dos, idéal pour les sièges d'avion ou de voiture inconfortables.",
        "price": 1900,
        "compare_price": 2800,
        "cost_price": 750,
        "stock": 90
    },
    {
        "name": "Serviette en microfibre à séchage rapide",
        "description": "Serviette de voyage ultra-absorbante et compacte, sèche 3 fois plus vite qu'une serviette classique.",
        "price": 1700,
        "compare_price": 2500,
        "cost_price": 700,
        "stock": 160
    },
    {
        "name": "Bas de contention pour le voyage",
        "description": "Chaussettes de compression pour stimuler la circulation sanguine et éviter les gonflements pendant les longs vols.",
        "price": 1400,
        "compare_price": 2000,
        "cost_price": 500,
        "stock": 220
    },
    {
        "name": "Parapluie de voyage ultra-compact",
        "description": "Mini parapluie coupe-vent qui tient dans la poche ou le sac à main. Léger et robuste.",
        "price": 2600,
        "compare_price": 3800,
        "cost_price": 1000,
        "stock": 130
    },
    {
        "name": "Sac à dos antivol imperméable",
        "description": "Sac à dos urbain avec fermetures cachées, port de charge USB et tissu résistant aux coupures. Idéal pour voyager en sécurité.",
        "price": 8500,
        "compare_price": 12000,
        "cost_price": 4000,
        "stock": 60
    }
]

def slugify(text):
    text = text.lower()
    text = re.sub(r'[^a-z0-9]+', '-', text)
    return text.strip('-')

added = 0
for p_data in products_data:
    slug = slugify(p_data["name"])
    
    existing = db.query(Product).filter_by(store_id=store_id, slug=slug).first()
    if existing:
        continue
        
    p = Product(
        id=str(uuid.uuid4()),
        store_id=store_id,
        name=p_data["name"],
        slug=slug,
        sku=f"TS-VOY-{random.randint(1000, 9999)}",
        description=p_data["description"],
        price=p_data["price"],
        compare_price=p_data["compare_price"],
        cost_price=p_data["cost_price"],
        stock=p_data["stock"]
    )
    db.add(p)
    added += 1

db.commit()
print(f"Added {added} products to TrustShop!")
