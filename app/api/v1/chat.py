from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any
from app.db.session import get_db
from app.models.store import Store
from app.models.product import Product
from pydantic import BaseModel, Field
import re
import time
from collections import defaultdict

router = APIRouter()

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    storeId: str
    conversationHistory: Optional[List[ChatMessage]] = []

class ChatResponse(BaseModel):
    response: str
    history: List[dict]

# In-memory Rate Limiting
chat_rate_limit = defaultdict(lambda: {"count": 0, "windowStart": time.time()})
CHAT_RATE_LIMIT = 10
CHAT_RATE_WINDOW = 60

def sanitize_message(text: str) -> str:
    """Mask phone numbers and addresses."""
    text = re.sub(r'0[5-7]\d{8}', '[NUMERO MASQUE]', text)
    text = re.sub(r'\b\d{5}\b', '[CODE MASQUE]', text)
    return text

@router.post("/", response_model=ChatResponse)
def handle_chat(
    req: ChatRequest,
    db: Session = Depends(get_db)
):
    now = time.time()
    rate_entry = chat_rate_limit[req.storeId]
    
    if now - rate_entry["windowStart"] < CHAT_RATE_WINDOW:
        if rate_entry["count"] >= CHAT_RATE_LIMIT:
            raise HTTPException(status_code=429, detail="Limite de messages atteinte. Veuillez patienter.")
        rate_entry["count"] += 1
    else:
        chat_rate_limit[req.storeId] = {"count": 1, "windowStart": now}

    sanitized_msg = sanitize_message(req.message.strip())

    store = db.query(Store).filter(Store.id == req.storeId, Store.is_deleted == False).first()
    if not store:
        raise HTTPException(status_code=404, detail="Boutique introuvable")

    products = db.query(Product).filter(Product.store_id == req.storeId, Product.is_active == True).limit(20).all()
    
    product_lines = []
    for p in products:
        available = max(0, p.stock - p.reserved_stock)
        status = "En stock" if available > 0 else "Rupture"
        desc = p.description or p.category or "Sans description"
        product_lines.append(f"- {p.name} ({p.price} DA) — {desc} [{status}]")
        
    product_list_text = "\n".join(product_lines) if product_lines else "Aucun produit actuellement disponible."

    # LIA AI Prompt structure
    system_prompt = f"""Tu es un assistant virtuel LECTURE-SEULE pour la boutique "{store.name}".
Description: {store.description or 'Boutique en ligne en Algérie'}

Produits disponibles:
{product_list_text}

Règles STRICTES:
- Réponds TOUJOURS en français
- Les prix sont en DA (Dinar Algérien)
- Tu es en mode LECTURE-SEULE"""

    history_dicts = [{"role": m.role, "content": sanitize_message(m.content[:500])} for m in req.conversationHistory[-10:] if m.role in ['user', 'assistant']]

    # Simulated AI response for the Python backend since ZAI SDK is Node only.
    # In a full production env, you would use openai or gemini SDK here.
    ai_response = f"[L.I.A] J'ai analysé votre demande '{sanitized_msg}'. Actuellement la boutique {store.name} possède {len(products)} produits phares en inventaire. Comment puis-je vous aider avec une commande ?"

    updated_history = history_dicts + [
        {"role": "user", "content": req.message},
        {"role": "assistant", "content": ai_response}
    ]

    return {
        "response": ai_response,
        "history": updated_history
    }
