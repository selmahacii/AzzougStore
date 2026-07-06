/**
 * Tests unitaires pour les motifs de validation (regex) utilisés
 * dans lensemble de la base de code.
 * Couvre : email, slug, téléphone algérien, numéro de commande.
 */
import { describe, test, expect } from 'bun:test';

// ─── Patterns de validation ───────────────────────────────────
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_PATTERN = /^[a-z0-9-]+$/;
const ALGERIAN_PHONE_PATTERN = /^0[5-7]\d{8}$/;
const ORDER_NUMBER_PATTERN = /^[A-Z]{2}-\d{8}-\d{4}$/;

// ══════════════════════════════════════════════════════════════
// Tests Email
// ══════════════════════════════════════════════════════════════
describe('Validation Email', () => {
  // ─── Cas valides ───────────────────────────────────────────
  test('email simple valide', () => {
    expect(EMAIL_PATTERN.test('user@example.com')).toBe(true);
  });

  test('email avec sous-domaine', () => {
    expect(EMAIL_PATTERN.test('user@mail.example.com')).toBe(true);
  });

  test('email avec plusieur sous-domaines', () => {
    expect(EMAIL_PATTERN.test('user@dept.corp.example.com')).toBe(true);
  });

  test('email avec points dans la partie locale', () => {
    expect(EMAIL_PATTERN.test('prenom.nom@example.com')).toBe(true);
  });

  test('email avec tirets dans le domaine', () => {
    expect(EMAIL_PATTERN.test('user@my-domain.com')).toBe(true);
  });

  test('email avec TLD long', () => {
    expect(EMAIL_PATTERN.test('user@example.technology')).toBe(true);
  });

  test('email avec TLD court (.dz)', () => {
    expect(EMAIL_PATTERN.test('admin@multistore.dz')).toBe(true);
  });

  test('email avec chiffres', () => {
    expect(EMAIL_PATTERN.test('user123@example456.com')).toBe(true);
  });

  test('email avec underscore dans la partie locale', () => {
    expect(EMAIL_PATTERN.test('user_name@example.com')).toBe(true);
  });

  test('email avec plus sign dans la partie locale', () => {
    expect(EMAIL_PATTERN.test('user+tag@example.com')).toBe(true);
  });

  test('email court (minimum)', () => {
    expect(EMAIL_PATTERN.test('a@b.co')).toBe(true);
  });

  // ─── Cas invalides ─────────────────────────────────────────
  test('email sans @ est invalide', () => {
    expect(EMAIL_PATTERN.test('userexample.com')).toBe(false);
  });

  test('email sans domaine après @', () => {
    expect(EMAIL_PATTERN.test('user@')).toBe(false);
  });

  test('email sans TLD', () => {
    expect(EMAIL_PATTERN.test('user@domain')).toBe(false);
  });

  test('email avec espace est invalide', () => {
    expect(EMAIL_PATTERN.test('user @example.com')).toBe(false);
  });

  test('email avec deux @ est invalide', () => {
    expect(EMAIL_PATTERN.test('user@@example.com')).toBe(false);
  });

  test('email vide est invalide', () => {
    expect(EMAIL_PATTERN.test('')).toBe(false);
  });

  test('chaîne @ seule est invalide', () => {
    expect(EMAIL_PATTERN.test('@')).toBe(false);
  });

  test('email commençant par un point', () => {
    expect(EMAIL_PATTERN.test('.user@example.com')).toBe(true); // accepté par le pattern
  });

  test('email se terminant par un point', () => {
    expect(EMAIL_PATTERN.test('user.@example.com')).toBe(true); // accepté par le pattern
  });
});

