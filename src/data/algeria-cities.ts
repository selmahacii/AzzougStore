/**
 * Static Algeria Wilayas (58 wilayas) dataset for instant (0ms) zero-network loading.
 * Compliant with official Algerian administrative division (48 historical + 10 created in 2019).
 * Dynamically reconciles with superadmin-configured fees from the database.
 */

export interface AlgeriaWilaya {
  code: string;         // '01' to '58'
  id: number;           // 1 to 58
  name: string;         // French / Official name
  nameAr: string;       // Arabic name
  homeFee: number;      // Standard home delivery fee in DZD
  deskFee: number;      // Standard stop-desk / agency delivery fee in DZD
  zone: 'centre' | 'est' | 'ouest' | 'sud' | 'grand_sud';
}

export type SuperadminFeeMap = Record<number, { home: number; office: number }>;

export const ALGERIA_WILAYAS: readonly AlgeriaWilaya[] = [
  { code: '01', id: 1, name: 'Adrar', nameAr: 'أدرار', homeFee: 700, deskFee: 400, zone: 'grand_sud' },
  { code: '02', id: 2, name: 'Chlef', nameAr: 'الشلف', homeFee: 700, deskFee: 400, zone: 'centre' },
  { code: '03', id: 3, name: 'Laghouat', nameAr: 'الأغواط', homeFee: 700, deskFee: 400, zone: 'sud' },
  { code: '04', id: 4, name: 'Oum El Bouaghi', nameAr: 'أم البواقي', homeFee: 700, deskFee: 400, zone: 'est' },
  { code: '05', id: 5, name: 'Batna', nameAr: 'باتنة', homeFee: 700, deskFee: 400, zone: 'est' },
  { code: '06', id: 6, name: 'Béjaïa', nameAr: 'بجاية', homeFee: 700, deskFee: 400, zone: 'centre' },
  { code: '07', id: 7, name: 'Biskra', nameAr: 'بسكرة', homeFee: 700, deskFee: 400, zone: 'sud' },
  { code: '08', id: 8, name: 'Béchar', nameAr: 'بشار', homeFee: 700, deskFee: 400, zone: 'sud' },
  { code: '09', id: 9, name: 'Blida', nameAr: 'البليدة', homeFee: 700, deskFee: 400, zone: 'centre' },
  { code: '10', id: 10, name: 'Bouira', nameAr: 'البويرة', homeFee: 700, deskFee: 400, zone: 'centre' },
  { code: '11', id: 11, name: 'Tamanrasset', nameAr: 'تمنراست', homeFee: 700, deskFee: 400, zone: 'grand_sud' },
  { code: '12', id: 12, name: 'Tébessa', nameAr: 'تبسة', homeFee: 700, deskFee: 400, zone: 'est' },
  { code: '13', id: 13, name: 'Tlemcen', nameAr: 'تلمسان', homeFee: 700, deskFee: 400, zone: 'ouest' },
  { code: '14', id: 14, name: 'Tiaret', nameAr: 'تيارت', homeFee: 700, deskFee: 400, zone: 'ouest' },
  { code: '15', id: 15, name: 'Tizi Ouzou', nameAr: 'تيزي وزو', homeFee: 700, deskFee: 400, zone: 'centre' },
  { code: '16', id: 16, name: 'Alger', nameAr: 'الجزائر', homeFee: 700, deskFee: 400, zone: 'centre' },
  { code: '17', id: 17, name: 'Djelfa', nameAr: 'الجلفة', homeFee: 700, deskFee: 400, zone: 'sud' },
  { code: '18', id: 18, name: 'Jijel', nameAr: 'جيجل', homeFee: 700, deskFee: 400, zone: 'est' },
  { code: '19', id: 19, name: 'Sétif', nameAr: 'سطيف', homeFee: 700, deskFee: 400, zone: 'est' },
  { code: '20', id: 20, name: 'Saïda', nameAr: 'سعيدة', homeFee: 700, deskFee: 400, zone: 'ouest' },
  { code: '21', id: 21, name: 'Skikda', nameAr: 'سكيكدة', homeFee: 700, deskFee: 400, zone: 'est' },
  { code: '22', id: 22, name: 'Sidi Bel Abbès', nameAr: 'سيدي بلعباس', homeFee: 700, deskFee: 400, zone: 'ouest' },
  { code: '23', id: 23, name: 'Annaba', nameAr: 'عنابة', homeFee: 700, deskFee: 400, zone: 'est' },
  { code: '24', id: 24, name: 'Guelma', nameAr: 'قالمة', homeFee: 700, deskFee: 400, zone: 'est' },
  { code: '25', id: 25, name: 'Constantine', nameAr: 'قسنطينة', homeFee: 700, deskFee: 400, zone: 'est' },
  { code: '26', id: 26, name: 'Médéa', nameAr: 'المدية', homeFee: 700, deskFee: 400, zone: 'centre' },
  { code: '27', id: 27, name: 'Mostaganem', nameAr: 'مستغانم', homeFee: 700, deskFee: 400, zone: 'ouest' },
  { code: '28', id: 28, name: "M'Sila", nameAr: 'المسيلة', homeFee: 700, deskFee: 400, zone: 'centre' },
  { code: '29', id: 29, name: 'Mascara', nameAr: 'معسكر', homeFee: 700, deskFee: 400, zone: 'ouest' },
  { code: '30', id: 30, name: 'Ouargla', nameAr: 'ورقلة', homeFee: 700, deskFee: 400, zone: 'sud' },
  { code: '31', id: 31, name: 'Oran', nameAr: 'وهران', homeFee: 700, deskFee: 400, zone: 'ouest' },
  { code: '32', id: 32, name: 'El Bayadh', nameAr: 'البيض', homeFee: 700, deskFee: 400, zone: 'sud' },
  { code: '33', id: 33, name: 'Illizi', nameAr: 'إليزي', homeFee: 700, deskFee: 400, zone: 'grand_sud' },
  { code: '34', id: 34, name: 'Bordj Bou Arréridj', nameAr: 'برج بوعريريج', homeFee: 700, deskFee: 400, zone: 'est' },
  { code: '35', id: 35, name: 'Boumerdès', nameAr: 'بومرداس', homeFee: 700, deskFee: 400, zone: 'centre' },
  { code: '36', id: 36, name: 'El Tarf', nameAr: 'الطارف', homeFee: 700, deskFee: 400, zone: 'est' },
  { code: '37', id: 37, name: 'Tindouf', nameAr: 'تندوف', homeFee: 700, deskFee: 400, zone: 'grand_sud' },
  { code: '38', id: 38, name: 'Tissemsilt', nameAr: 'تيسمسيلت', homeFee: 700, deskFee: 400, zone: 'centre' },
  { code: '39', id: 39, name: 'El Oued', nameAr: 'الوادي', homeFee: 700, deskFee: 400, zone: 'sud' },
  { code: '40', id: 40, name: 'Khenchela', nameAr: 'خنشلة', homeFee: 700, deskFee: 400, zone: 'est' },
  { code: '41', id: 41, name: 'Souk Ahras', nameAr: 'سوق أهراس', homeFee: 700, deskFee: 400, zone: 'est' },
  { code: '42', id: 42, name: 'Tipaza', nameAr: 'تيبازة', homeFee: 700, deskFee: 400, zone: 'centre' },
  { code: '43', id: 43, name: 'Mila', nameAr: 'ميلة', homeFee: 700, deskFee: 400, zone: 'est' },
  { code: '44', id: 44, name: 'Aïn Defla', nameAr: 'عين الدفلى', homeFee: 700, deskFee: 400, zone: 'centre' },
  { code: '45', id: 45, name: 'Naâma', nameAr: 'النعامة', homeFee: 700, deskFee: 400, zone: 'sud' },
  { code: '46', id: 46, name: 'Aïn Témouchent', nameAr: 'عين تموشنت', homeFee: 700, deskFee: 400, zone: 'ouest' },
  { code: '47', id: 47, name: 'Ghardaïa', nameAr: 'غرداية', homeFee: 700, deskFee: 400, zone: 'sud' },
  { code: '48', id: 48, name: 'Relizane', nameAr: 'غليزان', homeFee: 700, deskFee: 400, zone: 'ouest' },
  // 10 nouvelles wilayas (2019)
  { code: '49', id: 49, name: 'Timimoun', nameAr: 'تيميمون', homeFee: 700, deskFee: 400, zone: 'grand_sud' },
  { code: '50', id: 50, name: 'Bordj Badji Mokhtar', nameAr: 'برج باجي مختار', homeFee: 700, deskFee: 400, zone: 'grand_sud' },
  { code: '51', id: 51, name: 'Ouled Djellal', nameAr: 'أولاد جلال', homeFee: 700, deskFee: 400, zone: 'sud' },
  { code: '52', id: 52, name: 'Béni Abbès', nameAr: 'بني عباس', homeFee: 700, deskFee: 400, zone: 'sud' },
  { code: '53', id: 53, name: 'In Salah', nameAr: 'عين صالح', homeFee: 700, deskFee: 400, zone: 'grand_sud' },
  { code: '54', id: 54, name: 'In Guezzam', nameAr: 'عين قزام', homeFee: 700, deskFee: 400, zone: 'grand_sud' },
  { code: '55', id: 55, name: 'Touggourt', nameAr: 'تقرت', homeFee: 700, deskFee: 400, zone: 'sud' },
  { code: '56', id: 56, name: 'Djanet', nameAr: 'جانت', homeFee: 700, deskFee: 400, zone: 'grand_sud' },
  { code: '57', id: 57, name: "El M'Ghair", nameAr: 'المغير', homeFee: 700, deskFee: 400, zone: 'sud' },
  { code: '58', id: 58, name: 'El Meniaa', nameAr: 'المنيعة', homeFee: 700, deskFee: 400, zone: 'sud' },
] as const;

