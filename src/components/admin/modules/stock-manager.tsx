'use client';

import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { apiFetch } from '@/lib/api-client';
import { C } from './stock-manager/utils';

// Import child components
import { StockFilters } from './stock-manager/components/stock-filters';
import { StockTable } from './stock-manager/components/stock-table';
import { ProductDetailSheet } from './stock-manager/components/product-detail-sheet';
import { StockAdjustModal } from './stock-manager/components/stock-adjust-modal';
import { StockEntryModal } from './stock-manager/components/stock-entry-modal';
import { StockExitModal } from './stock-manager/components/stock-exit-modal';

export default function StockManager({ variant = 'all' }: { variant?: 'all' | 'alerts' | 'history' }) {
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [isEntryOpen, setIsEntryOpen] = useState(false);
  const [isExitOpen, setIsExitOpen] = useState(false);
  const [viewingProduct, setViewingProduct] = useState<any>(null);
  
  const [adjustingProduct, setAdjustingProduct] = useState<any>(null);
  const [fetchingProductId, setFetchingProductId] = useState<string | null>(null);

  const storeId = useAppStore(s => s.activeStore?.id) || '';

  const warehousesQuery = useQuery({
     queryKey: ['admin-warehouses', storeId],
     queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/warehouses/?store_id=${storeId}`),
     enabled: !!storeId,
  });
  const warehouses = warehousesQuery.data?.data || [];

  const productsQuery = useQuery({
    queryKey: ['admin-products-stock', search, warehouseId, variant],
    queryFn: () => {
       const params = new URLSearchParams();
       if (search) params.append('q', search);
       if (warehouseId !== 'all') params.append('warehouse_id', warehouseId);
       if (variant === 'alerts') params.append('low_stock_only', 'true');
       return apiFetch<{ success: boolean; data: any[]; total: number }>(`/api/v1/products/?${params.toString()}`);
    },
    refetchInterval: 60000,
  });
  const products = productsQuery.data?.data ?? [];

  const returnsQuery = useQuery({
     queryKey: ['returns-by-variant', storeId],
     queryFn: () => apiFetch<{ data: Record<string, Record<string, number>> }>(`/api/v1/stock/returns-by-variant?store_id=${storeId}`),
     enabled: !!storeId,
     refetchInterval: 120000,
  });
  const returnsByVariant = returnsQuery.data?.data || {};

  const handleAdjustClick = async (p: any) => {
    setFetchingProductId(p.id);
    try {
       const res = await apiFetch<any>(`/api/v1/products/${p.id}`);
       if (res.success && res.data) {
          const fetchedProduct = res.data;
          // Inject returns data dynamically for variants
          const productReturns = returnsByVariant[fetchedProduct.id] || {};
          if (fetchedProduct.variants) {
             fetchedProduct.variants = fetchedProduct.variants.map((v: any) => {
                let vars = v;
                if (typeof vars === 'string') {
                   try { vars = JSON.parse(vars); } catch { return vars; }
                }
                if (vars.sub_variants && vars.sub_variants.length > 0) {
                   vars.sub_variants = vars.sub_variants.map((sv: any) => {
                      const variantStr = `${vars.name}: ${vars.value}, ${sv.name || 'Taille'}: ${sv.value}`;
                      return { ...sv, returned: productReturns[variantStr] || 0 };
                   });
                } else {
                   const variantStr = `${vars.name}: ${vars.value}`;
                   vars.returned = productReturns[variantStr] || 0;
                }
                return vars;
             });
          }
          setAdjustingProduct(fetchedProduct);
       } else {
          setAdjustingProduct(p);
       }
    } catch (err) {
       setAdjustingProduct(p);
    } finally {
       setFetchingProductId(null);
    }
  };

  const quickAdjustProduct = useAppStore(s => s.quickAdjustProduct);
  const setQuickAdjustProduct = useAppStore(s => s.setQuickAdjustProduct);

  useEffect(() => {
     if (quickAdjustProduct) {
        handleAdjustClick(quickAdjustProduct);
        setQuickAdjustProduct(null);
     }
  }, [quickAdjustProduct, setQuickAdjustProduct]);

  return (
     <div className="space-y-6 animate-in fade-in duration-500">
       <StockFilters 
          search={search}
          setSearch={setSearch}
          showFilters={showFilters}
          setShowFilters={setShowFilters}
          warehouseId={warehouseId}
          setWarehouseId={setWarehouseId}
          warehouses={warehouses}
          setIsEntryOpen={setIsEntryOpen}
          setIsExitOpen={setIsExitOpen}
       />

       <StockTable 
          productsQuery={productsQuery}
          products={products}
          variant={variant as any}
          setViewingProduct={setViewingProduct}
          handleAdjustClick={handleAdjustClick}
          fetchingProductId={fetchingProductId}
       />

       {viewingProduct && (
          <ProductDetailSheet product={viewingProduct} storeId={storeId} onClose={() => setViewingProduct(null)} />
       )}

       {adjustingProduct && (
          <StockAdjustModal 
             product={adjustingProduct}
             storeId={storeId}
             onClose={() => setAdjustingProduct(null)}
          />
       )}

       {/* PAGINATION */}
       <div className="px-8 py-5 flex items-center justify-between">
          <div className="flex items-center gap-10">
             <div className="flex flex-col">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Total Matrix</span>
                <span className="text-sm font-black text-[#2D3436] tabular-nums">{productsQuery.data?.total || 0} Articles</span>
             </div>
          </div>
          <div className="flex items-center gap-2">
             <button className="size-10 rounded-xl flex items-center justify-center border text-[#636E72] hover:bg-[#F8F9FC] transition-colors disabled:opacity-30" style={{ borderColor: C.border }}>
                <ChevronLeft className="size-4" />
             </button>
             <span className="text-xs font-black text-white size-10 flex items-center justify-center rounded-xl shadow-lg shadow-indigo-100" style={{ backgroundColor: C.primary }}>1</span>
             <button className="size-10 rounded-xl flex items-center justify-center border text-[#636E72] hover:bg-[#F8F9FC] transition-colors disabled:opacity-30" style={{ borderColor: C.border }}>
                <ChevronRight className="size-4" />
             </button>
          </div>
       </div>

       <StockEntryModal 
          open={isEntryOpen} 
          onOpenChange={setIsEntryOpen} 
          products={products} 
          warehouses={warehouses} 
          storeId={storeId} 
       />

       <StockExitModal 
          open={isExitOpen} 
          onOpenChange={setIsExitOpen} 
          products={products} 
          warehouses={warehouses} 
          storeId={storeId} 
       />
    </div>
  );
}
