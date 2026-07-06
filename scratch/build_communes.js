const fs = require('fs');
const geo = require('geoalgeria');

const WILAYAS = [
  'Adrar', 'Chlef', 'Laghouat', 'Oum El Bouaghi', 'Batna', 'Béjaïa',
  'Biskra', 'Béchar', 'Blida', 'Bouira', 'Tamanrasset', 'Tébessa',
  'Tlemcen', 'Tiaret', 'Tizi Ouzou', 'Alger', 'Djelfa', 'Jijel',
  'Sétif', 'Saïda', 'Skikda', 'Sidi Bel Abbès', 'Annaba', 'Guelma',
  'Constantine', 'Médéa', 'Mostaganem', 'M\'Sila', 'Mascara', 'Ouargla',
  'Oran', 'El Bayadh', 'Illizi', 'Bordj Bou Arréridj', 'Boumerdès',
  'El Tarf', 'Tindouf', 'Tissemsilt', 'El Oued', 'Khenchela',
  'Souk Ahras', 'Tipaza', 'Mila', 'Aïn Defla', 'Naâma', 'Aïn Témouchent',
  'Ghardaïa', 'Relizane', 'El M\'Ghair', 'El Meniaa', 'Ouled Djellal',
  'Bordj Baji Mokhtar', 'Béni Abbès', 'Timimoun', 'Touggourt', 'Djanet',
  'In Salah', 'In Guezzam'
];

let out = `/* eslint-disable */
// Generated list of Algerian Communes grouped by EXACT Wilaya name used in the app
export interface CommuneInfo {
  id: number;
  name: string;      // Arabic
  nameAscii: string; // French/ASCII
}

export const ALGERIAN_COMMUNES: Record<string, CommuneInfo[]> = {
`;

for (let i = 0; i < 58; i++) {
  const wilayaId = i + 1;
  const wilayaKey = WILAYAS[i];
  const communes = geo.getCommunesByWilaya(wilayaId);
  
  out += `  "${wilayaKey.replace(/"/g, '\\"')}": [\n`;
  communes.forEach(c => {
    out += `    { id: ${c.code_commune || 0}, name: "${c.name_ar}", nameAscii: "${c.name_fr.replace(/"/g, '\\"')}" },\n`;
  });
  out += `  ],\n`;
}

out += `};
`;

fs.writeFileSync('c:/Users/ZBOOK/Downloads/azzougshop/src/lib/algerian-communes.ts', out);
console.log('Communes generated successfully!');
