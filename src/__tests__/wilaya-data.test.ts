import { test, expect, describe } from 'bun:test';
import { WILAYAS } from '@/lib/wilaya-data';
import { NOEST_BUREAUX } from '@/lib/noest-bureaux-data';

// Regression test for a real bug (2026-07): the tail of WILAYAS (positions
// 49-58, the 10 wilayas created in 2019) was listed in an order that didn't
// match Algeria's official wilaya numbering. Noest bureau data
// (noest-bureaux-data.ts) is coded with the REAL official numbers (e.g.
// "58A" = El Meniaa = wilaya 58), so WILAYAS.indexOf(name) + 1 computed the
// wrong wilayaId for every one of these 10 wilayas -- their bureaux never
// matched the filter and silently vanished from the Stop Desk dropdown.

describe('WILAYAS official numbering (wilayas 49-58)', () => {
  const OFFICIAL_IDS: Record<string, number> = {
    'Timimoun': 49,
    'Bordj Baji Mokhtar': 50,
    'Ouled Djellal': 51,
    'Béni Abbès': 52,
    'In Salah': 53,
    'In Guezzam': 54,
    'Touggourt': 55,
    'Djanet': 56,
    "El M'Ghair": 57,
    'El Meniaa': 58,
  };

  for (const [name, officialId] of Object.entries(OFFICIAL_IDS)) {
    test(`${name} resolves to official wilayaId ${officialId}`, () => {
      expect(WILAYAS.indexOf(name as any) + 1).toBe(officialId);
    });
  }

  test('El Meniaa bureau (58A) is now reachable via the computed wilayaId', () => {
    const wilayaId = WILAYAS.indexOf('El Meniaa' as any) + 1;
    const bureau = NOEST_BUREAUX.find(b => b.code === '58A');
    expect(bureau).toBeDefined();
    expect(bureau!.wilayaId).toBe(wilayaId);
  });

  test('every bureau for wilayas 49-58 matches a real position in WILAYAS', () => {
    const newWilayaBureaux = NOEST_BUREAUX.filter(b => b.wilayaId >= 49 && b.wilayaId <= 58);
    expect(newWilayaBureaux.length).toBeGreaterThan(0);
    for (const b of newWilayaBureaux) {
      expect(WILAYAS[b.wilayaId - 1]).toBeDefined();
    }
  });
});
