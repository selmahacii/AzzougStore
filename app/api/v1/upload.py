import os
import uuid
import mimetypes
import io
import logging
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, Request
from fastapi.responses import FileResponse

try:
    import cloudinary
    import cloudinary.uploader
    _CLOUDINARY_OK = True
except (ImportError, ValueError):
    _CLOUDINARY_OK = False

from app.api import deps

router = APIRouter()
logger = logging.getLogger("app.upload")

# ─── Configuration ────────────────────────────────────────────
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"}
ALLOWED_VIDEO_TYPES = {"video/mp4", "video/webm", "video/ogg", "video/quicktime"}
ALLOWED_TYPES = ALLOWED_IMAGE_TYPES
MAX_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024  # 100 MB

CLOUDINARY_URL = os.environ.get("CLOUDINARY_URL", "")
# Accept CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET as
# an alternative to CLOUDINARY_URL — Cloudinary's own dashboard shows these
# three values separately, so users who configured "Cloudinary" on HuggingFace
# by copying cloud name/key/secret (rather than assembling the single
# cloudinary://key:secret@cloud_name URL themselves) had it silently ignored:
# this file used to check ONLY CLOUDINARY_URL, so their uploads fell back to
# the Space's ephemeral local disk despite Cloudinary being "configured".
_CLOUD_NAME = os.environ.get("CLOUDINARY_CLOUD_NAME", "")
_API_KEY = os.environ.get("CLOUDINARY_API_KEY", "")
_API_SECRET = os.environ.get("CLOUDINARY_API_SECRET", "")
_USING_INDIVIDUAL_VARS = False

if _CLOUDINARY_OK:
    if CLOUDINARY_URL and CLOUDINARY_URL.startswith("cloudinary://"):
        try:
            cloudinary.config()
        except Exception:
            _CLOUDINARY_OK = False
    elif _CLOUD_NAME and _API_KEY and _API_SECRET:
        try:
            cloudinary.config(cloud_name=_CLOUD_NAME, api_key=_API_KEY, api_secret=_API_SECRET)
            _USING_INDIVIDUAL_VARS = True
        except Exception:
            _CLOUDINARY_OK = False
    else:
        _CLOUDINARY_OK = False

if not _CLOUDINARY_OK:
    import logging
    logging.getLogger("app.upload").warning(
        "Cloudinary non configuré — uploads stockés sur disque local ÉPHÉMÈRE "
        "(perdus à chaque redémarrage du Space). Configurez CLOUDINARY_URL ou "
        "CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET."
    )


def get_base_url(request: Request = None) -> str:
    # 1. Try env variable
    env_api_url = os.environ.get("NEXT_PUBLIC_API_URL") or os.environ.get("BACKEND_URL")
    if env_api_url:
        return env_api_url.rstrip("/")
        
    # 2. Try Hugging Face Space ID
    space_id = os.environ.get("SPACE_ID")
    if space_id:
        subdomain = space_id.replace("/", "-").lower()
        return f"https://{subdomain}.hf.space"
        
    # 3. Fall back to request headers if request is provided
    if request:
        host = request.headers.get("x-forwarded-host") or request.headers.get("host")
        if host:
            proto = request.headers.get("x-forwarded-proto") or request.url.scheme or "http"
            if "://" in host:
                return host.rstrip("/")
            return f"{proto}://{host}".rstrip("/")
            
    # 4. Global fallback
    return "http://localhost:8003"


