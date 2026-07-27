'use client';

import React from 'react';
import { Box, Eye, ArrowRightLeft, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { C, getProductVariantItems } from '../utils';

export function StockTable({
   productsQuery,
   products,
   variant,
   setViewingProduct,
   handleAdjustClick,
   fetchingProductId
}: {
   productsQuery: any;
   products: any[];
   variant: 'full' | 'alerts';
   setViewingProduct: (product: any) => void;
   handleAdjustClick: (product: any) => void;
   fetchingProductId: string | null;
}) {
   return (
      <div className="overflow-x-auto border rounded-2xl bg-white shadow-sm" style={{ borderColor: C.border }}>
         <table className="w-full text-left" style={{ minWidth: variant === 'alerts' ? '1000px' : '1200px' }}>
            <thead>
               <tr className="border-b bg-[#FAFBFD]" style={{ borderColor: C.border }}>
                  <th className="px-6 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest w-16">Asset</th>
                  <th className="px-6 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest">Produit Identifiant</th>
                  {variant === 'alerts' ? (
                     <>
                        <th className="px-3 py-4 text-[10px] font-black text-[#E17055] uppercase tracking-widest text-center">Seuil Min.</th>
                        <th className="px-3 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-center">Disponible</th>
                        <th className="px-3 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-center">En Transit</th>
                        <th className="px-3 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-right">Action</th>
                     </>
                  ) : (
                     <>
                        <th className="px-3 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-center">Dispo.</th>
                        <th className="px-3 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-center">Réservé</th>
                        <th className="px-3 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-center">En Cours</th>
                        <th className="px-3 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-center text-[#E17055]">Rupture</th>
                        <th className="px-5 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-right">Prix Achat</th>
                        <th className="px-5 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-right">Valeur Stock</th>
                        <th className="px-4 py-4 w-12"></th>
                     </>
                  )}
               </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: C.border }}>
               {productsQuery.isLoading ? (
                  [1,2,3].map(i => <tr key={i}><td colSpan={10} className="py-10 animate-pulse bg-[#FAFBFD]/30" /></tr>)
               ) : products.length === 0 ? (
                  <tr><td colSpan={10} className="py-20 text-center text-[#B2BEC3] text-sm font-black uppercase tracking-widest">Aucune donnée disponible</td></tr>
               ) : products.map((p) => {
                  const available = Math.max(0, (p.stock || 0) - (p.reserved_stock || 0));
                  const isLow = available <= (p.low_stock_threshold || 5);
                  return (
                     <tr key={p.id} className="hover:bg-[#FAFBFD] transition-colors group">
                        <td className="px-6 py-4">
                           <div className="size-11 bg-[#F8F9FC] border rounded-xl overflow-hidden shrink-0 group-hover:border-[#6C5CE7]/30 transition-all" style={{ borderColor: C.border }}>
                              {p.main_image ? <img src={p.main_image} className="size-full object-cover" /> : <Box className="size-full p-3 opacity-10 text-[#2D3436]" />}
                           </div>
                        </td>
                        <td className="px-6 py-4">
                           <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-black text-[#2D3436] tracking-tight line-clamp-1 uppercase">{p.name}</p>
                              {variant !== 'alerts' && (
                                 available <= 0
                                    ? <Badge className="bg-[#FFEDE9] text-[#E17055] border-none text-[8px] font-black tracking-widest uppercase shrink-0">RUPTURE</Badge>
                                    : isLow
                                       ? <Badge className="bg-[#FFF8E6] text-[#FDCB6E] border-none text-[8px] font-black tracking-widest uppercase shrink-0">FAIBLE</Badge>
                                       : <Badge className="bg-[#E6FFF8] text-[#00B894] border-none text-[8px] font-black tracking-widest uppercase shrink-0">DISPONIBLE</Badge>
                              )}
                           </div>
                           <p className="text-[10px] font-black text-[#6C5CE7] font-mono mt-0.5 tracking-wider">SKU: {p.slug || 'N/A'}</p>
                           {variant !== 'alerts' && getProductVariantItems(p).length > 0 && (
                              <div className="flex items-center gap-1 flex-wrap mt-1.5 max-w-[280px]">
                                 {getProductVariantItems(p).map((vi, vIdx) => {
                                    const vAvailable = Math.max(0, vi.stock - vi.reserved);
                                    const vColor = vAvailable <= 0 ? { bg: '#FFEDE9', text: '#E17055' }
                                       : vAvailable <= (p.low_stock_threshold || 5) ? { bg: '#FFF8E6', text: '#FDCB6E' }
                                       : { bg: '#E6FFF8', text: '#00B894' };
                                    return (
                                       <span
                                          key={vIdx}
                                          title={vi.variantStr}
                                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[8px] font-black tracking-wide whitespace-nowrap"
                                          style={{ backgroundColor: vColor.bg, color: vColor.text }}
                                       >
                                          {vi.variantStr.length > 18 ? vi.variantStr.slice(0, 18) + '…' : vi.variantStr}
                                          <span className="opacity-70">· {vAvailable} dispo{vi.reserved > 0 ? ` / ${vi.reserved} résa` : ''}</span>
                                          {vi.returned > 0 && (
                                             <span className="opacity-70">· ↩ {vi.returned} retour{vi.returned > 1 ? 's' : ''}</span>
                                          )}
                                       </span>
                                    );
                                 })}
                              </div>
                           )}
                        </td>
                        {variant === 'alerts' ? (
                           <>
                              <td className="px-3 text-center"><span className="text-sm font-black text-[#E17055] tabular-nums">{p.low_stock_threshold || 5}</span></td>
                              <td className="px-3 text-center"><span className="text-sm font-black text-[#2D3436] tabular-nums">{p.stock}</span></td>
                              <td className="px-3 text-center"><span className="text-xs font-bold text-[#FDCB6E] tabular-nums">0</span></td>
                              <td className="px-3 text-right">
                                 <button
                                    onClick={() => setViewingProduct(p)}
                                    className="px-4 py-2 rounded-xl border text-[10px] font-black uppercase text-[#6C5CE7] hover:bg-[#F0EDFF] transition-all ml-auto block"
                                    style={{ borderColor: C.primary }}
                                 >
                                    Traiter
                                 </button>
                              </td>
                           </>
                        ) : (
                           <>
                              <td className="px-3 text-center"><span className="text-sm font-black text-[#2D3436] tabular-nums">{p.stock || 0}</span></td>
                              <td className="px-3 text-center"><span className="text-xs font-bold text-[#636E72] tabular-nums">{p.reserved_stock || 0}</span></td>
                              <td className="px-3 text-center"><span className="text-sm font-black text-[#00B894] tabular-nums">{available}</span></td>
                              <td className="px-3 text-center">
                                 <div className="flex justify-center">
                                    <div className={cn("size-6 rounded-full flex items-center justify-center border", available <= 0 ? "bg-[#FFEDE9] text-[#E17055] border-[#E17055]/30" : "bg-[#F8F9FC] text-[#B2BEC3] border-transparent")}>
                                       <span className="text-[10px] font-black">!</span>
                                    </div>
                                 </div>
                              </td>
                              <td className="px-5 text-right"><span className="text-xs font-bold text-[#636E72] tabular-nums">{formatPrice(p.cost_price || 0)}</span></td>
                              <td className="px-5 text-right"><span className="text-sm font-black text-[#2D3436] tabular-nums">{formatPrice((p.cost_price || 0) * (p.stock || 0))}</span></td>
                              <td className="px-4 text-right">
                                 <div className="flex items-center justify-end gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                       onClick={() => setViewingProduct(p)}
                                       className="size-9 rounded-xl flex items-center justify-center text-[#B2BEC3] hover:text-[#2D3436] hover:bg-[#F8F9FC] transition-all"
                                    >
                                       <Eye className="size-4" />
                                    </button>
                                    <button
                                       disabled={fetchingProductId === p.id}
                                       onClick={() => handleAdjustClick(p)}
                                       className="size-9 rounded-xl flex items-center justify-center text-[#B2BEC3] hover:text-[#6C5CE7] hover:bg-[#F0EDFF] transition-all"
                                    >
                                       {fetchingProductId === p.id ? <Loader2 className="size-4 animate-spin text-[#6C5CE7]" /> : <ArrowRightLeft className="size-4" />}
                                    </button>
                                 </div>
                              </td>
                           </>
                        )}
                     </tr>
                  );
               })}
            </tbody>
         </table>
      </div>
   );
}
