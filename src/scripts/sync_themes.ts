import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🎨 Refining Store Themes...');

  // Mode & Bijoux - Sophisticated Gold/Silk theme
  await prisma.store.update({
    where: { slug: 'mode-bijoux' },
    data: {
      themeConfig: JSON.stringify({
        primaryColor: '#B8860B', // Dark Goldenrod
        accentColor: '#DAA520', // Goldenrod
        borderRadius: '2px',
        fontFamily: 'Inter'
      }),
      description: "Artisanal jewelry and premium fashion accessories crafted with technical precision and timeless elegance."
    }
  });

  // Tech Cases DZ - Sleek Carbon/Tactical theme
  await prisma.store.update({
    where: { slug: 'tech-cases-dz' },
    data: {
      themeConfig: JSON.stringify({
        primaryColor: '#1A1A1A', // Jet Black
        accentColor: '#333333', // Dark Grey
        borderRadius: '0px',
        fontFamily: 'Inter'
      }),
      description: "Stealth-grade protection for your technical deployments. Carbon fiber coques, high-speed charging nodes, and audio gear."
    }
  });

  // Veloce Sport - High-Performance Kinetic theme
  await prisma.store.update({
    where: { slug: 'veloce-sport' },
    data: {
      themeConfig: JSON.stringify({
        primaryColor: '#D4AF37', // Whiskey/Bronze (Existing Ekster)
        accentColor: '#000000',
        borderRadius: '4px',
        fontFamily: 'Inter'
      }),
      description: "Engineered for high-impact kinetic performance. Pro-grade fitness equipment and recovery logistics."
    }
  });

  console.log('✨ Themes Synchronized!');
}

main().finally(() => prisma.$disconnect());
