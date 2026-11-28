'use client';

import { useAppStore } from '@/store/app-store';
import { Facebook, Instagram, ShieldCheck, Phone, Mail, MapPin, Truck, RotateCcw, HelpCircle, PackageSearch } from 'lucide-react';
import { toast } from 'sonner';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { resolveTemplate } from '@/lib/template-resolver';

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.32 6.32 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.77 1.52V6.77a4.85 4.85 0 01-1-.08z" />
    </svg>
  );
}

function SocialLinks({ social, color, dark, isClean }: { social: Record<string, string>; color: string; dark?: boolean; isClean?: boolean }) {
  const cls = dark
    ? 'size-8 rounded-none border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors'
    : 'size-8 rounded-none bg-slate-50 border border-slate-200/80 flex items-center justify-center hover:bg-slate-900 text-slate-600 hover:text-white hover:border-slate-900 transition-all duration-200 group';
  const iconCls = dark ? 'size-4 text-white/50' : 'size-3.5 transition-colors';
  return (
    <div className="flex gap-2">
      {social.facebook && (
        <a href={social.facebook} target="_blank" rel="noopener noreferrer" className={cls} title="Facebook">
          <Facebook className={iconCls} />
        </a>
      )}
      {social.instagram && (
        <a href={social.instagram} target="_blank" rel="noopener noreferrer" className={cls} title="Instagram">
          <Instagram className={iconCls} />
        </a>
      )}
      {social.tiktok && (
        <a href={social.tiktok} target="_blank" rel="noopener noreferrer" className={cls} title="TikTok">
          <TikTokIcon className={iconCls} />
        </a>
      )}
    </div>
  );
}

