import { db } from '@/lib/db';
import type { OrderStatus } from '@/lib/types';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

async function hashPassword(password: string): Promise<string> {
  const bcrypt = await import('bcryptjs');
  return bcrypt.hash(password, 12);
}

function weightedRandom<T>(items: T[], weights: number[]): T {
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * totalWeight;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function randomDate(daysAgo: number, daysRecent?: number): Date {
  const now = new Date();
  const maxPast = daysRecent ?? daysAgo;
  const minPast = daysRecent ? daysAgo : 0;
  const from = new Date(now.getTime() - daysAgo * 86400000);
  const to = daysRecent
    ? new Date(now.getTime() - daysRecent * 86400000)
    : now;
  return new Date(from.getTime() + Math.random() * (to.getTime() - from.getTime()));
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateOrderNumber(prefix: string, daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86400000);
  const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const seq = String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0');
  return `${prefix}-${ds}-${seq}`;
}

function generatePhone(): string {
  const prefixes = ['0555', '0661', '0770', '0542', '0655', '0798'];
  const p = prefixes[Math.floor(Math.random() * prefixes.length)];
  return `${p}${String(Math.floor(Math.random() * 10000000)).padStart(7, '0')}`;
}

// ═══════════════════════════════════════════════════════════════
// 58 WILAYA DELIVERY FEES
// ═══════════════════════════════════════════════════════════════

const WILAYA_FEES: Array<{
  wilayaId: number;
  wilayaName: string;
  homeFee: number;
  officeFee: number;
}> = [
  { wilayaId: 1, wilayaName: 'Adrar', homeFee: 1000, officeFee: 800 },
  { wilayaId: 2, wilayaName: 'Chlef', homeFee: 700, officeFee: 500 },
  { wilayaId: 3, wilayaName: 'Laghouat', homeFee: 800, officeFee: 600 },
  { wilayaId: 4, wilayaName: 'Oum El Bouaghi', homeFee: 700, officeFee: 500 },
  { wilayaId: 5, wilayaName: 'Batna', homeFee: 700, officeFee: 500 },
  { wilayaId: 6, wilayaName: 'Béjaïa', homeFee: 700, officeFee: 500 },
  { wilayaId: 7, wilayaName: 'Biskra', homeFee: 700, officeFee: 500 },
  { wilayaId: 8, wilayaName: 'Béchar', homeFee: 900, officeFee: 700 },
  { wilayaId: 9, wilayaName: 'Blida', homeFee: 500, officeFee: 350 },
  { wilayaId: 10, wilayaName: 'Bouira', homeFee: 700, officeFee: 500 },
  { wilayaId: 11, wilayaName: 'Tamanrasset', homeFee: 1000, officeFee: 800 },
  { wilayaId: 12, wilayaName: 'Tébessa', homeFee: 700, officeFee: 500 },
  { wilayaId: 13, wilayaName: 'Tlemcen', homeFee: 700, officeFee: 500 },
  { wilayaId: 14, wilayaName: 'Tiaret', homeFee: 700, officeFee: 500 },
  { wilayaId: 15, wilayaName: 'Tizi Ouzou', homeFee: 600, officeFee: 450 },
  { wilayaId: 16, wilayaName: 'Alger', homeFee: 400, officeFee: 250 },
  { wilayaId: 17, wilayaName: 'Djelfa', homeFee: 700, officeFee: 500 },
  { wilayaId: 18, wilayaName: 'Jijel', homeFee: 700, officeFee: 500 },
  { wilayaId: 19, wilayaName: 'Sétif', homeFee: 600, officeFee: 450 },
  { wilayaId: 20, wilayaName: 'Saïda', homeFee: 700, officeFee: 500 },
  { wilayaId: 21, wilayaName: 'Skikda', homeFee: 700, officeFee: 500 },
  { wilayaId: 22, wilayaName: 'Sidi Bel Abbès', homeFee: 700, officeFee: 500 },
  { wilayaId: 23, wilayaName: 'Annaba', homeFee: 600, officeFee: 450 },
  { wilayaId: 24, wilayaName: 'Guelma', homeFee: 700, officeFee: 500 },
  { wilayaId: 25, wilayaName: 'Constantine', homeFee: 600, officeFee: 450 },
  { wilayaId: 26, wilayaName: 'Médéa', homeFee: 700, officeFee: 500 },
  { wilayaId: 27, wilayaName: 'Mostaganem', homeFee: 700, officeFee: 500 },
  { wilayaId: 28, wilayaName: 'M\'Sila', homeFee: 700, officeFee: 500 },
  { wilayaId: 29, wilayaName: 'Mascara', homeFee: 700, officeFee: 500 },
  { wilayaId: 30, wilayaName: 'Ouargla', homeFee: 800, officeFee: 600 },
  { wilayaId: 31, wilayaName: 'Oran', homeFee: 600, officeFee: 450 },
  { wilayaId: 32, wilayaName: 'El Bayadh', homeFee: 900, officeFee: 700 },
  { wilayaId: 33, wilayaName: 'Illizi', homeFee: 1000, officeFee: 800 },
  { wilayaId: 34, wilayaName: 'Bordj Bou Arréridj', homeFee: 700, officeFee: 500 },
  { wilayaId: 35, wilayaName: 'Boumerdès', homeFee: 500, officeFee: 350 },
  { wilayaId: 36, wilayaName: 'El Tarf', homeFee: 700, officeFee: 500 },
  { wilayaId: 37, wilayaName: 'Tindouf', homeFee: 1000, officeFee: 800 },
  { wilayaId: 38, wilayaName: 'Tissemsilt', homeFee: 700, officeFee: 500 },
  { wilayaId: 39, wilayaName: 'El Oued', homeFee: 800, officeFee: 600 },
  { wilayaId: 40, wilayaName: 'Khenchela', homeFee: 700, officeFee: 500 },
  { wilayaId: 41, wilayaName: 'Souk Ahras', homeFee: 700, officeFee: 500 },
  { wilayaId: 42, wilayaName: 'Tipaza', homeFee: 500, officeFee: 350 },
  { wilayaId: 43, wilayaName: 'Mila', homeFee: 700, officeFee: 500 },
  { wilayaId: 44, wilayaName: 'Aïn Defla', homeFee: 700, officeFee: 500 },
  { wilayaId: 45, wilayaName: 'Naâma', homeFee: 900, officeFee: 700 },
  { wilayaId: 46, wilayaName: 'Aïn Témouchent', homeFee: 700, officeFee: 500 },
  { wilayaId: 47, wilayaName: 'Ghardaïa', homeFee: 800, officeFee: 600 },
  { wilayaId: 48, wilayaName: 'Relizane', homeFee: 700, officeFee: 500 },
  { wilayaId: 49, wilayaName: 'El M\'Ghair', homeFee: 800, officeFee: 600 },
  { wilayaId: 50, wilayaName: 'El Meniaa', homeFee: 900, officeFee: 700 },
  { wilayaId: 51, wilayaName: 'Ouled Djellal', homeFee: 700, officeFee: 500 },
  { wilayaId: 52, wilayaName: 'Bordj Baji Mokhtar', homeFee: 1000, officeFee: 800 },
  { wilayaId: 53, wilayaName: 'Béni Abbès', homeFee: 900, officeFee: 700 },
  { wilayaId: 54, wilayaName: 'Timimoun', homeFee: 900, officeFee: 700 },
  { wilayaId: 55, wilayaName: 'Touggourt', homeFee: 800, officeFee: 600 },
  { wilayaId: 56, wilayaName: 'Djanet', homeFee: 1000, officeFee: 800 },
  { wilayaId: 57, wilayaName: 'In Salah', homeFee: 900, officeFee: 700 },
  { wilayaId: 58, wilayaName: 'In Guezzam', homeFee: 1000, officeFee: 800 },
];

// Helper to get delivery fee for a wilaya name
function getDeliveryFee(wilayaName: string, deliveryType: string): number {
  const w = WILAYA_FEES.find(wf => wf.wilayaName === wilayaName);
  if (!w) return deliveryType === 'HOME' ? 700 : 500;
  return deliveryType === 'HOME' ? w.homeFee : w.officeFee;
}

// ═══════════════════════════════════════════════════════════════
// STORE DEFINITIONS
// ═══════════════════════════════════════════════════════════════

interface StoreDef {
  name: string;
  slug: string;
  prefix: string;
  description: string;
  themeConfig: string;
  categories: string[];
  products: Array<{
    name: string;
    slug: string;
    price: number;
    comparePrice?: number;
    costPrice: number;
    stock: number;
    category: string;
    description: string;
    featured: boolean;
  }>;
  promotions: Array<{
    code: string;
    type: string;
    value: number;
    minOrderAmount: number;
    maxUses: number | null;
    description: string;
    applicableCategories: string;
  }>;
}

const STORE_DEFS: StoreDef[] = [
  // ─── 1. VELOCE SPORT ──────────────────────────────────
  {
    name: 'Veloce Sport',
    slug: 'veloce-sport',
    prefix: 'VS',
    description: 'Équipement sportif premium — Fitness, Running, Outdoor',
    themeConfig: JSON.stringify({
      primaryColor: '#B45309',
      accentColor: '#D97706',
      borderRadius: '0.5rem',
      fontFamily: 'Inter',
    }),
    categories: ['Sport', 'Fitness', 'Running', 'Outdoor', 'Accessoires'],
    products: [
      // Sport (4)
      { name: 'Ballon Football Pro', slug: 'ballon-football-pro', price: 4500, costPrice: 2200, stock: 30, category: 'Sport', description: 'Ballon football taille 5 FIFA Quality. Cuir synthétique haute tenue.', featured: true },
      { name: 'Raquette Tennis Carbon', slug: 'raquette-tennis-carbon', price: 12000, costPrice: 5800, stock: 12, category: 'Sport', description: 'Raquette carbone 100g, manche absorbant. Idéale joueurs intermédiaires.', featured: true },
      { name: 'Set Badminton Premium', slug: 'set-badminton-premium', price: 6800, costPrice: 3200, stock: 18, category: 'Sport', description: '2 raquettes + 6 volants + filet de terrain. Sac de transport inclus.', featured: false },
      { name: 'Gants Boxe Competition', slug: 'gants-boxe-competition', price: 5500, costPrice: 2500, stock: 22, category: 'Sport', description: 'Gants 12oz cuir véritable, rembourrage multi-couche. Fermeture velcro.', featured: false },
      // Fitness (4)
      { name: 'Haltères Réglables 20kg', slug: 'halteres-reglables-20kg', price: 9800, costPrice: 5200, stock: 15, category: 'Fitness', description: 'Paire haltères ajustables 2-20kg chacun. Revêtement néoprène antidérapant.', featured: true },
      { name: 'Tapis de Yoga Premium 8mm', slug: 'tapis-yoga-premium', price: 3500, costPrice: 1500, stock: 40, category: 'Fitness', description: 'Tapis TPE 183x61cm, antidérapant double face. Sangle de transport offerte.', featured: false },
      { name: 'Corde à Sauter Speed Pro', slug: 'corde-sauter-speed', price: 2200, costPrice: 800, stock: 55, category: 'Fitness', description: 'Câble acier gainé, roulements à billes. Poignées alu, longueur ajustable.', featured: false },
      { name: 'Kettlebell 12kg Vinyle', slug: 'kettlebell-12kg-vinyle', price: 4800, costPrice: 2200, stock: 20, category: 'Fitness', description: 'Kettlebell 12kg revêtement vinyle. Base plate, poignée chromée lisse.', featured: true },
      // Running (4)
      { name: 'Chaussures Running Aero', slug: 'chaussures-running-aero', price: 8900, costPrice: 4200, stock: 25, category: 'Running', description: 'Baskets running légères 240g, semelle amorti gel. Mesh respirant.', featured: true },
      { name: 'Montre GPS Running', slug: 'montre-gps-running', price: 7500, comparePrice: 9200, costPrice: 3500, stock: 16, category: 'Running', description: 'GPS intégré, fréquence cardiaque au poignet. Autonomie 14h, waterproof 5ATM.', featured: true },
      { name: 'Ceinture Porte-Bidon', slug: 'ceinture-porte-bidon', price: 1800, costPrice: 700, stock: 45, category: 'Running', description: 'Ceinture running avec 2 flasques 250ml. Poche téléphone étanche.', featured: false },
      { name: 'Short Running Ultralight', slug: 'short-running-ultralight', price: 2800, costPrice: 1200, stock: 35, category: 'Running', description: 'Short running homme, tissu mesh rapide au séchage. Poche zippée arrière.', featured: false },
      // Outdoor (4)
      { name: 'Sac Randonnée 45L', slug: 'sac-randonnee-45l', price: 6500, costPrice: 3000, stock: 14, category: 'Outdoor', description: 'Sac à dos randonnée 45L, dos ventilé. Imperméable, port de charge.', featured: true },
      { name: 'Tente 2 Places Ultra-Light', slug: 'tente-2-places', price: 8500, comparePrice: 11000, costPrice: 4000, stock: 8, category: 'Outdoor', description: 'Tente double paroi, 2.1kg. Arceaux aluminium, haute résistance au vent.', featured: true },
      { name: 'Lampe Frontale 300 Lumens', slug: 'lampe-frontale-300lm', price: 2500, costPrice: 1000, stock: 30, category: 'Outdoor', description: 'Frontale rechargeable USB, 5 modes. Étanche IPX4, bandoulière reflective.', featured: false },
      { name: 'Gourde Isotherme 750ml', slug: 'gourde-isotherme-750ml', price: 2000, costPrice: 800, stock: 50, category: 'Outdoor', description: 'Acier inox double paroi, maintient chaud 12h / froid 24h. Bouchon sport.', featured: false },
      // Accessoires (4)
      { name: 'Protège Genouillères Sport', slug: 'protege-genouilleres', price: 2500, costPrice: 1100, stock: 28, category: 'Accessoires', description: 'Paire genouillères avec gel silicone. Compression ajustable, antidérapant.', featured: false },
      { name: 'Bandeau Sport Absorbant x3', slug: 'bandeau-sport-x3', price: 1200, costPrice: 400, stock: 60, category: 'Accessoires', description: 'Lot de 3 bandeaux sport. Tissu technique anti-transpiration, taille unique.', featured: false },
      { name: 'Sangle d\'Étirement', slug: 'sangle-etirement', price: 1500, costPrice: 600, stock: 40, category: 'Accessoires', description: 'Sangle élastique 10 boucles pour stretching. Nylon, 220cm, pochettes incluses.', featured: false },
      { name: 'Gourde Sport Squeeze 1L', slug: 'gourde-sport-1l', price: 800, costPrice: 300, stock: 70, category: 'Accessoires', description: 'Gourde BPA-free 1L, bouchon paille. Marquages ml/oz, compatible vélo.', featured: false },
    ],
    promotions: [
      { code: 'VELOCE10', type: 'PERCENTAGE', value: 10, minOrderAmount: 5000, maxUses: 100, description: '10% de remise sur toute la boutique', applicableCategories: '' },
      { code: 'FITNESS500', type: 'FIXED_AMOUNT', value: 500, minOrderAmount: 3000, maxUses: 50, description: '500 DA de réduction sur le fitness', applicableCategories: 'Fitness' },
      { code: 'RUN50', type: 'PERCENTAGE', value: 50, minOrderAmount: 0, maxUses: 20, description: 'Moitié prix sur équipement running', applicableCategories: 'Running' },
      { code: 'LIVRAISON_GRATUITE', type: 'FREE_SHIPPING', value: 0, minOrderAmount: 4000, maxUses: 200, description: 'Livraison offerte dès 4000 DA', applicableCategories: '' },
      { code: 'OUTDOOR15', type: 'PERCENTAGE', value: 15, minOrderAmount: 6000, maxUses: 30, description: '15% sur la gamme outdoor', applicableCategories: 'Outdoor' },
    ],
  },

  // ─── 2. TECH CASES DZ ──────────────────────────────────
  {
    name: 'Tech Cases DZ',
    slug: 'tech-cases-dz',
    prefix: 'TC',
    description: 'Accessoires tech — Coques, Chargeurs, Câbles, Audio',
    themeConfig: JSON.stringify({
      primaryColor: '#0D9488',
      accentColor: '#14B8A6',
      borderRadius: '0.5rem',
      fontFamily: 'Inter',
    }),
    categories: ['Coques', 'Chargeurs', 'Câbles', 'Accessoires Audio', 'Protect'],
    products: [
      // Coques (4)
      { name: 'Coque iPhone 15 Pro MagSafe', slug: 'coque-iphone15pro-magsafe', price: 3500, costPrice: 1200, stock: 45, category: 'Coques', description: 'Coque silicone MagSafe, protection renforcée coins. Compatible iPhone 15 Pro.', featured: true },
      { name: 'Coque Samsung S24 Ultra Kevlar', slug: 'coque-samsung-s24-kevlar', price: 4200, costPrice: 1500, stock: 30, category: 'Coques', description: 'Fibre de Kevlar ultra-fine 0.6mm, MIL-STD-810G. Texture premium grippante.', featured: true },
      { name: 'Coque Transparente Anti-Jaune', slug: 'coque-transparente-anti-jaune', price: 1500, costPrice: 500, stock: 80, category: 'Coques', description: 'TPU transparent anti-jaunissement. Bords renforcés, compatible wireless charging.', featured: false },
      { name: 'Étui Cuir Flip iPhone 15', slug: 'etui-cuir-flip-iphone15', price: 3800, costPrice: 1400, stock: 25, category: 'Coques', description: 'Étui flip en PU cuir, rabat magnétique. Fonctions stand et carte ID.', featured: true },
      // Chargeurs (4)
      { name: 'Chargeur MagSafe 15W', slug: 'chargeur-magsafe-15w', price: 4500, costPrice: 1800, stock: 35, category: 'Chargeurs', description: 'Chargeur sans fil 15W, aimant puissant. Aluminium brossé, compatible iPhone 12+.', featured: true },
      { name: 'Chargeur Rapide GaN 65W', slug: 'chargeur-gan-65w', price: 3800, costPrice: 1600, stock: 28, category: 'Chargeurs', description: 'Chargeur GaN 65W 3 ports (2 USB-C + 1 USB-A). Pliable, ultra compact.', featured: true },
      { name: 'Powerbank 20000mAh PD', slug: 'powerbank-20000-pd', price: 6500, comparePrice: 8000, costPrice: 3000, stock: 20, category: 'Chargeurs', description: '20000mAh, charge rapide PD 65W, 2 USB-C. Écran LED, charge laptop + téléphone.', featured: true },
      { name: 'Chargeur Voiture USB-C 45W', slug: 'chargeur-voiture-45w', price: 2800, costPrice: 1100, stock: 40, category: 'Chargeurs', description: 'Chargeur allume-cigare 45W, 2 ports USB-C. Charge rapide simultanée 2 appareils.', featured: false },
      // Câbles (4)
      { name: 'Câble USB-C Nylon 2m', slug: 'cable-usbc-nylon-2m', price: 1200, costPrice: 350, stock: 100, category: 'Câbles', description: 'USB-C vers USB-C 100W, charge rapide + données. Nylon tressé, 15000 pliages.', featured: false },
      { name: 'Câble Lightning MFi 1.5m', slug: 'cable-lightning-mfi', price: 1800, costPrice: 600, stock: 75, category: 'Câbles', description: 'Câble MFi certifié Apple, charge rapide + synchronisation. Connecteurs renforcés.', featured: false },
      { name: 'Câble USB-C vers USB-A 1m', slug: 'cable-usbc-usba-1m', price: 900, costPrice: 280, stock: 90, category: 'Câbles', description: 'Charge et données, compatible tous appareils USB-C. Gaine PVC souple.', featured: false },
      { name: 'Pack Câbles 3-en-1', slug: 'pack-cables-3en1', price: 2500, comparePrice: 3500, costPrice: 800, stock: 50, category: 'Câbles', description: 'Lot 3 câbles: USB-C, Lightning, Micro-USB. 1.2m chacun, nylon coloré.', featured: true },
      // Accessoires Audio (4)
      { name: 'Écouteurs TWS ANC Pro', slug: 'ecouteurs-tws-anc-pro', price: 8500, comparePrice: 12000, costPrice: 3500, stock: 18, category: 'Accessoires Audio', description: 'Écouteurs bluetooth 5.3, ANC hybride. Autonomie 30h, IPX5, EQ personnalisable.', featured: true },
      { name: 'Enceinte Bluetooth 20W', slug: 'enceinte-bluetooth-20w', price: 5000, costPrice: 2000, stock: 22, category: 'Accessoires Audio', description: 'Enceinte portable 20W, basses profondes. 18h autonomie, IPX7, RGB.', featured: false },
      { name: 'Casque Over-Ear Bluetooth', slug: 'casque-overear-bluetooth', price: 6200, costPrice: 2500, stock: 15, category: 'Accessoires Audio', description: 'Casque supra-auriculaire, ANC 40dB. 50h autonomie, pliable, micro intégré.', featured: true },
      { name: 'Micro Lavalier USB-C', slug: 'micro-lavalier-usbc', price: 3000, costPrice: 1200, stock: 25, category: 'Accessoires Audio', description: 'Micro cravate USB-C pour smartphone et PC. Anti-bruit, clip métal, câble 2m.', featured: false },
      // Protect (4)
      { name: 'Verre Trempé iPhone 9H', slug: 'verre-trempe-iphone-9h', price: 1500, costPrice: 400, stock: 60, category: 'Protect', description: 'Verre trempé 9H, full cover bords. Compatibilité Face ID, installation sans bulles.', featured: true },
      { name: 'Film Protection Écran Matte', slug: 'film-protection-matte', price: 1200, costPrice: 350, stock: 55, category: 'Protect', description: 'Film mat anti-reflets, anti-empreintes. Compatible tactile, pack x2.', featured: false },
      { name: 'Protège Caméra iPhone', slug: 'protege-camera-iphone', price: 800, costPrice: 200, stock: 70, category: 'Protect', description: 'Verre trempé 9H pour module caméra. Anti-scratch, ultra fin, pack x3.', featured: false },
      { name: 'Pellicule Corps Complète', slug: 'pellicule-corps-complete', price: 2500, costPrice: 900, stock: 30, category: 'Protect', description: 'Skin adhésif full body pour iPhone/ Samsung. Carbon fibre look, anti-rayures.', featured: false },
    ],
    promotions: [
      { code: 'TECH5', type: 'PERCENTAGE', value: 5, minOrderAmount: 2000, maxUses: 150, description: '5% sur tout le magasin tech', applicableCategories: '' },
      { code: 'COQUE30', type: 'FIXED_AMOUNT', value: 300, minOrderAmount: 1500, maxUses: 80, description: '300 DA de réduction sur les coques', applicableCategories: 'Coques' },
      { code: 'AUDIO_FREE_SHIP', type: 'FREE_SHIPPING', value: 0, minOrderAmount: 3000, maxUses: 100, description: 'Livraison gratuite sur l\'audio', applicableCategories: 'Accessoires Audio' },
      { code: 'CABLE_PACK15', type: 'PERCENTAGE', value: 15, minOrderAmount: 1000, maxUses: 60, description: '15% sur les câbles et accessoires', applicableCategories: 'Câbles,Protect' },
      { code: 'CHARGEUR1000', type: 'FIXED_AMOUNT', value: 1000, minOrderAmount: 5000, maxUses: 40, description: '1000 DA de réduction sur les chargeurs', applicableCategories: 'Chargeurs' },
    ],
  },

  // ─── 3. MODE & BIJOUX ──────────────────────────────────
  {
    name: 'Mode & Bijoux',
    slug: 'mode-bijoux',
    prefix: 'MB',
    description: 'Bijoux artisanaux et accessoires de mode tendance',
    themeConfig: JSON.stringify({
      primaryColor: '#E11D48',
      accentColor: '#F43F5E',
      borderRadius: '0.5rem',
      fontFamily: 'Inter',
    }),
    categories: ['Bijoux', 'Montres', 'Sacs', 'Lunettes', 'Parfums'],
    products: [
      // Bijoux (4)
      { name: 'Collier Chaîne Gourmette Or', slug: 'collier-gourmette-or', price: 8500, costPrice: 3200, stock: 15, category: 'Bijoux', description: 'Chaîne gourmette plaqué or 18K, fermoir lobster. 50cm, épaisseur 3mm.', featured: true },
      { name: 'Bague Solitaire Zircon', slug: 'bague-solitaire-zircon', price: 5200, costPrice: 1800, stock: 20, category: 'Bijoux', description: 'Bague argent 925 plaqué or rose, zircon cubique 1.5 carat. Écrin inclus.', featured: true },
      { name: 'Bracelet Joncs Doré', slug: 'bracelet-joncs-dore', price: 6800, costPrice: 2800, stock: 12, category: 'Bijoux', description: 'Jonc ouvert plaqué or, design minimaliste. Diamètre adaptable, finition miroir.', featured: true },
      { name: 'Boucles Goutte Cristal', slug: 'boucles-goutte-cristal', price: 3500, costPrice: 1200, stock: 25, category: 'Bijoux', description: 'Boucles pendantes argent 925, cristaux Swarovski. Fermoir push-back.', featured: false },
      // Montres (4)
      { name: 'Montre Minimaliste Cuir', slug: 'montre-minimaliste-cuir', price: 7500, comparePrice: 9000, costPrice: 3200, stock: 14, category: 'Montres', description: 'Quartz japonais, boîtier acier 36mm. Bracelet cuir interchangeable.', featured: true },
      { name: 'Montre Chronographe Sport', slug: 'montre-chronographe-sport', price: 12000, comparePrice: 15000, costPrice: 5500, stock: 10, category: 'Montres', description: 'Chronographe tachymètre 42mm, verre saphir. Étanche 100m, bracelet acier.', featured: true },
      { name: 'Montre Dorée Cadran Mère Perle', slug: 'montre-doree-mere-perle', price: 9800, costPrice: 4200, stock: 8, category: 'Montres', description: 'Boîtier doré 34mm, cadran nacre. Quartz, bracelet maille milanaise.', featured: true },
      { name: 'Montre Digital Retro', slug: 'montre-digital-retro', price: 4500, costPrice: 1800, stock: 18, category: 'Montres', description: 'Montre rétro digital, écran LED. Alarme, chronomètre, étanche 50m.', featured: false },
      // Sacs (4)
      { name: 'Sac à Main Cuir Simili', slug: 'sac-main-cuir-simili', price: 5500, costPrice: 2200, stock: 16, category: 'Sacs', description: 'Sac bandoulière PU cuir, poche intérieure zippée. Bandoulière ajustable.', featured: true },
      { name: 'Pochette Soirée Dorée', slug: 'pochette-soiree-doree', price: 3800, costPrice: 1500, stock: 22, category: 'Sacs', description: 'Pochette métal doré, chaîne détachable. Idéale mariage et événements.', featured: true },
      { name: 'Sac Besace Toile', slug: 'sac-besace-toile', price: 2800, costPrice: 1000, stock: 20, category: 'Sacs', description: 'Sac besace toile épaisse, imprimé ethnique. Rabat magnétique, sangle tissée.', featured: false },
      { name: 'Trousse Maquillage Voyage', slug: 'trousse-maquillage-voyage', price: 1500, costPrice: 500, stock: 40, category: 'Sacs', description: 'Trousse maquillage étanche, poche zippée. Tissu nylon, format voyage.', featured: false },
      // Lunettes (4)
      { name: 'Lunettes de Soleil Aviator', slug: 'lunettes-aviator', price: 4200, costPrice: 1600, stock: 20, category: 'Lunettes', description: 'Aviator classique, verres polarisés UV400. Monture dorée, étui inclus.', featured: true },
      { name: 'Lunettes Rondes Vintage', slug: 'lunettes-rondes-vintage', price: 3500, costPrice: 1300, stock: 18, category: 'Lunettes', description: 'Monture ronde écaille de tortue, verres dégradés. Style rétro unisexe.', featured: true },
      { name: 'Lunettes Carrées Oversize', slug: 'lunettes-carrees-oversize', price: 4800, costPrice: 1800, stock: 14, category: 'Lunettes', description: 'Oversize carrée, monture acétate. Protection UVA/UVB, étui rigide.', featured: false },
      { name: 'Lunettes Sport Wrap', slug: 'lunettes-sport-wrap', price: 3000, costPrice: 1100, stock: 24, category: 'Lunettes', description: 'Wrap sport, antidérapant nez. Polycarbonate shatterproof, sac microfibre.', featured: false },
      // Parfums (4)
      { name: 'Parfum Homme Oud & Bois', slug: 'parfum-homme-oud-bois', price: 6500, costPrice: 2500, stock: 12, category: 'Parfums', description: 'Eau de parfum 100ml, notes oud, bois de santal, ambre. Ténacité 8h+.', featured: true },
      { name: 'Parfum Femme Floral Musqué', slug: 'parfum-femme-floral-musque', price: 5800, costPrice: 2200, stock: 15, category: 'Parfums', description: 'Eau de parfum 100ml, rose, jasmin, musc blanc. Flacon élégant.', featured: true },
      { name: 'Coffret Parfum Mini x5', slug: 'coffret-parfum-mini-x5', price: 4200, comparePrice: 5500, costPrice: 1500, stock: 10, category: 'Parfums', description: '5 mini parfums 20ml : frais, oriental, boisé, floral, sport. Coffret cadeau.', featured: true },
      { name: 'Parfum Unisexe Frais Marin', slug: 'parfum-unisexe-marin', price: 5000, costPrice: 1900, stock: 18, category: 'Parfums', description: 'Eau de toilette 100ml, notes marine, bergamote, cèdre. Printemps-été.', featured: false },
    ],
    promotions: [
      { code: 'BIJOUX20', type: 'PERCENTAGE', value: 20, minOrderAmount: 3000, maxUses: 50, description: '20% sur tous les bijoux', applicableCategories: 'Bijoux' },
      { code: 'MODE500', type: 'FIXED_AMOUNT', value: 500, minOrderAmount: 4000, maxUses: 80, description: '500 DA de réduction sur la mode', applicableCategories: '' },
      { code: 'LIVRE_OFFERTE', type: 'FREE_SHIPPING', value: 0, minOrderAmount: 5000, maxUses: 120, description: 'Livraison offerte dès 5000 DA', applicableCategories: '' },
      { code: 'MONTRE10', type: 'PERCENTAGE', value: 10, minOrderAmount: 7000, maxUses: 30, description: '10% sur les montres', applicableCategories: 'Montres' },
      { code: 'SOLDE_ETE', type: 'PERCENTAGE', value: 30, minOrderAmount: 2000, maxUses: 25, description: 'Soldes d\'été : 30% sur tout', applicableCategories: 'Lunettes,Parfums' },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════
// EMPLOYEE DEFINITIONS (per store)
// ═══════════════════════════════════════════════════════════════

interface EmployeeDef {
  name: string;
  email: string;
  phone: string;
  role: 'MANAGER' | 'CONFIRMATEUR' | 'MARKETER' | 'LIVREUR';
  password: string;
}

const EMPLOYEE_DEFS: Record<string, EmployeeDef[]> = {
  'veloce-sport': [
    { name: 'Karim Benali', email: 'karim@veloce-sport.dz', phone: '0555123456', role: 'MANAGER', password: 'Manager123!' },
    { name: 'Yacine Meddour', email: 'yacine@veloce-sport.dz', phone: '0661234567', role: 'CONFIRMATEUR', password: 'Confirm123!' },
    { name: 'Sofiane Kaci', email: 'sofiane@veloce-sport.dz', phone: '0770345678', role: 'CONFIRMATEUR', password: 'Confirm123!' },
    { name: 'Mourad Hamani', email: 'mourad@veloce-sport.dz', phone: '0555456789', role: 'LIVREUR', password: 'Delivery123!' },
    { name: 'Amine Marketer', email: 'amine@veloce-sport.dz', phone: '0555999888', role: 'MARKETER', password: 'Market123!' },
  ],
  'tech-cases-dz': [
    { name: 'Nadia Bouzid', email: 'nadia@tech-cases-dz.dz', phone: '0555789012', role: 'MANAGER', password: 'Manager123!' },
    { name: 'Rachid Ouali', email: 'rachid@tech-cases-dz.dz', phone: '0661890123', role: 'CONFIRMATEUR', password: 'Confirm123!' },
    { name: 'Amina Hadjadj', email: 'amina@tech-cases-dz.dz', phone: '0770901234', role: 'CONFIRMATEUR', password: 'Confirm123!' },
    { name: 'Djamel Touati', email: 'djamel@tech-cases-dz.dz', phone: '0555012345', role: 'LIVREUR', password: 'Delivery123!' },
    { name: 'Sara Marketer', email: 'sara@tech-cases-dz.dz', phone: '0555777666', role: 'MARKETER', password: 'Market123!' },
  ],
  'mode-bijoux': [
    { name: 'Leila Amrani', email: 'leila@mode-bijoux.dz', phone: '0661123456', role: 'MANAGER', password: 'Manager123!' },
    { name: 'Farid Zerhouni', email: 'farid@mode-bijoux.dz', phone: '0770234567', role: 'CONFIRMATEUR', password: 'Confirm123!' },
    { name: 'Samira Benaissa', email: 'samira@mode-bijoux.dz', phone: '0555345678', role: 'CONFIRMATEUR', password: 'Confirm123!' },
    { name: 'Hichem Khelifi', email: 'hichem@mode-bijoux.dz', phone: '0661456789', role: 'LIVREUR', password: 'Delivery123!' },
    { name: 'Zineb Marketer', email: 'zineb@mode-bijoux.dz', phone: '0555111222', role: 'MARKETER', password: 'Market123!' },
  ],
};

// ═══════════════════════════════════════════════════════════════
// ALGERIAN CUSTOMER DATA
// ═══════════════════════════════════════════════════════════════

const CUSTOMER_NAMES = [
  { first: 'Karim', last: 'Benmoussa' },
  { first: 'Fatima', last: 'Zerhouni' },
  { first: 'Youcef', last: 'Medjadi' },
  { first: 'Amina', last: 'Hadjadj' },
  { first: 'Mohamed', last: 'Boudiaf' },
  { first: 'Sara', last: 'Taleb' },
  { first: 'Omar', last: 'Ziani' },
  { first: 'Nour', last: 'Haddad' },
  { first: 'Walid', last: 'Slimani' },
  { first: 'Imane', last: 'Mansouri' },
  { first: 'Bilal', last: 'Charef' },
  { first: 'Lina', last: 'Djoudi' },
  { first: 'Hamza', last: 'Benaissa' },
  { first: 'Yasmine', last: 'Mokrani' },
  { first: 'Rami', last: 'Rahmani' },
  { first: 'Meriem', last: 'Belkacem' },
  { first: 'Ahmed', last: 'Kaci' },
  { first: 'Zahra', last: 'Bouzid' },
  { first: 'Sami', last: 'Benali' },
  { first: 'Khadija', last: 'Hamani' },
  { first: 'Amine', last: 'Touati' },
  { first: 'Ines', last: 'Amrani' },
  { first: 'Reda', last: 'Mebarki' },
  { first: 'Soumaya', last: 'Ouali' },
  { first: 'Fares', last: 'Zerrouki' },
  { first: 'Rania', last: 'Benmoussa' },
  { first: 'Nabil', last: 'Chibani' },
  { first: 'Hiba', last: 'Lahlou' },
  { first: 'Mehdi', last: 'Ferhat' },
  { first: 'Dalia', last: 'Boudjemaa' },
  { first: 'Adel', last: 'Bekkouche' },
  { first: 'Nadia', last: 'Slimani' },
  { first: 'Tarek', last: 'Mansouri' },
  { first: 'Camelia', last: 'Djelloul' },
  { first: 'Sofiane', last: 'Hamidou' },
  { first: 'Rym', last: 'Ait Ahmed' },
  { first: 'Ayoub', last: 'Mansouri' },
  { first: 'Loubna', last: 'Bouzid' },
  { first: 'Idir', last: 'Ferhat' },
  { first: 'Nesrine', last: 'Ziani' },
];

const COMMUNES = [
  'Bab El Oued', 'Kouba', 'El Biar', 'Hussein Dey', 'Bir Mourad Raïs',
  'Draria', 'Bir Khadem', 'El Harrach', 'Baraki', 'Oued Smar',
  'Sidi M\'Hamed', 'Belouizdad', 'Casbah', 'Bologhine', 'Raïs Hamidou',
  'Ain Taya', 'Mohammadia', 'Bourouba', 'Reghaia', 'Dely Ibrahim',
];

// ═══════════════════════════════════════════════════════════════
// SEED FUNCTION
// ═══════════════════════════════════════════════════════════════

const STATUSES: OrderStatus[] = ['NEW', 'ASSIGNED', 'CALLED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED'];
const STATUS_WEIGHTS = [15, 25, 25, 15, 10, 8, 7]; // percentages

const CALL_RESULTS = ['ANSWERED', 'NOT_ANSWERED', 'BUSY', 'REFUSED', 'POSTPONED'] as const;
const SOURCES = ['facebook_ads', 'tiktok', 'instagram', 'organic', 'manual', 'whatsapp'];
const UTM_SOURCES = ['facebook', 'google', 'tiktok', 'instagram', null];
const UTM_MEDIUMS = ['cpc', 'social', 'email', null];
const UTM_CAMPAIGNS = ['summer_sale', 'new_arrivals', 'ramadan_promo', 'flash_sale', null];

const REVIEW_COMMENTS = [
  'Très satisfaite de ma commande, produit conforme à la description.',
  'Qualité au rendez-vous, livraison rapide. Je recommande !',
  'Bon rapport qualité/prix, conforme aux photos.',
  'Produit excellent, emballage soigné.',
  'Un peu déçu par la qualité mais correct pour le prix.',
  'Parfait ! Exactement ce que je cherchais.',
  'Livraison un peu longue mais produit nickel.',
  'Très bon produit, j\'en rachèterai.',
  'La qualité est moyenne mais le prix est attractif.',
  'Superbe, mes amis veulent la même chose !',
  'Couleur légèrement différente de la photo mais j\'aime bien.',
  'Rapide et efficace, 5 étoiles !',
  'Manque un peu de finition mais globalement content.',
  'Le meilleur achat que j\'ai fait sur ce site.',
  'Correct, rien à redire.',
];

export async function seedDatabase() {
  const startTime = Date.now();
  console.log('🌱 Starting comprehensive database seed...');

  // ─── 1. CLEAR ALL DATA (in FK-safe order) ─────────────────
  console.log('🗑️  Clearing existing data...');
  await db.orderEvent.deleteMany();
  await db.stockMovement.deleteMany();
  await db.review.deleteMany();
  await db.orderItem.deleteMany();
  await db.financialTransaction.deleteMany();
  await db.expense.deleteMany();
  await db.wallet.deleteMany();
  await db.deliveryFeeGrid.deleteMany();
  await db.deliveryPartner.deleteMany();
  await db.order.deleteMany();
  await db.customer.deleteMany();
  await db.promotion.deleteMany();
  await db.product.deleteMany();
  await db.auditLog.deleteMany();
  await db.wilayaDeliveryFee.deleteMany();
  
  // Break circular dependency: User -> Store (Employee) and Store -> User (Owner)
  await db.user.updateMany({ data: { employeeStoreId: null } });
  await db.store.deleteMany();
  await db.user.deleteMany();
  console.log('   ✅ All tables cleared');

  // ─── 2. SEED WILAYA DELIVERY FEES ────────────────────────
  console.log('📦 Seeding 58 wilaya delivery fees...');
  for (const wf of WILAYA_FEES) {
    await db.wilayaDeliveryFee.create({
      data: {
        wilayaId: wf.wilayaId,
        wilayaName: wf.wilayaName,
        homeFee: wf.homeFee,
        officeFee: wf.officeFee,
        createdAt: new Date(),
      },
    });
  }
  console.log(`   ✅ ${WILAYA_FEES.length} wilayas seeded`);

  // ─── 3. CREATE SUPER ADMIN ───────────────────────────────
  console.log('👤 Creating super admin...');
  const adminHash = await hashPassword('Admin123!');
  const superAdmin = await db.user.create({
    data: {
      email: 'admin@multistore.dz',
      name: 'Admin Principal',
      passwordHash: adminHash,
      role: 'SUPER_ADMIN',
      phone: '0555000000',
      isActive: true,
    },
  });
  console.log('   ✅ Super admin created');

  // ─── 4. CREATE STORES ────────────────────────────────────
  console.log('🏪 Creating stores...');
  const stores: Array<{ id: string; slug: string; prefix: string; def: StoreDef }> = [];
  for (const storeDef of STORE_DEFS) {
    const store = await db.store.create({
      data: {
        name: storeDef.name,
        slug: storeDef.slug,
        description: storeDef.description,
        themeConfig: storeDef.themeConfig,
        ownerId: superAdmin.id,
        isActive: true,
        isDeleted: false,
      },
    });
    stores.push({ id: store.id, slug: store.slug, prefix: storeDef.prefix, def: storeDef });
  }
  console.log(`   ✅ ${stores.length} stores created`);

  // ─── 5. CREATE EMPLOYEES ─────────────────────────────────
  console.log('👥 Creating employees...');
  const storeEmployees: Record<string, Array<{ id: string; name: string; role: string }>> = {};
  for (const store of stores) {
    const emps = EMPLOYEE_DEFS[store.slug] ?? [];
    storeEmployees[store.id] = [];
    for (const empDef of emps) {
      const pwHash = await hashPassword(empDef.password);
      const user = await db.user.create({
        data: {
          email: empDef.email,
          name: empDef.name,
          passwordHash: pwHash,
          role: empDef.role,
          phone: empDef.phone,
          employeeStoreId: store.id,
          dailyTarget: empDef.role === 'CONFIRMATEUR' ? Math.floor(Math.random() * 10) + 5 : 0,
          isActive: true,
        },
      });
      storeEmployees[store.id].push({ id: user.id, name: user.name, role: empDef.role });
    }
  }
  const totalEmployees = Object.values(storeEmployees).flat().length;
  console.log(`   ✅ ${totalEmployees} employees created`);

  // ─── 5.1 CREATE DELIVERY PARTNERS ────────────────────────
  console.log('🚚 Creating delivery partners...');
  const storePartners: Record<string, Array<{ id: string; name: string; code: string }>> = {};
  for (const store of stores) {
    storePartners[store.id] = [];
    const partners = [
      { name: 'Yalidine Express', code: 'yalidine', logo: 'https://yalidine.com/wp-content/uploads/2021/04/logo-yalidine.png' },
      { name: 'Noest Express', code: 'noest', logo: 'https://noest.dz/assets/img/logo.png' }
    ];
    for (const p of partners) {
      const partner = await db.deliveryPartner.create({
        data: {
          storeId: store.id,
          name: p.name,
          code: p.code,
          logoUrl: p.logo,
          isApiEnabled: true,
          isActive: true,
          apiConfig: JSON.stringify({ api_key: 'test_key', api_token: 'test_token' })
        }
      });
      storePartners[store.id].push({ id: partner.id, name: partner.name, code: partner.code });
      
      // Create Pricing Grid for some wilayas
      for (const wf of WILAYA_FEES.slice(0, 20)) {
        await db.deliveryFeeGrid.create({
          data: {
            partnerId: partner.id,
            wilayaId: wf.wilayaId,
            homeFee: wf.homeFee,
            officeFee: wf.officeFee
          }
        });
      }
    }
  }
  console.log('   ✅ Delivery partners and grids created');

  // ─── 5.2 CREATE WALLETS ──────────────────────────────────
  console.log('💳 Creating wallets...');
  const storeWallets: Record<string, Array<{ id: string; name: string; type: string }>> = {};
  for (const store of stores) {
    storeWallets[store.id] = [];
    const walletDefs = [
      { name: 'Caisse Principale', type: 'CASH' },
      { name: 'Compte CCP', type: 'BANK' },
      { name: 'Compte BaridiMob', type: 'BANK' }
    ];
    for (const w of walletDefs) {
      const wallet = await db.wallet.create({
        data: {
          storeId: store.id,
          name: w.name,
          type: w.type as any,
          balance: 0,
          totalIn: 0,
          totalOut: 0,
          isActive: true
        }
      });
      storeWallets[store.id].push({ id: wallet.id, name: wallet.name, type: wallet.type as string });
    }
  }
  console.log('   ✅ Wallets created');

  // ─── 6. CREATE PRODUCTS ──────────────────────────────────
  console.log('🛍️  Creating products...');
  const storeProducts: Record<string, Array<{ id: string; name: string; price: number; costPrice: number; stock: number; category: string }>> = {};
  let totalProducts = 0;
  for (const store of stores) {
    const prods = store.def.products;
    storeProducts[store.id] = [];
    for (const p of prods) {
      const product = await db.product.create({
        data: {
          storeId: store.id,
          name: p.name,
          slug: p.slug,
          description: p.description,
          price: p.price,
          comparePrice: p.comparePrice ?? null,
          costPrice: p.costPrice,
          stock: p.stock,
          reservedStock: 0,
          lowStockThreshold: Math.max(3, Math.floor(p.stock * 0.15)),
          images: JSON.stringify([]),
          category: p.category,
          isActive: true,
          featured: p.featured,
        },
      });
      storeProducts[store.id].push({
        id: product.id,
        name: product.name,
        price: product.price,
        costPrice: product.costPrice ?? 0,
        stock: product.stock,
        category: product.category ?? '',
      });
      totalProducts++;
    }
  }
  console.log(`   ✅ ${totalProducts} products created`);

  // ─── 7. CREATE PROMOTIONS ────────────────────────────────
  console.log('🏷️  Creating promotions...');
  const storePromotions: Record<string, Array<{ id: string; code: string; type: string; value: number; minOrderAmount: number; applicableCategories: string }>> = {};
  let totalPromotions = 0;
  for (const store of stores) {
    const promos = store.def.promotions;
    storePromotions[store.id] = [];
    for (const promo of promos) {
      const now = new Date();
      const start = new Date(now.getTime() - 7 * 86400000);
      const end = new Date(now.getTime() + 30 * 86400000);
      const promotion = await db.promotion.create({
        data: {
          storeId: store.id,
          code: promo.code,
          type: promo.type,
          value: promo.value,
          minOrderAmount: promo.minOrderAmount,
          maxUses: promo.maxUses,
          usedCount: 0,
          startsAt: start,
          endsAt: end,
          isActive: true,
          description: promo.description,
          applicableCategories: promo.applicableCategories,
          firstPurchaseOnly: false,
          isFlashSale: false,
        },
      });
      storePromotions[store.id].push({
        id: promotion.id,
        code: promotion.code,
        type: promotion.type,
        value: promotion.value,
        minOrderAmount: promotion.minOrderAmount,
        applicableCategories: promotion.applicableCategories,
      });
      totalPromotions++;
    }
  }
  console.log(`   ✅ ${totalPromotions} promotions created`);

  // ─── 8. CREATE CUSTOMERS (30 per store) ──────────────────
  console.log('🧑‍🤝‍🧑 Creating customers...');
  const storeCustomers: Record<string, Array<{ id: string; name: string; phone: string; wilaya: string }>> = {};
  let totalCustomers = 0;
  for (const store of stores) {
    storeCustomers[store.id] = [];
    // Pick 30 unique customer names
    const shuffledNames = [...CUSTOMER_NAMES].sort(() => Math.random() - 0.5).slice(0, 30);
    const usedPhones = new Set<string>();
    for (const cn of shuffledNames) {
      let phone = generatePhone();
      while (usedPhones.has(phone)) phone = generatePhone();
      usedPhones.add(phone);

      const wilaya = pickRandom(WILAYA_FEES).wilayaName;
      const customer = await db.customer.create({
        data: {
          storeId: store.id,
          phone,
          name: `${cn.first} ${cn.last}`,
          email: `${cn.first.toLowerCase()}.${cn.last.toLowerCase()}@email.dz`,
          wilaya,
          address: `Cité ${Math.floor(Math.random() * 500) + 1}, ${wilaya}`,
          tier: pickRandom(['BRONZE', 'BRONZE', 'BRONZE', 'SILVER', 'SILVER', 'GOLD']),
          totalOrders: 0,
          totalSpent: 0,
        },
      });
      storeCustomers[store.id].push({
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        wilaya: customer.wilaya ?? '',
      });
      totalCustomers++;
    }
  }
  console.log(`   ✅ ${totalCustomers} customers created`);

  // ─── 9. CREATE ORDERS (50 per store) ─────────────────────
  console.log('📋 Creating orders...');
  let totalOrders = 0;
  let totalEvents = 0;
  const allStockMovements: Array<{
    productId: string;
    type: string;
    quantity: number;
    reason: string;
    actorId: string | null;
    orderId: string;
  }> = [];

  for (const store of stores) {
    const prods = storeProducts[store.id];
    const emps = storeEmployees[store.id];
    const custs = storeCustomers[store.id];
    const promos = storePromotions[store.id];
    const confirmateurs = emps.filter(e => e.role === 'CONFIRMATEUR');

    for (let i = 0; i < 50; i++) {
      const status = weightedRandom(STATUSES, STATUS_WEIGHTS);
      const daysAgo = Math.floor(Math.random() * 60) + 1;
      const deliveryType = Math.random() > 0.4 ? 'HOME' : 'OFFICE';

      // Pick a customer
      const cust = pickRandom(custs);
      const wilayaName = cust.wilaya || pickRandom(WILAYA_FEES).wilayaName;
      const deliveryFee = getDeliveryFee(wilayaName, deliveryType);

      // Pick 1-3 products from this store
      const numItems = Math.floor(Math.random() * 3) + 1;
      const pickedIndices = new Set<number>();
      while (pickedIndices.size < numItems && pickedIndices.size < prods.length) {
        pickedIndices.add(Math.floor(Math.random() * prods.length));
      }
      const selectedProds = [...pickedIndices].map(idx => prods[idx]).filter(Boolean);

      // Build order items array
      const orderItems = selectedProds.map(p => ({
        productId: p.id,
        productName: p.name,
        qty: Math.floor(Math.random() * 2) + 1,
        price: p.price,
        image: '',
        variant: null,
        category: p.category ?? null,
      }));

      const subtotal = orderItems.reduce((sum, it) => sum + it.price * it.qty, 0);

      // Maybe apply a promo
      let discount = 0;
      let promoCode: string | null = null;
      if (Math.random() > 0.65) {
        const promo = pickRandom(promos);
        if (promo && subtotal >= promo.minOrderAmount) {
          promoCode = promo.code;
          if (promo.type === 'PERCENTAGE') {
            discount = Math.round(subtotal * (promo.value / 100));
          } else if (promo.type === 'FIXED_AMOUNT') {
            discount = promo.value;
          } else if (promo.type === 'FREE_SHIPPING') {
            discount = deliveryFee;
          }
        }
      }

      const total = subtotal + deliveryFee - discount;

      // Assign to employee if not NEW
      const assignedTo = status !== 'NEW' && confirmateurs.length > 0
        ? pickRandom(confirmateurs).id
        : null;

      const source = pickRandom(SOURCES);
      const utmSource = pickRandom(UTM_SOURCES);
      const utmMedium = pickRandom(UTM_MEDIUMS);
      const utmCampaign = pickRandom(UTM_CAMPAIGNS);

      const createdAt = randomDate(daysAgo, 0);
      const orderNumber = generateOrderNumber(store.prefix, daysAgo);

      const order = await db.order.create({
        data: {
          storeId: store.id,
          orderNumber,
          customerName: cust.name,
          customerPhone: cust.phone,
          customerPhone2: Math.random() > 0.6 ? generatePhone() : null,
          customerAddress: `Cité ${Math.floor(Math.random() * 500) + 1}, ${wilayaName}`,
          customerWilaya: wilayaName,
          customerCommune: pickRandom(COMMUNES),
          deliveryType,
          deliveryFee,
          subtotal,
          discount,
          total,
          status,
          assignedTo,
          carrierId: (status === 'SHIPPED' || status === 'DELIVERED') ? 'yalidine' : null,
          trackingNumber: (status === 'SHIPPED' || status === 'DELIVERED')
            ? `YAL${Date.now()}${Math.floor(Math.random() * 10000)}`
            : null,
          source,
          utmSource,
          utmMedium,
          utmCampaign,
          customerId: cust.id,
          customerTier: cust.wilaya === 'Alger' ? 'GOLD' : 'BRONZE',
          promoCode,
          createdAt,
        },
      });
      totalOrders++;

      // ─── Financial Transaction for DELIVERED ─────
      if (status === 'DELIVERED') {
        const wallets = storeWallets[store.id];
        if (wallets.length > 0) {
          const wallet = pickRandom(wallets);
          await db.financialTransaction.create({
            data: {
              storeId: store.id,
              walletId: wallet.id,
              type: 'INCOME',
              amount: total,
              category: 'Vente Directe',
              beneficiary: cust.name,
              description: `Paiement commande ${orderNumber}`,
              transactionDate: new Date(createdAt.getTime() + 5 * 86400000), // 5 days after order
              reference: `TX-${orderNumber}`,
              createdAt: new Date(),
            },
          });
        }
      }

      // ─── Order Items (relational table) ─────────
      if (orderItems.length > 0) {
        await db.orderItem.createMany({
          data: orderItems.map((item) => ({
            orderId: order.id,
            productId: item.productId,
            productName: item.productName,
            quantity: item.qty,
            unitPrice: Math.round(item.price),
            image: item.image ?? null,
            variant: item.variant ?? undefined,
            category: item.category ?? null,
          })),
        });
      }

      // ─── Order Events ──────────────────────────────
      // For CALLED and beyond, create 2-3 call events
      if (['CALLED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED'].includes(status)) {
        const statusFlow: OrderStatus[] = ['NEW', 'ASSIGNED', 'CALLED', 'CONFIRMED', 'SHIPPED', 'DELIVERED'];
        const targetIdx = statusFlow.indexOf(status);
        if (targetIdx < 0) continue;

        // Create events for each status transition up to target
        for (let s = 0; s <= targetIdx; s++) {
          const toStatus = statusFlow[s];
          const fromStatus = s > 0 ? statusFlow[s - 1] : null;

          // For CALLED status, create 1-3 call attempt events
          if (toStatus === 'CALLED') {
            const callAttempts = Math.floor(Math.random() * 2) + 2; // 2-3 calls
            for (let c = 0; c < callAttempts; c++) {
              const callResult = c === callAttempts - 1
                ? (status !== 'RETURNED' ? 'ANSWERED' : pickRandom(['NOT_ANSWERED', 'REFUSED']))
                : pickRandom(['NOT_ANSWERED', 'BUSY', 'POSTPONED']);
              const actorId = confirmateurs.length > 0 ? pickRandom(confirmateurs).id : superAdmin.id;
              await db.orderEvent.create({
                data: {
                  orderId: order.id,
                  actorId,
                  fromStatus: c === 0 ? 'ASSIGNED' : 'CALLED',
                  toStatus: 'CALLED',
                  note: callResult === 'POSTPONED'
                    ? 'Client demande rappel demain'
                    : callResult === 'REFUSED'
                      ? 'Client refuse la commande'
                      : null,
                  callResult,
                  callAttemptNumber: c + 1,
                  scheduledCallbackAt: callResult === 'POSTPONED'
                    ? new Date(createdAt.getTime() + 86400000)
                    : null,
                  createdAt: new Date(createdAt.getTime() + (c + 1) * 3600000 * 2 + Math.random() * 3600000),
                },
              });
              totalEvents++;
            }
          } else {
            // Regular status transition event
            const actorId = s === 0
              ? superAdmin.id
              : (confirmateurs.length > 0 ? pickRandom(confirmateurs).id : superAdmin.id);
            await db.orderEvent.create({
              data: {
                orderId: order.id,
                actorId,
                fromStatus,
                toStatus,
                note: toStatus === 'RETURNED' ? 'Retour client - non satisfait' : null,
                createdAt: new Date(createdAt.getTime() + (s + 1) * 3600000 * 4 + Math.random() * 3600000),
              },
            });
            totalEvents++;
          }
        }
      } else if (status === 'ASSIGNED') {
        // Just one event: NEW -> ASSIGNED
        await db.orderEvent.create({
          data: {
            orderId: order.id,
            actorId: superAdmin.id,
            fromStatus: 'NEW',
            toStatus: 'ASSIGNED',
            createdAt: new Date(createdAt.getTime() + 1800000),
          },
        });
        totalEvents++;
      }

      // ─── Stock Movements for CONFIRMED+ orders ─────
      if (['CONFIRMED', 'SHIPPED', 'DELIVERED'].includes(status)) {
        for (const item of orderItems) {
          // ORDER_RESERVE
          allStockMovements.push({
            productId: item.productId,
            type: 'ORDER_RESERVE',
            quantity: item.qty,
            reason: `Commande ${orderNumber}`,
            actorId: assignedTo,
            orderId: order.id,
          });
          // ORDER_CONFIRM (stock out of reserved)
          allStockMovements.push({
            productId: item.productId,
            type: 'ORDER_CONFIRM',
            quantity: item.qty,
            reason: `Confirmation ${orderNumber}`,
            actorId: assignedTo,
            orderId: order.id,
          });
        }
      } else if (status === 'RETURNED') {
        // Could be returned from various stages
        const returnedFrom = Math.random() > 0.5 ? 'CONFIRMED' : 'SHIPPED';
        if (returnedFrom === 'CONFIRMED') {
          for (const item of orderItems) {
            allStockMovements.push({
              productId: item.productId,
              type: 'RETURN_RESTOCK',
              quantity: item.qty,
              reason: `Retour ${orderNumber}`,
              actorId: assignedTo,
              orderId: order.id,
            });
          }
        }
      }
    }
  }
  console.log(`   ✅ ${totalOrders} orders created`);

  // ─── 10. CREATE STOCK MOVEMENTS ───────────────────────────
  console.log('📦 Creating stock movements...');
  let totalMovements = 0;

  // Order-related movements
  for (const sm of allStockMovements) {
    await db.stockMovement.create({
      data: {
        productId: sm.productId,
        type: sm.type,
        quantity: sm.quantity,
        reason: sm.reason,
        actorId: sm.actorId,
        orderId: sm.orderId,
      },
    });
    totalMovements++;

    // Also update product stock
    if (sm.type === 'ORDER_CONFIRM') {
      await db.product.update({
        where: { id: sm.productId },
        data: { stock: { decrement: sm.quantity }, reservedStock: { decrement: sm.quantity } },
      });
    } else if (sm.type === 'ORDER_RESERVE') {
      await db.product.update({
        where: { id: sm.productId },
        data: { reservedStock: { increment: sm.quantity } },
      });
    } else if (sm.type === 'RETURN_RESTOCK') {
      await db.product.update({
        where: { id: sm.productId },
        data: { stock: { increment: sm.quantity } },
      });
    }
  }

  // Random MANUAL_ADJUSTMENT and RESTOCK movements
  for (const store of stores) {
    const prods = storeProducts[store.id];
    for (let i = 0; i < 5; i++) {
      const prod = pickRandom(prods);
      const type = Math.random() > 0.5 ? 'MANUAL_ADJUSTMENT' : 'RESTOCK';
      const qty = Math.floor(Math.random() * 20) + 5;
      const actorId = storeEmployees[store.id]?.[0]?.id ?? superAdmin.id;
      await db.stockMovement.create({
        data: {
          productId: prod.id,
          type,
          quantity: qty,
          reason: type === 'RESTOCK' ? 'Réapprovisionnement stock' : 'Ajustement inventaire',
          actorId,
          orderId: null,
          createdAt: randomDate(30),
        },
      });
      totalMovements++;
      if (type === 'RESTOCK') {
        await db.product.update({
          where: { id: prod.id },
          data: { stock: { increment: qty } },
        });
      }
    }
  }
  console.log(`   ✅ ${totalMovements} stock movements created`);

  // ─── 11. UPDATE CUSTOMER STATS ───────────────────────────
  console.log('📊 Updating customer stats...');
  for (const store of stores) {
    const custs = storeCustomers[store.id];
    for (const cust of custs) {
      const orders = await db.order.findMany({
        where: { customerId: cust.id, isDeleted: false },
      });
      const totalOrders = orders.length;
      const totalSpent = orders
        .filter(o => o.status === 'DELIVERED')
        .reduce((s, o) => s + o.total, 0);
      const lastOrder = orders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

      // Determine tier based on totalSpent
      let tier = 'BRONZE';
      if (totalSpent >= 200000) tier = 'DIAMOND';
      else if (totalSpent >= 100000) tier = 'PLATINUM';
      else if (totalSpent >= 50000) tier = 'GOLD';
      else if (totalSpent >= 20000) tier = 'SILVER';

      await db.customer.update({
        where: { id: cust.id },
        data: {
          totalOrders,
          totalSpent,
          lastOrderAt: lastOrder?.createdAt ?? null,
          tier,
        },
      });
    }
  }
  console.log('   ✅ Customer stats updated');

  // ─── 12. UPDATE PROMOTION usedCount ──────────────────────
  console.log('🔄 Updating promotion usage counts...');
  for (const store of stores) {
    const promos = storePromotions[store.id];
    for (const promo of promos) {
      const usedCount = await db.order.count({
        where: { storeId: store.id, promoCode: promo.code, isDeleted: false },
      });
      await db.promotion.update({
        where: { id: promo.id },
        data: { usedCount },
      });
    }
  }
  console.log('   ✅ Promotion usage updated');

  // ─── 13. CREATE REVIEWS ──────────────────────────────────
  console.log('⭐ Creating reviews...');
  let totalReviews = 0;
  for (const store of stores) {
    const prods = storeProducts[store.id];
    // Create 8-12 reviews per store
    const numReviews = Math.floor(Math.random() * 5) + 8;
    for (let i = 0; i < numReviews; i++) {
      const prod = pickRandom(prods);
      const cust = pickRandom(storeCustomers[store.id]);
      await db.review.create({
        data: {
          productId: prod.id,
          storeId: store.id,
          customerName: cust.name,
          rating: Math.floor(Math.random() * 3) + 3, // 3-5 stars
          title: pickRandom([
            'Excellent produit',
            'Très bon achat',
            'Qualité correcte',
            'Je recommande',
            'Super',
            'Bon rapport qualité prix',
          ]),
          comment: pickRandom(REVIEW_COMMENTS),
          isVerified: Math.random() > 0.3,
          isApproved: Math.random() > 0.15, // 85% approved
          createdAt: randomDate(45),
        },
      });
      totalReviews++;
    }
  }
  console.log(`   ✅ ${totalReviews} reviews created`);

  // ─── 14. CREATE EXPENSES ─────────────────────────────────
  console.log('💸 Creating expenses...');
  let totalExpensesCount = 0;
  const EXPENSE_CATS = ['MARKETING', 'RENT', 'SALARY', 'UTILITIES', 'LOGISTICS', 'OTHER'];
  for (const store of stores) {
    const wallets = storeWallets[store.id];
    const emps = storeEmployees[store.id];
    const numExp = Math.floor(Math.random() * 6) + 5; // 5-10 expenses
    for (let i = 0; i < numExp; i++) {
      const cat = pickRandom(EXPENSE_CATS);
      const amount = Math.floor(Math.random() * 50000) + 2000;
      const wallet = pickRandom(wallets);
      const creator = emps.length > 0 ? pickRandom(emps).id : superAdmin.id;
      
      await db.expense.create({
        data: {
          storeId: store.id,
          category: cat as any,
          label: `Dépense ${cat.toLowerCase()} ${i + 1}`,
          amount,
          totalAmount: amount,
          status: 'PAID',
          expenseDate: randomDate(30),
          walletId: wallet.id,
          createdBy: creator,
          createdAt: new Date(),
        }
      });
      totalExpensesCount++;
      
      // Also create a financial transaction for this expense
      await db.financialTransaction.create({
        data: {
          storeId: store.id,
          walletId: wallet.id,
          type: 'EXPENSE',
          amount,
          category: cat,
          beneficiary: 'Fournisseur externe',
          description: `Paiement ${cat.toLowerCase()}`,
          transactionDate: new Date(),
          createdAt: new Date(),
        }
      });
    }
  }
  console.log(`   ✅ ${totalExpensesCount} expenses created`);

  // ─── 15. UPDATE WALLET BALANCES ──────────────────────────
  console.log('🏦 Updating wallet balances...');
  for (const store of stores) {
    const wallets = storeWallets[store.id];
    for (const w of wallets) {
      const txs = await db.financialTransaction.findMany({ where: { walletId: w.id } });
      const totalIn = txs.filter(t => t.type === 'INCOME').reduce((sum, t) => sum + t.amount, 0);
      const totalOut = txs.filter(t => t.type === 'EXPENSE' || t.type === 'TRANSFER_OUT').reduce((sum, t) => sum + t.amount, 0);
      
      await db.wallet.update({
        where: { id: w.id },
        data: {
          totalIn,
          totalOut,
          balance: totalIn - totalOut
        }
      });
    }
  }
  console.log('   ✅ Wallet balances updated');

  // ─── 16. CREATE AUDIT LOGS ───────────────────────────────
  console.log('📝 Creating audit logs...');
  const auditEntities = ['Order', 'Product', 'Store', 'User', 'Promotion', 'Customer', 'StockMovement'];
  const auditActions = ['CREATE', 'UPDATE', 'SOFT_DELETE', 'RESTORE', 'STATUS_CHANGE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'EXPORT'];
  let totalAudit = 0;

  // Login/logout for super admin
  for (let i = 0; i < 5; i++) {
    await db.auditLog.create({
      data: {
        actorId: superAdmin.id,
        storeId: stores[Math.floor(Math.random() * stores.length)].id,
        entity: 'User',
        entityId: superAdmin.id,
        action: pickRandom(['LOGIN', 'LOGOUT', 'LOGIN_FAILED']),
        ipAddress: `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        createdAt: randomDate(14),
      },
    });
    totalAudit++;
  }

  // Random audit logs
  for (let i = 0; i < 30; i++) {
    const store = pickRandom(stores);
    const emps = storeEmployees[store.id];
    const actor = emps.length > 0 ? pickRandom(emps) : null;
    await db.auditLog.create({
      data: {
        actorId: actor?.id ?? superAdmin.id,
        storeId: store.id,
        entity: pickRandom(auditEntities),
        entityId: `entity-${Date.now()}-${i}`,
        action: pickRandom(auditActions),
        diff: JSON.stringify({ before: { status: 'NEW' }, after: { status: 'CONFIRMED' } }),
        ipAddress: `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        createdAt: randomDate(30),
      },
    });
    totalAudit++;
  }
  console.log(`   ✅ ${totalAudit} audit logs created`);

  // ─── DONE ─────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n🎉 Seed completed in ${elapsed}s!`);
  console.log('─── Summary ──────────────────────────────');
  console.log(`   Wilaya Fees:  ${WILAYA_FEES.length}`);
  console.log(`   Super Admin:  1`);
  console.log(`   Stores:       ${stores.length}`);
  console.log(`   Employees:    ${totalEmployees}`);
  console.log(`   Products:     ${totalProducts}`);
  console.log(`   Promotions:   ${totalPromotions}`);
  console.log(`   Customers:    ${totalCustomers}`);
  console.log(`   Orders:       ${totalOrders}`);
  console.log(`   Order Events: ${totalEvents}`);
  console.log(`   Stock Moves:  ${totalMovements}`);
  console.log(`   Reviews:      ${totalReviews}`);
  console.log(`   Expenses:     ${totalExpensesCount}`);
  console.log(`   Audit Logs:   ${totalAudit}`);
  console.log('─────────────────────────────────────────');

  return {
    message: 'Database seeded successfully',
    stats: {
      wilayaFees: WILAYA_FEES.length,
      stores: stores.length,
      employees: totalEmployees,
      products: totalProducts,
      promotions: totalPromotions,
      customers: totalCustomers,
      orders: totalOrders,
      orderEvents: totalEvents,
      stockMovements: totalMovements,
      reviews: totalReviews,
      expenses: totalExpensesCount,
      auditLogs: totalAudit,
    },
  };
}