export const WILAYAS_NAMES = ALGERIA_WILAYAS.map(w => w.name);

export function getWilayaByCode(code: string | number): AlgeriaWilaya | undefined {
  const normalized = typeof code === 'number' ? String(code).padStart(2, '0') : code.padStart(2, '0');
  return ALGERIA_WILAYAS.find(w => w.code === normalized);
}

export function getWilayaByName(name: string): AlgeriaWilaya | undefined {
  if (!name) return undefined;
  const n = name.trim().toLowerCase();
  return ALGERIA_WILAYAS.find(
    w => w.name.toLowerCase() === n || w.nameAr === name.trim() || w.name.toLowerCase().includes(n) || n.includes(w.name.toLowerCase())
  );
}

/**
 * Calculates delivery fee respecting the superadmin-configured fees from the DB.
 * If superadmin has configured custom fees, those take strict precedence.
 */
export function getStandardDeliveryFee(
  wilayaNameOrCode: string,
  type: 'HOME' | 'OFFICE' = 'HOME',
  superadminFees?: SuperadminFeeMap | null
): number {
  const wilaya = getWilayaByName(wilayaNameOrCode) || getWilayaByCode(wilayaNameOrCode);
  
  // 1. Superadmin custom fees from database
  if (superadminFees && wilaya?.id && superadminFees[wilaya.id]) {
    const entry = superadminFees[wilaya.id];
    return type === 'OFFICE' ? Number(entry.office) : Number(entry.home);
  }

  // 2. Fallback to default wilaya fee
  if (!wilaya) return type === 'OFFICE' ? 400 : 700;
  return type === 'OFFICE' ? wilaya.deskFee : wilaya.homeFee;
}