function ContactBlock({ contact, color, dark, isClean }: { contact: Record<string, string>; color: string; dark?: boolean; isClean?: boolean }) {
  const textCls = dark 
    ? 'text-white/80 hover:text-white font-medium text-xs' 
    : 'text-slate-600 hover:text-slate-900 font-semibold text-xs';
  const iconColor = dark ? 'white' : color;
  const hasInfo = contact.phone || contact.email || contact.address;

  if (!hasInfo) {
    return (
      <div className="space-y-2 sm:space-y-2.5">
        <p className={dark ? "text-[11px] sm:text-xs text-white/60 leading-relaxed font-normal" : "text-[11px] sm:text-xs text-slate-500 leading-relaxed font-medium"}>
          Service client et assistance disponibles 7j/7 pour vos commandes et expéditions.
        </p>
        <div className="flex items-center gap-2 pt-0.5 sm:pt-1">
          <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className={dark ? "text-[10px] sm:text-[11px] font-bold text-emerald-400 font-mono uppercase" : "text-[10px] sm:text-[11px] font-bold text-emerald-700 font-mono uppercase"}>
            Support Disponible
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 sm:space-y-2.5">
      {contact.phone && (
        <a href={`tel:${contact.phone}`} className={`flex items-center gap-2 sm:gap-2.5 transition-colors ${textCls}`}>
          <div className="size-5 sm:size-6 rounded-none border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0">
            <Phone className="size-2.5 sm:size-3 shrink-0" style={{ color: iconColor }} />
          </div>
          <span className="text-[11px] sm:text-xs">{contact.phone}</span>
        </a>
      )}
      {contact.email && (
        <a href={`mailto:${contact.email}`} className={`flex items-center gap-2 sm:gap-2.5 transition-colors ${textCls}`}>
          <div className="size-5 sm:size-6 rounded-none border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0">
            <Mail className="size-2.5 sm:size-3 shrink-0" style={{ color: iconColor }} />
          </div>
          <span className="truncate text-[11px] sm:text-xs">{contact.email}</span>
        </a>
      )}
      {contact.address && (
        <div className={`flex items-start gap-2 sm:gap-2.5 ${textCls}`}>
          <div className="size-5 sm:size-6 rounded-none border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0 mt-0.5">
            <MapPin className="size-2.5 sm:size-3 shrink-0" style={{ color: iconColor }} />
          </div>
          <span className="text-[11px] sm:text-xs">{contact.address}</span>
        </div>
      )}
    </div>
  );
}

// SHOP_LINKS and HELP_LINKS are now dynamic (loaded from API/theme_config in the component)
const HELP_LINKS = [
  { label: 'Livraison & délais', icon: Truck },
  { label: 'Retours & échanges', icon: RotateCcw },
  { label: 'Suivi de commande', icon: PackageSearch },
  { label: 'FAQ', icon: HelpCircle },
];

export function StorefrontFooter() {
  const activeStore = useAppStore((s) => s.activeStore);
  const setStorefrontView = useAppStore((s) => s.setStorefrontView);
  const setSelectedCategory = useAppStore((s) => s.setSelectedCategory);
  const [shopLinks, setShopLinks] = useState<string[]>([]);

  const storeName = activeStore?.name ?? 'Ma Boutique';
  const tpl = resolveTemplate(activeStore?.template_id ?? (activeStore?.theme_config?.templateId as string));
  const primary = (activeStore?.theme_config?.primaryColor as string | undefined) ?? '#4b7bec';
  const tagline = activeStore?.theme_config?.footerTagline as string | undefined;
  const copyright = (activeStore?.theme_config?.footerCopyright as string | undefined) ?? `© ${new Date().getFullYear()} ${storeName}. Tous droits réservés.`;
  const rawContact = (activeStore?.theme_config?.contact ?? activeStore?.contact ?? {}) as Record<string, string>;
  const contact: Record<string, string> = {
    phone: (rawContact.phone && !rawContact.phone.includes('778 30 19 20') && !rawContact.phone.includes('778301920')) 
      ? rawContact.phone 
      : '0550 00 00 00',
    email: rawContact.email || 'contact@maboutique.com',
    address: rawContact.address || 'Alger, Algérie',
  };
  const social = (activeStore?.social_links ?? {}) as Record<string, string>;
  const logoUrl = activeStore?.logo_url || activeStore?.logo || (activeStore?.theme_config?.logo as string) || null;

  // Même queryKey que storefront-header.tsx — voir le commentaire là-bas :
  // les deux composants demandaient indépendamment la même liste de
  // catégories via fetch() brut (donc sans cache/dédoublonnage), causant
  // deux appels réseau identiques à chaque chargement de page. React Query
  // fusionne les deux useQuery en un seul appel partagé.
  const { data: categoriesData } = useQuery({
    queryKey: ['store-categories', activeStore?.id],
    queryFn: () => apiFetch<{ categories?: string[] }>(`/api/v1/products?store_id=${activeStore!.id}&pageSize=1&is_active=true&include_categories=true`),
    enabled: !!activeStore?.id,
    staleTime: 10 * 60 * 1000,
  });
  useEffect(() => {
    if (categoriesData?.categories && categoriesData.categories.length > 0) {
      setShopLinks(categoriesData.categories.slice(0, 5));
    }
  }, [categoriesData]);

  const handleHelpAction = (label: string) => {
    if (label === 'Suivi de commande') {
      setStorefrontView('order-tracking');
      return;
    }
    
    const messages: Record<string, string> = {
      'Livraison & délais': 'Livraison standard en 2-5 jours ouvrables partout en Algérie.',
      'Retours & échanges': 'Retours acceptés sous 14 jours si le produit est dans son état original.',
      'FAQ': 'Notre centre d\'aide est disponible 24/7 pour répondre à vos questions.'
    };
    
    toast.info(messages[label] || 'Information bientôt disponible');
  };

  if (tpl === 'clean') {
    return (
      <footer 
        className="w-full bg-white border-t border-slate-200/80 text-slate-800"
        style={{ fontFamily: '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif' }}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-8 lg:py-12">
          <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-12 gap-x-6 sm:gap-x-8 gap-y-4 sm:gap-y-6 lg:gap-10">
            
            {/* Store Brand & Presentation (Full width on mobile, 5 cols on lg) */}
            <div className="col-span-2 lg:col-span-5 space-y-2 sm:space-y-3.5">
              <div className="flex items-center gap-2.5 sm:gap-3">
                <div className="size-9 sm:size-11 rounded-none bg-white border border-slate-200/80 p-1 flex items-center justify-center shrink-0 shadow-2xs">
                  {logoUrl ? (
                    <img src={logoUrl} alt={storeName} className="h-full w-full object-contain" />
                  ) : (
                    <span className="text-xs sm:text-sm font-black text-white size-full rounded-none flex items-center justify-center uppercase" style={{ backgroundColor: primary }}>
                      {storeName.charAt(0)}
                    </span>
                  )}
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-extrabold uppercase tracking-tight text-slate-900">{storeName}</h3>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[9px] font-black uppercase tracking-wider text-emerald-600 font-mono">Boutique Officielle</span>
                  </div>
                </div>
              </div>

              <p className="text-[11px] sm:text-xs text-slate-500 leading-relaxed font-medium max-w-sm">
                {tagline || "Votre vitrine e-commerce de référence. Produits certifiés, finitions soignées et service client réactif."}
              </p>

              {/* Social Links */}
              <div className="pt-0.5 sm:pt-2">
                <SocialLinks social={social} color={primary} />
              </div>
            </div>

            {/* Catalog Collections (Gauche / Left on mobile: col-span-1) */}
            <div className="col-span-1 lg:col-span-2 space-y-2 sm:space-y-3.5">
              <h4 className="text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-slate-900">Collections</h4>
              <ul className="space-y-1 sm:space-y-2">
                {shopLinks.length > 0 ? shopLinks.map(l => (
                  <li key={l}>
                    <button 
                      onClick={() => { setSelectedCategory(l); setStorefrontView('shop'); }} 
                      className="text-[11px] sm:text-xs font-semibold text-slate-600 hover:text-[#4b7bec] transition-colors text-left cursor-pointer truncate max-w-full block"
                    >
                      {l}
                    </button>
                  </li>
                )) : null}
                <li>
                  <button 
                    onClick={() => { setSelectedCategory(null); setStorefrontView('shop'); }} 
                    className="text-[11px] sm:text-xs font-bold text-[#4b7bec] hover:underline transition-colors text-left cursor-pointer inline-flex items-center gap-1"
                  >
                    Tout voir →
                  </button>
                </li>
              </ul>
            </div>

            {/* Customer Service (Droite / Right on mobile: col-span-1) */}
            <div className="col-span-1 lg:col-span-2 space-y-2 sm:space-y-3.5">
              <h4 className="text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-slate-900">Assistance</h4>
              <ul className="space-y-1 sm:space-y-2">
                {HELP_LINKS.map(l => (
                  <li key={l.label}>
                    <button 
                      onClick={() => handleHelpAction(l.label)} 
                      className="w-full flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs font-semibold text-slate-600 hover:text-slate-950 transition-colors text-left cursor-pointer"
                    >
                      <l.icon className="size-3 sm:size-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{l.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* Contact Details (Full width on mobile: col-span-2, 3 cols on lg) */}
            <div className="col-span-2 md:col-span-2 lg:col-span-3 space-y-2 sm:space-y-3.5 pt-3 sm:pt-0 border-t border-slate-100 sm:border-0">
              <h4 className="text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-slate-900">Coordonnées</h4>
              <ContactBlock contact={contact} color={primary} />
            </div>

          </div>

          {/* Bottom Bar - Clean, Minimalist & Balanced */}
          <div className="mt-6 sm:mt-10 lg:mt-12 pt-3.5 sm:pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-2.5 sm:gap-4">
            <p className="text-[11px] sm:text-xs font-medium text-slate-400 text-center sm:text-left">
              {copyright}
            </p>

            <div className="flex items-center gap-2 sm:gap-3 text-[10px] sm:text-xs font-medium text-slate-400 flex-wrap justify-center">
              <span>Paiement sécurisé</span>
              <span>•</span>
              <span>Vérification à la livraison</span>
              <span>•</span>
              <span>Support 7j/7</span>
            </div>
          </div>

        </div>
      </footer>
    );
  }

  if (tpl === 'luxe') {
    return (
      <footer className="w-full text-white border-t relative overflow-hidden" style={{ backgroundColor: primary, backgroundImage: `radial-gradient(circle at 0% 0%, rgba(255,255,255,0.1) 0%, transparent 50%), radial-gradient(circle at 100% 100%, rgba(0,0,0,0.2) 0%, transparent 50%)`, borderColor: 'rgba(255,255,255,0.2)' }}>
        <div className="mx-auto max-w-[1800px] px-6 sm:px-12 py-12 sm:pt-24 sm:pb-12">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 md:gap-12 lg:gap-20 mb-12 sm:mb-20">
            <div className="space-y-8">
              {logoUrl ? <div className="h-16 w-auto flex items-center"><img src={logoUrl} alt={storeName} className="h-full w-auto object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /></div> : <div className="flex flex-col gap-2"><span className="text-3xl tracking-[0.05em] font-serif font-medium text-white" style={{ fontFamily: '"Playfair Display", Didot, serif' }}>{storeName}</span><div className="h-0.5 w-10 bg-white" /></div>}
              {tagline && <p className="text-sm font-medium text-white/90 leading-relaxed max-w-xs">{tagline}</p>}
              <SocialLinks social={social} color="white" dark />
            </div>
            <div className="space-y-8">
              <h4 className="text-[11px] font-black uppercase tracking-[0.4em] text-white">Catalogue</h4>
              <ul className="space-y-4">
                {shopLinks.length > 0 ? shopLinks.map(l => (
                   <li key={l}><button onClick={() => { setSelectedCategory(l); setStorefrontView('shop'); }} className="text-sm font-bold text-white hover:opacity-80 transition-all hover:translate-x-1">{l}</button></li>
                )) : (
                  <li><button onClick={() => setStorefrontView('shop')} className="text-sm font-bold text-white hover:opacity-80 transition-all">Voir le catalogue</button></li>
                )}
              </ul>
            </div>
            <div className="space-y-8">
              <h4 className="text-[11px] font-black uppercase tracking-[0.4em] text-white">Assistance</h4>
              <ul className="space-y-4">
                {HELP_LINKS.map(l => (
                   <li key={l.label}><button onClick={() => handleHelpAction(l.label)} className="group flex items-center gap-3 text-sm font-bold text-white hover:opacity-80 transition-all hover:translate-x-1"><l.icon className="size-4 shrink-0 transition-colors text-white" />{l.label}</button></li>
                ))}
              </ul>
            </div>
            <div className="space-y-8">
              <h4 className="text-[10px] font-black uppercase tracking-[0.4em]" style={{ color: 'white' }}>Contact</h4>
              <ContactBlock contact={contact} color="white" dark />
            </div>
          </div>
          <div className="pt-10 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/20">{copyright}</p>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer 
      className="w-full bg-[#0A0D14] text-white border-t border-slate-800/80" 
      style={{ fontFamily: '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif' }}
    >
      <div className="mx-auto max-w-[1600px] px-4 sm:px-8 lg:px-12 py-6 sm:py-10 lg:py-14">
        
        {/* Main Footer Cards Grid */}
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-12 gap-x-4 sm:gap-x-6 gap-y-4 sm:gap-y-6 mb-6 sm:mb-10 lg:mb-12">
          
          {/* Store Brand Card (Full width on mobile, 4 cols on lg) */}
          <div className="col-span-2 lg:col-span-4 bg-white/[0.04] rounded-2xl border border-white/10 p-4 sm:p-6 flex flex-col justify-between space-y-3.5 sm:space-y-5">
            <div className="space-y-2.5 sm:space-y-3.5">
              <div className="flex items-center gap-2.5 sm:gap-3">
                <div className="size-9 sm:size-11 rounded-2xl bg-white/10 border border-white/10 p-1 flex items-center justify-center shrink-0">
                  {logoUrl ? (
                    <img src={logoUrl} alt={storeName} className="h-full w-full object-contain" />
                  ) : (
                    <span className="text-xs sm:text-sm font-black text-white size-full rounded-xl flex items-center justify-center uppercase" style={{ backgroundColor: primary }}>
                      {storeName.charAt(0)}
                    </span>
                  )}
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-extrabold uppercase tracking-tight text-white">{storeName}</h3>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[9px] font-black uppercase tracking-wider text-emerald-400 font-mono">Boutique Officielle</span>
                  </div>
                </div>
              </div>

              <p className="text-[11px] sm:text-xs text-white/60 leading-relaxed font-medium">
                {tagline || "Votre vitrine e-commerce de référence. Produits certifiés, finitions soignées et expédition rapide dans les 58 wilayas."}
              </p>
            </div>

            {/* Social Links */}
            <div className="pt-2 sm:pt-3 border-t border-white/10 flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-white/40">Réseaux</span>
              <SocialLinks social={social} color={primary} dark />
            </div>
          </div>

          {/* Catalog Collections Card (Gauche / Left on mobile: col-span-1, 3 cols on lg) */}
          <div className="col-span-1 lg:col-span-3 bg-white/[0.04] rounded-2xl border border-white/10 p-3.5 sm:p-6 space-y-2.5 sm:space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-2 sm:pb-3">
              <h4 className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-white">Collections</h4>
              <button 
                onClick={() => { setSelectedCategory(null); setStorefrontView('shop'); }}
                className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-[#4b7bec] hover:underline cursor-pointer"
              >
                Tout voir
              </button>
            </div>
            <ul className="space-y-1 sm:space-y-2">
              {shopLinks.length > 0 ? shopLinks.map(l => (
                <li key={l}>
                  <button 
                    onClick={() => { setSelectedCategory(l); setStorefrontView('shop'); }} 
                    className="w-full flex items-center justify-between py-0.5 sm:py-1 text-[11px] sm:text-xs font-semibold text-white/70 hover:text-white transition-colors group text-left cursor-pointer truncate"
                  >
                    <span className="truncate">{l}</span>
                    <span className="text-white/30 group-hover:text-white transition-colors ml-1">›</span>
                  </button>
                </li>
              )) : (
                <li>
                  <button 
                    onClick={() => { setSelectedCategory(null); setStorefrontView('shop'); }} 
                    className="w-full flex items-center justify-between py-0.5 sm:py-1 text-[11px] sm:text-xs font-semibold text-white/70 hover:text-white transition-colors group text-left cursor-pointer"
                  >
                    <span>Catalogue</span>
                    <span className="text-white/30 group-hover:text-white transition-colors">›</span>
                  </button>
                </li>
              )}
            </ul>
          </div>

          {/* Customer Service Card (Droite / Right on mobile: col-span-1, 2 cols on lg) */}
          <div className="col-span-1 lg:col-span-2 bg-white/[0.04] rounded-2xl border border-white/10 p-3.5 sm:p-6 space-y-2.5 sm:space-y-4">
            <div className="border-b border-white/10 pb-2 sm:pb-3">
              <h4 className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-white">Assistance</h4>
            </div>
            <ul className="space-y-1 sm:space-y-2">
              {HELP_LINKS.map(l => (
                <li key={l.label}>
                  <button 
                    onClick={() => handleHelpAction(l.label)} 
                    className="w-full flex items-center gap-1.5 sm:gap-2 py-0.5 sm:py-1 text-[11px] sm:text-xs font-semibold text-white/70 hover:text-white transition-colors text-left cursor-pointer"
                  >
                    <l.icon className="size-3 sm:size-3.5 text-white/40 shrink-0" />
                    <span className="truncate">{l.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact Card (Full width on mobile: col-span-2, 3 cols on lg) */}
          <div className="col-span-2 md:col-span-2 lg:col-span-3 bg-white/[0.04] rounded-2xl border border-white/10 p-3.5 sm:p-6 space-y-2.5 sm:space-y-4">
            <div className="border-b border-white/10 pb-2 sm:pb-3">
              <h4 className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-white">Coordonnées</h4>
            </div>
            <ContactBlock contact={contact} color={primary} dark />
          </div>

        </div>

        {/* Bottom Bar */}
        <div className="pt-4 sm:pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-2.5 sm:gap-4">
          <p className="text-[11px] sm:text-xs font-medium text-white/40 text-center sm:text-left">
            {copyright}
          </p>

          <div className="flex items-center gap-2 sm:gap-3 text-[10px] sm:text-xs font-medium text-white/40 flex-wrap justify-center">
            <span>Paiement sécurisé</span>
            <span>•</span>
            <span>Vérification à la livraison</span>
            <span>•</span>
            <span>Support 7j/7</span>
          </div>
        </div>

      </div>
    </footer>
  );
}
