'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Package, Loader2, Boxes, Clock, FileText } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';
import type { Product } from '@/lib/types';

/**
 * Read-only, simplified stock/movements views shared by roles that only
 * need to CHECK inventory (livreur, confirmatrice) — not manage pricing,
 * suppliers, purchases or warehouses like the full admin InventoryDashboard.
 */

// ─── Stock list ─────────────────────────────────────────────────────────────

export function SimpleStockList({ defaultFilter = 'all' }: { defaultFilter?: 'all' | 'low' | 'out' }) {
  const activeStore = useAppStore(s => s.activeStore);
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>(defaultFilter);

  const { data, isLoading } = useQuery<{ data: Product[] }>({
    queryKey: ['simple-stock-products', activeStore?.id],
    queryFn: () => apiFetch(`/api/v1/products?store_id=${activeStore?.id}&pageSize=500`),
    enabled: !!activeStore?.id,
  });

  const products = data?.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
      if (q && !p.name.toLowerCase().includes(q) && !p.sku?.toLowerCase().includes(q)) return false;
      const isOut = p.stock <= 0;
      const isLow = !isOut && p.stock <= (p.low_stock_threshold || 5);
      if (stockFilter === 'low' && !isLow) return false;
      if (stockFilter === 'out' && !isOut) return false;
      return true;
    });
  }, [products, search, stockFilter]);

  const lowCount = products.filter(p => p.stock > 0 && p.stock <= (p.low_stock_threshold || 5)).length;
  const outCount = products.filter(p => p.stock <= 0).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white border rounded-2xl p-3 text-center">
          <p className="text-[8px] font-black uppercase tracking-wider text-slate-400 leading-tight">Produits</p>
          <p className="text-2xl font-black text-slate-800 tabular-nums mt-1">{products.length}</p>
        </div>
        <div className="bg-white border rounded-2xl p-3 text-center">
          <p className="text-[8px] font-black uppercase tracking-wider text-slate-400 leading-tight">Stock faible</p>
          <p className="text-2xl font-black text-amber-500 tabular-nums mt-1">{lowCount}</p>
        </div>
        <div className="bg-white border rounded-2xl p-3 text-center">
          <p className="text-[8px] font-black uppercase tracking-wider text-slate-400 leading-tight">Rupture</p>
          <p className="text-2xl font-black text-rose-500 tabular-nums mt-1">{outCount}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-0.5 bg-white border p-1 rounded-2xl overflow-x-auto">
          {([
            ['all', 'Tous'],
            ['low', `Stock faible (${lowCount})`],
            ['out', `Rupture (${outCount})`],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setStockFilter(id)}
              className={cn(
                'px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap shrink-0',
                stockFilter === id ? 'bg-slate-900 text-white shadow' : 'text-slate-500 hover:bg-slate-50',
              )}
            >{label}</button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-300 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Nom du produit, référence..."
            className="w-full h-11 pl-9 pr-3 rounded-xl border bg-white text-sm font-medium outline-none focus:border-cyan-400"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center py-20 gap-3">
          <Loader2 className="size-8 animate-spin text-slate-200" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-dashed rounded-3xl py-20 text-center">
          <Boxes className="size-10 text-slate-200 mx-auto" />
          <p className="mt-3 text-xs font-bold text-slate-300 uppercase tracking-widest">
            {products.length === 0 ? 'Aucun produit' : 'Aucun résultat pour ce filtre'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(product => (
            <ProductStockCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductStockCard({ product }: { product: Product }) {
  const image = product.main_image || product.images?.[0];
  const isOut = product.stock <= 0;
  const isLow = !isOut && product.stock <= (product.low_stock_threshold || 5);

  return (
    <div className="bg-white border rounded-2xl p-3 flex items-center gap-3">
      <div className="size-12 rounded-xl bg-slate-100 border border-slate-100 flex items-center justify-center shrink-0 overflow-hidden">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={product.name} className="size-full object-cover" />
        ) : (
          <Package className="size-5 text-slate-300" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-black text-slate-800 leading-tight truncate">{product.name}</p>
        {product.sku && (
          <p className="text-[10px] font-bold text-slate-400 mt-0.5 truncate">Réf. {product.sku}</p>
        )}
        {(product.variants?.length ?? 0) > 0 && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {product.variants!.slice(0, 4).map((v, i) => (
              <span key={i} className="text-[9px] font-bold text-slate-500 bg-slate-50 border border-slate-100 rounded px-1.5 py-0.5">
                {v.value}{v.stock != null ? ` · ${v.stock}` : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      <span className={cn(
        'shrink-0 px-2.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider text-center tabular-nums',
        isOut ? 'bg-rose-50 text-rose-600' : isLow ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600',
      )}>
        {isOut ? 'Rupture' : `${product.stock} en stock`}
      </span>
    </div>
  );
}

// ─── Movements list ─────────────────────────────────────────────────────────

interface InventoryMovement {
  id: string;
  product_id: string;
  type: string;
  quantity: number;
  reason: string | null;
  created_at: string;
  actor?: { id: string; name: string; email: string; role: string };
}

const MOVEMENT_LABELS: Record<string, string> = {
  RESTOCK: 'Réapprovisionnement',
  ORDER_CONFIRM: 'Confirmation Commande',
  POS_SALE: 'Vente au Comptant (POS)',
};

export function SimpleMovementsList() {
  const activeStore = useAppStore(s => s.activeStore);
  const { data, isLoading } = useQuery<{ data: InventoryMovement[] }>({
    queryKey: ['simple-stock-movements', activeStore?.id],
    queryFn: () => apiFetch(`/api/v1/stock/?store_id=${activeStore?.id}&pageSize=30`),
    enabled: !!activeStore?.id,
  });

  const movements = data?.data ?? [];

  return (
    <div className="space-y-2">
      {isLoading ? (
        <div className="flex flex-col items-center py-20 gap-3">
          <Loader2 className="size-8 animate-spin text-slate-200" />
        </div>
      ) : movements.length === 0 ? (
        <div className="bg-white border border-dashed rounded-3xl py-20 text-center">
          <FileText className="size-10 text-slate-200 mx-auto" />
          <p className="mt-3 text-xs font-bold text-slate-300 uppercase tracking-widest">Aucun mouvement</p>
        </div>
      ) : (
        movements.map(m => (
          <div key={m.id} className="bg-white border rounded-2xl p-3 flex items-center gap-3">
            <div className="size-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0">
              <FileText className="size-4 text-slate-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-slate-800 truncate">
                {MOVEMENT_LABELS[m.type] || 'Ajustement Manuel'}
              </p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                  <Clock className="size-3" />
                  {new Date(m.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
                {m.actor?.name && <span className="text-[10px] font-bold text-slate-400">· {m.actor.name}</span>}
              </div>
            </div>
            <span className={cn(
              'shrink-0 px-2.5 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider tabular-nums',
              m.quantity > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600',
            )}>
              {m.quantity > 0 ? '+' : ''}{m.quantity}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
