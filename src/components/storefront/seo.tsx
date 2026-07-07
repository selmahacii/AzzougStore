'use client';

import { useEffect } from 'react';

interface SEOProps {
  title: string;
  description: string;
  image?: string;
  url?: string;
  productSchema?: {
    name: string;
    description: string;
    image: string;
    sku?: string;
    price: number;
    currency: string;
    availability: string;
    brand: string;
  };
}

export function SEO({ title, description, image, url, productSchema }: SEOProps) {
  useEffect(() => {
    // 1. Update document title
    document.title = title;

    // Helper to find or create meta tag
    const updateMetaTag = (property: string, content: string, attrName: 'property' | 'name' = 'property') => {
      let tag = document.querySelector(`meta[${attrName}="${property}"]`);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute(attrName, property);
        document.head.appendChild(tag);
      }
      tag.setAttribute('content', content);
    };

    // 2. Open Graph Meta Tags
    updateMetaTag('og:title', title);
    updateMetaTag('og:description', description);
    if (image) updateMetaTag('og:image', image);
    if (url) updateMetaTag('og:url', url);
    updateMetaTag('og:type', productSchema ? 'product' : 'website');

    // 3. Twitter Card Meta Tags
    updateMetaTag('twitter:card', 'summary_large_image', 'name');
    updateMetaTag('twitter:title', title, 'name');
    updateMetaTag('twitter:description', description, 'name');
    if (image) updateMetaTag('twitter:image', image, 'name');

    // 4. JSON-LD Structured Data
    let scriptTag = document.getElementById('seo-jsonld') as HTMLScriptElement | null;
    if (!scriptTag) {
      scriptTag = document.createElement('script');
      scriptTag.id = 'seo-jsonld';
      scriptTag.type = 'application/ld+json';
      document.head.appendChild(scriptTag);
    }

    if (productSchema) {
      const schemaData = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: productSchema.name,
        image: productSchema.image,
        description: productSchema.description,
        sku: productSchema.sku || productSchema.name.toLowerCase().replace(/\s+/g, '-'),
        brand: {
          '@type': 'Brand',
          name: productSchema.brand,
        },
        offers: {
          '@type': 'Offer',
          url: url || window.location.href,
          priceCurrency: productSchema.currency,
          price: productSchema.price,
          priceValidUntil: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString().split('T')[0], // 1 year
          itemCondition: 'https://schema.org/NewCondition',
          availability: productSchema.availability === 'in stock' || productSchema.availability === 'in_stock'
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock',
        },
      };
      scriptTag.textContent = JSON.stringify(schemaData);
    } else {
      // General Organization / Website Schema
      const schemaData = {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: title,
        url: url || window.location.href,
        description: description,
      };
      scriptTag.textContent = JSON.stringify(schemaData);
    }

    return () => {
      // Clean up JSON-LD on unmount
      const tag = document.getElementById('seo-jsonld');
      if (tag) tag.remove();
    };
  }, [title, description, image, url, productSchema]);

  return null;
}
