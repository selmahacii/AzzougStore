import difflib
import logging
import re
import unicodedata
from typing import Any, Dict, List, Optional
import httpx
from sqlalchemy.orm import Session
from app.models.delivery_partner import DeliveryPartner
from app.core.encryption import decrypt_dict

logger = logging.getLogger("carriers.noest_mapping")

# Standard Algerian Wilayas list (same order as Official/Noest list, 1-indexed)
WILAYAS = [
    'Adrar', 'Chlef', 'Laghouat', 'Oum El Bouaghi', 'Batna', 'Béjaïa',
    'Biskra', 'Béchar', 'Blida', 'Bouira', 'Tamanrasset', 'Tébessa',
    'Tlemcen', 'Tiaret', 'Tizi Ouzou', 'Alger', 'Djelfa', 'Jijel',
    'Sétif', 'Saïda', 'Skikda', 'Sidi Bel Abbès', 'Annaba', 'Guelma',
    'Constantine', 'Médéa', 'Mostaganem', "M'Sila", 'Mascara', 'Ouargla',
    'Oran', 'El Bayadh', 'Illizi', 'Bordj Bou Arréridj', 'Boumerdès',
    'El Tarf', 'Tindouf', 'Tissemsilt', 'El Oued', 'Khenchela',
    'Souk Ahras', 'Tipaza', 'Mila', 'Aïn Defla', 'Naâma', 'Aïn Témouchent',
    'Ghardaïa', 'Relizane', "El M'Ghair", 'El Meniaa', 'Ouled Djellal',
    'Bordj Baji Mokhtar', 'Béni Abbès', 'Timimoun', 'Touggourt', 'Djanet',
    'In Salah', 'In Guezzam'
]

# Cache in-memory: wilaya_id -> List of commune names
_communes_cache: Dict[int, List[str]] = {}

# Static fallback communes for wilayas that Noest may not cover
_STATIC_COMMUNES: Dict[int, List[str]] = {
    57: ['In Salah', 'Foggaret Ezzaouia', 'In Ghar'],
}

def normalize_string(s: str) -> str:
    """
    Normalizes a string for robust matching:
    1. Converts to lowercase.
    2. Removes Arabic characters.
    3. Stips accents (converts to base characters).
    4. Removes non-alphanumeric punctuation.
    5. Collapses spaces.
    """
    if not s:
        return ""
    s = s.lower()
    # Remove Arabic letters (Unicode blocks for Arabic)
    s = re.sub(r'[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]', '', s)
    # Strip accents
    s = "".join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')
    # Replace non-alphanumeric characters with spaces
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    # Clean multiple spaces
    s = re.sub(r"\s+", " ", s).strip()
    return s

def map_wilaya_name_to_id(wilaya_name: str) -> int:
    """
    Maps a wilaya name or numeric string to its 1-indexed ID.
    Defaults to 16 (Alger) if not found.
    """
    if not wilaya_name:
        return 16
    
    val = wilaya_name.strip()
    if val.isdigit():
        num = int(val)
        if 1 <= num <= 58:
            return num
        return 16

    norm_input = normalize_string(val)
    for idx, w_name in enumerate(WILAYAS):
        if normalize_string(w_name) == norm_input:
            return idx + 1
            
    # Substring matching fallback
    for idx, w_name in enumerate(WILAYAS):
        if norm_input in normalize_string(w_name) or normalize_string(w_name) in norm_input:
            return idx + 1

    return 16

async def get_noest_communes(db: Session, store_id: str, wilaya_id: int) -> List[str]:
    """
    Fetches the list of communes for a wilaya from Noest API (with process lifetime cache).
    """
    if wilaya_id in _communes_cache:
        return _communes_cache[wilaya_id]

    # Fetch partner credentials
    partner = (
        db.query(DeliveryPartner)
        .filter(
            DeliveryPartner.store_id == store_id,
            DeliveryPartner.carrier_id == "noest",
            DeliveryPartner.is_active == True,
        )
        .first()
    )
    if not partner:
        logger.warning("Noest partner not configured for store %s", store_id)
        return []

    try:
        cfg = decrypt_dict(partner.api_config_encrypted or "")
    except Exception:
        cfg = {}
    token = cfg.get("api_token") or cfg.get("token") or ""
    if not token:
        logger.warning("Noest token missing for store %s", store_id)
        return []

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    url = f"https://app.noest-dz.com/api/public/get/communes?wilaya_id={wilaya_id}"
    logger.info("Fetching Noest communes for Wilaya %s from API...", wilaya_id)
    
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            r = await client.get(url, headers=headers)
            if r.status_code != 200:
                logger.error("Failed to fetch Noest communes: %s", r.text[:200])
                return []
            
            data = r.json()
            raw_list = data
            if isinstance(data, dict) and "data" in data:
                raw_list = data["data"]
            
            communes = []
            if isinstance(raw_list, list):
                for item in raw_list:
                    if isinstance(item, dict) and "nom" in item:
                        communes.append(item["nom"])
                    elif isinstance(item, str):
                        communes.append(item)
            
            if communes:
                _communes_cache[wilaya_id] = communes
                logger.info("Cached %s communes for Wilaya %s", len(communes), wilaya_id)
                return communes
        except Exception as e:
            logger.error("Exception fetching Noest communes: %s", e)

    static = _STATIC_COMMUNES.get(wilaya_id)
    if static:
        _communes_cache[wilaya_id] = static
        return static
    return []

