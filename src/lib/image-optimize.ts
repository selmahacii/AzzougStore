/**
 * Injects Cloudinary auto-format/auto-quality/width transformations into an
 * existing Cloudinary delivery URL. No-op (returns the URL unchanged) for any
 * non-Cloudinary URL (local upload fallback, external placeholder, etc).
 *
 * Directly targets the Lighthouse findings on the landing pages ("Améliorer
 * l'affichage des images" ~3 Mio, "Utiliser des durées de cache efficaces"
 * ~225 Kio): f_auto serves AVIF/WebP to browsers that support it, q_auto
 * picks the smallest visually-lossless quality, and capping width avoids
 * shipping a full-resolution upload for a thumbnail-sized slot. Cloudinary's
 * CDN already sets long-lived cache headers on transformed derivatives.
 */
export function optimizeCloudinaryUrl(url: string | null | undefined, width?: number): string {
  if (!url) return '';
  const marker = '/image/upload/';
  const idx = url.indexOf(marker);
  if (idx === -1) return url; // not a Cloudinary URL — leave untouched

  // If URL already has transformations like f_auto,q_auto,w_1600, update target width
  if (url.includes('/image/upload/f_auto') || url.includes('/image/upload/q_auto')) {
    if (width) {
      return url.replace(/\/image\/upload\/([^/]+)\//, (match, trans) => {
        if (/w_\d+/.test(trans)) {
          return `/image/upload/${trans.replace(/w_\d+/, `w_${width}`)}/`;
        }
        return `/image/upload/${trans},w_${width}/`;
      });
    }
    return url;
  }

  const transformations = ['f_auto', 'q_auto', ...(width ? [`w_${width}`] : [])].join(',');
  const before = url.slice(0, idx + marker.length);
  const after = url.slice(idx + marker.length);

  return `${before}${transformations}/${after}`;
}
