/**
 * Resolves a store template_id to an internal render variant.
 * New template IDs (minimalist, landing) map to render variants.
 * Legacy IDs (clean, athletic, luxe) pass through unchanged.
 */
export type RenderVariant = 'clean' | 'athletic' | 'luxe' | 'landing';

export function resolveTemplate(templateId?: string | null): RenderVariant {
  const t = (templateId ?? 'minimalist').toLowerCase().trim();
  switch (t) {
    case 'minimalist':
    case 'modern':
    case 'ecom':
    case 'clean':
      return 'clean';
    case 'landing':
      return 'landing';
    case 'athletic':
      return 'athletic';
    case 'luxe':
    case 'luxury':
      return 'luxe';
    default:
      return 'clean';
  }
}