# Explicit mapping table for spelling discrepancies, typos, or special cases
# Maps (wilaya_id, normalized_frontend_commune) -> exact_noest_commune_name
EXPLICIT_MAPPING = {
    # Mila
    (43, "teleghma"): "Telerghma",
    (43, "amira arres"): "Amira Arras",
    # Oran
    (31, "el ancor"): "El Ancar",
    # Alger — legacy frontend spellings (old orders) + ONS names vs Noest names
    (16, "bologhine ibnou ziri"): "Bologhine Ibn Ziri",
    (16, "bologhine"): "Bologhine Ibn Ziri",
    (16, "mohamed belouzdad"): "Belouizdad",
    (16, "khraissia"): "Khraicia",
    (16, "sehaoula"): "Saoula",
    (16, "maalma"): "Mahelma",
    (16, "douira"): "Douera",
    (16, "bir touta"): "Birtouta",
    (16, "herraoua"): "Heraoua",
    (16, "h raoua"): "Heraoua",
    # M'Sila — communes ajoutées à la liste ONS + variantes probables Noest
    (28, "bou saada"): "Bou Saada",
    (28, "ain el melh"): "Ain El Melh",
    (28, "djebel messaad"): "Djebel Messaad",
    (28, "mohammed boudiaf"): "Mohammed Boudiaf",
    (28, "sidi m hamed"): "Sidi M'hamed",
    # Tizi Ouzou
    (15, "aghribs"): "Aghrib",
    (15, "iboudrarene"): "Iboudraren",
    (15, "maatkas"): "Maatka",
    (15, "mechtras"): "Mechtrass",
    (15, "ouadhias"): "Ouadhia",
    (15, "souama"): "Souamaa",
    (15, "tizi gheniff"): "Tizi Ghenif",
    (15, "yakourene"): "Yakouren",
    (15, "yatafene"): "Yatafen",
    # Guelma
    (24, "bordj sabath"): "Bordj Sabat",
    (24, "khezaras"): "Khezara",
    # Constantine
    (25, "ouled rahmoun"): "Ouled Rahmoune",
    # Médéa
    (26, "ouled deid"): "Ouled Deide",
    # Mostaganem
    (27, "benabdelmalek ramdane"): "Abdelmalek Ramdane",
    (27, "hassiane"): "El Hassiane",
    # El Oued
    (39, "douar el maa"): "Douar El Ma",
    # Tipaza
    (42, "cherchell"): "Cherchel",
    # Aïn Defla
    (44, "hassania"): "El Hassania",
    # Naâma
    (45, "el biodh"): "El Biod",
    # Custom
    (16, "centre sacre coeur"): "Alger Centre",
}

async def find_best_commune_match(db: Session, store_id: str, wilaya_id: int, commune_name: str) -> Optional[str]:
    """
    Resolves the raw commune string into the exact commune name expected by Noest.
    Returns None if no match is found.
    """
    if not commune_name:
        return None

    # Load standard Noest communes
    noest_communes = await get_noest_communes(db, store_id, wilaya_id)
    if not noest_communes:
        # Fall back to returning sanitized string if API fetch failed to prevent blocking
        return normalize_string(commune_name)

    norm_input = normalize_string(commune_name)

    # 0. Check explicit mapping table first. If the override isn't present in the
    #    live Noest list, fall through to the generic matching steps instead of
    #    returning a name Noest would reject.
    override = EXPLICIT_MAPPING.get((wilaya_id, norm_input))
    if override:
        for c in noest_communes:
            if c.lower() == override.lower():
                return c

    # 1. Exact normalized match
    for c in noest_communes:
        if normalize_string(c) == norm_input:
            return c

    # 2. Substring matching fallback
    for c in noest_communes:
        norm_c = normalize_string(c)
        if norm_input in norm_c or norm_c in norm_input:
            return c

    # 3. Fuzzy fallback for spelling variants (Khraissia/Khraicia, Douira/Douera...)
    normalized_map = {normalize_string(c): c for c in noest_communes}
    close = difflib.get_close_matches(norm_input, list(normalized_map.keys()), n=1, cutoff=0.8)
    if close:
        logger.info("Fuzzy commune match: '%s' -> '%s'", commune_name, normalized_map[close[0]])
        return normalized_map[close[0]]

    # 4. Last resort: trust the override even if not seen in the fetched list
    return override
