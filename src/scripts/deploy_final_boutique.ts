import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Finalizing High-Fidelity Boutique Data Sync...');

  const storeSlugs = ['mode-bijoux', 'veloce-sport', 'tech-cases-dz'];
  
  const boutiqueData: Record<string, { products: any[], theme: any }> = {
    'mode-bijoux': {
      theme: { primaryColor: '#D4AF37', accentColor: '#1A1A1A', borderRadius: '0px' },
      products: [
        {
          name: "Silver Lotus Necklace",
          slug: "silver-lotus-necklace",
          description: "Artisanal sterling silver necklace with a hand-carved lotus pendant. Symbol of purity and professional precision.",
          price: 12500,
          comparePrice: 15000,
          category: "Necklaces",
          images: ["/images/products/silver-lotus-necklace.png", "https://images.unsplash.com/photo-1599643478140-599fd1639ae7?q=80&w=1200"],
          featured: true,
          variants: [
            { name: "Material", value: "Silver" },
            { name: "Material", value: "Gold" },
            { name: "Material", value: "Rose Gold" }
          ]
        },
        {
          name: "Geometric Gold Bracelet",
          slug: "geometric-gold-bracelet",
          description: "24k gold-plated cuff featuring structural geometric nodes. Industrial elegance defined.",
          price: 8900,
          comparePrice: null,
          category: "Bracelets",
          images: ["/images/products/geometric-gold-bracelet.png", "https://images.unsplash.com/photo-1611591437281-460bfbe1520e?q=80&w=1200"],
          featured: true
        },
        {
          name: "Silk Patterned Scarf",
          slug: "silk-patterned-scarf",
          description: "100% mulberry silk with hand-rolled edges. Features a technical schematic print.",
          price: 5400,
          comparePrice: 7000,
          category: "Accessories",
          images: ["https://images.unsplash.com/photo-1589156206699-bc21e38c8a7d?q=80&w=1200"],
          featured: true,
          variants: [
            { name: "Material", value: "Silver" },
            { name: "Material", value: "Gold" }
          ]
        },
        {
          name: "Ethereal Silver Ring",
          slug: "ethereal-silver-ring",
          description: "Sculptural organic shape. Hand-polished sterling silver for an eternal finish.",
          price: 9500,
          comparePrice: 12000,
          category: "Rings",
          images: ["/images/products/ethereal-silver-ring.png", "https://images.unsplash.com/photo-1627225924765-552d44cfbc72?q=80&w=1200"],
          featured: true,
          variants: [
            { name: "Material", value: "Silver" },
            { name: "Material", value: "Gold" }
          ]
        }
      ]
    },
    'veloce-sport': {
      theme: { primaryColor: '#CF9474', accentColor: '#000000', borderRadius: '2px' },
      products: [
        {
          name: "Hex Dumbbells Set",
          slug: "hex-dumbbells-set",
          description: "Premium rubber-encased hex dumbbells with ergonomic knurled grips. Built for high-intensity deployment.",
          price: 18500,
          comparePrice: 22000,
          category: "Strength",
          images: ["/images/products/hex-dumbbells-set.png", "https://images.unsplash.com/photo-1583454110551-21f2fa2ec617?q=80&w=1200"],
          featured: true
        },
        {
          name: "Smart Yoga Mat",
          slug: "smart-yoga-mat",
          description: "High-density polymers with laser-etched alignment nodes. Superior kinetic stability.",
          price: 6500,
          comparePrice: null,
          category: "Recovery",
          images: ["https://images.unsplash.com/photo-1592419044706-39796d40f98c?q=80&w=1200"],
          featured: true
        },
        {
          name: "Tactical Massage Gun",
          slug: "tactical-massage-gun",
          description: "High-torque percussion recovery unit. 6 speed nodes for deep tissue sync.",
          price: 24500,
          comparePrice: 30000,
          category: "Recovery",
          images: ["/images/products/tactical-massage-gun.png", "https://images.unsplash.com/photo-1596395817112-9856cc651817?q=80&w=1200"],
          featured: true,
          variants: [
            { name: "Color", value: "Black" },
            { name: "Color", value: "Carbon" }
          ]
        },
        {
          name: "Kinetic Running Vest",
          slug: "kinetic-running-vest",
          description: "Tactical weight distribution. 12-point adjustment nodes for zero-bounce performance.",
          price: 18500,
          comparePrice: 22000,
          category: "Apparel",
          images: ["/images/products/kinetic-running-vest.png", "https://images.unsplash.com/photo-1547489432-cf93fa6c71ee?q=80&w=1200"],
          featured: true,
          variants: [
            { name: "Color", value: "Black" },
            { name: "Color", value: "Urban" }
          ]
        }
      ]
    },
    'tech-cases-dz': {
      theme: { primaryColor: '#1A1A1A', accentColor: '#333333', borderRadius: '4px' },
      products: [
        {
          name: "Carbon Armor Case",
          slug: "carbon-fiber-case",
          description: "Real aerospace-grade carbon fiber housing. Impact-resistant polymer core for extreme urban deployments.",
          price: 4500,
          comparePrice: 5500,
          category: "Protection",
          images: ["https://images.unsplash.com/photo-1611206688755-f8ebb94480a4?auto=format&fit=crop&q=80&w=1200"],
          featured: true
        },
        {
          name: "MagSafe Power Node",
          slug: "magsafe-power-node",
          description: "Ultra-slim 10,000mAh magnetic base. Zero-sync latency charging with an industrial matte finish.",
          price: 7800,
          comparePrice: null,
          category: "Energy",
          images: ["https://images.unsplash.com/photo-1622445270947-32dc812224b1?auto=format&fit=crop&q=80&w=1200"],
          featured: true,
          variants: [
            { name: "Color", value: "Titanium" },
            { name: "Color", value: "Stealth Black" }
          ]
        },
        {
          name: "Stealth Audio Nodes",
          slug: "stealth-audio-nodes",
          description: "Active noise-canceling in-ear monitors. Tuned acoustic drivers within a stealth black chassis.",
          price: 12400,
          comparePrice: 15000,
          category: "Audio",
          images: ["https://images.unsplash.com/photo-1590658268037-6bf12165a8df?auto=format&fit=crop&q=80&w=1200"],
          featured: true
        },
        {
          name: "Obsidian Leather Wallet",
          slug: "obsidian-leather-wallet",
          description: "Ultra-slim multi-node card protection. Full-grain leather with carbon-stitch reinforcement.",
          price: 15500,
          comparePrice: 18000,
          category: "Wallets",
          images: ["https://images.unsplash.com/photo-1627993077672-99079c66a4bc?auto=format&fit=crop&q=80&w=1200"],
          featured: true,
          variants: [
            { name: "Color", value: "Black" },
            { name: "Color", value: "Vachetta" }
          ]
        }
      ]
    }
  };

  for (const slug of storeSlugs) {
    const store = await prisma.store.findUnique({ where: { slug } });
    if (!store) continue;

    console.log(`- Refitting Boutique: ${store.name}`);

    // Update Theme
    await prisma.store.update({
      where: { id: store.id },
      data: { themeConfig: JSON.stringify(boutiqueData[slug].theme), isActive: true }
    });

    // Purge old products and re-insert fresh
    await prisma.product.deleteMany({ where: { storeId: store.id } });

    for (const p of boutiqueData[slug].products) {
      await prisma.product.create({
        data: {
          storeId: store.id,
          name: p.name,
          slug: p.slug,
          description: p.description,
          price: p.price,
          comparePrice: p.comparePrice,
          category: p.category,
          images: JSON.stringify(p.images),
          featured: p.featured,
          isActive: true,
          stock: 50,
        }
      });
    }
  }

  console.log('✨ Mission Success: Boutique Inventory Deployed.');
}

main().finally(() => prisma.$disconnect());
