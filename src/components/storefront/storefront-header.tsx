'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShoppingCart, Menu, Search, X, LayoutDashboard, ChevronDown, Phone, Mail, Heart, MapPin, Truck, ShieldCheck, User, Check, Globe, Home, ShoppingBag, Flame, LogOut } from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { useCartStore } from '@/store/cart-store';
import { LoginDialog } from '@/components/auth/login-dialog';
import { AccountPanel } from '@/components/storefront/account-panel';
import { apiFetch } from '@/lib/api-client';
import { toast } from 'sonner';
import { motion, AnimatePresence, useScroll, useMotionValueEvent } from 'framer-motion';
import type { Store } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/use-translation';
import { optimizeCloudinaryUrl } from '@/lib/image-optimize';

function getTheme(store: Store | null) {
  const tpl = (store?.template_id ?? 'clean') as 'clean' | 'athletic' | 'luxe' | 'landing';
  const primary = (store?.theme_config?.primaryColor as string | undefined) ?? '#4b7bec';
  if (tpl === 'athletic') {
    return { tpl, primary, bg: '#0A0A0A', border: 'rgba(255,255,255,0.07)', logo: '#FFFFFF', nav: 'rgba(255,255,255,0.45)', navHover: '#FFFFFF', icon: 'rgba(255,255,255,0.75)', badge: primary, badgeText: '#000', announce: '#111', announceText: primary, mobileBg: '#0A0A0A', mobileText: '#FFFFFF', mobileAccent: primary, mobileBorder: 'rgba(255,255,255,0.07)', dropBg: '#111', dropText: '#fff', dropHover: 'rgba(255,255,255,0.05)' };
  }
  if (tpl === 'luxe') {
    return { tpl, primary, bg: '#0C0F1A', border: `${primary}18`, logo: '#FFFFFF', nav: 'rgba(255,255,255,0.35)', navHover: primary, icon: 'rgba(255,255,255,0.6)', badge: primary, badgeText: '#0C0F1A', announce: '#0C0F1A', announceText: primary, mobileBg: '#0C0F1A', mobileText: '#FFFFFF', mobileAccent: primary, mobileBorder: `${primary}18`, dropBg: '#0C0F1A', dropText: '#fff', dropHover: `${primary}10` };
  }
  return { tpl, primary, bg: '#FFFFFF', border: '#E5E7EB', logo: '#111827', nav: '#4B5563', navHover: '#111827', icon: '#374151', badge: primary, badgeText: '#FFFFFF', announce: primary, announceText: '#FFFFFF', mobileBg: '#FFFFFF', mobileText: '#1e293b', mobileAccent: primary, mobileBorder: '#f1f5f9', dropBg: '#fff', dropText: '#1e293b', dropHover: '#f9fafb' };
}