@router.get("/storage-status", response_model=dict)
def storage_status(current_user: Any = Depends(deps.get_current_active_user)) -> dict:
    """
    Reports whether uploads are actually persisted to Cloudinary or falling
    back to the Space's ephemeral local disk (wiped on every redeploy/restart).
    Runs a real authenticated call against Cloudinary — not just a format
    check on the env var — so a wrong/expired CLOUDINARY_URL is caught here
    instead of silently degrading every future upload to local disk.
    """
    url_looks_valid = bool(CLOUDINARY_URL and CLOUDINARY_URL.startswith("cloudinary://"))
    individual_vars_present = bool(_CLOUD_NAME and _API_KEY and _API_SECRET)

    result: dict = {
        "package_installed": _CLOUDINARY_OK,
        "config_method": "CLOUDINARY_URL" if url_looks_valid else ("individual vars" if individual_vars_present else None),
        "env_var_present": bool(CLOUDINARY_URL) or individual_vars_present,
        "env_var_looks_valid": url_looks_valid or individual_vars_present,
        "persistent": False,
        "detail": None,
    }

    if not CLOUDINARY_URL and not individual_vars_present:
        result["detail"] = (
            "Aucune configuration Cloudinary trouvée — ni CLOUDINARY_URL, ni le trio "
            "CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET. "
            "Tous les uploads (logos, hero, produits) sont perdus à chaque redéploiement du Space."
        )
        return result

    if CLOUDINARY_URL and not url_looks_valid and not individual_vars_present:
        result["detail"] = "CLOUDINARY_URL est défini mais n'a pas le format attendu 'cloudinary://<api_key>:<api_secret>@<cloud_name>' — vérifiez le secret sur HuggingFace."
        return result

    if not _CLOUDINARY_OK:
        result["detail"] = "Le package cloudinary n'a pas pu être importé/configuré côté serveur."
        return result

    try:
        import cloudinary.api as _cloudinary_api
        _cloudinary_api.ping()
        result["persistent"] = True
        result["detail"] = "Stockage Cloudinary actif et joignable — les uploads persistent entre les redéploiements."
    except Exception as exc:
        result["detail"] = f"Configuration Cloudinary présente mais l'appel de test a échoué ({exc}) — les uploads retombent en stockage local éphémère."

    return result


