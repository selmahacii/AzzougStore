import { db } from '@/lib/db';

/**
 * Minimal seed — crée uniquement le compte SUPER_ADMIN.
 * Aucune donnée de démonstration, aucun mock data.
 * Toutes les données (boutiques, produits, commandes...) sont créées
 * directement par l'utilisateur via l'interface d'administration.
 */
export async function seedDatabase() {
  console.log('🌱 Seed démarré — création du compte administrateur...');

  // Vérifier si le compte admin existe déjà
  const existing = await db.user.findFirst({
    where: { role: 'SUPER_ADMIN' },
  });

  if (existing) {
    console.log(`✅ Compte admin déjà présent : ${existing.email}`);
    return;
  }

  // Créer le compte SUPER_ADMIN
  const bcrypt = await import('bcryptjs');
  const adminHash = await bcrypt.hash('Admin123!', 12);

  const admin = await db.user.create({
    data: {
      email: 'admin@azzougshop.com',
      name: 'Admin AzzougShop',
      passwordHash: adminHash,
      role: 'SUPER_ADMIN',
      isActive: true,
      createdAt: new Date(),
    },
  });

  console.log(`✅ Compte admin créé : ${admin.email}`);
  console.log('   Mot de passe par défaut : Admin123!');
  console.log('   ⚠️  Changez ce mot de passe dès la première connexion.');
  console.log('🎉 Seed terminé.');
}
