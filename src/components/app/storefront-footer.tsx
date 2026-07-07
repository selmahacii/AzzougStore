'use client';

import { useAppStore } from '@/store/app-store';
import { Facebook, Instagram, ShieldCheck, Phone, Mail, MapPin, Truck, RotateCcw, HelpCircle, PackageSearch } from 'lucide-react';
import { toast } from 'sonner';
import { useState, useEffect } from 'react';

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.32 6.32 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.77 1.52V6.77a4.85 4.85 0 01-1-.08z" />
    </svg>
  );
}

function SocialLinks({ social, color, dark, isClean }: { social: Record<string, string>; color: string; dark?: boolean; isClean?: boolean }) {
  const cls = isClean
    ? 'size-8 rounded-none border border-neutral-200 flex items-center justify-center hover:border-neutral-950 hover:bg-neutral-950 transition-all duration-300 group'
    : dark
      ? 'size-9 rounded-xl border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors'
      : 'size-9 rounded-xl border border-slate-200 flex items-center justify-center hover:border-slate-400 transition-colors';
  const iconCls = isClean ? 'size-3.5 text-neutral-500 group-hover:text-white transition-colors' : dark ? 'size-4 text-white/50' : 'size-4 text-slate-500';
  return (
    <div className="flex gap-2">
      {social.facebook && (
        <a href={social.facebook} target="_blank" rel="noopener noreferrer" className={cls}>
          <Facebook className={iconCls} />
        </a>
      )}
      {social.instagram && (
        <a href={social.instagram} target="_blank" rel="noopener noreferrer" className={cls}>
          <Instagram className={iconCls} />
        </a>
      )}
      {social.tiktok && (
        <a href={social.tiktok} target="_blank" rel="noopener noreferrer" className={cls}>
          <TikTokIcon className={iconCls} />
        </a>
      )}
    </div>
  );
}

