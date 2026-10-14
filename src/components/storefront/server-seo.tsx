import React from 'react';

interface ServerSeoProps {
  title: string;
  description: string;
  image?: string | null;
  url?: string;
  productSchema?: {
    name: string;
    description: string;
    image: string;
    sku?: string;
    price?: number | string;
    currency?: string;
    availability?: string;
    brand?: string;
  };
}

export function ServerSeo({ title, description, image, url, productSchema }: ServerSeoProps) {
  const canonicalUrl = url || '';
  const imageUrl = image || productSchema?.image || '';
  const productTitle = productSchema ? `${productSchema.name} | ${title}` : title;
  const productDescription = productSchema?.description || description;
  const productAvailability = productSchema?.availability === 'in stock' || productSchema?.availability === 'in_stock'
    ? 'https://schema.org/InStock'
    : 'https://schema.org/OutOfStock';

  const schemaData = productSchema ? {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: productSchema.name,
    image: imageUrl ? [imageUrl] : [],
    description: productDescription,
    sku: productSchema.sku || productSchema.name.toLowerCase().replace(/\s+/g, '-'),
    brand: productSchema.brand ? { '@type': 'Brand', name: productSchema.brand } : undefined,
    offers: {
      '@type': 'Offer',
      url: canonicalUrl,
      priceCurrency: productSchema.currency || 'DZD',
      price: productSchema.price ?? 0,
      availability: productAvailability,
    },
  } : {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: title,
    url: canonicalUrl,
    description,
  };

  return (
    <>
      <title>{productTitle}</title>
      <meta name="description" content={productDescription} />
      <meta property="og:title" content={productTitle} />
      <meta property="og:description" content={productDescription} />
      <meta property="og:type" content={productSchema ? 'product' : 'website'} />
      {canonicalUrl ? <meta property="og:url" content={canonicalUrl} /> : null}
      {imageUrl ? <meta property="og:image" content={imageUrl} /> : null}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={productTitle} />
      <meta name="twitter:description" content={productDescription} />
      {imageUrl ? <meta name="twitter:image" content={imageUrl} /> : null}
      {canonicalUrl ? <link rel="canonical" href={canonicalUrl} /> : null}
      <link rel="preconnect" href="https://res.cloudinary.com" crossOrigin="anonymous" />
      <link rel="preconnect" href="https://connect.facebook.net" crossOrigin="anonymous" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schemaData) }} />
    </>
  );
}
