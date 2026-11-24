/**
 * Resolves a store template_id to an internal render variant.
 * Standard e-commerce templates (clean, minimalist, modern, ecom, landing) map to 'clean'.
 * Specialized niche themes (athletic, luxe) map to their respective render variants.
 */
export type RenderVariant = 'clean' | 'athletic' | 'luxe';

export function resolveTemplate(templateId?: string | null): RenderVariant {
  const t = (templateId ?? 'clean').toLowerCase().trim();
  switch (t) {
    case 'minimalist':
    case 'modern':
    case 'ecom':
    case 'clean':
    case 'landing':
      return 'clean';
    case 'athletic':
      return 'athletic';
    case 'luxe':
    case 'luxury':
      return 'luxe';
    default:
      return 'clean';
  }
}
