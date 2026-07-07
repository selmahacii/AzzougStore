import React, { useState } from 'react';
import { 
  Key, 
  Truck, 
  Zap,
  Plus,
  ShieldCheck,
  Copy,
  RefreshCw,
  Info,
  ExternalLink,
  Settings,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Activity
} from 'lucide-react';
import { formatPrice } from '@/lib/format';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';
import { toast } from 'sonner';
import type { PartnerApiKey, WebhookConfig, ApiResponse } from '@/lib/types';
import { cn } from '@/lib/utils';

const C = {
   primary: '#6C5CE7', primaryBg: '#F0EDFF',
   success: '#00B894', successBg: '#E6FFF8',
   danger: '#E17055', dangerBg: '#FFEDE9',
   warning: '#FDCB6E', warningBg: '#FFF8E6',
   info: '#0984E3', infoBg: '#E8F4FE',
   text: '#2D3436', textLight: '#636E72', textDim: '#B2BEC3', border: '#E9ECF0', bg: '#F8F9FC',
};

import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button as UIButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import MetaAdsDashboard from './meta-ads-dashboard';
import TikTokAdsDashboard from './tiktok-ads-dashboard';

export default function PartnersDashboard() {
  const { activeStore } = useAppStore();
  const storeId = activeStore?.id ?? '';
  const queryClient = useQueryClient();

  const [revealedKey, setRevealedKey] = useState<{ name: string; key: string } | null>(null);
  const [isWebhookDialogOpen, setIsWebhookDialogOpen] = useState(false);
  const [newWebhook, setNewWebhook] = useState({ url: '', events: ['order_created', 'order_status_changed'] });

  // ─── Queries ───────────────────────────────────────────
  const keysQuery = useQuery<ApiResponse<PartnerApiKey[]>>({
    queryKey: ['partner-keys', storeId],
    queryFn: () => apiFetch(`/api/v1/partners/keys?store_id=${storeId}`),
    enabled: !!storeId,
  });

  const webhooksQuery = useQuery<ApiResponse<WebhookConfig[]>>({
    queryKey: ['partner-webhooks', storeId],
    queryFn: () => apiFetch(`/api/v1/partners/webhooks?store_id=${storeId}`),
    enabled: !!storeId,
  });

  // ─── Mutations ─────────────────────────────────────────
  const rotateKeyMutation = useMutation({
    mutationFn: (keyId: string) => apiFetch(`/api/v1/partners/keys/${keyId}/rotate`, { method: 'POST' }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['partner-keys'] });
      setRevealedKey({ name: res.data.name, key: res.raw_key });
      toast.success('Clé de sécurité régénérée');
    },
    onError: () => toast.error('Échec de la rotation'),
  });

  const deleteKeyMutation = useMutation({
    mutationFn: (keyId: string) => apiFetch(`/api/v1/partners/keys/${keyId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['partner-keys'] });
      toast.success('Clé révoquée');
    },
    onError: () => toast.error('Échec de la révocation'),
  });

  const generateKeyMutation = useMutation({
    mutationFn: (name: string) => apiFetch('/api/v1/partners/keys', { 
      method: 'POST', 
      body: JSON.stringify({ name, store_id: storeId }) 
    }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['partner-keys'] });
      setRevealedKey({ name: res.data.name, key: res.raw_key });
      toast.success('Nouvelle clé générée');
    },
    onError: () => toast.error('Échec de la génération'),
  });

  const createWebhookMutation = useMutation({
    mutationFn: (data: typeof newWebhook) => apiFetch('/api/v1/partners/webhooks', {
      method: 'POST',
      body: JSON.stringify({ ...data, store_id: storeId })
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['partner-webhooks'] });
      setIsWebhookDialogOpen(false);
      setNewWebhook({ url: '', events: ['order_created', 'order_status_changed'] });
      toast.success('Webhook configuré');
    },
    onError: (err: any) => toast.error(err.message || 'Échec de la configuration'),
  });

  const deleteWebhookMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/partners/webhooks/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['partner-webhooks'] });
      toast.success('Webhook supprimé');
    },
  });

  const keys = keysQuery.data?.data ?? [];
  const webhooks = webhooksQuery.data?.data ?? [];

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copié dans le presse-papier');
  };

  return (
    <div className="space-y-6 pb-28 animate-in fade-in duration-500">
      <Tabs defaultValue="api" className="space-y-6">
        <div className="flex justify-center sm:justify-start">
          <TabsList className="bg-white border rounded-2xl p-1 h-auto shadow-sm">
            <TabsTrigger value="api" className="rounded-xl px-8 h-11 font-black uppercase tracking-widest text-[11px] data-[state=active]:bg-[#6C5CE7] data-[state=active]:text-white transition-all">
              API & Logistique
            </TabsTrigger>
            <TabsTrigger value="meta" className="rounded-xl px-8 h-11 font-black uppercase tracking-widest text-[11px] data-[state=active]:bg-[#1877F2] data-[state=active]:text-white transition-all">
              Meta Ads & Marketing
            </TabsTrigger>
            <TabsTrigger value="tiktok" className="rounded-xl px-8 h-11 font-black uppercase tracking-widest text-[11px] data-[state=active]:bg-black data-[state=active]:text-white transition-all">
              TikTok Ads
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="api" className="space-y-6 outline-none">
          {/* ─── Modern & Human Header ─── */}
      <div className="bg-white rounded-[40px] border px-10 py-12 shadow-sm relative overflow-hidden" style={{ borderColor: C.border }}>
         <div className="absolute top-0 right-0 p-12 opacity-[0.03] text-[#6C5CE7] rotate-12">
            <Zap className="size-48" />
         </div>
         <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-10 relative z-10">
            <div className="flex items-center gap-8">
               <div className="size-20 rounded-[32px] flex items-center justify-center shadow-inner" style={{ backgroundColor: C.primaryBg }}>
                  <Zap className="size-10" style={{ color: C.primary }} />
               </div>
               <div className="space-y-2">
                  <div className="flex items-center gap-3">
                     <span className="text-[11px] font-black uppercase tracking-[0.2em] text-[#6C5CE7]/60">Logistique Stack</span>
                     <div className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                  </div>
                  <h1 className="text-4xl font-black text-[#2D3436] tracking-tighter uppercase">
                     Hub Partenaires
                  </h1>
                  <p className="text-sm font-bold text-neutral-400 max-w-md">Orchestrez vos intégrations logistiques et sécurisez vos flux de données inter-systèmes.</p>
               </div>
            </div>
            <button 
               onClick={() => {
                  const name = prompt('Nom de la nouvelle clé (ex: Yalidine PROD)');
                  if (name) generateKeyMutation.mutate(name);
               }}
               className="flex items-center gap-3 px-8 h-14 rounded-2xl text-white text-[13px] font-black uppercase tracking-wider shadow-2xl shadow-[#6C5CE7]/30 hover:translate-y-[-2px] active:translate-y-[1px] transition-all disabled:opacity-50" 
               style={{ backgroundColor: C.primary }}
               disabled={generateKeyMutation.isPending}
            >
               {generateKeyMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
               Générer une clef API
            </button>
         </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
         {/* ─── Webhook Configuration ─── */}
         <div className="bg-white rounded-[32px] border p-10 flex flex-col" style={{ borderColor: C.border }}>
            <div className="flex items-center justify-between mb-10 border-b border-neutral-50 pb-8">
               <div className="space-y-1">
                  <h3 className="text-xl font-extrabold text-[#2D3436] tracking-tight uppercase">Configuration Webhooks</h3>
                  <p className="text-xs font-bold text-neutral-400">Réception d'événements asynchrones en temps réel.</p>
               </div>
               <button 
                  onClick={() => setIsWebhookDialogOpen(true)}
                  className="size-10 rounded-xl bg-[#E6FFF8] text-emerald-600 flex items-center justify-center hover:bg-emerald-100 transition-colors"
               >
                  <Plus className="size-5" />
               </button>
            </div>
            
            <div className="space-y-10 flex-1 overflow-y-auto max-h-[400px] pr-2 custom-scrollbar">
               {webhooksQuery.status === 'pending' ? (
                  <div className="space-y-4">
                     <div className="h-20 bg-slate-50 rounded-2xl animate-pulse" />
                     <div className="h-20 bg-slate-50 rounded-2xl animate-pulse" />
                  </div>
               ) : webhooks.length > 0 ? (
                  webhooks.map((wh) => (
                     <div key={wh.id} className="space-y-6 pb-6 border-b last:border-0 border-neutral-50">
                        <div className="space-y-3">
                           <div className="flex items-center justify-between">
                              <label className="text-[11px] font-black text-[#636E72] uppercase tracking-[0.1em]">Endpoint de réception</label>
                              <div className="flex items-center gap-2">
                                 <Badge variant="outline" className="text-[8px] font-black uppercase tracking-widest py-0.5 border-neutral-100">Production</Badge>
                                 <button 
                                    onClick={() => deleteWebhookMutation.mutate(wh.id)}
                                    className="p-1 text-rose-300 hover:text-rose-500 transition-colors"
                                 >
                                    <Trash2 className="size-3.5" />
                                 </button>
                              </div>
                           </div>
                           <div className="bg-[#F8F9FC] border p-5 rounded-2xl font-mono text-[13px] text-[#2D3436] border-neutral-100 flex items-center justify-between group">
                              <span className="truncate opacity-80">{wh.url}</span>
                              <button 
                                 onClick={() => copyToClipboard(wh.url)}
                                 className="text-[#6C5CE7] hover:bg-[#F0EDFF] p-2.5 rounded-xl transition-all shadow-sm bg-white"
                              >
                                 <Copy className="size-4" />
                              </button>
                           </div>
                        </div>

                        <div className="space-y-4">
                           <label className="text-[11px] font-black text-[#636E72] uppercase tracking-[0.1em]">Événements abonnés</label>
                           <div className="flex flex-wrap items-center gap-3">
                              {wh.events.map(ev => (
                                 <div key={ev} className="bg-white px-4 py-2.5 rounded-xl border border-neutral-100 flex items-center gap-3 shadow-sm hover:border-[#6C5CE7]/30 transition-colors">
                                    <CheckCircle2 className="size-3.5 text-emerald-500" />
                                    <span className="text-[11px] font-black text-[#2D3436] uppercase tracking-wider">{ev.replace(/_/g, ' ')}</span>
                                 </div>
                              ))}
                           </div>
                        </div>
                     </div>
                  ))
               ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center opacity-40">
                     <AlertCircle className="size-12 mb-4" />
                     <p className="text-sm font-bold">Aucun Webhook configuré</p>
                     <Button onClick={() => setIsWebhookDialogOpen(true)} variant="link" className="text-xs font-black uppercase mt-2">Démarrer l'intégration</Button>
                  </div>
               )}
            </div>

            <div className="mt-10 pt-8 border-t border-neutral-50 flex items-center gap-4 bg-slate-50/50 p-6 rounded-2xl">
               <div className="size-10 rounded-xl bg-white border border-neutral-100 flex items-center justify-center">
                  <Info className="size-5 text-[#636E72]" />
               </div>
               <p className="text-[11px] leading-relaxed text-[#636E72] font-medium">
                  Les webhooks vous permettent de synchroniser automatiquement vos inventaires et états de livraison sans intervention manuelle.
               </p>
            </div>
         </div>

         {/* ─── Active API Keys ─── */}
         <div className="bg-[#2D3436] rounded-[32px] p-10 flex flex-col shadow-2xl" style={{ borderColor: C.border }}>
            <div className="flex items-center justify-between mb-10 border-b border-white/5 pb-8">
               <div className="space-y-1">
                  <h3 className="text-xl font-extrabold text-white tracking-tight uppercase">Security Keys</h3>
                  <p className="text-xs font-bold text-white/40">Jetons de sécurité pour authentification m2m.</p>
               </div>
               <div className="size-12 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10">
                  <Key className="size-6 text-white/80" />
               </div>
            </div>

            <div className="space-y-4 flex-1">
               {keysQuery.isLoading ? (
                  Array.from({ length: 2 }).map((_, i) => (
                     <div key={i} className="h-24 bg-white/5 rounded-2xl animate-pulse" />
                  ))
               ) : keys.length > 0 ? (
                  keys.map((k) => (
                     <div key={k.id} className="flex items-center justify-between p-6 bg-white/5 border border-white/5 rounded-2xl hover:bg-white/[0.08] transition-all group">
                        <div className="flex items-center gap-5">
                           <div className="size-12 rounded-2xl bg-white/10 flex items-center justify-center text-white/40 group-hover:bg-[#6C5CE7]/30 group-hover:text-white transition-all">
                              <ShieldCheck className="size-6" />
                           </div>
                           <div className="space-y-1">
                              <p className="text-sm font-bold text-white tracking-wide">{k.name}</p>
                              <div className="flex items-center gap-3">
                                 <span className="text-[10px] font-mono text-white/30 tracking-widest">{k.key_preview}</span>
                                 <div className="size-1 rounded-full bg-white/20" />
                                 <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Rotation : {new Date(k.last_rotated_at).toLocaleDateString('fr-FR')}</p>
                              </div>
                           </div>
                        </div>
                        <div className="flex items-center gap-2">
                           <button 
                              onClick={() => rotateKeyMutation.mutate(k.id)}
                              disabled={rotateKeyMutation.isPending}
                              className="size-10 rounded-xl bg-white/5 text-white/40 hover:text-white hover:bg-white/10 flex items-center justify-center transition-all disabled:opacity-30"
                              title="Réinitialiser la clé"
                           >
                              {rotateKeyMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                           </button>
                           <button 
                              onClick={() => deleteKeyMutation.mutate(k.id)}
                              disabled={deleteKeyMutation.isPending}
                              className="size-10 rounded-xl bg-white/5 text-white/40 hover:text-rose-400 hover:bg-rose-500/20 flex items-center justify-center transition-all disabled:opacity-30"
                              title="Révoquer l'accès"
                           >
                              {deleteKeyMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                           </button>
                        </div>
                     </div>
                  ))
               ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-center opacity-20">
                     <Key className="size-16 mb-6 text-white" />
                     <p className="text-base font-black uppercase text-white">Aucune clé active</p>
                  </div>
               )}
               
               <div className="mt-8 p-6 bg-[#6C5CE7]/10 border border-[#6C5CE7]/20 rounded-2xl flex items-start gap-4">
                  <ShieldCheck className="size-5 text-[#6C5CE7] mt-1 shrink-0" />
                  <p className="text-[12px] leading-relaxed text-white/60 font-medium">
                     <span className="text-white font-black uppercase tracking-widest block mb-1">Expert Protocol</span>
                     Pensez à faire pivoter vos clefs d'accès tous les <span className="text-[#6C5CE7] font-black">90 jours</span>. Une clé compromise peut compromettre l'intégralité de vos stocks et bordereaux.
                  </p>
               </div>
            </div>
         </div>
      </div>

      {/* ─── Add Webhook Dialog ─── */}
      <Dialog open={isWebhookDialogOpen} onOpenChange={setIsWebhookDialogOpen}>
         <DialogContent className="max-w-xl w-[96vw] rounded-[40px] p-8 shadow-2xl border-none">
            <DialogHeader>
               <DialogTitle className="text-xl font-black uppercase tracking-tight">Nouvel Intégration</DialogTitle>
            </DialogHeader>
            <div className="space-y-6 py-4">
               <div className="space-y-2">
                  <label className="text-[11px] font-black text-[#636E72] uppercase">URL de réception</label>
                  <Input 
                     placeholder="https://api.votre-service.com/webhook" 
                     value={newWebhook.url}
                     onChange={e => setNewWebhook({...newWebhook, url: e.target.value})}
                  />
               </div>
               <div className="space-y-2">
                  <label className="text-[11px] font-black text-[#636E72] uppercase">Événements (Mock selection)</label>
                  <div className="p-3 bg-slate-50 rounded-xl border border-neutral-100 flex items-center gap-2">
                     <CheckCircle2 className="size-4 text-emerald-500" />
                     <span className="text-[10px] font-bold text-slate-500 uppercase">Commandes & Statuts active par défaut</span>
                  </div>
               </div>
            </div>
            <DialogFooter>
               <UIButton 
                  onClick={() => createWebhookMutation.mutate(newWebhook)}
                  disabled={createWebhookMutation.isPending || !newWebhook.url}
                  className="w-full h-11 bg-[#6C5CE7] hover:bg-[#5A4AD1] text-white font-bold"
               >
                  {createWebhookMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "Enregistrer l'intégration"}
               </UIButton>
            </DialogFooter>
         </DialogContent>
      </Dialog>

      {/* ─── Security Reveal Dialog ─── */}
      <Dialog open={!!revealedKey} onOpenChange={() => setRevealedKey(null)}>
         <DialogContent className="max-w-xl w-[96vw] rounded-[40px] p-8 shadow-2xl bg-[#2D3436] border-white/10 text-white">
            <DialogHeader>
               <DialogTitle className="text-white flex items-center gap-3">
                  <ShieldCheck className="size-6 text-[#6C5CE7]" />
                  Clé de Sécurité Générée
               </DialogTitle>
            </DialogHeader>
            <div className="space-y-6 py-6">
               <p className="text-sm text-white/60 font-medium">Pour des raisons de sécurité, cette clé ne sera affichée <span className="text-white font-bold uppercase tracking-widest">qu'une seule fois</span>. Veuillez la copier immédiatement.</p>
               <div className="bg-white/5 border border-white/10 p-6 rounded-2xl flex items-center justify-between group">
                  <span className="font-mono text-lg text-[#6C5CE7] font-bold tracking-tight select-all break-all pr-4">
                     {revealedKey?.key}
                  </span>
                  <button 
                     onClick={() => revealedKey && copyToClipboard(revealedKey.key)}
                     className="bg-white/10 p-3 rounded-xl hover:bg-[#6C5CE7] transition-all"
                  >
                     <Copy className="size-5" />
                  </button>
               </div>
               <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex gap-3">
                  <AlertCircle className="size-5 text-amber-500 shrink-0" />
                  <p className="text-[11px] text-amber-500/80 font-bold uppercase leading-relaxed">
                     Ne partagez jamais cette clé publiquement. Elle donne un accès total aux API de logistique de {revealedKey?.name}.
                  </p>
               </div>
            </div>
            <DialogFooter>
               <UIButton onClick={() => setRevealedKey(null)} className="w-full h-12 bg-white text-black font-extrabold uppercase tracking-widest hover:bg-neutral-200">
                  J'ai sécurisé ma clef
               </UIButton>
            </DialogFooter>
         </DialogContent>
      </Dialog>
      </TabsContent>

      <TabsContent value="meta" className="outline-none">
        <div className="mt-2">
          <MetaAdsDashboard />
        </div>
      </TabsContent>

      <TabsContent value="tiktok" className="outline-none">
        <div className="mt-2">
          <TikTokAdsDashboard />
        </div>
      </TabsContent>
      </Tabs>
    </div>
  );
}

function Badge({ children, variant, className }: any) {
   return (
      <div className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase", className)}>
         {children}
      </div>
   );
}

function Button({ children, variant, className, onClick }: any) {
   return (
      <button onClick={onClick} className={cn("", className)}>
         {children}
      </button>
   );
}
