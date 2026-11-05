'use client';

import React, { useState } from 'react';
import { 
  Sparkles, 
  TrendingUp, 
  DollarSign, 
  Settings, 
  UserCheck, 
  Plus, 
  Package, 
  Activity, 
  Clock, 
  Percent, 
  Check, 
  Coins, 
  ChevronRight,
  Filter,
  Trash2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/lib/format';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';

const C = {
   primary: '#6C5CE7',
   primaryBg: '#F0EDFF',
   success: '#00B894',
   successBg: '#E6FFF8',
   danger: '#E17055',
   dangerBg: '#FFEDE9',
   warning: '#FDCB6E',
   warningBg: '#FFF8E6',
   info: '#0984E3',
   infoBg: '#E8F4FE',
   text: '#2D3436',
   textLight: '#636E72',
   textDim: '#B2BEC3',
   border: '#E9ECF0',
   bg: '#F8F9FC',
};

export default function UpsellManager() {
  const activeStore = useAppStore((s) => s.activeStore);
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'STATS' | 'RULES' | 'COMMISSIONS'>('STATS');
  const [isCreatingRule, setIsCreatingRule] = useState(false);

  // --- New Rule Form State ---
  const [triggerProductId, setTriggerProductId] = useState('');
  const [selectedUpsellIds, setSelectedUpsellIds] = useState<string[]>([]);
  const [minQty, setMinQty] = useState(1);

  // --- Queries ---
  const { data: statsData, isLoading: isLoadingStats } = useQuery({
    queryKey: ['upsell_stats', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any }>(`/api/v1/upsell/stats?store_id=${activeStore?.id}`),
    enabled: !!activeStore?.id && activeTab === 'STATS',
  });

  const { data: rulesData, isLoading: isLoadingRules } = useQuery({
    queryKey: ['upsell_rules', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/upsell/rules?store_id=${activeStore?.id}`),
    enabled: !!activeStore?.id && (activeTab === 'RULES' || isCreatingRule),
  });

  const { data: commissionsData, isLoading: isLoadingCommissions } = useQuery({
    queryKey: ['upsell_commissions', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/upsell/commissions?store_id=${activeStore?.id}`),
    enabled: !!activeStore?.id && activeTab === 'COMMISSIONS',
  });

  const { data: productsData } = useQuery({
    queryKey: ['products', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/products?store_id=${activeStore?.id}`),
    enabled: isCreatingRule && !!activeStore?.id,
  });

  const stats = statsData?.data || { total_offers: 0, total_accepted: 0, upsell_rate: 0, total_revenue: 0, top_products: [] };
  const rules = rulesData?.data || [];
  const commissions = commissionsData?.data || [];
  const products = productsData?.data || [];

  // --- Mutations ---
  const saveRuleMutation = useMutation({
    mutationFn: (payload: any) => apiFetch('/api/v1/upsell/rules', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['upsell_rules'] });
      toast.success('Règle d\'upsell configurée avec succès !');
      setIsCreatingRule(false);
      setTriggerProductId('');
      setSelectedUpsellIds([]);
      setMinQty(1);
    },
    onError: (err: any) => {
      toast.error('Erreur', { description: err.message });
    }
  });

  const payCommissionMutation = useMutation({
    mutationFn: (commId: string) => apiFetch(`/api/v1/upsell/commissions/${commId}/pay`, {
      method: 'POST'
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['upsell_commissions'] });
      toast.success('Commission marquée comme payée avec succès !');
    },
    onError: (err: any) => {
      toast.error('Erreur', { description: err.message });
    }
  });

  const handleSaveRule = () => {
    if (!triggerProductId || selectedUpsellIds.length === 0) return toast.error('Veuillez renseigner le déclencheur et au moins un produit upsell');
    saveRuleMutation.mutate({
      store_id: activeStore?.id,
      product_id: triggerProductId,
      upsell_product_ids: selectedUpsellIds,
      trigger_conditions: { min_quantity: minQty }
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      
      {/* ─── TAB NAVIGATION ─── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-2xl border shadow-sm">
        <div className="flex bg-[#F8F9FC] p-1 rounded-xl">
          <button 
            onClick={() => setActiveTab('STATS')}
            className={cn("px-5 py-2.5 rounded-lg text-xs font-black tracking-wide transition-all", activeTab === 'STATS' ? "bg-white text-black shadow-sm" : "text-[#636E72] hover:text-black")}
          >
            Performances & Stats
          </button>
          <button 
            onClick={() => setActiveTab('RULES')}
            className={cn("px-5 py-2.5 rounded-lg text-xs font-black tracking-wide transition-all", activeTab === 'RULES' ? "bg-white text-black shadow-sm" : "text-[#636E72] hover:text-black")}
          >
            Règles d'Upsell
          </button>
          <button 
            onClick={() => setActiveTab('COMMISSIONS')}
            className={cn("px-5 py-2.5 rounded-lg text-xs font-black tracking-wide transition-all", activeTab === 'COMMISSIONS' ? "bg-white text-black shadow-sm" : "text-[#636E72] hover:text-black")}
          >
            Commissions Confirmatrices
          </button>
        </div>

        {activeTab === 'RULES' && (
          <Button onClick={() => setIsCreatingRule(true)} className="h-11 px-5 rounded-xl bg-black text-white text-xs font-black uppercase hover:opacity-90 shadow-sm">
            <Plus className="mr-2 size-4" /> Configurer une règle
          </Button>
        )}
      </div>

      {/* ─── TAB CONTENT: STATS ─── */}
      {activeTab === 'STATS' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            <div className="bg-white p-6 rounded-2xl border shadow-sm flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Offres Proposées</span>
                <h2 className="text-2xl font-black text-[#2D3436] tabular-nums">{stats.total_offers}</h2>
                <span className="text-[9px] font-bold text-[#636E72] uppercase">Tentatives d'upsell</span>
              </div>
              <div className="size-12 rounded-xl bg-neutral-50 flex items-center justify-center text-neutral-500">
                <Activity className="size-5" />
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border shadow-sm flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Offres Acceptées</span>
                <h2 className="text-2xl font-black text-[#2D3436] tabular-nums">{stats.total_accepted}</h2>
                <span className="text-[9px] font-bold text-[#00B894] uppercase">Taux de conversion</span>
              </div>
              <div className="size-12 rounded-xl bg-[#E6FFF8] flex items-center justify-center text-[#00B894]">
                <UserCheck className="size-5" />
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border shadow-sm flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Revenu Supplémentaire</span>
                <h2 className="text-2xl font-black text-[#6C5CE7] tabular-nums">{formatPrice(stats.total_revenue)}</h2>
                <span className="text-[9px] font-bold text-[#6C5CE7] uppercase">Ventes additionnelles</span>
              </div>
              <div className="size-12 rounded-xl bg-[#F0EDFF] flex items-center justify-center text-[#6C5CE7]">
                <DollarSign className="size-5" />
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border shadow-sm flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Taux d'Upsell</span>
                <h2 className="text-3xl font-black text-[#2D3436] tabular-nums">{stats.upsell_rate}%</h2>
                <span className="text-[9px] font-bold text-[#636E72] uppercase">Rentabilité convertie</span>
              </div>
              <div className="size-12 rounded-xl bg-orange-50 flex items-center justify-center text-orange-400">
                <Percent className="size-5" />
              </div>
            </div>

          </div>

          {/* Top Products Upsell */}
          <div className="bg-white p-6 rounded-3xl border shadow-sm">
            <h3 className="text-sm font-black uppercase tracking-wider mb-6 flex items-center gap-1.5">
              <Sparkles className="size-4 text-[#6C5CE7]" /> Top produits vendus en Upsell
            </h3>
            
            <div className="space-y-4">
              {stats.top_products?.length === 0 ? (
                <div className="text-center py-10 text-xs text-[#B2BEC3] font-bold uppercase tracking-tight">Aucun produit upsell converti pour le moment</div>
              ) : stats.top_products?.map((p: any, idx: number) => (
                <div key={p.product_id} className="flex items-center justify-between p-4 bg-[#F8F9FC] rounded-2xl border border-[#E9ECF0] hover:scale-[1.01] transition-transform">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-black size-6 bg-[#6C5CE7] text-white rounded-full flex items-center justify-center font-mono">{idx + 1}</span>
                    <span className="text-sm font-bold text-[#2D3436]">{p.product_name}</span>
                  </div>
                  <div className="flex items-center gap-8 text-xs font-bold font-mono">
                    <div>
                      <span className="text-[#B2BEC3] uppercase text-[9px] block">Qté vendue</span>
                      <span className="text-[#2D3436] tabular-nums">{p.quantity} unités</span>
                    </div>
                    <div>
                      <span className="text-[#B2BEC3] uppercase text-[9px] block">Revenu</span>
                      <span className="text-[#00B894] tabular-nums">{formatPrice(p.revenue)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── TAB CONTENT: RULES ─── */}
      {activeTab === 'RULES' && (
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[700px]">
              <thead>
                <tr className="bg-[#F8F9FC] border-b border-[#E9ECF0]">
                  <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Produit Déclencheur</th>
                  <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Produits suggérés en Upsell</th>
                  <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-center">Conditions</th>
                  <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-center">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E9ECF0]">
                {isLoadingRules ? (
                  [1,2].map(i => <tr key={i} className="animate-pulse h-16 bg-[#FAFBFD]/50" />)
                ) : rules.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-[#B2BEC3] font-bold uppercase tracking-tight">Aucune règle d'upsell active</td>
                  </tr>
                ) : rules.map((r: any) => (
                  <tr key={r.id} className="hover:bg-[#FAFBFD] transition-colors font-bold text-xs">
                    <td className="px-6 py-5 whitespace-nowrap text-sm font-black text-[#2D3436]">{r.product_name}</td>
                    <td className="px-6 py-5 whitespace-nowrap">
                      <div className="flex flex-wrap gap-1.5 max-w-sm">
                        {r.upsell_product_ids?.map((id: string) => (
                          <Badge key={id} className="bg-[#F8F9FC] text-[#636E72] hover:bg-[#E9ECF0] border text-[9px] uppercase px-2 py-0.5">ID: {id.substring(0,8)}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-5 text-center whitespace-nowrap">
                      <span className="text-[#636E72] font-mono text-xs">Min. Qté : {r.trigger_conditions?.min_quantity || 1}</span>
                    </td>
                    <td className="px-6 py-5 text-center whitespace-nowrap">
                      <Badge className={cn("border-none rounded-md px-2.5 py-1 text-[9px] uppercase font-black tracking-widest", r.is_active ? "bg-[#E6FFF8] text-[#00B894]" : "bg-[#FFEDE9] text-[#E17055]")}>
                        {r.is_active ? 'ACTIF' : 'INACTIF'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── TAB CONTENT: COMMISSIONS ─── */}
      {activeTab === 'COMMISSIONS' && (
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[700px]">
              <thead>
                <tr className="bg-[#F8F9FC] border-b border-[#E9ECF0]">
                  <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Confirmatrice</th>
                  <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Date & Heure</th>
                  <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">N° Commande</th>
                  <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-right">Montant Commission</th>
                  <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-center">Paiement</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E9ECF0]">
                {isLoadingCommissions ? (
                  [1,2].map(i => <tr key={i} className="animate-pulse h-16 bg-[#FAFBFD]/50" />)
                ) : commissions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-[#B2BEC3] font-bold uppercase tracking-tight">Aucune commission enregistrée</td>
                  </tr>
                ) : commissions.map((c: any) => (
                  <tr key={c.id} className="hover:bg-[#FAFBFD] transition-colors font-bold text-xs">
                    <td className="px-6 py-5 whitespace-nowrap text-sm font-black text-[#2D3436] uppercase">{c.agent_name}</td>
                    <td className="px-6 py-5 whitespace-nowrap font-mono text-[#636E72]">{new Date(c.created_at).toLocaleString()}</td>
                    <td className="px-6 py-5 whitespace-nowrap text-[#6C5CE7] font-black tracking-wide font-mono">#{c.order_number}</td>
                    <td className="px-6 py-5 text-right whitespace-nowrap font-black font-mono text-[#2D3436] tabular-nums">{formatPrice(c.amount)}</td>
                    <td className="px-6 py-5 text-center whitespace-nowrap">
                      <Badge className={cn("border-none rounded-md px-2 py-0.5 text-[9px] uppercase font-black tracking-widest", c.is_paid ? "bg-[#E6FFF8] text-[#00B894]" : "bg-[#FFF8E6] text-[#FDCB6E]")}>
                        {c.is_paid ? 'PAYÉ' : 'À PAYER'}
                      </Badge>
                    </td>
                    <td className="px-6 py-5 text-right">
                      {!c.is_paid && (
                        <Button 
                          onClick={() => payCommissionMutation.mutate(c.id)}
                          disabled={payCommissionMutation.isPending}
                          size="sm" 
                          className="h-8 rounded-lg bg-black text-white hover:opacity-90 font-black text-[10px] uppercase flex items-center gap-1.5"
                        >
                          <Coins className="size-3" /> Payer
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── MODAL: CONFIGURE RULE ─── */}
      <Dialog open={isCreatingRule} onOpenChange={setIsCreatingRule}>
         <DialogContent className="bg-white border-none shadow-2xl max-w-xl w-[96vw] p-0 rounded-[40px] overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-black p-8 text-white relative overflow-hidden">
               <div className="relative z-10">
                  <DialogTitle className="text-xl font-bold uppercase tracking-widest">Configurer une règle d'Upsell</DialogTitle>
                  <p className="text-xs font-medium text-white/50 mt-2 uppercase tracking-tight">Associer des suggestions de vente automatique lors de la confirmation.</p>
               </div>
               <div className="absolute top-0 right-0 p-8 opacity-10">
                  <Settings size={80} />
               </div>
            </div>
            
            <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto no-scrollbar">
              
              {/* Trigger product */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Produit déclencheur (Panier de base)</label>
                <Select value={triggerProductId} onValueChange={setTriggerProductId}>
                  <SelectTrigger className="h-12 bg-[#F8F9FC] border-[#E9ECF0] rounded-xl text-xs font-bold"><SelectValue placeholder="Sélectionner le produit déclencheur" /></SelectTrigger>
                  <SelectContent className="bg-white border-[#E9ECF0] rounded-xl">
                    {products.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Suggestions */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Produits suggérés en Upsell</label>
                <div className="max-h-48 overflow-y-auto border border-[#E9ECF0] p-4 rounded-2xl bg-[#F8F9FC] space-y-2">
                  {products.map(p => {
                    const isSelected = selectedUpsellIds.includes(p.id);
                    return (
                      <div 
                        key={p.id} 
                        onClick={() => {
                          if (isSelected) {
                            setSelectedUpsellIds(selectedUpsellIds.filter(id => id !== p.id));
                          } else {
                            setSelectedUpsellIds([...selectedUpsellIds, p.id]);
                          }
                        }}
                        className={cn("flex justify-between items-center p-3 rounded-xl border cursor-pointer transition-colors font-bold text-xs", isSelected ? "bg-[#F0EDFF] border-[#6C5CE7]/30 text-black" : "bg-white border-transparent text-[#636E72]")}
                      >
                        <span>{p.name}</span>
                        {isSelected && <Check className="size-4 text-[#6C5CE7]" />}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Minimum Qty */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Condition de déclenchement (Quantité Minimum)</label>
                <Input 
                  type="number"
                  value={minQty}
                  onChange={(e) => setMinQty(parseInt(e.target.value) || 1)}
                  className="h-11 font-bold text-xs rounded-xl"
                  placeholder="1"
                />
              </div>

            </div>

            <DialogFooter className="p-8 bg-[#F8F9FC] border-t border-[#E9ECF0] flex justify-end gap-2">
               <Button variant="ghost" onClick={() => setIsCreatingRule(false)} className="rounded-xl text-xs font-bold text-[#636E72]">
                Annuler
               </Button>
               <Button onClick={handleSaveRule} disabled={saveRuleMutation.isPending} className="bg-black text-white rounded-xl text-xs font-black uppercase tracking-wider px-6">
                {saveRuleMutation.isPending ? 'Enregistrement...' : 'Sauvegarder la règle'}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>

    </div>
  );
}
