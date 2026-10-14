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
  'Timimoun', 'Bordj Badji Mokhtar', 'Ouled Djellal', 'Béni Abbès',
  'In Salah', 'In Guezzam', 'Touggourt', 'Djanet', 'El M\'Ghair', 'El Meniaa',
  // 11 nouvelles wilayas officielles (Loi 26-06 / Décret présidentiel 26-206)
  'Aflou', 'Barika', 'El Kantara', 'Bir El Ater', 'El Aricha',
  'Ksar Chellala', 'Aïn Oussera', 'Messaad', 'Ksar El Boukhari',
  'Bou Saâda', 'El Abiodh Sidi Cheikh',
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
  wilaya: string | number | null | undefined,
  type: 'home' | 'office' | 'bureau' = 'home'
): number {
  if (!wilaya) return 800;
  
  const lookupType = type === 'bureau' ? 'office' : type;
  const isOffice = lookupType === 'office';
  const raw = String(wilaya).trim();

  // Robust wilaya name extraction
  let name = raw;
  const m = raw.match(/^\d+\s*[-_–.]\s*(.*)$/);
  if (m) name = m[1].trim();

  // If purely numeric
  if (/^\d+$/.test(raw)) {
    const num = parseInt(raw, 10);
    if (num >= 1 && num <= WILAYAS.length) {
      name = WILAYAS[num - 1];
    }
  }

  // Exact Noest tarif grid
  const grid: Record<string, { home: number; office: number }> = {
    'Adrar': { home: 1450, office: 700 },
    'Chlef': { home: 800, office: 400 },
    'Laghouat': { home: 950, office: 500 },
    'Oum El Bouaghi': { home: 800, office: 400 },
    'Batna': { home: 800, office: 400 },
    'Béjaïa': { home: 800, office: 400 },
    'Biskra': { home: 950, office: 500 },
    'Béchar': { home: 1150, office: 600 },
    'Blida': { home: 550, office: 350 },
    'Bouira': { home: 700, office: 400 },
    'Tamanrasset': { home: 1750, office: 1000 },
    'Tébessa': { home: 850, office: 400 },
    'Tlemcen': { home: 800, office: 400 },
    'Tiaret': { home: 850, office: 400 },
    'Tizi Ouzou': { home: 700, office: 400 },
    'Alger': { home: 500, office: 250 },
    'Djelfa': { home: 900, office: 500 },
    'Jijel': { home: 800, office: 400 },
    'Sétif': { home: 750, office: 400 },
    'Saïda': { home: 900, office: 400 },
    'Skikda': { home: 800, office: 400 },
    'Sidi Bel Abbès': { home: 800, office: 400 },
    'Annaba': { home: 800, office: 400 },
    'Guelma': { home: 850, office: 400 },
    'Constantine': { home: 750, office: 400 },
    'Médéa': { home: 700, office: 400 },
    'Mostaganem': { home: 800, office: 400 },
    "M'Sila": { home: 800, office: 400 },
    'Mascara': { home: 800, office: 400 },
    'Ouargla': { home: 1050, office: 500 },
    'Oran': { home: 750, office: 400 },
    'El Bayadh': { home: 1200, office: 600 },
    'Illizi': { home: 1750, office: 1000 },
    'Bordj Bou Arréridj': { home: 750, office: 400 },
    'Boumerdès': { home: 550, office: 350 },
    'El Tarf': { home: 900, office: 500 },
    'Tindouf': { home: 1500, office: 600 },
    'Tissemsilt': { home: 800, office: 400 },
    'El Oued': { home: 1100, office: 500 },
    'Khenchela': { home: 900, office: 400 },
    'Souk Ahras': { home: 900, office: 400 },
    'Tipaza': { home: 550, office: 350 },
    'Mila': { home: 800, office: 400 },
    'Aïn Defla': { home: 800, office: 400 },
    'Naâma': { home: 1150, office: 600 },
    'Aïn Témouchent': { home: 800, office: 400 },
    'Ghardaïa': { home: 1050, office: 500 },
    'Relizane': { home: 800, office: 400 },
    'Timimoun': { home: 1500, office: 700 },
    'Bordj Badji Mokhtar': { home: 1400, office: 700 },
    'Ouled Djellal': { home: 1000, office: 450 },
    'Béni Abbès': { home: 1200, office: 600 },
    'In Salah': { home: 1700, office: 1000 },
    'In Guezzam': { home: 1400, office: 700 },
    'Touggourt': { home: 1050, office: 500 },
    'Djanet': { home: 1400, office: 700 },
    "El M'Ghair": { home: 1100, office: 500 },
    'El Meniaa': { home: 1100, office: 500 },
    'Aflou': { home: 950, office: 500 },
    'Barika': { home: 800, office: 400 },
    'El Kantara': { home: 950, office: 500 },
    'Bir El Ater': { home: 850, office: 400 },
    'El Aricha': { home: 800, office: 400 },
    'Ksar Chellala': { home: 850, office: 400 },
    'Aïn Oussera': { home: 900, office: 500 },
    'Messaad': { home: 900, office: 500 },
    'Ksar El Boukhari': { home: 700, office: 400 },
    'Bou Saâda': { home: 800, office: 400 },
    'El Abiodh Sidi Cheikh': { home: 1200, office: 600 },
  };

  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const targetNorm = norm(name);

  for (const [k, v] of Object.entries(grid)) {
    if (norm(k) === targetNorm) {
      return isOffice ? v.office : v.home;
    }
  }

  return isOffice ? 400 : 800;
}