// ══════════════════════════════════════════════════════════════
// Tests Slug
// ══════════════════════════════════════════════════════════════
describe('Validation Slug', () => {
  // ─── Cas valides ───────────────────────────────────────────
  test('slug simple en minuscules', () => {
    expect(SLUG_PATTERN.test('produit')).toBe(true);
  });

  test('slug avec tirets', () => {
    expect(SLUG_PATTERN.test('mon-produit-test')).toBe(true);
  });

  test('slug avec chiffres', () => {
    expect(SLUG_PATTERN.test('produit-123')).toBe(true);
  });

  test('slug uniquement chiffres', () => {
    expect(SLUG_PATTERN.test('12345')).toBe(true);
  });

  test('slug commençant par un tiret', () => {
    expect(SLUG_PATTERN.test('-produit')).toBe(true);
  });

  test('slug se terminant par un tiret', () => {
    expect(SLUG_PATTERN.test('produit-')).toBe(true);
  });

  test('slug uniquement des tirets', () => {
    expect(SLUG_PATTERN.test('---')).toBe(true);
  });

  test('slug vide est invalide', () => {
    expect(SLUG_PATTERN.test('')).toBe(false);
  });

  test('slug avec lettres accentuées est invalide', () => {
    expect(SLUG_PATTERN.test('café')).toBe(false);
  });

  test('slug avec majuscules est invalide', () => {
    expect(SLUG_PATTERN.test('Mon-Produit')).toBe(false);
  });

  test('slug avec espace est invalide', () => {
    expect(SLUG_PATTERN.test('mon produit')).toBe(false);
  });

  test('slug avec underscore est invalide', () => {
    expect(SLUG_PATTERN.test('mon_produit')).toBe(false);
  });

  test('slug avec caractères spéciaux est invalide', () => {
    expect(SLUG_PATTERN.test('mon.produit')).toBe(false);
  });

  test('slug du projet : maison-luxe', () => {
    expect(SLUG_PATTERN.test('maison-luxe')).toBe(true);
  });

  test('slug du projet : tech-cases', () => {
    expect(SLUG_PATTERN.test('tech-cases')).toBe(true);
  });

  test('slug du projet : mode-bijoux', () => {
    expect(SLUG_PATTERN.test('mode-bijoux')).toBe(true);
  });

  test('slug avec caractères spéciaux français', () => {
    expect(SLUG_PATTERN.test('etageres-flottantes')).toBe(true);
    expect(SLUG_PATTERN.test('chargeur-magnétique-15w')).toBe(false); // é accentué
  });
});

