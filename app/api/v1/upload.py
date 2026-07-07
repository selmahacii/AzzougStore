import os
import uuid
import mimetypes
import io
from pathlib import Path
from typing import Any

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

# ─── Configuration ────────────────────────────────────────────
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"}
ALLOWED_VIDEO_TYPES = {"video/mp4", "video/webm", "video/ogg", "video/quicktime"}
ALLOWED_TYPES = ALLOWED_IMAGE_TYPES
MAX_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024  # 100 MB

CLOUDINARY_URL = os.environ.get("CLOUDINARY_URL", "")
if _CLOUDINARY_OK and CLOUDINARY_URL and CLOUDINARY_URL.startswith("cloudinary://"):
    try:
        cloudinary.config()
    except Exception:
        _CLOUDINARY_OK = False

if not (CLOUDINARY_URL and CLOUDINARY_URL.startswith("cloudinary://") and _CLOUDINARY_OK):
    import logging
    logging.getLogger("app.upload").warning(
        "CLOUDINARY_URL non configuré — les uploads sont stockés sur le disque local "
        "ÉPHÉMÈRE (perdus à chaque redémarrage du Space). Configurez le secret "
        "CLOUDINARY_URL sur HuggingFace pour un stockage persistant."
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
    result: dict = {
        "package_installed": _CLOUDINARY_OK,
        "env_var_present": bool(CLOUDINARY_URL),
        "env_var_looks_valid": bool(CLOUDINARY_URL and CLOUDINARY_URL.startswith("cloudinary://")),
        "persistent": False,
        "detail": None,
    }

    if not CLOUDINARY_URL:
        result["detail"] = "CLOUDINARY_URL n'est pas défini — tous les uploads (logos, hero, produits) sont perdus à chaque redéploiement du Space."
        return result

    if not result["env_var_looks_valid"]:
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
        result["detail"] = f"CLOUDINARY_URL est présent mais l'appel de test a échoué ({exc}) — les uploads retombent en stockage local éphémère."

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
    if _CLOUDINARY_OK and CLOUDINARY_URL and CLOUDINARY_URL.startswith("cloudinary://"):
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
    if _CLOUDINARY_OK and CLOUDINARY_URL and CLOUDINARY_URL.startswith("cloudinary://"):
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

    return FileResponse(path=str(file_path), filename=safe_name)
