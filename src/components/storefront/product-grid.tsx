'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useCallback, useEffect, useState, useMemo } from 'react';
import { Search, SlidersHorizontal, X, ChevronLeft, ChevronRight, Package, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppStore } from '@/store/app-store';
import { useCartStore } from '@/store/cart-store';
import type { Product } from '@/lib/types';
import { ProductCard } from './product-card';
import { apiFetch } from '@/lib/api-client';

type SortOption = 'popular' | 'newest' | 'price-asc' | 'price-desc';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'popular',    label: 'Populaires' },
  { value: 'newest',     label: 'Nouveautés' },
  { value: 'price-asc',  label: 'Prix ↑' },
  { value: 'price-desc', label: 'Prix ↓' },
];


// ─── Shared data-fetching hook ──────────────────────────────────
function useProductData(storeId: string | undefined) {
  const selectedCategoryStore = useAppStore(s => s.selectedCategory);
  const setSelectedCategoryStore = useAppStore(s => s.setSelectedCategory);

  const [products, setProducts] = useState<Product[]>([]);
  const [rawCategories, setRawCategories] = useState<string[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(selectedCategoryStore || 'all');
  const [minPrice, setMinPrice] = useState<number | null>(null);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('popular');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [promoOnly, setPromoOnly] = useState(false);
  const [preorderOnly, setPreorderOnly] = useState(false);
  const pageSize = 24;

  useEffect(() => {
    if (selectedCategoryStore) setSelectedCategory(selectedCategoryStore);
    else setSelectedCategory('all');
  }, [selectedCategoryStore]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const normalizedCategories = useMemo(() => {
    const map = new Map<string, string>();
    rawCategories.forEach(c => { const k = c.toLowerCase().trim(); if (!map.has(k)) map.set(k, c); });
    return Array.from(map.values()).sort();
  }, [rawCategories]);

  const fetchProducts = useCallback(async (signal?: AbortSignal) => {
    if (!storeId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ store_id: storeId, page: String(page), pageSize: String(pageSize), sort: sortBy });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (selectedCategory !== 'all') params.set('category', selectedCategory);
      if (minPrice !== null) params.set('min_price', String(minPrice));
      if (maxPrice !== null) params.set('max_price', String(maxPrice));
      if (inStockOnly) params.set('in_stock', 'true');
      if (promoOnly) params.set('promo', 'true');
      const json = await apiFetch<any>(`/api/v1/products?${params}`, { signal });
      setProducts(json.data ?? []);
      setTotalPages(json.totalPages ?? 1);
      setTotal(json.total ?? 0);
      if (json.categories) setRawCategories(json.categories);
      else {
        const cats = new Set<string>();
        (json.data ?? []).forEach((p: Product) => { if (p.category) cats.add(p.category); });
        setRawCategories(Array.from(cats));
      }
      if (json.categoryCounts) setCategoryCounts(json.categoryCounts);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [storeId, page, debouncedSearch, selectedCategory, minPrice, maxPrice, sortBy, inStockOnly, promoOnly]);

  useEffect(() => { setPage(1); }, [debouncedSearch, selectedCategory, minPrice, maxPrice, sortBy]);

  useEffect(() => {
    const c = new AbortController();
    fetchProducts(c.signal);
    return () => c.abort();
  }, [fetchProducts]);

  const clearFilters = () => {
    setSearch(''); setSelectedCategory('all'); setSelectedCategoryStore(null);
    setMinPrice(null); setMaxPrice(null); setSortBy('popular');
    setInStockOnly(false); setPromoOnly(false); setPreorderOnly(false);
  };

  const hasActiveFilters = !!(debouncedSearch || (selectedCategory !== 'all' && selectedCategory !== null) || minPrice !== null || maxPrice !== null || inStockOnly || promoOnly || preorderOnly);

  return {
    products, normalizedCategories, categoryCounts, loading, page, setPage, totalPages, total,
    search, setSearch, selectedCategory, setSelectedCategory, setSelectedCategoryStore,
    minPrice, setMinPrice, maxPrice, setMaxPrice, sortBy, setSortBy,
    inStockOnly, setInStockOnly, promoOnly, setPromoOnly, preorderOnly, setPreorderOnly,
    clearFilters, hasActiveFilters,
  };
}

// ─── Pagination component ───────────────────────────────────────
function Pagination({ page, totalPages, onPage, primary, dark }: {
  page: number; totalPages: number; onPage: (p: number) => void; primary: string; dark?: boolean;
}) {
  if (totalPages <= 1) return null;
  const textCls = dark ? 'text-white/30' : 'text-slate-300';
  const activeColor = dark ? '#000' : '#fff';

  // Build page number list with ellipsis when totalPages > 7
  const pageNumbers: (number | '...')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pageNumbers.push(i);
  } else {
    const left = Math.max(2, page - 1);
    const right = Math.min(totalPages - 1, page + 1);
    pageNumbers.push(1);
    if (left > 2) pageNumbers.push('...');
    for (let i = left; i <= right; i++) pageNumbers.push(i);
    if (right < totalPages - 1) pageNumbers.push('...');
    pageNumbers.push(totalPages);
  }

  return (
    <div className="flex items-center justify-center gap-8 pt-16">
      <button disabled={page <= 1} onClick={() => onPage(Math.max(1, page - 1))}
        className={`group flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.25em] disabled:opacity-20 transition-opacity ${textCls}`}>
        <ChevronLeft className="size-4 group-hover:-translate-x-0.5 transition-transform" /> Préc.
      </button>
      <div className="flex items-center gap-2">
        {pageNumbers.map((n, i) =>
          n === '...' ? (
            <span key={`ellipsis-${i}`} className={`px-1 text-[11px] font-black ${textCls}`}>…</span>
          ) : (
            <button key={n} onClick={() => onPage(n as number)}
              className="size-9 flex items-center justify-center text-[11px] font-black rounded-xl transition-all"
              style={page === n ? { backgroundColor: primary, color: activeColor } : {}}>
              {page === n ? n : <span className={textCls}>{n}</span>}
            </button>
          )
        )}
      </div>
      <button disabled={page >= totalPages} onClick={() => onPage(Math.min(totalPages, page + 1))}
        className={`group flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.25em] disabled:opacity-20 transition-opacity ${textCls}`}>
        Suiv. <ChevronRight className="size-4 group-hover:translate-x-0.5 transition-transform" />
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// CLEAN GRID — Shopify Dawn / Template Minimaliste
// ══════════════════════════════════════════════════════════════════
function CleanGrid({ storeId, primary, setStorefrontView }: { storeId: string; primary: string; setStorefrontView: (v: any) => void }) {
  const d = useProductData(storeId);
  const addItem = useCartStore(s => s.addItem);
  const openCart = useCartStore(s => s.openCart);
  const setSelectedProductSlug = useAppStore(s => s.setSelectedProductSlug);
  const [newsletterEmail, setNewsletterEmail] = useState('');

  const go = (p: number) => { d.setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  // Local state for the dual range price inputs (string for the input)
  const [localMin, setLocalMin] = useState('');
  const [localMax, setLocalMax] = useState('');

  const applyPrice = () => {
    const mn = localMin !== '' ? parseFloat(localMin) : null;
    const mx = localMax !== '' ? parseFloat(localMax) : null;
    d.setMinPrice(mn);
    d.setMaxPrice(mx);
  };

  return (
    <div className="bg-white min-h-screen">
      <div className="max-w-[1800px] mx-auto px-5 sm:px-10 py-10 lg:py-16">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.25em] text-slate-300 mb-10">
          <button onClick={() => setStorefrontView('home')} className="hover:text-slate-600 transition-colors">Accueil</button>
          <ChevronRight className="size-3" />
          <span className="text-slate-800">Collections</span>
        </div>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-14 pb-10 border-b border-slate-100">
          <div>
            <h1 className="text-4xl sm:text-5xl font-black tracking-tight text-slate-900 leading-[0.95]">
              {d.selectedCategory === 'all' ? 'La Collection' : d.selectedCategory}
            </h1>
            <p className="mt-3 text-xs text-slate-400 font-medium uppercase tracking-widest">{d.total} produits</p>
          </div>
          {/* Sort */}
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-slate-300" />
            <select value={d.sortBy} onChange={e => d.setSortBy(e.target.value as SortOption)}
              className="text-xs font-bold uppercase tracking-widest text-slate-500 bg-transparent border-none outline-none cursor-pointer">
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-14">
          {/* Sidebar — w-64, sticky */}
          <aside className="hidden lg:flex flex-col w-64 shrink-0 gap-10 sticky top-28 h-fit">
            {/* Search */}
            <div className="space-y-3">
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-300">Recherche</p>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-slate-300" />
                <input type="text" value={d.search} onChange={e => d.setSearch(e.target.value)}
                  placeholder="Chercher..." className="w-full h-10 pl-9 pr-4 text-xs font-medium rounded-xl border border-slate-100 bg-slate-50 focus:outline-none focus:border-slate-300 transition-colors" />
              </div>
            </div>

            {/* Categories with count badge */}
            <div className="space-y-4">
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-300">Catégories</p>
              <div className="flex flex-col gap-1.5">
                {[{ id: 'all', label: 'Tous' }, ...d.normalizedCategories.map(c => ({ id: c, label: c }))].map(cat => (
                  <button key={cat.id} onClick={() => { d.setSelectedCategory(cat.id); d.setSelectedCategoryStore(cat.id === 'all' ? null : cat.id); }}
                    className={`flex items-center justify-between text-xs font-bold text-left py-1.5 transition-all rounded-lg px-3 ${d.selectedCategory === cat.id ? 'text-white shadow-sm' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}
                    style={d.selectedCategory === cat.id ? { backgroundColor: primary } : {}}>
                    <span>{cat.label}</span>
                    {cat.id !== 'all' && d.categoryCounts[cat.id] !== undefined && (
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ml-2 ${d.selectedCategory === cat.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-400'}`}>
                        {d.categoryCounts[cat.id]}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Prix — dual range inputs */}
            <div className="space-y-4">
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-300">Prix</p>
              {(d.minPrice !== null || d.maxPrice !== null) && (
                <p className="text-[11px] font-bold text-slate-500">
                  {d.minPrice !== null ? `${d.minPrice.toLocaleString('fr-DZ')} DA` : '0 DA'}
                  {' — '}
                  {d.maxPrice !== null ? `${d.maxPrice.toLocaleString('fr-DZ')} DA` : '∞'}
                </p>
              )}
              <div className="flex items-center gap-2">
                <input type="number" value={localMin} onChange={e => setLocalMin(e.target.value)} placeholder="Min"
                  className="w-full h-9 px-3 text-xs border border-slate-100 rounded-lg focus:outline-none focus:border-slate-300 bg-slate-50" />
                <span className="text-slate-300 text-xs">—</span>
                <input type="number" value={localMax} onChange={e => setLocalMax(e.target.value)} placeholder="Max"
                  className="w-full h-9 px-3 text-xs border border-slate-100 rounded-lg focus:outline-none focus:border-slate-300 bg-slate-50" />
              </div>
              <button onClick={applyPrice}
                className="w-full h-9 text-[10px] font-black uppercase tracking-widest text-white rounded-lg transition-all hover:brightness-110"
                style={{ backgroundColor: primary }}>
                Appliquer
              </button>
            </div>

            {/* Disponibilité — checkboxes */}
            <div className="space-y-3">
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-300">Disponibilité</p>
              <div className="flex flex-col gap-2.5">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input type="checkbox" checked={d.inStockOnly} onChange={e => d.setInStockOnly(e.target.checked)}
                    className="size-4 accent-current rounded" style={{ accentColor: primary }} />
                  <span className="text-xs font-bold text-slate-500 group-hover:text-slate-800 transition-colors">En stock</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input type="checkbox" checked={d.preorderOnly} onChange={e => d.setPreorderOnly(e.target.checked)}
                    className="size-4 rounded" style={{ accentColor: primary }} />
                  <span className="text-xs font-bold text-slate-500 group-hover:text-slate-800 transition-colors">Pré-commande</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input type="checkbox" checked={d.promoOnly} onChange={e => d.setPromoOnly(e.target.checked)}
                    className="size-4 rounded" style={{ accentColor: primary }} />
                  <span className="text-xs font-bold text-slate-500 group-hover:text-slate-800 transition-colors">En promotion</span>
                </label>
              </div>
            </div>

            {d.hasActiveFilters && (
              <button onClick={() => { d.clearFilters(); setLocalMin(''); setLocalMax(''); }}
                className="text-[10px] font-black uppercase tracking-widest text-slate-300 hover:text-slate-700 transition-colors flex items-center gap-1.5">
                <X className="size-3"/> Réinitialiser les filtres
              </button>
            )}

            {/* Newsletter widget */}
            <div className="mt-2 pt-6 border-t border-slate-100 space-y-3">
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-300">Rejoignez-nous</p>
              <p className="text-xs text-slate-400">Recevez nos offres exclusives en avant-première.</p>
              <div className="flex gap-2">
                <input type="email" value={newsletterEmail} onChange={e => setNewsletterEmail(e.target.value)}
                  placeholder="Votre e-mail"
                  className="flex-1 h-9 px-3 text-xs border border-slate-100 rounded-lg focus:outline-none focus:border-slate-300 bg-slate-50 min-w-0" />
                <button onClick={() => { if (newsletterEmail) { setNewsletterEmail(''); } }}
                  className="h-9 w-9 flex items-center justify-center text-white rounded-lg shrink-0 hover:brightness-110 transition-all"
                  style={{ backgroundColor: primary }}>
                  →
                </button>
              </div>
            </div>
          </aside>

          {/* Mobile filter bar */}
          <div className="lg:hidden flex items-center gap-2 overflow-x-auto pb-4 mb-2 no-scrollbar">
            {['all', ...d.normalizedCategories].map(cat => (
              <button key={cat} onClick={() => { d.setSelectedCategory(cat); d.setSelectedCategoryStore(cat === 'all' ? null : cat); }}
                className="shrink-0 px-5 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-full border transition-all"
                style={d.selectedCategory === cat ? { backgroundColor: primary, borderColor: primary, color: '#fff' } : { borderColor: '#e5e7eb', color: '#9ca3af' }}>
                {cat === 'all' ? 'Tous' : cat}
              </button>
            ))}
            <button onClick={() => d.setInStockOnly(!d.inStockOnly)}
              className="shrink-0 px-5 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-full border transition-all"
              style={d.inStockOnly ? { backgroundColor: primary, borderColor: primary, color: '#fff' } : { borderColor: '#e5e7eb', color: '#9ca3af' }}>
              En stock
            </button>
            <button onClick={() => d.setPromoOnly(!d.promoOnly)}
              className="shrink-0 px-5 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-full border transition-all"
              style={d.promoOnly ? { backgroundColor: primary, borderColor: primary, color: '#fff' } : { borderColor: '#e5e7eb', color: '#9ca3af' }}>
              Promo
            </button>
          </div>

          {/* Grid — 3 columns on desktop */}
          <div className="flex-1 min-w-0">
            {d.loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="aspect-[4/5] bg-slate-100" />)}
              </div>
            ) : d.products.length === 0 ? (
              <div className="py-32 flex flex-col items-center gap-6 text-center">
                <div className="size-20 rounded-full bg-slate-50 flex items-center justify-center">
                  <Package className="size-8 text-slate-200" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-600">Aucun produit trouvé</p>
                  <p className="text-xs text-slate-400 mt-1">Essayez d'autres filtres</p>
                </div>
                <button onClick={d.clearFilters} className="px-8 py-3 text-[11px] font-black uppercase tracking-widest text-white rounded-xl transition-all hover:brightness-110"
                  style={{ backgroundColor: primary }}>
                  Réinitialiser
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-2 xl:grid-cols-3 gap-5 sm:gap-6">
                  <AnimatePresence mode="popLayout">
                    {d.products.map(p => (
                      <ProductCard key={p.id} product={p}
                        onQuickView={slug => setSelectedProductSlug(slug)}
                        onAddToCart={p => { addItem(p, 1); openCart(); }} />
                    ))}
                  </AnimatePresence>
                </div>
                <Pagination page={d.page} totalPages={d.totalPages} onPage={go} primary={primary} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// ATHLETIC GRID — Gymshark/Nike: black, dense, pill categories
// ══════════════════════════════════════════════════════════════════
function AthleticGrid({ storeId, primary, setStorefrontView }: { storeId: string; primary: string; setStorefrontView: (v: any) => void }) {
  const d = useProductData(storeId);
  const addItem = useCartStore(s => s.addItem);
  const openCart = useCartStore(s => s.openCart);
  const setSelectedProductSlug = useAppStore(s => s.setSelectedProductSlug);
  const [showSearch, setShowSearch] = useState(false);

  const go = (p: number) => { d.setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  return (
    <div className="bg-[#0A0A0A] min-h-screen text-white">
      {/* Top bar — categories + search */}
      <div className="sticky top-16 z-30 bg-[#0A0A0A] border-b border-white/5">
        <div className="max-w-[1800px] mx-auto px-5 sm:px-10">
          {/* Category scroll row */}
          <div className="flex items-center gap-0 overflow-x-auto no-scrollbar border-b border-white/5">
            {[{ id: 'all', label: 'TOUT' }, ...d.normalizedCategories.map(c => ({ id: c, label: c.toUpperCase() }))].map(cat => (
              <button key={cat.id} onClick={() => { d.setSelectedCategory(cat.id); d.setSelectedCategoryStore(cat.id === 'all' ? null : cat.id); }}
                className="shrink-0 h-12 px-5 text-[9px] font-black tracking-[0.3em] border-b-2 transition-all whitespace-nowrap"
                style={d.selectedCategory === cat.id
                  ? { borderBottomColor: primary, color: primary }
                  : { borderBottomColor: 'transparent', color: 'rgba(255,255,255,0.3)' }}>
                {cat.label}
              </button>
            ))}
            {/* Search toggle */}
            <button onClick={() => setShowSearch(s => !s)} className="ml-auto shrink-0 h-12 px-5 flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-white/30 hover:text-white transition-colors">
              <Search className="size-4" /> {showSearch ? 'Fermer' : 'Recherche'}
            </button>
          </div>
          {/* Search row */}
          {showSearch && (
            <div className="flex items-center gap-4 py-3 border-b border-white/5">
              <Search className="size-4 text-white/20 shrink-0" />
              <input type="text" value={d.search} onChange={e => d.setSearch(e.target.value)} autoFocus
                placeholder="CHERCHER UN PRODUIT..."
                className="flex-1 bg-transparent text-[11px] font-black uppercase tracking-widest text-white placeholder:text-white/20 focus:outline-none" />
              {d.search && <button onClick={() => d.setSearch('')}><X className="size-4 text-white/30" /></button>}
            </div>
          )}
          {/* Sort + count bar */}
          <div className="flex items-center justify-between h-11">
            <span className="text-[9px] font-black uppercase tracking-[0.3em] text-white/20">{d.total} produits</span>
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="size-3.5 text-white/20" />
              <select value={d.sortBy} onChange={e => d.setSortBy(e.target.value as SortOption)}
                className="text-[9px] font-black uppercase tracking-[0.25em] bg-transparent text-white/30 border-none outline-none cursor-pointer">
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value} className="bg-[#111] text-white">{o.label}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="max-w-[1800px] mx-auto px-5 sm:px-10 py-8">
        {d.loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-px bg-white/5">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-[4/5] bg-[#111]" />)}
          </div>
        ) : d.products.length === 0 ? (
          <div className="py-40 flex flex-col items-center gap-6 text-center">
            <Package className="size-12 text-white/10" />
            <p className="text-[11px] font-black uppercase tracking-[0.3em] text-white/30">Aucun produit</p>
            <button onClick={d.clearFilters} className="px-8 py-3 text-[9px] font-black uppercase tracking-[0.3em] text-black transition-all"
              style={{ backgroundColor: primary }}>
              Réinitialiser les filtres
            </button>
          </div>
        ) : (
          <>
            {/* Dense grid with 1px gap (like Gymshark) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-px bg-white/5">
              <AnimatePresence mode="popLayout">
                {d.products.map(p => (
                  <div key={p.id} className="bg-[#0A0A0A]">
                    <ProductCard product={p}
                      onQuickView={slug => setSelectedProductSlug(slug)}
                      onAddToCart={p => { addItem(p, 1); openCart(); }} />
                  </div>
                ))}
              </AnimatePresence>
            </div>
            <Pagination page={d.page} totalPages={d.totalPages} onPage={go} primary={primary} dark />
          </>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// LUXE GRID — Maison de Couture: navy, 2-col max, editorial space
// ══════════════════════════════════════════════════════════════════
function LuxeGrid({ storeId, primary, setStorefrontView }: { storeId: string; primary: string; setStorefrontView: (v: any) => void }) {
  const d = useProductData(storeId);
  const addItem = useCartStore(s => s.addItem);
  const openCart = useCartStore(s => s.openCart);
  const setSelectedProductSlug = useAppStore(s => s.setSelectedProductSlug);

  const go = (p: number) => { d.setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0C0F1A' }}>
      <div className="max-w-[1400px] mx-auto px-5 sm:px-10 py-16 sm:py-24">

        {/* Editorial header */}
        <div className="mb-20">
          <div className="flex items-center gap-4 mb-8">
            <button onClick={() => setStorefrontView('home')} className="text-[9px] tracking-[0.4em] uppercase transition-colors" style={{ color: `${primary}50` }}>
              Accueil
            </button>
            <span style={{ color: `${primary}20` }}>—</span>
            <span className="text-[9px] tracking-[0.4em] uppercase" style={{ color: `${primary}60` }}>Collection</span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-8">
            <div>
              <h1 className="text-5xl sm:text-7xl font-thin tracking-[-0.02em] text-white leading-[0.9]">
                {d.selectedCategory === 'all' ? 'La Collection' : d.selectedCategory}
              </h1>
              <p className="mt-4 text-xs font-light tracking-[0.4em] uppercase" style={{ color: `${primary}50` }}>
                {d.total} pièces sélectionnées
              </p>
            </div>
            <select value={d.sortBy} onChange={e => d.setSortBy(e.target.value as SortOption)}
              className="text-[10px] tracking-[0.3em] uppercase font-light border-b pb-2 bg-transparent outline-none cursor-pointer"
              style={{ borderColor: `${primary}20`, color: `${primary}60` }}>
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value} style={{ backgroundColor: '#0C0F1A', color: '#fff' }}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {/* Thin tab filter */}
        <div className="flex items-center gap-8 mb-16 overflow-x-auto no-scrollbar border-b pb-6" style={{ borderColor: `${primary}10` }}>
          {[{ id: 'all', label: 'Tout' }, ...d.normalizedCategories.map(c => ({ id: c, label: c }))].map(cat => (
            <button key={cat.id} onClick={() => { d.setSelectedCategory(cat.id); d.setSelectedCategoryStore(cat.id === 'all' ? null : cat.id); }}
              className="shrink-0 text-[10px] tracking-[0.35em] uppercase font-light pb-1 border-b transition-all whitespace-nowrap"
              style={d.selectedCategory === cat.id
                ? { color: primary, borderBottomColor: primary }
                : { color: 'rgba(255,255,255,0.25)', borderBottomColor: 'transparent' }}>
              {cat.label}
            </button>
          ))}
        </div>

        {/* Grid — max 3 col, generous gap */}
        {d.loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="aspect-[2/3] rounded-none" style={{ backgroundColor: '#12172A' }} />)}
          </div>
        ) : d.products.length === 0 ? (
          <div className="py-40 flex flex-col items-center gap-8 text-center">
            <div className="size-20 border flex items-center justify-center" style={{ borderColor: `${primary}15` }}>
              <Package className="size-8" style={{ color: `${primary}30` }} />
            </div>
            <div>
              <p className="text-sm font-light tracking-[0.2em] uppercase text-white/40">Aucun résultat</p>
            </div>
            <button onClick={d.clearFilters} className="px-10 py-3 border text-[10px] tracking-[0.3em] uppercase font-light transition-all"
              style={{ borderColor: `${primary}30`, color: primary }}>
              Réinitialiser
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 sm:gap-10">
              <AnimatePresence mode="popLayout">
                {d.products.map(p => (
                  <ProductCard key={p.id} product={p}
                    onQuickView={slug => setSelectedProductSlug(slug)}
                    onAddToCart={p => { addItem(p, 1); openCart(); }} />
                ))}
              </AnimatePresence>
            </div>
            <Pagination page={d.page} totalPages={d.totalPages} onPage={go} primary={primary} dark />
          </>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ══════════════════════════════════════════════════════════════════
export function ProductGrid() {
  const activeStore = useAppStore(s => s.activeStore);
  const setStorefrontView = useAppStore(s => s.setStorefrontView);
  const _raw = (activeStore?.template_id ?? 'clean') as string;
  const tpl = _raw === 'minimalist' ? 'clean' : _raw === 'landing' ? 'athletic' : _raw;
  const primary = (activeStore?.theme_config?.primaryColor as string) || '#4b7bec';
  const storeId = activeStore?.id;

  if (!storeId) return null;

  if (tpl === 'athletic') return <AthleticGrid storeId={storeId} primary={primary} setStorefrontView={setStorefrontView} />;
  if (tpl === 'luxe') return <LuxeGrid storeId={storeId} primary={primary} setStorefrontView={setStorefrontView} />;
  return <CleanGrid storeId={storeId} primary={primary} setStorefrontView={setStorefrontView} />;
}
