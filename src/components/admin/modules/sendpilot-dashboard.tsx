'use client';

import React, { useState } from 'react';
import {
  RadioTower, MessageSquare, Mail, Smartphone, Target, Layout,
  CheckCircle2, Plus, Loader2, Trash2, X, Send, Calendar,
  Users, BarChart3, Eye, AlertCircle, RefreshCw,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// ─── Types ────────────────────────────────────────────────────
interface MarketingSummary {
  capacityPerDay: string;
  latencyMs: number;
  transmissionLoad: number;
  successRate: number;
}

interface Channel {
  id: string;
  name: string;
  type: 'WHATSAPP' | 'INSTAGRAM' | 'SMS' | 'EMAIL';
  status: 'CONNECTED' | 'ERROR' | 'PENDING';
  health_score: number;
  identifier?: string;
}

interface Campaign {
  id: string;
  name: string;
  type: 'WHATSAPP' | 'INSTAGRAM' | 'SMS' | 'EMAIL';
  status: 'DRAFT' | 'SCHEDULED' | 'RUNNING' | 'DONE' | 'PAUSED';
  sent?: number;
  target?: number;
  scheduled_at?: string;
  created_at?: string;
}

interface Template {
  id: string;
  name: string;
  type: 'WHATSAPP' | 'INSTAGRAM' | 'SMS' | 'EMAIL';
  language: string;
  content: string;
}

// ─── Color System ─────────────────────────────────────────────
const C = {
  primary: '#6C5CE7', primaryBg: '#F0EDFF',
  success: '#00B894', successBg: '#E6FFF8',
  danger: '#E17055', dangerBg: '#FFEDE9',
  warning: '#FDCB6E', warningBg: '#FFF8E6',
  info: '#0984E3', infoBg: '#E8F4FE',
  text: '#2D3436', textLight: '#636E72', textDim: '#B2BEC3', border: '#E9ECF0', bg: '#F8F9FC',
};

const CHANNEL_COLORS: Record<string, string> = {
  WHATSAPP: '#25D366', INSTAGRAM: '#E4405F', SMS: '#2D3436', EMAIL: '#FDCB6E',
};

const CHANNEL_ICONS: Record<string, React.ElementType> = {
  WHATSAPP: MessageSquare, INSTAGRAM: Target, SMS: Smartphone, EMAIL: Mail,
};

const TABS = [
  { id: 'overview', label: 'Dashboard', icon: RadioTower },
  { id: 'channels', label: 'Canaux de messagerie', icon: MessageSquare },
  { id: 'campaigns', label: 'Campagnes', icon: Send },
  { id: 'templates', label: 'Modèles', icon: Layout },
];

// ─── Add Channel Modal ─────────────────────────────────────────
function AddChannelModal({ open, onClose, storeId, onSaved }: { open: boolean; onClose: () => void; storeId: string; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<Channel['type']>('WHATSAPP');
  const [identifier, setIdentifier] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return toast.error('Nom requis');
    setSaving(true);
    try {
      await apiFetch('/api/v1/marketing/channels', {
        method: 'POST',
        body: JSON.stringify({ store_id: storeId, name: name.trim(), type, identifier: identifier.trim() }),
      });
      toast.success('Canal ajouté avec succès');
      setName(''); setIdentifier('');
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || 'Erreur lors de l\'ajout');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0 rounded-3xl overflow-hidden border-none shadow-2xl">
        <div className="px-7 py-5 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
          <DialogHeader><DialogTitle className="text-sm font-black uppercase tracking-wider text-[#2D3436]">Ajouter un canal</DialogTitle></DialogHeader>
          <button onClick={onClose} className="text-[#B2BEC3] hover:text-[#636E72]"><X className="size-4" /></button>
        </div>
        <div className="p-7 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Nom du canal</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: WhatsApp Boutique" className="h-11 rounded-xl border-[#E9ECF0] text-sm font-bold" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Type</label>
            <div className="grid grid-cols-4 gap-2">
              {(['WHATSAPP', 'INSTAGRAM', 'SMS', 'EMAIL'] as const).map(t => {
                const color = CHANNEL_COLORS[t];
                const Icon = CHANNEL_ICONS[t];
                return (
                  <button key={t} onClick={() => setType(t)}
                    className={cn("h-16 rounded-xl border-2 flex flex-col items-center justify-center gap-1 transition-all text-[9px] font-black uppercase tracking-wider")}
                    style={{ borderColor: type === t ? color : C.border, backgroundColor: type === t ? color + '15' : 'white', color: type === t ? color : C.textDim }}
                  >
                    <Icon className="size-4" />
                    {t === 'WHATSAPP' ? 'WA' : t}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">
              {type === 'WHATSAPP' ? 'Numéro WhatsApp' : type === 'INSTAGRAM' ? 'Compte Instagram' : type === 'SMS' ? 'Numéro expéditeur' : 'Adresse email'}
            </label>
            <Input value={identifier} onChange={e => setIdentifier(e.target.value)}
              placeholder={type === 'WHATSAPP' ? '+213 XX XX XX XX' : type === 'INSTAGRAM' ? '@maboutique' : type === 'EMAIL' ? 'contact@boutique.dz' : '0550000000'}
              className="h-11 rounded-xl border-[#E9ECF0] text-sm font-bold"
            />
          </div>
        </div>
        <div className="px-7 py-5 border-t flex justify-end gap-3" style={{ borderColor: C.border }}>
          <Button variant="ghost" onClick={onClose} className="h-10 px-5 rounded-xl font-bold text-[#636E72]">Annuler</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()} className="h-10 px-6 rounded-xl font-black text-white text-[11px] uppercase tracking-wider" style={{ backgroundColor: C.primary }}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <><Plus className="size-4 mr-1.5" />Ajouter</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add Campaign Modal ────────────────────────────────────────
function AddCampaignModal({ open, onClose, storeId, onSaved }: { open: boolean; onClose: () => void; storeId: string; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<Channel['type']>('WHATSAPP');
  const [scheduledAt, setScheduledAt] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return toast.error('Nom requis');
    setSaving(true);
    try {
      await apiFetch('/api/v1/marketing/campaigns', {
        method: 'POST',
        body: JSON.stringify({ store_id: storeId, name: name.trim(), type, scheduled_at: scheduledAt || null, status: 'DRAFT' }),
      });
      toast.success('Campagne créée');
      setName(''); setScheduledAt('');
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || 'Erreur lors de la création');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0 rounded-3xl overflow-hidden border-none shadow-2xl">
        <div className="px-7 py-5 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
          <DialogHeader><DialogTitle className="text-sm font-black uppercase tracking-wider text-[#2D3436]">Nouvelle campagne</DialogTitle></DialogHeader>
          <button onClick={onClose} className="text-[#B2BEC3] hover:text-[#636E72]"><X className="size-4" /></button>
        </div>
        <div className="p-7 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Nom de la campagne</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Promo Eid 2026" className="h-11 rounded-xl border-[#E9ECF0] text-sm font-bold" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Canal</label>
            <div className="grid grid-cols-4 gap-2">
              {(['WHATSAPP', 'INSTAGRAM', 'SMS', 'EMAIL'] as const).map(t => {
                const color = CHANNEL_COLORS[t];
                const Icon = CHANNEL_ICONS[t];
                return (
                  <button key={t} onClick={() => setType(t)}
                    className="h-16 rounded-xl border-2 flex flex-col items-center justify-center gap-1 transition-all text-[9px] font-black uppercase tracking-wider"
                    style={{ borderColor: type === t ? color : C.border, backgroundColor: type === t ? color + '15' : 'white', color: type === t ? color : C.textDim }}
                  >
                    <Icon className="size-4" />
                    {t === 'WHATSAPP' ? 'WA' : t}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Planifier (optionnel)</label>
            <Input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} className="h-11 rounded-xl border-[#E9ECF0] text-sm font-bold" />
          </div>
        </div>
        <div className="px-7 py-5 border-t flex justify-end gap-3" style={{ borderColor: C.border }}>
          <Button variant="ghost" onClick={onClose} className="h-10 px-5 rounded-xl font-bold text-[#636E72]">Annuler</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()} className="h-10 px-6 rounded-xl font-black text-white text-[11px] uppercase tracking-wider" style={{ backgroundColor: C.primary }}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <><Plus className="size-4 mr-1.5" />Créer</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add Template Modal ────────────────────────────────────────
function AddTemplateModal({ open, onClose, storeId, onSaved }: { open: boolean; onClose: () => void; storeId: string; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<Channel['type']>('WHATSAPP');
  const [language, setLanguage] = useState('fr');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !content.trim()) return toast.error('Nom et contenu requis');
    setSaving(true);
    try {
      await apiFetch('/api/v1/marketing/templates', {
        method: 'POST',
        body: JSON.stringify({ store_id: storeId, name: name.trim(), type, language, content: content.trim() }),
      });
      toast.success('Modèle créé');
      setName(''); setContent('');
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || 'Erreur lors de la création');
    } finally {
      setSaving(false);
    }
  };

  const insertVar = (v: string) => setContent(c => c + `{{${v}}}`);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl p-0 rounded-3xl overflow-hidden border-none shadow-2xl max-h-[90vh] flex flex-col">
        <div className="px-7 py-5 border-b flex items-center justify-between shrink-0" style={{ borderColor: C.border }}>
          <DialogHeader><DialogTitle className="text-sm font-black uppercase tracking-wider text-[#2D3436]">Créer un modèle</DialogTitle></DialogHeader>
          <button onClick={onClose} className="text-[#B2BEC3] hover:text-[#636E72]"><X className="size-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-7 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Nom</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Confirmation commande..." className="h-11 rounded-xl border-[#E9ECF0] text-sm font-bold" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Langue</label>
              <select value={language} onChange={e => setLanguage(e.target.value)} className="h-11 w-full rounded-xl border border-[#E9ECF0] px-3 text-sm font-bold bg-white text-[#2D3436]">
                <option value="fr">Français</option>
                <option value="ar">Arabe</option>
                <option value="en">Anglais</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Canal</label>
            <div className="grid grid-cols-4 gap-2">
              {(['WHATSAPP', 'INSTAGRAM', 'SMS', 'EMAIL'] as const).map(t => {
                const color = CHANNEL_COLORS[t];
                const Icon = CHANNEL_ICONS[t];
                return (
                  <button key={t} onClick={() => setType(t)}
                    className="h-12 rounded-xl border-2 flex items-center justify-center gap-1.5 transition-all text-[9px] font-black uppercase tracking-wider"
                    style={{ borderColor: type === t ? color : C.border, backgroundColor: type === t ? color + '15' : 'white', color: type === t ? color : C.textDim }}
                  >
                    <Icon className="size-3.5" />{t === 'WHATSAPP' ? 'WA' : t}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Contenu</label>
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={5}
              placeholder="Bonjour {{Customer_Name}}, votre commande #{{Order_Number}} est confirmée..."
              className="w-full rounded-xl border border-[#E9ECF0] px-4 py-3 text-sm font-medium text-[#2D3436] resize-none focus:outline-none focus:ring-2 focus:ring-[#6C5CE7]/20"
            />
          </div>
          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Variables disponibles</p>
            <div className="flex flex-wrap gap-1.5">
              {['Customer_Name', 'Customer_Phone', 'Order_Number', 'Order_Status', 'Total_Order', 'Tracking_ID', 'Delivery_Company', 'Wilaya', 'Agent_Name'].map(v => (
                <button key={v} onClick={() => insertVar(v)}
                  className="px-2 py-1 bg-[#F8F9FC] text-[#636E72] border rounded text-[10px] font-bold cursor-pointer hover:bg-[#6C5CE7] hover:text-white hover:border-[#6C5CE7] transition-colors"
                  style={{ borderColor: C.border }}
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="px-7 py-5 border-t flex justify-end gap-3 shrink-0" style={{ borderColor: C.border }}>
          <Button variant="ghost" onClick={onClose} className="h-10 px-5 rounded-xl font-bold text-[#636E72]">Annuler</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim() || !content.trim()} className="h-10 px-6 rounded-xl font-black text-white text-[11px] uppercase tracking-wider" style={{ backgroundColor: C.primary }}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <><Plus className="size-4 mr-1.5" />Créer</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────
export default function SendpilotDashboard() {
  const { activeStore, adminSubView } = useAppStore();
  const storeId = activeStore?.id ?? '';
  const queryClient = useQueryClient();

  const normalizeTab = (sv: string | null) => {
    if (!sv) return 'overview';
    if (sv === 'Canaux de messagerie' || sv === 'channels') return 'channels';
    if (sv === 'Campagnes' || sv === 'campaigns') return 'campaigns';
    if (sv === 'Modèles' || sv === 'templates') return 'templates';
    return 'overview';
  };
  const [activeTab, setActiveTab] = useState(normalizeTab(adminSubView));
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [showAddCampaign, setShowAddCampaign] = useState(false);
  const [showAddTemplate, setShowAddTemplate] = useState(false);

  React.useEffect(() => { setActiveTab(normalizeTab(adminSubView)); }, [adminSubView]);

  const summaryQuery = useQuery({
    queryKey: ['marketing', 'summary', storeId],
    queryFn: () => apiFetch<MarketingSummary>(`/api/v1/marketing/summary?store_id=${storeId}`),
    enabled: !!storeId,
  });

  const channelsQuery = useQuery({
    queryKey: ['marketing', 'channels', storeId],
    queryFn: () => apiFetch<Channel[]>(`/api/v1/marketing/channels?store_id=${storeId}`),
    enabled: !!storeId,
  });

  const campaignsQuery = useQuery({
    queryKey: ['marketing', 'campaigns', storeId],
    queryFn: () => apiFetch<Campaign[]>(`/api/v1/marketing/campaigns?store_id=${storeId}`),
    enabled: !!storeId && activeTab === 'campaigns',
  });

  const templatesQuery = useQuery({
    queryKey: ['marketing', 'templates', storeId],
    queryFn: () => apiFetch<Template[]>(`/api/v1/marketing/templates?store_id=${storeId}`),
    enabled: !!storeId && activeTab === 'templates',
  });

  const deleteChannel = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/marketing/channels/${id}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['marketing', 'channels'] }); toast.success('Canal supprimé'); },
    onError: () => toast.error('Erreur lors de la suppression'),
  });

  const deleteCampaign = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/marketing/campaigns/${id}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['marketing', 'campaigns'] }); toast.success('Campagne supprimée'); },
    onError: () => toast.error('Erreur lors de la suppression'),
  });

  const deleteTemplate = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/marketing/templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['marketing', 'templates'] }); toast.success('Modèle supprimé'); },
    onError: () => toast.error('Erreur lors de la suppression'),
  });

  const channels: Channel[] = Array.isArray(channelsQuery.data) ? channelsQuery.data : (channelsQuery.data as any)?.data ?? [];
  const campaigns: Campaign[] = Array.isArray(campaignsQuery.data) ? campaignsQuery.data : (campaignsQuery.data as any)?.data ?? [];
  const templates: Template[] = Array.isArray(templatesQuery.data) ? templatesQuery.data : (templatesQuery.data as any)?.data ?? [];

  const campaignStatusColor: Record<string, string> = {
    DRAFT: C.textDim, SCHEDULED: C.info, RUNNING: C.success, DONE: C.primary, PAUSED: C.warning,
  };
  const campaignStatusLabel: Record<string, string> = {
    DRAFT: 'Brouillon', SCHEDULED: 'Planifiée', RUNNING: 'En cours', DONE: 'Terminée', PAUSED: 'Pausée',
  };

  return (
    <div className="space-y-6 pb-28 animate-in fade-in duration-500">
      {/* ─── HEADER & TABS ─── */}
      <div className="bg-white rounded-xl border flex flex-col" style={{ borderColor: C.border }}>
        <div className="px-6 py-5 flex items-center justify-between border-b" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: C.primaryBg }}>
              <RadioTower className="size-4" style={{ color: C.primary }} />
            </div>
            <div>
              <h1 className="text-sm font-extrabold uppercase tracking-wider text-[#2D3436]">Sendpilot</h1>
              <p className="text-[10px] font-bold text-[#B2BEC3] uppercase tracking-widest mt-0.5">Marketing & Messagerie</p>
            </div>
          </div>
          {activeTab === 'channels' && (
            <Button onClick={() => setShowAddChannel(true)} className="h-10 px-6 text-white text-[11px] font-bold rounded-xl flex items-center gap-2 border-none" style={{ backgroundColor: C.primary }}>
              <Plus className="size-4" /> Ajouter un canal
            </Button>
          )}
          {activeTab === 'campaigns' && (
            <Button onClick={() => setShowAddCampaign(true)} className="h-10 px-6 text-white text-[11px] font-bold rounded-xl flex items-center gap-2 border-none" style={{ backgroundColor: C.success }}>
              <Plus className="size-4" /> Nouvelle campagne
            </Button>
          )}
          {activeTab === 'templates' && (
            <Button onClick={() => setShowAddTemplate(true)} className="h-10 px-6 text-white text-[11px] font-bold rounded-xl flex items-center gap-2 border-none" style={{ backgroundColor: C.info }}>
              <Plus className="size-4" /> Créer un modèle
            </Button>
          )}
        </div>
        <div className="px-4 py-2 flex gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={cn("px-4 py-2 flex items-center gap-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap",
                  isActive ? "text-white" : "text-[#636E72] hover:bg-[#F8F9FC]"
                )} style={isActive ? { backgroundColor: C.primary } : {}}>
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="animate-in slide-in-from-right-4 duration-300">

        {/* ─── DASHBOARD ─── */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8">
              <div className="bg-white rounded-xl border p-8 space-y-6" style={{ borderColor: C.border }}>
                <div className="flex items-center gap-6">
                  <div className="size-16 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: C.primaryBg }}>
                    <RadioTower className="size-8" style={{ color: C.primary }} />
                  </div>
                  <div>
                    <h3 className="text-xl font-extrabold text-[#2D3436] uppercase tracking-wider">Orchestration Marketing</h3>
                    <p className="text-[11px] font-bold text-[#B2BEC3] uppercase tracking-widest mt-1">Canaux unifiés · WhatsApp · SMS · Email · Instagram</p>
                  </div>
                </div>
                <p className="text-sm font-semibold text-[#636E72] leading-relaxed">
                  Sendpilot centralise vos communications marketing. Gérez vos canaux de messagerie, créez des campagnes et définissez des modèles personnalisés avec variables dynamiques.
                </p>
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { l: 'Canaux actifs', v: channels.filter(c => c.status === 'CONNECTED').length, c: C.success, icon: MessageSquare },
                    { l: 'Campagnes', v: campaigns.length, c: C.primary, icon: Send },
                    { l: 'Modèles', v: templates.length, c: C.info, icon: Layout },
                  ].map((k, i) => (
                    <div key={i} className="bg-[#F8F9FC] border rounded-lg p-5 flex items-center gap-3" style={{ borderColor: C.border }}>
                      <div className="size-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: k.c + '15' }}>
                        <k.icon className="size-4" style={{ color: k.c }} />
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-[#B2BEC3] uppercase tracking-widest block">{k.l}</span>
                        <span className="text-xl font-extrabold text-[#2D3436] block">{k.v}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="lg:col-span-4 space-y-6">
              <div className="bg-white rounded-xl border p-6" style={{ borderColor: C.border }}>
                <h3 className="text-sm font-bold text-[#2D3436] mb-6">Pulsation Système</h3>
                <div className="space-y-6">
                  {[
                    { label: 'Charge de Transmission', val: summaryQuery.data?.transmissionLoad || 0, color: C.primary },
                    { label: 'Taux de Réussite', val: summaryQuery.data?.successRate || 0, color: C.success },
                  ].map((p, i) => (
                    <div key={i} className="space-y-2">
                      <div className="flex justify-between text-[11px] font-bold text-[#636E72] uppercase tracking-wider">
                        <span>{p.label}</span>
                        <span className="text-[#2D3436] tabular-nums">{p.val}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-[#F8F9FC] border rounded-full overflow-hidden" style={{ borderColor: C.border }}>
                        <div className="h-full transition-all duration-1000 ease-out" style={{ width: `${p.val}%`, backgroundColor: p.color }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-[#E6FFF8] border border-[#B3F2E3] p-6 rounded-xl flex items-center gap-4">
                <div className="size-10 bg-white rounded-lg flex items-center justify-center shrink-0">
                  <CheckCircle2 className="size-5 text-[#00B894]" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-[#00B894]">Système Opérationnel</h3>
                  <p className="text-[10px] font-semibold text-[#00B894] mt-1">Tous les nœuds sont synchronisés.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── CANAUX DE MESSAGERIE ─── */}
        {activeTab === 'channels' && (
          <div className="space-y-6">
            {channelsQuery.isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-44 bg-white border animate-pulse rounded-xl" style={{ borderColor: C.border }} />)}
              </div>
            ) : channels.length === 0 ? (
              <div className="bg-white rounded-xl border p-16 flex flex-col items-center text-center gap-4" style={{ borderColor: C.border }}>
                <div className="size-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: C.primaryBg }}>
                  <MessageSquare className="size-8" style={{ color: C.primary }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-[#2D3436]">Aucun canal configuré</p>
                  <p className="text-xs text-[#B2BEC3] mt-1">Ajoutez votre premier canal de messagerie</p>
                </div>
                <Button onClick={() => setShowAddChannel(true)} className="h-10 px-6 rounded-xl font-black text-white text-[11px] uppercase tracking-wider" style={{ backgroundColor: C.primary }}>
                  <Plus className="size-4 mr-1.5" /> Ajouter un canal
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {channels.map((c, i) => {
                  const color = CHANNEL_COLORS[c.type] ?? C.primary;
                  const Icon = CHANNEL_ICONS[c.type] ?? MessageSquare;
                  return (
                    <div key={c.id ?? i} className="bg-white rounded-xl border p-6 hover:border-[#B2BEC3] transition-colors relative group" style={{ borderColor: C.border }}>
                      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => { if (confirm('Supprimer ce canal ?')) deleteChannel.mutate(c.id); }}
                          className="size-7 rounded-lg flex items-center justify-center bg-[#FFEDE9] text-[#E17055] hover:bg-[#E17055] hover:text-white transition-colors"
                          disabled={deleteChannel.isPending}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                      <div className="flex justify-between items-start mb-6">
                        <div className="size-12 rounded-xl flex items-center justify-center shadow-sm" style={{ backgroundColor: `${color}15` }}>
                          <Icon className="size-6" style={{ color }} />
                        </div>
                        <span className={cn("px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                          c.status === 'CONNECTED' ? "text-[#00B894] bg-[#E6FFF8]" : c.status === 'PENDING' ? "text-[#FDCB6E] bg-[#FFF8E6]" : "text-[#E17055] bg-[#FFEDE9]"
                        )}>
                          {c.status === 'CONNECTED' ? 'Connecté' : c.status === 'PENDING' ? 'En attente' : 'Erreur'}
                        </span>
                      </div>
                      <h3 className="text-sm font-extrabold text-[#2D3436]">{c.name}</h3>
                      {c.identifier && <p className="text-[10px] text-[#B2BEC3] font-medium mt-0.5">{c.identifier}</p>}
                      <div className="flex items-center gap-3 mt-4">
                        <div className="flex-1 h-1.5 bg-[#F8F9FC] rounded-full overflow-hidden border" style={{ borderColor: C.border }}>
                          <div className="h-full transition-all duration-1000" style={{ width: `${c.health_score || 0}%`, backgroundColor: color }} />
                        </div>
                        <span className="text-[10px] font-bold text-[#636E72] tabular-nums">{c.health_score || 0}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── CAMPAGNES ─── */}
        {activeTab === 'campaigns' && (
          <div className="space-y-4">
            {campaignsQuery.isLoading ? (
              Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 bg-white border animate-pulse rounded-xl" style={{ borderColor: C.border }} />)
            ) : campaigns.length === 0 ? (
              <div className="bg-white rounded-xl border p-16 flex flex-col items-center text-center gap-4" style={{ borderColor: C.border }}>
                <div className="size-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: C.primaryBg }}>
                  <Send className="size-8" style={{ color: C.primary }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-[#2D3436]">Aucune campagne créée</p>
                  <p className="text-xs text-[#B2BEC3] mt-1">Créez votre première campagne marketing</p>
                </div>
                <Button onClick={() => setShowAddCampaign(true)} className="h-10 px-6 rounded-xl font-black text-white text-[11px] uppercase tracking-wider" style={{ backgroundColor: C.success }}>
                  <Plus className="size-4 mr-1.5" /> Nouvelle campagne
                </Button>
              </div>
            ) : (
              campaigns.map((camp, i) => {
                const color = CHANNEL_COLORS[camp.type] ?? C.primary;
                const Icon = CHANNEL_ICONS[camp.type] ?? Send;
                const statusColor = campaignStatusColor[camp.status] ?? C.textDim;
                const statusLabel = campaignStatusLabel[camp.status] ?? camp.status;
                return (
                  <div key={camp.id ?? i} className="bg-white rounded-xl border p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-[#FAFBFD] transition-colors group" style={{ borderColor: C.border }}>
                    <div className="flex items-center gap-4">
                      <div className="size-10 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: color + '15' }}>
                        <Icon className="size-4" style={{ color }} />
                      </div>
                      <div>
                        <span className="text-sm font-bold text-[#2D3436] block">{camp.name}</span>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider" style={{ backgroundColor: statusColor + '15', color: statusColor }}>{statusLabel}</span>
                          {camp.scheduled_at && (
                            <span className="text-[10px] font-bold text-[#B2BEC3] flex items-center gap-1">
                              <Calendar className="size-3" />{new Date(camp.scheduled_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                          {camp.sent !== undefined && (
                            <span className="text-[10px] font-bold text-[#B2BEC3] flex items-center gap-1">
                              <Users className="size-3" />{camp.sent}{camp.target ? `/${camp.target}` : ''} envois
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pl-14 sm:pl-0">
                      <button
                        onClick={() => { if (confirm('Supprimer cette campagne ?')) deleteCampaign.mutate(camp.id); }}
                        className="size-8 rounded-lg flex items-center justify-center text-[#B2BEC3] hover:bg-[#FFEDE9] hover:text-[#E17055] transition-colors"
                        disabled={deleteCampaign.isPending}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ─── MODÈLES DE MESSAGE ─── */}
        {activeTab === 'templates' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8">
              {templatesQuery.isLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-64 bg-white border animate-pulse rounded-xl" style={{ borderColor: C.border }} />)}
                </div>
              ) : templates.length === 0 ? (
                <div className="bg-white rounded-xl border p-16 flex flex-col items-center text-center gap-4" style={{ borderColor: C.border }}>
                  <div className="size-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: C.infoBg }}>
                    <Layout className="size-8" style={{ color: C.info }} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[#2D3436]">Aucun modèle créé</p>
                    <p className="text-xs text-[#B2BEC3] mt-1">Créez des modèles réutilisables avec variables dynamiques</p>
                  </div>
                  <Button onClick={() => setShowAddTemplate(true)} className="h-10 px-6 rounded-xl font-black text-white text-[11px] uppercase tracking-wider" style={{ backgroundColor: C.info }}>
                    <Plus className="size-4 mr-1.5" /> Créer un modèle
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {templates.map((t, i) => {
                    const color = CHANNEL_COLORS[t.type] ?? C.primary;
                    return (
                      <div key={t.id ?? i} className="bg-white rounded-xl border p-6 flex flex-col" style={{ borderColor: C.border }}>
                        <div className="flex justify-between items-center mb-5">
                          <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md" style={{ backgroundColor: `${color}15`, color }}>
                            {t.type}
                          </span>
                          <span className="text-[10px] font-bold text-[#636E72] bg-[#F8F9FC] border px-2 py-1 rounded" style={{ borderColor: C.border }}>{t.language}</span>
                        </div>
                        <h3 className="text-sm font-extrabold text-[#2D3436] mb-3">{t.name}</h3>
                        <div className="bg-[#F8F9FC] border p-4 rounded-lg flex-1 mb-5" style={{ borderColor: C.border }}>
                          <p className="text-[11px] text-[#636E72] font-medium leading-relaxed italic line-clamp-4">"{t.content}"</p>
                        </div>
                        <div className="flex gap-2">
                          <button className="flex-1 py-2.5 rounded-lg text-xs font-bold text-[#636E72] bg-white border hover:bg-[#F8F9FC] transition-colors" style={{ borderColor: C.border }}>
                            Modifier
                          </button>
                          <button
                            onClick={() => { if (confirm('Supprimer ce modèle ?')) deleteTemplate.mutate(t.id); }}
                            disabled={deleteTemplate.isPending}
                            className="px-3 py-2.5 rounded-lg text-xs font-bold text-[#E17055] bg-white border hover:bg-[#FFEDE9] transition-colors" style={{ borderColor: C.border }}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Dynamic Variables Panel */}
            <div className="lg:col-span-4 bg-white rounded-xl border p-6 flex flex-col h-fit" style={{ borderColor: C.border }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="size-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: C.infoBg }}>
                  <Layout className="size-4" style={{ color: C.info }} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#2D3436]">Variables Dynamiques</h3>
                  <p className="text-[10px] font-bold text-[#B2BEC3] uppercase mt-0.5">Cliquez pour copier</p>
                </div>
              </div>
              <div className="space-y-4 overflow-y-auto flex-1 pr-1">
                {[
                  { category: 'Livraison', vars: ['Delivery_Channel', 'Tracking_ID', 'Delivery_Company', 'Delivery_Guy_Phone'] },
                  { category: 'Client & Localisation', vars: ['Customer_Name', 'Customer_Phone', 'Customer_Address', 'Wilaya', 'Commune'] },
                  { category: 'Statut & Dates', vars: ['Order_Status', 'Creation_Date', 'Confirmation_Date', 'Shipping_Date', 'Delivery_Date'] },
                  { category: 'Commande', vars: ['Total_Order', 'Products', 'Order_Source', 'Order_Number'] },
                  { category: 'Agents', vars: ['Agent_Name', 'Agent_Phone', 'FollowUp_Agent_Name'] },
                ].map((grp, idx) => (
                  <div key={idx} className="space-y-2">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">{grp.category}</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {grp.vars.map(v => (
                        <button key={v}
                          onClick={() => { navigator.clipboard?.writeText(`{{${v}}}`); toast.success(`{{${v}}} copié`); }}
                          className="px-2 py-1 bg-[#F8F9FC] text-[#636E72] border rounded text-[10px] font-bold cursor-pointer hover:bg-[#6C5CE7] hover:text-white hover:border-[#6C5CE7] transition-colors"
                          style={{ borderColor: C.border }}
                        >
                          {`{{${v}}}`}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── MODALS ─── */}
      <AddChannelModal open={showAddChannel} onClose={() => setShowAddChannel(false)} storeId={storeId} onSaved={() => queryClient.invalidateQueries({ queryKey: ['marketing', 'channels'] })} />
      <AddCampaignModal open={showAddCampaign} onClose={() => setShowAddCampaign(false)} storeId={storeId} onSaved={() => queryClient.invalidateQueries({ queryKey: ['marketing', 'campaigns'] })} />
      <AddTemplateModal open={showAddTemplate} onClose={() => setShowAddTemplate(false)} storeId={storeId} onSaved={() => queryClient.invalidateQueries({ queryKey: ['marketing', 'templates'] })} />
    </div>
  );
}