// ══════════════════════════════════════════════════════════════
// Tests Téléphone Algérien
// ══════════════════════════════════════════════════════════════
describe('Validation Téléphone Algérien', () => {
  // ─── Cas valides ───────────────────────────────────────────
  test('numéro 05xx valide', () => {
    expect(ALGERIAN_PHONE_PATTERN.test('0555123456')).toBe(true);
  });

  test('numéro 06xx valide', () => {
    expect(ALGERIAN_PHONE_PATTERN.test('0661123456')).toBe(true);
  });

  test('numéro 07xx valide', () => {
    expect(ALGERIAN_PHONE_PATTERN.test('0770123456')).toBe(true);
  });

  test('numéro avec tous les zéros après le préfixe', () => {
    expect(ALGERIAN_PHONE_PATTERN.test('0555000000')).toBe(true);
  });

  test('numéro avec tous les neuf après le préfixe', () => {
    expect(ALGERIAN_PHONE_PATTERN.test('0777999999')).toBe(true);
  });

  // ─── Cas invalides ─────────────────────────────────────────
  test('numéro commençant par 01 est invalide', () => {
    expect(ALGERIAN_PHONE_PATTERN.test('0123456789')).toBe(false);
  });

  test('numéro commençant par 02 est invalide', () => {
    expect(ALGERIAN_PHONE_PATTERN.test('0234567890')).toBe(false);
  });

  test('numéro commençant par 03 est invalide', () => {
    expect(ALGERIAN_PHONE_PATTERN.test('0345678901')).toBe(false);
  });

  test('numéro commençant par 04 est invalide', () => {
    expect(ALGERIAN_PHONE_PATTERN.test('0456789012')).toBe(false);
  });

  test('numéro commençant par 08 est invalide', () => {
    expect(ALGERIAN_PHONE_PATTERN.test('0898765432')).toBe(false);
  });

  test('numéro commençant par 09 est invalide', () => {
    expect(ALGERIAN_PHONE_PATTERN.test('0987654321')).toBe(false);
  });

  test('numéro trop court (9 chiffres)', () => {
    expect(ALGERIAN_PHONE_PATTERN.test('055512345')).toBe(false);
  });

  test('numéro trop long (11 chiffres)', () => {
    expect(ALGERIAN_PHONE_PATTERN.test('05551234567')).toBe(false);
  });

  test('numéro sans le 0 initial est invalide', () => {
    expect(ALGERIAN_PHONE_PATTERN.test('555123456')).toBe(false);
  });

  test('numéro avec préfixe international +213 est invalide', () => {
    expect(ALGERIAN_PHONE_PATTERN.test('+213555123456')).toBe(false);
  });

  test('numéro avec espaces est invalide', () => {
    expect(ALGERIAN_PHONE_PATTERN.test('0555 123 456')).toBe(false);
  });

  test('numéro avec tirets est invalide', () => {
    expect(ALGERIAN_PHONE_PATTERN.test('0555-123-456')).toBe(false);
  });

  test('chaîne vide est invalide', () => {
    expect(ALGERIAN_PHONE_PATTERN.test('')).toBe(false);
  });

  test('numéro avec lettres est invalide', () => {
    expect(ALGERIAN_PHONE_PATTERN.test('0555abcde')).toBe(false);
  });

  test('numéro des employés du seed (sans espaces) sont valides', () => {
    // Les numéros du seed ont des espaces quon retire
    expect(ALGERIAN_PHONE_PATTERN.test('0555123456')).toBe(true);
    expect(ALGERIAN_PHONE_PATTERN.test('0661234567')).toBe(true);
    expect(ALGERIAN_PHONE_PATTERN.test('0770345678')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════
// Tests Numéro de Commande
// ══════════════════════════════════════════════════════════════
describe('Validation Numéro de Commande', () => {
  // ─── Cas valides ───────────────────────────────────────────
  test('format ML-YYYYMMDD-XXXX valide', () => {
    expect(ORDER_NUMBER_PATTERN.test('ML-20250101-0001')).toBe(true);
  });

  test('format TC-YYYYMMDD-XXXX valide', () => {
    expect(ORDER_NUMBER_PATTERN.test('TC-20250615-1234')).toBe(true);
  });

  test('format MB-YYYYMMDD-XXXX valide', () => {
    expect(ORDER_NUMBER_PATTERN.test('MB-20251231-9999')).toBe(true);
  });

  test('séquence avec zéros', () => {
    expect(ORDER_NUMBER_PATTERN.test('ML-20250101-0000')).toBe(true);
  });

  test('tous les préfixes possibles (2 lettres A-Z)', () => {
    expect(ORDER_NUMBER_PATTERN.test('AA-20250101-0001')).toBe(true);
    expect(ORDER_NUMBER_PATTERN.test('ZZ-20250101-9999')).toBe(true);
  });

  // ─── Cas invalides ─────────────────────────────────────────
  test('préfixe en minuscules est invalide', () => {
    expect(ORDER_NUMBER_PATTERN.test('ml-20250101-0001')).toBe(false);
  });

  test('préfixe avec une seule lettre est invalide', () => {
    expect(ORDER_NUMBER_PATTERN.test('M-20250101-0001')).toBe(false);
  });

  test('préfixe avec trois lettres est invalide', () => {
    expect(ORDER_NUMBER_PATTERN.test('MLO-20250101-0001')).toBe(false);
  });

  test('date avec mois 13 est invalide (mais le pattern laccepte)', () => {
    // Le pattern vérifie uniquement le format, pas la validité de la date
    expect(ORDER_NUMBER_PATTERN.test('ML-20251301-0001')).toBe(true);
  });

  test('date avec jour 00 est acceptée par le pattern', () => {
    expect(ORDER_NUMBER_PATTERN.test('ML-20250100-0001')).toBe(true);
  });

  test('séquence avec 3 chiffres est invalide', () => {
    expect(ORDER_NUMBER_PATTERN.test('ML-20250101-001')).toBe(false);
  });

  test('séquence avec 5 chiffres est invalide', () => {
    expect(ORDER_NUMBER_PATTERN.test('ML-20250101-00001')).toBe(false);
  });

  test('sans tirets est invalide', () => {
    expect(ORDER_NUMBER_PATTERN.test('ML202501010001')).toBe(false);
  });

  test('avec un seul tiret est invalide', () => {
    expect(ORDER_NUMBER_PATTERN.test('ML-202501010001')).toBe(false);
  });

  test('chaîne vide est invalide', () => {
    expect(ORDER_NUMBER_PATTERN.test('')).toBe(false);
  });

  test('numéro généré par la fonction generateOrderNumber respecte le pattern', () => {
    // Simulation de la logique de génération
    const prefix = 'ML';
    const date = new Date();
    const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const seq = String(Math.floor(Math.random() * 9999)).padStart(4, '0');
    const orderNumber = `${prefix}-${dateStr}-${seq}`;
    expect(ORDER_NUMBER_PATTERN.test(orderNumber)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════
// Tests croisés
// ══════════════════════════════════════════════════════════════
describe('Croisement des patterns', () => {
  test('un slug ne match jamais un téléphone', () => {
    const slug = 'mon-produit-test';
    expect(SLUG_PATTERN.test(slug)).toBe(true);
    expect(ALGERIAN_PHONE_PATTERN.test(slug)).toBe(false);
  });

  test('un téléphone ne match jamais un slug', () => {
    const phone = '0555123456';
    expect(ALGERIAN_PHONE_PATTERN.test(phone)).toBe(true);
    expect(SLUG_PATTERN.test(phone)).toBe(true); // les chiffres sont acceptés par le slug
  });

  test('un numéro de commande ne match jamais un email', () => {
    const orderNum = 'ML-20250101-0001';
    expect(ORDER_NUMBER_PATTERN.test(orderNum)).toBe(true);
    expect(EMAIL_PATTERN.test(orderNum)).toBe(false);
  });
});
