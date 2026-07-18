// ═══════════════════════════════════════════════════════════════
// Wilaya Delivery Data
// Lookup delivery fees by numeric wilayaId (1-58).
// Data sourced from the WilayaDeliveryFee DB table.
// ═══════════════════════════════════════════════════════════════

import { db } from '@/lib/db';

export type DeliveryType = 'HOME' | 'OFFICE';

export interface DeliveryFeeResult {
  wilayaId: number;
  wilayaName: string | null;
  homeFee: number;
  officeFee: number;
  type: DeliveryType;
  fee: number;
}

export const WILAYAS = [
  'Adrar', 'Chlef', 'Laghouat', 'Oum El Bouaghi', 'Batna', 'Béjaïa',
  'Biskra', 'Béchar', 'Blida', 'Bouira', 'Tamanrasset', 'Tébessa',
  'Tlemcen', 'Tiaret', 'Tizi Ouzou', 'Alger', 'Djelfa', 'Jijel',
  'Sétif', 'Saïda', 'Skikda', 'Sidi Bel Abbès', 'Annaba', 'Guelma',
  'Constantine', 'Médéa', 'Mostaganem', 'M\'Sila', 'Mascara', 'Ouargla',
  'Oran', 'El Bayadh', 'Illizi', 'Bordj Bou Arréridj', 'Boumerdès',
  'El Tarf', 'Tindouf', 'Tissemsilt', 'El Oued', 'Khenchela',
  'Souk Ahras', 'Tipaza', 'Mila', 'Aïn Defla', 'Naâma', 'Aïn Témouchent',
  'Ghardaïa', 'Relizane',
  // Les 10 wilayas créées en 2019 (49-58) — l'ORDRE ici DOIT correspondre à
  // leur numéro officiel, car wilayaId est dérivé de la position dans ce
  // tableau (WILAYAS.indexOf(nom) + 1), utilisé pour filtrer les bureaux
  // Noest ET les grilles tarifaires. Le tableau les listait dans un ORDRE
  // DIFFÉRENT du numéro officiel (ex: "El Meniaa" à la position 50 au lieu
  // de 58) — chaque bureau Noest (noest-bureaux-data.ts) est codé avec le
  // VRAI numéro officiel (ex: "58A" = El Meniaa = wilaya 58), donc le
  // bureau ne matchait plus jamais son wilayaId calculé et disparaissait
  // du menu déroulant. Confirmé bureau par bureau (49A=Timimoun,
  // 51A=Ouled Djellal, 52A=Béni Abbès, 53A=In Salah, 55A=Touggourt,
  // 56A=Djanet, 58A=El Meniaa) avant correction.
  'Timimoun', 'Bordj Baji Mokhtar', 'Ouled Djellal', 'Béni Abbès',
  'In Salah', 'In Guezzam', 'Touggourt', 'Djanet', 'El M\'Ghair', 'El Meniaa',
] as const;

export const DEFAULT_DELIVERY_FEE = { home: 700, office: 400 };

/**
 * Get delivery fee by numeric wilaya ID and delivery type.
 */
export async function getDeliveryFee(
  wilayaId: number,
  type: 'home' | 'office' = 'home'
): Promise<DeliveryFeeResult> {
  try {
    const record = await db.wilayaDeliveryFee.findUnique({
      where: { wilayaId },
    });

    const homeFee: number = record?.homeFee ?? DEFAULT_DELIVERY_FEE.home;
    const officeFee: number = record?.officeFee ?? DEFAULT_DELIVERY_FEE.office;
    const fee: number = type === 'home' ? homeFee : officeFee;

    return {
      wilayaId,
      wilayaName: record?.wilayaName ?? (WILAYAS[wilayaId - 1] || null),
      homeFee,
      officeFee,
      type: type.toUpperCase() as DeliveryType,
      fee,
    };
  } catch {
    return {
      wilayaId,
      wilayaName: WILAYAS[wilayaId - 1] || null,
      homeFee: DEFAULT_DELIVERY_FEE.home,
      officeFee: DEFAULT_DELIVERY_FEE.office,
      type: type.toUpperCase() as DeliveryType,
      fee: type === 'home' ? DEFAULT_DELIVERY_FEE.home : DEFAULT_DELIVERY_FEE.office,
    };
  }
}

/**
 * Helper for UI components that work with Wilaya names.
 */
export async function getDeliveryFeeByName(
  name: string,
  type: 'home' | 'office' = 'home'
): Promise<number> {
  const index = WILAYAS.findIndex(w => w.toLowerCase() === name.toLowerCase());
  if (index === -1) return type === 'home' ? DEFAULT_DELIVERY_FEE.home : DEFAULT_DELIVERY_FEE.office;
  const result = await getDeliveryFee(index + 1, type);
  return result.fee;
}

/**
 * Synchronous version for immediate UI feedback.
 * Uses default fees based on hardcoded Maghreb benchmarks.
 */
export function getDeliveryFeeSync(
  wilaya: string | null,
  type: 'home' | 'office' | 'bureau' = 'home'
): number {
  if (!wilaya) return DEFAULT_DELIVERY_FEE.home;
  
  const lookupType = type === 'bureau' ? 'office' : type;

  // Hardcoded known deviations for UX (as seen in original types.ts)
  const deviations: Record<string, { home: number; office: number }> = {
    'Alger': { home: 400, office: 250 },
    'Blida': { home: 500, office: 300 },
    'Boumerdès': { home: 500, office: 300 },
    'Tipaza': { home: 500, office: 300 },
    'Oran': { home: 600, office: 350 },
    'Constantine': { home: 600, office: 350 },
    'Annaba': { home: 600, office: 350 },
    'Sétif': { home: 600, office: 350 },
    'Tizi Ouzou': { home: 600, office: 350 },
  };

  const fee = deviations[wilaya];
  if (fee) return lookupType === 'home' ? fee.home : fee.office;
  
  return lookupType === 'home' ? DEFAULT_DELIVERY_FEE.home : DEFAULT_DELIVERY_FEE.office;
}