@router.post("/image", response_model=dict)
async def upload_image(
    request: Request,
    file: UploadFile = File(...),
    current_user: Any = Depends(deps.get_current_active_user),
) -> dict:
    """
    Upload a single product image.
    - Validates MIME type (jpeg/png/webp/gif/avif only)
    - Validates file size (≤ 10 MB)
    - Stores to Cloudinary if CLOUDINARY_URL is set, otherwise locally
    - Returns { url, filename, size }
    """
    # ── MIME validation ───────────────────────────────────────
    content_type = file.content_type or ""
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Type de fichier non supporté: '{content_type}'. "
                   f"Types acceptés: jpeg, png, webp, gif, avif."
        )

    # ── Read & size check ─────────────────────────────────────
    content = await file.read()
    if len(content) > MAX_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Fichier trop volumineux ({len(content) // 1024} KB). Limite: 10 MB."
        )

    # ── Cloudinary Upload ─────────────────────────────────────
    cloudinary_error = None
    if _CLOUDINARY_OK:
        try:
            upload_result = cloudinary.uploader.upload(
                io.BytesIO(content),
                folder="azzougshop/products",
                resource_type="image"
            )
            url = upload_result.get("secure_url") or upload_result.get("url")
            return {
                "success": True,
                "url": url,
                "filename": upload_result.get("public_id"),
                "size": len(content),
                "content_type": content_type,
            }
        except Exception as e:
            cloudinary_error = str(e)
            print(f"WARNING: Cloudinary upload failed: {cloudinary_error}. Falling back to local storage.")

    # ── Determine extension ───────────────────────────────────
    ext = mimetypes.guess_extension(content_type) or ""
    ext_map = {
        ".jpe": ".jpg",
        ".jpeg": ".jpg",
    }
    ext = ext_map.get(ext, ext) or ".jpg"

    # ── Save to disk ──────────────────────────────────────────
    filename = f"{uuid.uuid4().hex}{ext}"
    dest = UPLOAD_DIR / filename
    dest.write_bytes(content)

    # ── Return public URL ─────────────────────────────────────
    base_url = get_base_url(request)
    url = f"{base_url}/api/v1/upload/files/{filename}"
    res = {
        "success": True,
        "url": url,
        "filename": filename,
        "size": len(content),
        "content_type": content_type,
    }
    if cloudinary_error:
        res["warning"] = "Stockage distant indisponible, image conservée en stockage local temporaire."
    return res


@router.post("/media", response_model=dict)
async def upload_media(
    request: Request,
    file: UploadFile = File(...),
    current_user: Any = Depends(deps.get_current_active_user),
) -> dict:
    """
    Upload an image or video (banner/hero section).
    Images: ≤ 10 MB. Videos: ≤ 100 MB.
    """
    content_type = file.content_type or ""
    allowed = ALLOWED_IMAGE_TYPES | ALLOWED_VIDEO_TYPES
    if content_type not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Type non supporté: '{content_type}'. Acceptés: jpeg, png, webp, mp4, webm."
        )

    content = await file.read()
    is_video = content_type in ALLOWED_VIDEO_TYPES
    size_limit = MAX_VIDEO_SIZE_BYTES if is_video else MAX_SIZE_BYTES
    if len(content) > size_limit:
        raise HTTPException(
            status_code=413,
            detail=f"Fichier trop volumineux ({len(content) // 1024} KB). Limite: {size_limit // 1024 // 1024} MB."
        )

    # ── Cloudinary Upload ─────────────────────────────────────
    cloudinary_error = None
    if _CLOUDINARY_OK:
        try:
            upload_result = cloudinary.uploader.upload(
                io.BytesIO(content),
                folder="azzougshop/media",
                resource_type="video" if is_video else "image"
            )
            url = upload_result.get("secure_url") or upload_result.get("url")
            return {
                "success": True,
                "url": url,
                "filename": upload_result.get("public_id"),
                "size": len(content),
                "content_type": content_type,
                "is_video": is_video,
            }
        except Exception as e:
            cloudinary_error = str(e)
            print(f"WARNING: Cloudinary upload failed: {cloudinary_error}. Falling back to local storage.")

    video_ext_map = {
        "video/mp4": ".mp4",
        "video/webm": ".webm",
        "video/ogg": ".ogv",
        "video/quicktime": ".mov",
    }
    if is_video:
        ext = video_ext_map.get(content_type, ".mp4")
    else:
        ext = mimetypes.guess_extension(content_type) or ".jpg"
        ext_map = {".jpe": ".jpg", ".jpeg": ".jpg"}
        ext = ext_map.get(ext, ext)

    filename = f"{uuid.uuid4().hex}{ext}"
    dest = UPLOAD_DIR / filename
    dest.write_bytes(content)

    base_url = get_base_url(request)
    url = f"{base_url}/api/v1/upload/files/{filename}"
    res = {
        "success": True,
        "url": url,
        "filename": filename,
        "size": len(content),
        "content_type": content_type,
        "is_video": is_video,
    }
    if cloudinary_error:
        res["warning"] = "Stockage distant indisponible, image conservée en stockage local temporaire."
    return res