function LanguageSwitcher({ T }: { T: any }) {
  const { locale, setLocale, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const languages = [
    { code: 'fr', label: 'FR' },
    { code: 'en', label: 'EN' },
    { code: 'ar', label: 'AR' },
  ];

  const current = languages.find(l => l.code === locale) || languages[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 px-2 py-1 rounded-xl hover:bg-black/5 transition-colors text-xs font-black uppercase tracking-wider"
        style={{ color: T.icon }}
      >
        <Globe className="size-4 opacity-75" />
        <span>{current.label}</span>
        <ChevronDown className="size-3 opacity-50" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 min-w-[130px] rounded-2xl border shadow-2xl overflow-hidden z-50 py-1.5"
            style={{ backgroundColor: T.dropBg, borderColor: T.border }}
          >
            {languages.map(lang => (
              <button
                key={lang.code}
                onClick={() => { setLocale(lang.code); setOpen(false); }}
                className="w-full text-left px-4 py-2 text-xs font-bold transition-colors flex items-center justify-between"
                style={{ color: locale === lang.code ? T.primary : T.dropText }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = T.dropHover)}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <span>{lang.code === 'ar' ? 'العربية (AR)' : lang.code === 'en' ? 'English (EN)' : 'Français (FR)'}</span>
                {locale === lang.code && <Check className="size-3.5" style={{ color: T.primary }} />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Category dropdown ────────────────────────────────────────
function CategoryDropdown({ categories, T, label = 'Catalogue', onSelect, onAll }: {
  categories: string[]; T: ReturnType<typeof getTheme>; label?: string;
  onSelect: (cat: string) => void; onAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    function handle(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  if (categories.length === 0) return null;

  return (
    <div 
      ref={ref} 
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="group relative py-4 sm:py-5 flex items-center gap-1.5"
      >
        <span className="text-[11px] font-black uppercase tracking-[0.4em] transition-all duration-300" style={{ color: open ? T.navHover : T.nav }}>
          {label}
        </span>
        <ChevronDown className={`size-3 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} style={{ color: open ? T.navHover : T.nav }} />
        <span className="absolute bottom-0 left-0 h-[2px] transition-all duration-300" style={{ backgroundColor: T.navHover, width: open ? '100%' : '0%' }} />
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* Invisible bridge to prevent closing when moving to menu */}
            <div className="absolute top-full left-0 w-full h-4" />
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.18 }}
              className="absolute top-full left-1/2 -translate-x-1/2 mt-0 min-w-[220px] rounded-2xl border shadow-2xl overflow-hidden z-50 py-2"
              style={{ backgroundColor: T.dropBg, borderColor: T.border }}
            >
            <button
              onClick={() => { onAll(); setOpen(false); }}
              className="w-full text-left px-5 py-3 text-[11px] font-black uppercase tracking-widest transition-colors"
              style={{ color: T.primary }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = T.dropHover)}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              {t('allCollection')}
            </button>
            <div className="h-px mx-4 my-1" style={{ backgroundColor: T.border }} />
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => { onSelect(cat); setOpen(false); }}
                className="w-full text-left px-5 py-3 text-xs font-bold uppercase tracking-wider transition-colors"
                style={{ color: T.dropText }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = T.dropHover)}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                {cat}
              </button>
            ))}
          </motion.div>
        </>
      )}
      </AnimatePresence>
    </div>
  );
}

// ─── Search bar ───────────────────────────────────────────────
function SearchBar({ T, onClose, onSearch }: {
  T: ReturnType<typeof getTheme>; onClose: () => void; onSearch: (q: string) => void;
}) {
  const [q, setQ] = useState('');
  const { t } = useTranslation();
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="absolute inset-x-0 top-full z-50 border-b px-6 py-4 flex items-center gap-4"
      style={{ backgroundColor: T.bg, borderColor: T.border }}
    >
      <Search className="size-5 shrink-0" style={{ color: T.icon }} />
      <input
        autoFocus
        value={q}
        onChange={e => setQ(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { onSearch(q); onClose(); } }}
        placeholder={t('searchPlaceholder')}
        className="flex-1 bg-transparent outline-none text-sm font-medium placeholder-gray-400"
        style={{ color: T.logo }}
      />
      <button onClick={onClose} className="p-1 rounded-lg hover:bg-black/5 transition-colors">
        <X className="size-5" style={{ color: T.icon }} />
      </button>
    </motion.div>
  );
}


export function StorefrontHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [showAccountPanel, setShowAccountPanel] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);

  const activeStore = useAppStore((s) => s.activeStore);
  const setSelectedCategory = useAppStore((s) => s.setSelectedCategory);
  const setStorefrontView = useAppStore((s) => s.setStorefrontView);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const user = useAppStore((s) => s.user);
  const setAppView = useAppStore((s) => s.setAppView);
  const clearUser = useAppStore((s) => s.clearUser);
  const toggleCart = useCartStore((s) => s.toggleCart);
  const totalItems = useCartStore((s) => s.totalItems);
  const { t } = useTranslation();

  const cartCount = totalItems();
  const storeName = activeStore?.name ?? 'Boutique';
  const T = getTheme(activeStore);
  const contact = activeStore?.theme_config?.contact as { phone?: string; email?: string } | undefined;

  // Catégories du store — MÊME queryKey que storefront-footer.tsx (qui a
  // besoin de la même liste, juste tronquée différemment) : header ET
  // footer montés simultanément déclenchaient chacun leur propre fetch()
  // brut vers ce endpoint (confirmé en réseau : la requête
  // pageSize=1&is_active=true partait deux fois au chargement de chaque
  // page). React Query dédoublonne automatiquement deux useQuery avec la
  // même clé — un seul appel réseau, partagé par les deux composants.
  const { data: categoriesData } = useQuery({
    queryKey: ['store-categories', activeStore?.id],
    queryFn: () => apiFetch<{ categories?: string[] }>(`/api/v1/products?store_id=${activeStore!.id}&pageSize=1&is_active=true&include_categories=true`),
    enabled: !!activeStore?.id,
    staleTime: 5 * 60 * 1000,
  });
  useEffect(() => {
    if (categoriesData?.categories) setCategories(categoriesData.categories.slice(0, 12));
  }, [categoriesData]);

  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, 'change', (v) => {
    setHidden(v > (scrollY.getPrevious() ?? 0) && v > 120);
  });

  const handleNav = (view: string, hash?: string, category?: string) => {
    if (category) { setSelectedCategory(category); setStorefrontView('shop' as any); }
    else if (view === 'shop') { setSelectedCategory(null); setStorefrontView('shop' as any); }
    else setStorefrontView(view as any);
    setMenuOpen(false);
    if (hash) setTimeout(() => document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth' }), 200);
  };

  const handleLogout = async () => {
    await apiFetch('/api/v1/auth', { method: 'DELETE' }).catch(() => {});
    clearUser();
    toast.success('Déconnexion réussie');
  };

  // Header renders on every page navigation — a capped logo avoids
  // re-fetching a large source image on every route change.
  const logoSrc = optimizeCloudinaryUrl(activeStore?.logo_url || activeStore?.logo, 150);

  return (
    <>
      <motion.header
        variants={{ visible: { y: 0 }, hidden: { y: '-100%' } }}
        animate={hidden ? 'hidden' : 'visible'}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="sticky top-0 z-40 w-full"
        style={{ backgroundColor: T.bg, borderBottom: `1px solid ${T.border}` }}
      >
        <div className="max-w-[1800px] mx-auto w-full flex h-16 sm:h-20 items-center justify-between px-5 sm:px-10 lg:px-16 relative">

          {/* ─── Logo ─── */}
          <button onClick={() => handleNav('home')} className="flex items-center gap-3 group shrink-0 focus:outline-none">
            <div className="size-10 sm:size-12 overflow-hidden rounded-xl flex items-center justify-center relative border border-slate-200/60 shadow-sm shrink-0 bg-white">
              <span className="absolute inset-0 flex items-center justify-center text-sm font-black text-white select-none" style={{ backgroundColor: T.primary }}>
                {storeName.charAt(0).toUpperCase()}
              </span>
              <img 
                src={logoSrc || activeStore?.logo_url || '/azzougshop_logo.png'} 
                alt={storeName} 
                className="h-full w-full object-contain p-0 relative z-10 bg-white" 
                onError={(e) => {
                  const target = e.currentTarget;
                  if (target.src.includes('azzougshop_logo')) {
                    target.src = '/brand-icon-primary.png';
                  } else if (target.src.includes('brand-icon-primary')) {
                    target.src = '/icon.png';
                  } else {
                    target.style.display = 'none';
                  }
                }} 
              />
            </div>
            <div className="flex flex-col items-start gap-0">
              <span
                className={`text-sm sm:text-base leading-none tracking-tight ${T.tpl === 'luxe' ? 'italic font-serif' : 'font-black uppercase tracking-[0.06em]'}`}
                style={{ color: T.logo, fontFamily: T.tpl === 'luxe' ? '"Playfair Display", Didot, serif' : undefined }}
              >
                {storeName}
              </span>
              {T.tpl === 'clean' && (
                <span 
                  className="text-[9px] italic tracking-[0.1em] mt-0.5 opacity-60" 
                  style={{ color: T.logo, fontFamily: '"Playfair Display", Didot, serif' }}
                >
                  {(activeStore?.theme_config?.storeTagline as string | undefined) ?? ''}
                </span>
              )}
            </div>
          </button>

          {/* ─── Desktop Nav ─── */}
          <nav className={cn(
            "hidden lg:flex items-center gap-10 xl:gap-14",
            T.tpl === 'clean' ? "absolute left-1/2 -translate-x-1/2" : ""
          )}>
            <button onClick={() => handleNav('home')} className="group relative py-2">
              <span className="text-[11px] font-black uppercase tracking-[0.35em] transition-colors" style={{ color: T.nav }}>{t('home')}</span>
              <span className="absolute bottom-0 left-0 h-[2px] w-0 group-hover:w-full transition-all duration-300" style={{ backgroundColor: T.navHover }} />
            </button>

            {/* Collections Dropdown */}
            <CategoryDropdown
              label={t('collections')}
              categories={categories}
              T={T}
              onAll={() => handleNav('shop')}
              onSelect={(cat) => handleNav('shop', undefined, cat)}
            />

            <button onClick={() => handleNav('order-tracking')} className="group relative py-4 sm:py-5">
              <span className="text-[11px] font-black uppercase tracking-[0.35em] transition-colors" style={{ color: T.nav }}>{t('trackOrder')}</span>
              <span className="absolute bottom-0 left-0 h-[2px] w-0 group-hover:w-full transition-all duration-300" style={{ backgroundColor: T.navHover }} />
            </button>
          </nav>

          {/* ─── Right actions ─── */}
          <div className="flex items-center gap-0.5 sm:gap-2">

            {/* Search (Hidden on Mobile) */}
            <button
              onClick={() => setSearchOpen(o => !o)}
              className="hidden sm:flex p-2.5 rounded-xl hover:bg-black/5 transition-colors"
              title={t('searchProduct')}
            >
              <Search className="size-5" style={{ color: T.icon }} />
            </button>

            {/* Wishlist (Desktop only) */}
            <button
              onClick={() => handleNav('shop')}
              className="hidden lg:flex p-2.5 rounded-xl hover:bg-black/5 transition-colors"
              title={t('wishlist')}
            >
              <Heart className="size-5" style={{ color: T.icon }} />
            </button>

            {/* Cart (Visible on Mobile) */}
            <button
              onClick={toggleCart}
              className="group relative p-2.5 rounded-xl hover:bg-black/5 transition-colors"
              title={t('cart')}
            >
              <ShoppingCart className="size-5" style={{ color: T.icon }} />
              {cartCount > 0 && (
                <motion.span
                  key={cartCount}
                  initial={{ scale: 1.4 }} animate={{ scale: 1 }}
                  className="absolute right-1 top-1 size-4 rounded-full flex items-center justify-center text-[9px] font-black text-white shadow-sm"
                  style={{ backgroundColor: T.badge, color: T.badgeText }}
                >
                  {cartCount}
                </motion.span>
              )}
            </button>

            {/* Language Switcher */}
            <LanguageSwitcher T={T} />

            {/* Direct Staff / Livreur Space Button */}
            {isAuthenticated && user && ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CONFIRMATEUR', 'LIVREUR', 'AGENT', 'MARKETER'].includes(user.role) && (
              <button
                onClick={() => useAppStore.getState().setAppView('admin')}
                className="px-2.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all shrink-0"
                title="Accéder à mon Espace Professionnel"
              >
                <ShieldCheck className="size-3.5" />
                <span className="hidden sm:inline">{user.role === 'LIVREUR' ? 'Espace Livreur' : 'Espace Pro'}</span>
              </button>
            )}

            {/* Account (Far Right, Visible on Mobile) */}
            <button 
              onClick={isAuthenticated ? () => setShowAccountPanel(true) : () => setShowLoginDialog(true)}
              className="relative p-2.5 rounded-xl hover:bg-black/5 transition-colors"
              title={t('myAccount')}
            >
              <User className="size-5" style={{ color: T.icon }} />
              {isAuthenticated && (
                <span className="absolute right-2 top-2 size-2 rounded-full border border-white bg-green-500" />
              )}
            </button>
            {/* Mobile menu */}
            <button onClick={() => setMenuOpen(true)} className="lg:hidden p-2.5 rounded-xl hover:bg-black/5 transition-colors ml-1">
              <Menu className="size-5" style={{ color: T.icon }} />
            </button>
          </div>

          {/* Search bar dropdown */}
          <AnimatePresence>
            {searchOpen && (
              <SearchBar
                T={T}
                onClose={() => setSearchOpen(false)}
                onSearch={(q) => { setSelectedCategory(null); setStorefrontView('shop' as any); }}
              />
            )}
          </AnimatePresence>
        </div>

        {/* ─── Trust bar below nav (desktop only) ─ only shown if configured in theme_config ─── */}
        {T.tpl === 'clean' && (() => {
          const rawTrustBar = activeStore?.theme_config?.trustBar as Array<{label: string; sub: string; icon?: string}> | undefined;
          if (!rawTrustBar || rawTrustBar.length === 0) return null;
          return (
            <div className="hidden lg:block border-t" style={{ borderColor: T.border }}>
              <div className="max-w-[1800px] mx-auto px-16 py-2.5 flex items-center justify-center gap-12">
                {rawTrustBar.map(({ label, sub }) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="size-3.5 shrink-0 rounded-full inline-block" style={{ backgroundColor: T.primary }} />
                    <span className="text-[10px] font-bold text-gray-500">
                      <span className="font-black text-gray-800">{label}</span> · {sub}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </motion.header>

      {/* ─── Mobile Menu Drawer (Meta Ads Template) ─── */}
      <AnimatePresence>
        {menuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs" 
              onClick={() => setMenuOpen(false)} 
            />
            
            {/* Drawer */}
            <motion.div
              initial={{ x: '-100%' }} 
              animate={{ x: 0 }} 
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 240 }}
              className="relative w-[88vw] max-w-sm bg-[#F8F9FC] h-full shadow-2xl flex flex-col z-10 overflow-hidden border-r border-slate-200/80"
            >
              {/* Top Header Card */}
              <div className="p-4 bg-white border-b border-slate-100 flex items-center justify-between shadow-2xs">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="size-11 rounded-xl overflow-hidden bg-white border border-slate-200/80 p-0.5 flex items-center justify-center shrink-0 shadow-2xs">
                    {logoSrc ? (
                      <img src={logoSrc} alt={storeName} className="h-full w-full object-contain" />
                    ) : (
                      <span className="text-xs font-black text-white size-full flex items-center justify-center rounded-lg" style={{ backgroundColor: T.primary }}>
                        {storeName.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-tight text-slate-900 truncate">{storeName}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-[9px] font-black uppercase tracking-wider text-emerald-600 font-mono">Boutique Active</span>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={() => setMenuOpen(false)} 
                  className="size-9 rounded-xl bg-slate-50 border border-slate-200/80 text-slate-500 hover:text-slate-900 flex items-center justify-center transition-all active:scale-95"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">

                {/* Quick Search Input Card */}
                <div className="bg-white rounded-2xl border border-slate-100 p-2 shadow-2xs flex items-center gap-2">
                  <Search className="size-4 text-slate-400 ml-2 shrink-0" />
                  <input 
                    type="text" 
                    placeholder="Rechercher un produit..." 
                    className="flex-1 bg-transparent text-xs font-medium text-slate-800 placeholder-slate-400 outline-none pr-2 h-8"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = (e.target as HTMLInputElement).value;
                        if (val.trim()) {
                          setSelectedCategory(null);
                          setStorefrontView('shop' as any);
                          setMenuOpen(false);
                        }
                      }
                    }}
                  />
                </div>

                {/* Primary Nav Links Card */}
                <div className="bg-white rounded-2xl border border-slate-100 p-2 shadow-2xs space-y-1">
                  <label className="text-[9px] font-black uppercase tracking-wider text-slate-400 px-3 pt-1 block">Navigation</label>
                  {[
                    { label: t('home'), view: 'home', icon: Home },
                    { label: 'Tout le catalogue', view: 'shop', icon: ShoppingBag, badge: '58 Wilayas' },
                    { label: t('ourBestSellers'), view: 'home', hash: '#best-sellers', icon: Flame },
                    { label: t('trackOrder'), view: 'order-tracking', icon: Truck },
                  ].map(item => {
                    const IconComp = item.icon;
                    return (
                      <button
                        key={item.label}
                        onClick={() => handleNav(item.view, item.hash)}
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="size-7 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600">
                            <IconComp className="size-3.5" />
                          </div>
                          <span>{item.label}</span>
                        </div>
                        {item.badge && (
                          <span className="px-2 py-0.5 rounded-md text-[9px] font-mono font-black uppercase bg-blue-50 text-[#4b7bec] border border-blue-100">
                            {item.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Collections / Categories Card */}
                {categories.length > 0 && (
                  <div className="bg-white rounded-2xl border border-slate-100 p-3 shadow-2xs space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <label className="text-[9px] font-black uppercase tracking-wider text-slate-400">Collections</label>
                      <button 
                        onClick={() => handleNav('shop')} 
                        className="text-[9px] font-black uppercase tracking-wider text-[#4b7bec] hover:underline"
                      >
                        Voir tout
                      </button>
                    </div>
                    <div className="flex flex-col gap-1">
                      {categories.map(cat => (
                        <button
                          key={cat}
                          onClick={() => handleNav('shop', undefined, cat)}
                          className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all text-left"
                        >
                          <div className="flex items-center gap-2">
                            <span className="size-1.5 rounded-full" style={{ backgroundColor: T.primary }} />
                            <span>{cat}</span>
                          </div>
                          <ChevronDown className="size-3 text-slate-300 -rotate-90" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reassurance Mini Box */}
                <div className="bg-gradient-to-br from-blue-50/80 to-indigo-50/50 rounded-2xl border border-blue-100/70 p-3.5 space-y-2 shadow-2xs">
                  <div className="flex items-center gap-2 text-[#4b7bec]">
                    <ShieldCheck className="size-4 shrink-0" />
                    <span className="text-[10px] font-black uppercase tracking-wider">Garantie & Service</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[10px] font-bold text-slate-700">
                    <div className="flex items-center gap-1.5">
                      <Truck className="size-3 text-[#4b7bec]" />
                      <span>58 Wilayas COD</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Check className="size-3 text-emerald-600" />
                      <span>Paiement Réception</span>
                    </div>
                  </div>
                </div>

                {/* Customer & Staff Space Card */}
                <div className="bg-white rounded-2xl border border-slate-100 p-3 shadow-2xs space-y-2">
                  <label className="text-[9px] font-black uppercase tracking-wider text-slate-400 px-1">Espace Utilisateur</label>
                  {isAuthenticated && user ? (
                    <div className="space-y-2">
                      <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                        <div>
                          <p className="text-xs font-black text-slate-900">{user.name || (user as any).full_name || user.email}</p>
                          <span className="text-[9px] font-mono font-bold text-slate-400">{user.role}</span>
                        </div>
                        {['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CONFIRMATEUR', 'LIVREUR', 'AGENT', 'MARKETER'].includes(user.role) && (
                          <button
                            onClick={() => { setAppView('admin'); setMenuOpen(false); }}
                            className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-[10px] font-bold"
                          >
                            Espace Pro
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => { setShowAccountPanel(true); setMenuOpen(false); }}
                          className="flex-1 h-9 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        >
                          Mon Compte
                        </button>
                        <button 
                          onClick={handleLogout}
                          className="h-9 px-3 rounded-xl border border-rose-100 bg-rose-50 text-rose-600 text-xs font-bold hover:bg-rose-100 flex items-center gap-1"
                        >
                          <LogOut className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setShowLoginDialog(true); setMenuOpen(false); }}
                      className="w-full h-10 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-wider shadow-xs hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
                    >
                      <User className="size-3.5" /> Se Connecter / S'inscrire
                    </button>
                  )}
                </div>

                {/* Contact Details */}
                {(contact?.phone || contact?.email) && (
                  <div className="bg-white rounded-2xl border border-slate-100 p-3 shadow-2xs space-y-2">
                    <label className="text-[9px] font-black uppercase tracking-wider text-slate-400 px-1">Service Client</label>
                    {contact?.phone && (
                      <a 
                        href={`tel:${contact.phone}`} 
                        className="flex items-center gap-2.5 p-2 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50"
                      >
                        <Phone className="size-3.5 text-[#4b7bec]" />
                        <span>{contact.phone}</span>
                      </a>
                    )}
                    {contact?.email && (
                      <a 
                        href={`mailto:${contact.email}`} 
                        className="flex items-center gap-2.5 p-2 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50"
                      >
                        <Mail className="size-3.5 text-[#4b7bec]" />
                        <span className="truncate">{contact.email}</span>
                      </a>
                    )}
                  </div>
                )}

              </div>

              {/* Drawer Footer */}
              <div className="p-4 bg-white border-t border-slate-100 space-y-3">
                {/* Language Switcher Bar */}
                <div className="flex items-center justify-between px-1">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Langue</span>
                  <LanguageSwitcher T={T} />
                </div>

                {/* Cart CTA Button */}
                <button 
                  onClick={() => { toggleCart(); setMenuOpen(false); }}
                  className="w-full h-12 rounded-xl text-xs font-black uppercase tracking-wider text-white shadow-xs transition-all flex items-center justify-center gap-2 hover:opacity-95 active:scale-[0.98]"
                  style={{ backgroundColor: T.primary }}
                >
                  <ShoppingCart className="size-4" /> Voir mon panier {cartCount > 0 && `(${cartCount})`}
                </button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <LoginDialog open={showLoginDialog} onOpenChange={setShowLoginDialog} />
      <AccountPanel open={showAccountPanel} onOpenChange={setShowAccountPanel} />
    </>
  );
}