function ContactBlock({ contact, color, dark, isClean }: { contact: Record<string, string>; color: string; dark?: boolean; isClean?: boolean }) {
  const textCls = isClean 
    ? 'text-neutral-500 hover:text-neutral-900 font-light text-xs' 
    : dark 
      ? 'text-white/80 hover:text-white font-medium' 
      : 'text-slate-500 hover:text-slate-800';
  const iconColor = isClean ? '#737373' : dark ? 'white' : color;
  return (
    <div className="space-y-3.5">
      {contact.phone && (
        <a href={`tel:${contact.phone}`} className={`flex items-center gap-3 transition-colors ${textCls}`}>
          <Phone className="size-3.5 shrink-0" style={{ color: iconColor }} />
          {contact.phone}
        </a>
      )}
      {contact.email && (
        <a href={`mailto:${contact.email}`} className={`flex items-center gap-3 transition-colors ${textCls}`}>
          <Mail className="size-3.5 shrink-0" style={{ color: iconColor }} />
          {contact.email}
        </a>
      )}
      {contact.address && (
        <p className={`flex items-start gap-3 ${textCls}`}>
          <MapPin className="size-3.5 shrink-0 mt-0.5" style={{ color: iconColor }} />
          {contact.address}
        </p>
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
  const tpl = ((activeStore?.template_id ?? activeStore?.theme_config?.templateId ?? 'clean') as string).toLowerCase();
  const primary = (activeStore?.theme_config?.primaryColor as string | undefined) ?? '#4b7bec';
  const tagline = activeStore?.theme_config?.footerTagline as string | undefined;
  const copyright = (activeStore?.theme_config?.footerCopyright as string | undefined) ?? `© ${new Date().getFullYear()} ${storeName}. Tous droits réservés.`;
  const contact = (activeStore?.theme_config?.contact ?? activeStore?.contact ?? {}) as Record<string, string>;
  const social = (activeStore?.social_links ?? {}) as Record<string, string>;
  const logoUrl = activeStore?.logo_url || activeStore?.logo || (activeStore?.theme_config?.logo as string) || null;

  // Load real categories from the products API
  useEffect(() => {
    if (!activeStore?.id) return;
    fetch(`/api/v1/products?store_id=${activeStore.id}&pageSize=1&is_active=true`)
      .then(r => r.json())
      .then(json => {
        if (json.categories && json.categories.length > 0) {
          setShopLinks(json.categories.slice(0, 5));
        }
      })
      .catch(() => {});
  }, [activeStore?.id]);

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
      <footer className="w-full bg-neutral-50/50 border-t border-neutral-100">
        <div className="mx-auto max-w-[1600px] px-6 sm:px-12 py-12 sm:pt-24 sm:pb-12">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 sm:gap-16 mb-12 sm:mb-20">
            <div className="sm:col-span-2 lg:col-span-1 space-y-6">
              <div className="flex flex-col gap-2">
                {logoUrl ? (
                  <img src={logoUrl} alt={storeName} className="h-10 w-auto object-contain self-start" />
                ) : (
                  <span className="text-xl font-light uppercase tracking-[0.2em] text-neutral-900" style={{ fontFamily: '"Plus Jakarta Sans", sans-serif' }}>
                    {storeName}
                  </span>
                )}
              </div>
              {tagline && <p className="text-xs text-neutral-500 leading-relaxed max-w-xs font-light">{tagline}</p>}
              <div className="flex gap-3 pt-2">
                <SocialLinks social={social} color={primary} isClean />
              </div>
            </div>

            <div className="space-y-6">
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.3em] text-neutral-900">Catalogue</h4>
              <ul className="space-y-3">
                {shopLinks.length > 0 ? shopLinks.map(l => (
                  <li key={l}>
                    <button 
                      onClick={() => { setSelectedCategory(l); setStorefrontView('shop'); }} 
                      className="text-xs font-light text-neutral-500 hover:text-neutral-900 hover:underline underline-offset-4 transition-all duration-300"
                    >
                      {l}
                    </button>
                  </li>
                )) : (
                  <li>
                    <button 
                      onClick={() => setStorefrontView('shop')} 
                      className="text-xs font-light text-neutral-500 hover:text-neutral-900 hover:underline underline-offset-4 transition-all duration-300"
                    >
                      Voir le catalogue
                    </button>
                  </li>
                )}
              </ul>
            </div>

            <div className="space-y-6">
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.3em] text-neutral-900">Support Client</h4>
              <ul className="space-y-3">
                {HELP_LINKS.map(l => (
                  <li key={l.label}>
                    <button 
                      onClick={() => handleHelpAction(l.label)} 
                      className="text-xs font-light text-neutral-500 hover:text-neutral-900 hover:underline underline-offset-4 transition-all duration-300"
                    >
                      {l.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-6">
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.3em] text-neutral-900">Nous Contacter</h4>
              <ContactBlock contact={contact} color={primary} isClean />
            </div>
          </div>

          <div className="pt-10 border-t border-neutral-100 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-8">
              <p className="text-[10px] font-light tracking-wider text-neutral-400">
                {copyright}
              </p>
              <div className="flex gap-6">
                <button className="text-[10px] font-light tracking-wider text-neutral-400 hover:text-neutral-900 hover:underline underline-offset-4 transition-colors">Confidentialité</button>
                <button className="text-[10px] font-light tracking-wider text-neutral-400 hover:text-neutral-900 hover:underline underline-offset-4 transition-colors">CGV</button>
              </div>
            </div>

            <div className="flex items-center gap-2.5 px-4 py-2 bg-neutral-50 rounded-none border border-neutral-200/60">
               <ShieldCheck className="size-3.5 text-neutral-400" />
               <span className="text-[9px] font-medium uppercase tracking-[0.15em] text-neutral-500">Paiement 100% Sécurisé</span>
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
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/5">
                 <ShieldCheck className="size-4" style={{ color: 'white' }} />
                 <span className="text-[10px] font-black uppercase tracking-widest text-white/30">Paiement Sécurisé</span>
              </div>
            </div>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer className="w-full text-white border-t-4 relative overflow-hidden" style={{ backgroundColor: primary, backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.1), rgba(0,0,0,0.3))`, borderColor: 'rgba(255,255,255,0.2)' }}>
      <div className="mx-auto max-w-screen-2xl px-6 sm:px-12 py-12 sm:pt-20 sm:pb-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-10 mb-8 sm:mb-12">
          <div className="sm:col-span-2 lg:col-span-1 space-y-4">
            {logoUrl ? <img src={logoUrl} alt={storeName} className="h-10 w-auto object-contain" /> : <span className="text-lg font-black text-white uppercase tracking-widest">{storeName}</span>}
            {tagline && <p className="text-xs font-bold text-white/90 leading-relaxed italic">{tagline}</p>}
            <SocialLinks social={social} color="white" dark />
          </div>
          <div className="space-y-4">
            <h4 className="text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: 'white' }}>Shop</h4>
            <ul className="space-y-2.5">
              {shopLinks.length > 0 ? shopLinks.map(l => (
                <li key={l}><button onClick={() => { setSelectedCategory(l); setStorefrontView('shop'); }} className="text-xs font-bold uppercase tracking-wider text-white/80 hover:text-white transition-colors">{l}</button></li>
              )) : (
                <li><button onClick={() => setStorefrontView('shop')} className="text-xs font-bold uppercase tracking-wider text-white/80 hover:text-white transition-colors">Voir le catalogue</button></li>
              )}
            </ul>
          </div>
          <div className="space-y-4">
            <h4 className="text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: 'white' }}>Aide</h4>
            <ul className="space-y-2.5">
              {HELP_LINKS.map(l => (
                <li key={l.label}><button onClick={() => handleHelpAction(l.label)} className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/80 hover:text-white transition-colors"><l.icon className="size-3" style={{ color: 'white' }} />{l.label}</button></li>
              ))}
            </ul>
          </div>
          <div className="space-y-4">
            <h4 className="text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: 'white' }}>Contact</h4>
            <ContactBlock contact={contact} color="white" dark />
          </div>
        </div>
        <div className="pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-white/30">{copyright}</p>
          <div className="flex items-center gap-3 text-[9px] font-black uppercase tracking-widest text-white/40">
            <ShieldCheck className="size-3.5" style={{ color: 'white' }} />
            Paiement sécurisé
          </div>
        </div>
      </div>
    </footer>
  );
}