@router.post("/migrate-to-cloudinary", response_model=dict)
def migrate_local_images_to_cloudinary(
    current_user: Any = Depends(deps.get_current_active_user),
) -> dict:
    """
    One-off, idempotent migration: finds every product image (main_image,
    gallery images[], variant/sub-variant images) still pointing at this
    backend's own ephemeral local-disk file server (…/api/v1/upload/files/…)
    and re-uploads it to Cloudinary, rewriting the stored URL in place.

    Why this exists: uploads made before CLOUDINARY_URL was correctly parsed
    (or made while Cloudinary was briefly unreachable) silently fell back to
    local disk. Those images are (a) served from the backend container itself
    with no CDN/format optimization — the single biggest Lighthouse
    "Améliorer l'affichage des images" hit on the landing pages — and (b) lost
    forever on the next Space restart, unlike everything already on Cloudinary.
    Safe to re-run: already-Cloudinary URLs are left untouched.
    """
    if current_user.role not in ("SUPER_ADMIN", "ADMIN"):
        raise HTTPException(status_code=403, detail="Superadmin only")
    if not _CLOUDINARY_OK:
        raise HTTPException(status_code=400, detail="Cloudinary n'est pas configuré sur ce serveur.")

    local_marker = "/api/v1/upload/files/"

    def _migrate_one(url: str) -> Optional[str]:
        if not url or local_marker not in url:
            return None
        filename = url.rsplit("/", 1)[-1]
        file_path = UPLOAD_DIR / Path(filename).name
        if not file_path.exists():
            return None
        try:
            content = file_path.read_bytes()
            upload_result = cloudinary.uploader.upload(
                io.BytesIO(content), folder="azzougshop/products", resource_type="image"
            )
            return upload_result.get("secure_url") or upload_result.get("url")
        except Exception as exc:
            logger.warning("Migration Cloudinary échouée pour %s: %s", filename, exc)
            return None

    from app.models.product import Product
    from app.db.session import get_db as _get_db

    db = next(_get_db())
    failed = 0
    products_touched = 0
    try:
        products = db.query(Product).all()
        for p in products:
            changed = False

            new_main = _migrate_one(p.main_image or "")
            if new_main:
                p.main_image = new_main
                changed = True
            elif p.main_image and local_marker in p.main_image:
                failed += 1

            images = list(p.images) if isinstance(p.images, list) else []
            new_images = []
            for img_url in images:
                new_url = _migrate_one(img_url)
                if new_url:
                    new_images.append(new_url)
                    changed = True
                else:
                    new_images.append(img_url)
                    if img_url and local_marker in img_url:
                        failed += 1
            if changed and new_images != images:
                p.images = new_images

            variants = p.variants if isinstance(p.variants, list) else []
            for v in variants:
                if not isinstance(v, dict):
                    continue
                if v.get("image"):
                    new_v_img = _migrate_one(v["image"])
                    if new_v_img:
                        v["image"] = new_v_img
                        changed = True
                    elif local_marker in v["image"]:
                        failed += 1
                for sv in (v.get("sub_variants") or []):
                    if isinstance(sv, dict) and sv.get("image"):
                        new_sv_img = _migrate_one(sv["image"])
                        if new_sv_img:
                            sv["image"] = new_sv_img
                            changed = True
                        elif local_marker in sv["image"]:
                            failed += 1

            if changed:
                from sqlalchemy.orm.attributes import flag_modified
                flag_modified(p, "images")
                flag_modified(p, "variants")
                products_touched += 1

        db.commit()
    finally:
        db.close()

    return {
        "success": True,
        "products_updated": products_touched,
        "images_still_local_or_failed": failed,
        "message": f"{products_touched} produit(s) migré(s) vers Cloudinary."
                   + (f" {failed} image(s) n'ont pas pu être migrées (fichier introuvable ou erreur Cloudinary)." if failed else ""),
    }


@router.get("/files/{filename}")
def serve_uploaded_file(filename: str) -> FileResponse:
    """
    Serve a previously uploaded file.
    In production, serve static files via Nginx/Caddy instead.
    """
    # Security: prevent path traversal
    safe_name = Path(filename).name
    if safe_name != filename:
        raise HTTPException(status_code=400, detail="Nom de fichier invalide.")

    file_path = UPLOAD_DIR / safe_name
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Fichier introuvable.")

    # The filename is a random UUID minted once at upload time and never
    # reused for different content, so it's safe to cache "forever" — this was
    # served with NO cache header at all, meaning every single page view
    # re-downloaded the full image from this container. Lighthouse flagged
    # this as "Utiliser des durées de cache efficaces" on every landing page
    # using a locally-served (non-Cloudinary) image.
    return FileResponse(
        path=str(file_path),
        filename=safe_name,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
