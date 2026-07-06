'use client';

import { useState, useEffect, useRef } from 'react';
import { ShoppingCart, Menu, Search, X, LayoutDashboard, ChevronDown, Phone, Mail, Heart, MapPin, Truck, ShieldCheck, User } from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { useCartStore } from '@/store/cart-store';
import { LoginDialog } from '@/components/auth/login-dialog';
import { AccountPanel } from '@/components/storefront/account-panel';
import { apiFetch } from '@/lib/api-client';
import { toast } from 'sonner';
import { motion, AnimatePresence, useScroll, useMotionValueEvent } from 'framer-motion';
import type { Store } from '@/lib/types';
import { cn } from '@/lib/utils';

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


// ─── Category dropdown ────────────────────────────────────────
function CategoryDropdown({ categories, T, label = 'Catalogue', onSelect, onAll }: {
  categories: string[]; T: ReturnType<typeof getTheme>; label?: string;
  onSelect: (cat: string) => void; onAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
              Toute la collection
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
        placeholder="Rechercher un produit..."
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

  const cartCount = totalItems();
  const storeName = activeStore?.name ?? 'Boutique';
  const T = getTheme(activeStore);
  const contact = activeStore?.theme_config?.contact as { phone?: string; email?: string } | undefined;

  // Fetch categories for dropdown
  useEffect(() => {
    if (!activeStore?.id) return;
    fetch(`/api/v1/products?store_id=${activeStore.id}&pageSize=1`)
      .then(r => r.json())
      .then(json => {
        if (json.categories) setCategories(json.categories.slice(0, 12));
      })
      .catch(() => {});
  }, [activeStore?.id]);

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

  const logoSrc = activeStore?.logo_url || activeStore?.logo;

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
            {logoSrc ? (
              <div className="size-10 sm:size-12 overflow-hidden rounded-xl flex items-center justify-center bg-black/5 group-hover:bg-black/10 transition-colors">
                <img src={logoSrc} alt={storeName} className="h-full w-full object-contain p-1.5" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              </div>
            ) : (
              <div className="size-10 sm:size-12 rounded-xl flex items-center justify-center text-sm font-black text-white shrink-0 group-hover:brightness-110 transition-all" style={{ backgroundColor: T.primary }}>
                {storeName.charAt(0).toUpperCase()}
              </div>
            )}
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
                  Boutique Officielle
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
              <span className="text-[11px] font-black uppercase tracking-[0.35em] transition-colors" style={{ color: T.nav }}>Accueil</span>
              <span className="absolute bottom-0 left-0 h-[2px] w-0 group-hover:w-full transition-all duration-300" style={{ backgroundColor: T.navHover }} />
            </button>

            {/* Collections Dropdown */}
            <CategoryDropdown
              label="Collections"
              categories={categories}
              T={T}
              onAll={() => handleNav('shop')}
              onSelect={(cat) => handleNav('shop', undefined, cat)}
            />

            <button onClick={() => handleNav('order-tracking')} className="group relative py-4 sm:py-5">
              <span className="text-[11px] font-black uppercase tracking-[0.35em] transition-colors" style={{ color: T.nav }}>Suivi commande</span>
              <span className="absolute bottom-0 left-0 h-[2px] w-0 group-hover:w-full transition-all duration-300" style={{ backgroundColor: T.navHover }} />
            </button>
          </nav>

          {/* ─── Right actions ─── */}
          <div className="flex items-center gap-0.5 sm:gap-2">

            {/* Search (Hidden on Mobile) */}
            <button
              onClick={() => setSearchOpen(o => !o)}
              className="hidden sm:flex p-2.5 rounded-xl hover:bg-black/5 transition-colors"
              title="Rechercher"
            >
              <Search className="size-5" style={{ color: T.icon }} />
            </button>

            {/* Wishlist (Desktop only) */}
            <button
              onClick={() => handleNav('shop')}
              className="hidden lg:flex p-2.5 rounded-xl hover:bg-black/5 transition-colors"
              title="Favoris"
            >
              <Heart className="size-5" style={{ color: T.icon }} />
            </button>

            {/* Cart (Visible on Mobile) */}
            <button
              onClick={toggleCart}
              className="group relative p-2.5 rounded-xl hover:bg-black/5 transition-colors"
              title="Panier"
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

            {/* Account (Far Right, Visible on Mobile) */}
            <button 
              onClick={isAuthenticated ? () => setShowAccountPanel(true) : () => setShowLoginDialog(true)}
              className="relative p-2.5 rounded-xl hover:bg-black/5 transition-colors"
              title="Mon compte"
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

        {/* ─── Delivery trust bar (below nav, desktop only) ─── */}
        {T.tpl === 'clean' && (
          <div className="hidden lg:block border-t" style={{ borderColor: T.border }}>
            <div className="max-w-[1800px] mx-auto px-16 py-2.5 flex items-center justify-center gap-12">
              {[
                { icon: Truck,   label: 'Livraison 48h',            sub: 'partout en Algérie' },
                { icon: MapPin,  label: 'Paiement à la livraison',  sub: 'Zéro risque' },
                { icon: Phone,   label: 'Retour 14 jours',          sub: 'Échanges sans frais' },
              ].map(({ icon: Icon, label, sub }) => (
                <div key={label} className="flex items-center gap-2">
                  <Icon className="size-3.5 shrink-0" style={{ color: T.primary }} />
                  <span className="text-[10px] font-bold text-gray-500">
                    <span className="font-black text-gray-800">{label}</span> · {sub}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.header>

      {/* ─── Mobile Menu ─── */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMenuOpen(false)} />
            <motion.div
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 220 }}
              className="absolute inset-y-0 left-0 w-[85vw] max-w-sm flex flex-col shadow-2xl"
              style={{ backgroundColor: T.mobileBg }}
            >
              {/* Header */}
              <div className="flex h-20 items-center justify-between px-6 border-b" style={{ borderColor: T.mobileBorder }}>
                <div className="flex items-center gap-3">
                  {logoSrc ? (
                    <div className="size-9 rounded-lg overflow-hidden bg-black/10 flex items-center justify-center">
                      <img src={logoSrc} alt={storeName} className="h-full w-full object-contain p-1" />
                    </div>
                  ) : (
                    <div className="size-9 rounded-lg flex items-center justify-center text-xs font-black text-white" style={{ backgroundColor: T.primary }}>
                      {storeName.charAt(0)}
                    </div>
                  )}
                  <span className="text-sm font-black uppercase tracking-wide" style={{ color: T.mobileText }}>{storeName}</span>
                </div>
                <button onClick={() => setMenuOpen(false)} className="p-2 rounded-xl hover:bg-black/5 transition-colors">
                  <X className="size-5" style={{ color: T.mobileText }} />
                </button>
              </div>

              {/* Links */}
              <div className="flex-1 overflow-y-auto px-4 py-6 space-y-1">
                {[
                  { label: 'Accueil', view: 'home' },
                  { label: 'Tous les produits', view: 'shop' },
                  { label: 'Best-Sellers', view: 'home', hash: '#best-sellers' },
                  { label: 'Suivi de commande', view: 'order-tracking' },
                ].map(link => (
                  <button key={link.label} onClick={() => handleNav(link.view, link.hash)}
                    className="flex w-full items-center justify-between px-4 py-3.5 rounded-2xl text-sm font-black uppercase tracking-tight transition-colors hover:bg-black/5"
                    style={{ color: T.mobileText }}>
                    {link.label}
                  </button>
                ))}

                {/* Mobile categories */}
                {categories.length > 0 && (
                  <div className="pt-4">
                    <p className="px-4 text-[10px] font-black uppercase tracking-[0.3em] mb-2 opacity-40" style={{ color: T.mobileText }}>
                      Catégories
                    </p>
                    {categories.map(cat => (
                      <button key={cat} onClick={() => handleNav('shop', undefined, cat)}
                        className="flex w-full items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold transition-colors hover:bg-black/5"
                        style={{ color: T.mobileText }}>
                        <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: T.mobileAccent }} />
                        {cat}
                      </button>
                    ))}
                  </div>
                )}

                {/* Contact */}
                {(contact?.phone || contact?.email) && (
                  <div className="pt-6 border-t mt-4 space-y-3 px-1" style={{ borderColor: T.mobileBorder }}>
                    <p className="px-3 text-[10px] font-black uppercase tracking-[0.3em] opacity-40" style={{ color: T.mobileText }}>Contact</p>
                    {contact?.phone && (
                      <a href={`tel:${contact.phone}`} className="flex items-center gap-3 px-3 py-2 text-sm font-bold rounded-xl" style={{ color: T.mobileText }}>
                        <Phone className="size-4 shrink-0" style={{ color: T.mobileAccent }} /> {contact.phone}
                      </a>
                    )}
                    {contact?.email && (
                      <a href={`mailto:${contact.email}`} className="flex items-center gap-3 px-3 py-2 text-sm font-bold rounded-xl" style={{ color: T.mobileText }}>
                        <Mail className="size-4 shrink-0" style={{ color: T.mobileAccent }} /> {contact.email}
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* Bottom CTA */}
              <div className="p-4 border-t space-y-3" style={{ borderColor: T.mobileBorder }}>
                {isAuthenticated ? (
                  <button onClick={() => { setAppView('admin'); setMenuOpen(false); }}
                    className="w-full py-4 rounded-2xl flex items-center justify-center gap-2 text-sm font-black uppercase tracking-widest text-white"
                    style={{ backgroundColor: T.mobileAccent }}>
                    <LayoutDashboard className="size-4" /> Mon Espace Admin
                  </button>
                ) : (
                  <button onClick={() => { setShowLoginDialog(true); setMenuOpen(false); }}
                    className="w-full py-4 rounded-2xl flex items-center justify-center gap-2 text-sm font-black uppercase tracking-widest text-white"
                    style={{ backgroundColor: T.mobileAccent }}>
                    Se connecter
                  </button>
                )}
                <button onClick={() => { toggleCart(); setMenuOpen(false); }}
                  className="w-full py-3.5 rounded-2xl flex items-center justify-center gap-2 text-sm font-black uppercase tracking-widest border"
                  style={{ color: T.mobileText, borderColor: T.mobileBorder }}>
                  <ShoppingCart className="size-4" /> Panier {cartCount > 0 && `(${cartCount})`}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <LoginDialog open={showLoginDialog} onOpenChange={setShowLoginDialog} />
      <AccountPanel open={showAccountPanel} onOpenChange={setShowAccountPanel} />
    </>
  );
}
