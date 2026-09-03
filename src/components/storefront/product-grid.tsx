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
import { cn } from '@/lib/utils';

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
      const params = new URLSearchParams({ store_id: storeId, page: String(page), pageSize: String(pageSize), sort: sortBy, is_active: 'true' });
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
// CLEAN GRID — Meta Ads Template Minimalist Catalog (100% Responsive)
// ══════════════════════════════════════════════════════════════════
function CleanGrid({ storeId, primary, setStorefrontView }: { storeId: string; primary: string; setStorefrontView: (v: any) => void }) {
  const d = useProductData(storeId);
  const addItem = useCartStore(s => s.addItem);
  const openCart = useCartStore(s => s.openCart);
  const setSelectedProductSlug = useAppStore(s => s.setSelectedProductSlug);

  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [localMin, setLocalMin] = useState('');
  const [localMax, setLocalMax] = useState('');

  const go = (p: number) => { d.setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const applyPrice = () => {
    const mn = localMin !== '' ? parseFloat(localMin) : null;
    const mx = localMax !== '' ? parseFloat(localMax) : null;
    d.setMinPrice(mn);
    d.setMaxPrice(mx);
  };

  const activeFilterCount = (d.selectedCategory !== 'all' && d.selectedCategory !== null ? 1 : 0) +
    (d.minPrice !== null || d.maxPrice !== null ? 1 : 0) +
    (d.inStockOnly ? 1 : 0) +
    (d.promoOnly ? 1 : 0);

  return (
    <div className="bg-[#F8F9FC] min-h-screen">
      <div className="max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-12 py-5 sm:py-8 lg:py-12 space-y-4 sm:space-y-6">

        {/* Top Header Card (Meta Ads Style — 100% Responsive) */}
        <div className="bg-white rounded-2xl sm:rounded-[32px] border border-slate-100 p-4 sm:p-6 lg:p-7 shadow-sm flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 sm:gap-6">
          <div className="w-full lg:w-auto">
            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
              <button onClick={() => setStorefrontView('home')} className="hover:text-slate-900 transition-colors">Accueil</button>
              <ChevronRight className="size-3 text-slate-300" />
              <span className="text-slate-800">Catalogue</span>
            </div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-lg sm:text-2xl font-black text-slate-900 uppercase tracking-tight">
                {d.selectedCategory === 'all' ? 'Toutes les collections' : d.selectedCategory}
              </h1>
              <span className="px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase font-mono bg-blue-50 text-[#4b7bec] border border-blue-100">
                {d.total} article{d.total > 1 ? 's' : ''}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5 sm:mt-1 hidden sm:block">
              Parcourez notre catalogue officiel avec livraison rapide sur les 58 Wilayas et paiement cash à la livraison.
            </p>
          </div>

          {/* Quick Tactical Actions: Search, Filter Toggle, Sort */}
          <div className="flex items-center gap-2 sm:gap-3 w-full lg:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
              <input
                type="text"
                value={d.search}
                onChange={e => d.setSearch(e.target.value)}
                placeholder="Rechercher..."
                className="w-full h-11 pl-9 pr-8 text-xs font-medium rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:bg-white focus:border-[#4b7bec] transition-all"
              />
              {d.search && (
                <button onClick={() => d.setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            {/* Mobile Filter Button (Visible on mobile/tablet < lg) */}
            <button
              onClick={() => setMobileFilterOpen(true)}
              className={cn(
                "lg:hidden size-11 rounded-xl border flex items-center justify-center relative shrink-0 transition-all active:scale-95 shadow-2xs",
                activeFilterCount > 0 
                  ? "bg-slate-900 border-slate-900 text-white" 
                  : "bg-slate-50 border-slate-200/80 text-slate-700 hover:bg-slate-100"
              )}
              title="Filtres"
            >
              <Filter className="size-4" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 size-4 rounded-full bg-[#4b7bec] text-white text-[9px] font-mono font-black flex items-center justify-center shadow-xs">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* Sort Selector */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200/80 rounded-xl px-2.5 h-11 shadow-2xs shrink-0">
              <SlidersHorizontal className="size-3.5 text-slate-400 shrink-0" />
              <select 
                value={d.sortBy} 
                onChange={e => d.setSortBy(e.target.value as SortOption)}
                className="text-xs font-bold text-slate-700 bg-transparent border-none outline-none cursor-pointer"
              >
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Global Catalog Highlights Row (Meta Ads KPI Style — Fully Responsive) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-4">
          <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-100 p-3 sm:p-4 shadow-sm space-y-0.5">
            <span className="text-[8px] sm:text-[9px] font-black uppercase tracking-wider text-slate-400">Catalogue Actif</span>
            <p className="text-sm sm:text-lg font-black text-slate-900 font-mono">{d.total} Références</p>
            <p className="text-[9px] sm:text-[10px] font-bold text-emerald-600 truncate">Produits certifiés</p>
          </div>
          <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-100 p-3 sm:p-4 shadow-sm space-y-0.5">
            <span className="text-[8px] sm:text-[9px] font-black uppercase tracking-wider text-slate-400">Expédition</span>
            <p className="text-sm sm:text-lg font-black text-slate-900 font-mono">58 Wilayas</p>
            <p className="text-[9px] sm:text-[10px] font-bold text-slate-400 truncate">Domicile & Relais</p>
          </div>
          <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-100 p-3 sm:p-4 shadow-sm space-y-0.5">
            <span className="text-[8px] sm:text-[9px] font-black uppercase tracking-wider text-slate-400">Paiement</span>
            <p className="text-sm sm:text-lg font-black text-slate-900 font-mono">Cash (COD)</p>
            <p className="text-[9px] sm:text-[10px] font-bold text-emerald-600 truncate">À la réception</p>
          </div>
          <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-100 p-3 sm:p-4 shadow-sm space-y-0.5">
            <span className="text-[8px] sm:text-[9px] font-black uppercase tracking-wider text-slate-400">Assistance</span>
            <p className="text-sm sm:text-lg font-black text-slate-900 font-mono">7j / 7</p>
            <p className="text-[9px] sm:text-[10px] font-bold text-slate-400 truncate">Support client réactif</p>
          </div>
        </div>

        {/* Mobile Filter Chips Row */}
        <div className="lg:hidden flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar w-full">
          {[{ id: 'all', label: 'Toutes les catégories' }, ...d.normalizedCategories.map(c => ({ id: c, label: c }))].map(cat => (
            <button 
              key={cat.id} 
              onClick={() => { d.setSelectedCategory(cat.id); d.setSelectedCategoryStore(cat.id === 'all' ? null : cat.id); }}
              className={cn(
                "shrink-0 px-3.5 py-2 text-xs font-bold rounded-xl border transition-all whitespace-nowrap shadow-2xs",
                d.selectedCategory === cat.id 
                  ? "bg-slate-900 text-white border-slate-900 font-black shadow-xs" 
                  : "bg-white text-slate-600 border-slate-200/80 hover:bg-slate-50"
              )}
            >
              {cat.label}
              {cat.id !== 'all' && d.categoryCounts[cat.id] !== undefined && (
                <span className="ml-1.5 opacity-60 font-mono text-[10px]">{d.categoryCounts[cat.id]}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Desktop Sidebar Filters */}
          <aside className="hidden lg:flex flex-col w-72 shrink-0 gap-5 sticky top-28 h-fit">

            {/* Categories Card */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm space-y-3">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Catégories</label>
              <div className="flex flex-col gap-1.5">
                {[{ id: 'all', label: 'Toutes les catégories' }, ...d.normalizedCategories.map(c => ({ id: c, label: c }))].map(cat => (
                  <button 
                    key={cat.id} 
                    onClick={() => { d.setSelectedCategory(cat.id); d.setSelectedCategoryStore(cat.id === 'all' ? null : cat.id); }}
                    className={cn(
                      "flex items-center justify-between text-xs font-bold text-left px-3.5 py-2.5 rounded-xl transition-all",
                      d.selectedCategory === cat.id 
                        ? "bg-blue-50 text-[#4b7bec] font-black shadow-2xs" 
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    )}
                  >
                    <span>{cat.label}</span>
                    {cat.id !== 'all' && d.categoryCounts[cat.id] !== undefined && (
                      <span className="text-[10px] font-mono font-bold text-slate-400">
                        {d.categoryCounts[cat.id]}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Price Filter Card */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm space-y-3">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Tranche de Prix (DA)</label>
              <div className="grid grid-cols-2 gap-2">
                <input 
                  type="number" 
                  value={localMin} 
                  onChange={e => setLocalMin(e.target.value)} 
                  placeholder="Min DA"
                  className="h-10 px-3 text-xs font-bold font-mono border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-[#4b7bec]" 
                />
                <input 
                  type="number" 
                  value={localMax} 
                  onChange={e => setLocalMax(e.target.value)} 
                  placeholder="Max DA"
                  className="h-10 px-3 text-xs font-bold font-mono border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-[#4b7bec]" 
                />
              </div>
              <button 
                onClick={applyPrice}
                className="w-full h-10 text-xs font-black uppercase tracking-wider text-white rounded-xl shadow-xs transition-all hover:opacity-95"
                style={{ backgroundColor: primary }}
              >
                Appliquer le filtre
              </button>
            </div>

            {/* Availability Checks */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm space-y-3">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Disponibilité</label>
              <div className="space-y-2.5">
                <label className="flex items-center gap-2.5 cursor-pointer text-xs font-bold text-slate-700">
                  <input 
                    type="checkbox" 
                    checked={d.inStockOnly} 
                    onChange={e => d.setInStockOnly(e.target.checked)}
                    className="size-4 rounded accent-[#4b7bec]" 
                  />
                  En stock uniquement
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer text-xs font-bold text-slate-700">
                  <input 
                    type="checkbox" 
                    checked={d.promoOnly} 
                    onChange={e => d.setPromoOnly(e.target.checked)}
                    className="size-4 rounded accent-[#4b7bec]" 
                  />
                  En promotion
                </label>
              </div>
            </div>

            {d.hasActiveFilters && (
              <button 
                onClick={() => { d.clearFilters(); setLocalMin(''); setLocalMax(''); }}
                className="h-10 rounded-xl text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors flex items-center justify-center gap-1.5 border border-rose-100"
              >
                <X className="size-3.5"/> Réinitialiser les filtres
              </button>
            )}
          </aside>

          {/* Main Product Grid (Adaptive Columns for all devices) */}
          <div className="flex-1 min-w-0">
            {d.loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-3 sm:gap-6">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-[4/5] bg-white rounded-2xl sm:rounded-[24px] border border-slate-100 shadow-sm" />
                ))}
              </div>
            ) : d.products.length === 0 ? (
              <div className="bg-white rounded-2xl sm:rounded-[32px] border border-slate-100 p-10 sm:p-16 flex flex-col items-center justify-center gap-4 text-center shadow-sm">
                <div className="size-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center">
                  <Package className="size-7" />
                </div>
                <h3 className="text-base font-black text-slate-900">Aucun produit disponible</h3>
                <p className="text-xs text-slate-400 max-w-sm">
                  {d.hasActiveFilters ? 'Aucun produit ne correspond à vos filtres sélectionnés.' : 'Le catalogue de cette boutique sera bientôt complété.'}
                </p>
                {d.hasActiveFilters && (
                  <button 
                    onClick={() => { d.clearFilters(); setLocalMin(''); setLocalMax(''); }}
                    className="mt-2 h-10 px-5 rounded-xl text-xs font-black uppercase tracking-wider text-white bg-slate-900 hover:bg-slate-800 transition-all"
                  >
                    Effacer les filtres
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-3 sm:gap-6">
                  {d.products.map(product => (
                    <ProductCard 
                      key={product.id} 
                      product={product}
                      onQuickView={(slug) => { 
                        setSelectedProductSlug(slug); 
                        setStorefrontView('product'); 
                      }}
                      onAddToCart={(p) => { addItem(p, 1); openCart(); }}
                    />
                  ))}
                </div>

                <Pagination 
                  page={d.page} 
                  totalPages={d.totalPages} 
                  onPage={go} 
                  primary={primary} 
                />
              </>
            )}
          </div>

        </div>

      </div>

      {/* Mobile Filter Drawer Modal */}
      <AnimatePresence>
        {mobileFilterOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex justify-end">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              className="absolute inset-0 bg-black/50 backdrop-blur-xs" 
              onClick={() => setMobileFilterOpen(false)} 
            />
            <motion.div 
              initial={{ x: '100%' }} 
              animate={{ x: 0 }} 
              exit={{ x: '100%' }} 
              transition={{ type: 'spring', damping: 28, stiffness: 240 }}
              className="relative w-full max-w-xs sm:max-w-sm bg-white h-full shadow-2xl flex flex-col z-10"
            >
              {/* Drawer Header */}
              <div className="flex items-center justify-between p-5 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="size-4 text-slate-900" />
                  <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">Filtres du catalogue</h3>
                </div>
                <button 
                  onClick={() => setMobileFilterOpen(false)} 
                  className="size-8 rounded-xl bg-slate-50 border border-slate-200/80 text-slate-500 hover:text-slate-900 flex items-center justify-center"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Drawer Content */}
              <div className="flex-1 overflow-y-auto p-5 space-y-6">
                {/* Categories */}
                <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Catégories</label>
                  <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-1">
                    {[{ id: 'all', label: 'Toutes les catégories' }, ...d.normalizedCategories.map(c => ({ id: c, label: c }))].map(cat => (
                      <button 
                        key={cat.id} 
                        onClick={() => { d.setSelectedCategory(cat.id); d.setSelectedCategoryStore(cat.id === 'all' ? null : cat.id); }}
                        className={cn(
                          "flex items-center justify-between text-xs font-bold text-left px-3 py-2 rounded-xl transition-all",
                          d.selectedCategory === cat.id 
                            ? "bg-slate-900 text-white font-black" 
                            : "text-slate-600 hover:bg-slate-50"
                        )}
                      >
                        <span>{cat.label}</span>
                        {cat.id !== 'all' && d.categoryCounts[cat.id] !== undefined && (
                          <span className={cn(
                            "text-[10px] font-mono",
                            d.selectedCategory === cat.id ? "text-slate-300" : "text-slate-400"
                          )}>
                            {d.categoryCounts[cat.id]}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Price Range */}
                <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Prix (DA)</label>
                  <div className="grid grid-cols-2 gap-2">
                    <input 
                      type="number" 
                      value={localMin} 
                      onChange={e => setLocalMin(e.target.value)} 
                      placeholder="Min DA"
                      className="h-10 px-3 text-xs font-bold font-mono border border-slate-200 rounded-xl bg-slate-50 focus:bg-white" 
                    />
                    <input 
                      type="number" 
                      value={localMax} 
                      onChange={e => setLocalMax(e.target.value)} 
                      placeholder="Max DA"
                      className="h-10 px-3 text-xs font-bold font-mono border border-slate-200 rounded-xl bg-slate-50 focus:bg-white" 
                    />
                  </div>
                  <button 
                    onClick={applyPrice}
                    className="w-full h-10 text-xs font-black uppercase tracking-wider text-white rounded-xl shadow-xs"
                    style={{ backgroundColor: primary }}
                  >
                    Appliquer le prix
                  </button>
                </div>

                {/* Availability */}
                <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Disponibilité</label>
                  <div className="space-y-2.5">
                    <label className="flex items-center gap-2.5 cursor-pointer text-xs font-bold text-slate-700">
                      <input 
                        type="checkbox" 
                        checked={d.inStockOnly} 
                        onChange={e => d.setInStockOnly(e.target.checked)}
                        className="size-4 rounded accent-[#4b7bec]" 
                      />
                      En stock uniquement
                    </label>
                    <label className="flex items-center gap-2.5 cursor-pointer text-xs font-bold text-slate-700">
                      <input 
                        type="checkbox" 
                        checked={d.promoOnly} 
                        onChange={e => d.setPromoOnly(e.target.checked)}
                        className="size-4 rounded accent-[#4b7bec]" 
                      />
                      En promotion
                    </label>
                  </div>
                </div>
              </div>

              {/* Drawer Footer */}
              <div className="p-4 border-t border-slate-100 flex gap-2">
                {d.hasActiveFilters && (
                  <button 
                    onClick={() => { d.clearFilters(); setLocalMin(''); setLocalMax(''); }}
                    className="flex-1 h-11 text-xs font-bold text-rose-600 bg-rose-50 rounded-xl border border-rose-100"
                  >
                    Réinitialiser
                  </button>
                )}
                <button 
                  onClick={() => setMobileFilterOpen(false)}
                  className="flex-1 h-11 text-xs font-black uppercase tracking-wider text-white bg-slate-900 rounded-xl shadow-xs"
                >
                  Voir {d.total} produits
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
