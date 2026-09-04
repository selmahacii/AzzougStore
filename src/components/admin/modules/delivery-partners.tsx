\'use client\';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import {
  Truck, Plus, Search, Check, X, Loader2,
  RefreshCw, Eye, EyeOff, Wifi, Package, Clock,
  MapPin, BarChart3, AlertCircle, Settings, Trash2,
  CheckCircle2, ExternalLink, Activity, Zap, TrendingUp,
  ChevronRight, Radio, Upload, Download, ShieldCheck,
  Send, Database, ArrowUpRight, Copy, Layers, Filter,
  Phone, User, ArrowDownRight, Sparkles, CheckCheck, Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';
import { formatPrice } from '@/lib/format';
import { NoestRealtimeWidget } from '@/components/admin/noest-realtime-widget';

// ─── ALGERIAN WILAYAS ─────────────────────────────────────────
const ALGERIAN_WILAYAS = [
  'Adrar', 'Chlef', 'Laghouat', 'Oum El Bouaghi', 'Batna', 'Béjaïa', 'Biskra', 'Béchar',
  'Blida', 'Bouira', 'Tamanrasset', 'Tébessa', 'Tlemcen', 'Tiaret', 'Tizi Ouzou', 'Alger',
  'Djelfa', 'Jijel', 'Sétif', 'Saïda', 'Skikda', 'Sidi Bel Abbès', 'Annaba', 'Guelma',
  'Constantine', 'Médéa', 'Mostaganem', 'M\\'Sila', 'Mascara', 'Ouargla', 'Oran', 'El Bayadh',
  'Illizi', 'Bordj Bou Arréridj', 'Boumerdès', 'El Tarf', 'Tindouf', 'Tissemsilt', 'El Oued',
  'Khenchela', 'Souk Ahras', 'Tipaza', 'Mila', 'Aïn Defla', 'Naâma', 'Aïn Témouchent',
  'Ghardaïa', 'Relizane', 'Timimoun', 'Bordj Badji Mokhtar', 'Ouled Djellal', 'Béni Abbès',
  'In Salah', 'In Guezzam', 'Touggourt', 'Djanet', 'El M\\'Ghair', 'El Meniaa',
];

// ─── KNOWN CARRIERS ───────────────────────────────────────────
const KNOWN_CARRIERS = [
  {
    id: 'yalidine',
    name: 'Yalidine',
    iconType: 'send',
    color: '#FF6B35',
    website: 'https://yalidine.app',
    description: 'Leader livraison express en Algérie. Couverture nationale 58 wilayas. API REST complète.',
    features: ['Tracking temps réel', 'Webhook statut', '58 wilayas', 'Collecte J+0'],
    pricing: { home: 'À partir de 350 DA', relay: 'À partir de 250 DA' },
    api_docs: 'https://yalidine.app/api',
    sandbox_url: 'https://dev.yalidine.app/v1',
    prod_url: 'https://api.yalidine.app/v1',
    fields: ['api_id', 'api_token'],
  },
  {
    id: 'noest',
    name: 'Noest',
    iconType: 'shield',
    color: '#0984E3',
    website: 'https://noest.dz',
    description: 'Spécialiste e-commerce DZ. Paiement à la livraison sécurisé. Dashboard avancé.',
    features: ['COD sécurisé', 'Dashboard', 'API webhook', 'Preuves photo'],
    pricing: { home: '380 DA', relay: '260 DA' },
    api_docs: 'https://noest.dz/developers',
    sandbox_url: 'https://app.noest-dz.com',
    prod_url: 'https://app.noest-dz.com',
    fields: ['api_token', 'guid'],
  },
  {
    id: 'zr_express',
    name: 'ZR Express',
    iconType: 'zap',
    color: '#6C5CE7',
    website: 'https://zrexpress.app',
    description: 'Transporteur algérien nouvelle génération. API moderne, webhooks, tracking temps réel.',
    features: ['Tracking temps réel', 'Webhooks', 'COD', 'Dashboard fournisseur'],
    pricing: { home: 'Selon grille tarifaire', relay: 'Selon grille tarifaire' },
    api_docs: 'https://api.zrexpress.app',
    sandbox_url: 'https://api.zrexpress.app/api/v1',
    prod_url: 'https://api.zrexpress.app/api/v1',
    fields: ['secret_key', 'tenant_id'],
  },
  {
    id: 'add_new',
    name: 'Ajouter un transporteur',
    iconType: 'plus',
    color: '#636E72',
    website: '',
    description: 'Connectez un autre partenaire logistique personnalisé via son API REST ou webhook.',
    features: ['Intégration sur-mesure'],
    pricing: { home: '—', relay: '—' },
    api_docs: '',
    sandbox_url: '',
    prod_url: '',
    fields: [] as string[],
  },
];

interface DeliveryPartner {
  id: string;
  store_id: string;
  carrier_id: string;
  name: string;
  is_active: boolean;
  is_sandbox: boolean;
  api_config: Record<string, string>;
  fee_home: number;
  fee_relay: number;
  free_shipping_threshold: number | null;
  covered_wilayas: string[];
  webhook_url: string | null;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  created_at: string;
}

// ─── API TEST ─────────────────────────────────────────────────
async function testDeliveryApi(
  carrierId: string,
  storeId: string,
): Promise<{ ok: boolean; message: string; latency_ms: number }> {
  const endpoint = carrierId === 'noest' ? '/api/noest/test' : '/api/yalidine/test';
  const res = await apiFetch(`${endpoint}?store_id=${storeId}`, { method: 'POST' });
  return res as { ok: boolean; message: string; latency_ms: number };
}

// ─── STATUS CONFIG ────────────────────────────────────────────
const TRACKING_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; pulse?: boolean }> = {
  DELIVERED: { label: 'Livré', color: '#00B894', bg: '#E6FFF8' },
  IN_TRANSIT: { label: 'En transit', color: '#0984E3', bg: '#E8F4FE', pulse: true },
  OUT_FOR_DELIVERY: { label: 'En livraison', color: '#FDCB6E', bg: '#FFF8E6', pulse: true },
  PICKED_UP: { label: 'Collecté', color: '#6C5CE7', bg: '#F0EDFF' },
  RETURNED: { label: 'Retourné', color: '#E17055', bg: '#FFEDE9' },
  PENDING: { label: 'En attente', color: '#B2BEC3', bg: '#F8F9FC' },
  FAILED: { label: 'Échec', color: '#E17055', bg: '#FFEDE9' },
};

function CarrierIconBadge({ iconType, color, className }: { iconType: string; color: string; className?: string }) {
  if (iconType === 'send') return <Send className={cn('size-5', className)} style={{ color }} />;
  if (iconType === 'shield') return <ShieldCheck className={cn('size-5', className)} style={{ color }} />;
  if (iconType === 'zap') return <Zap className={cn('size-5', className)} style={{ color }} />;
  if (iconType === 'plus') return <Plus className={cn('size-5', className)} style={{ color }} />;
  return <Truck className={cn('size-5', className)} style={{ color }} />;
}

// ─── REAL-TIME TRACKING ───────────────────────────────────────
function TrackingLookup({ storeId }: { storeId: string }) {
  return (
    <div className="space-y-6">
      <NoestRealtimeWidget />
    </div>
  );
}

// ─── WILAYA FEES STATE ────────────────────────────────────────
type WilayaFees = Record<number, { home: string; desk: string }>;

function getFieldLabel(field: string): string {
  if (field === 'api_id') return 'API ID';
  if (field === 'api_token') return 'API Token';
  if (field === 'guid') return 'GUID utilisateur';
  if (field === 'api_key') return 'Clé API';
  if (field === 'secret') return 'Secret';
  if (field === 'secret_key') return 'Secret Key (ZR Express)';
  if (field === 'tenant_id') return 'Tenant ID (ZR Express)';
  if (field === 'store_id') return 'Store ID';
  if (field === 'token') return 'Token';
  if (field === 'api_url') return 'URL API';
  return field;
}

// ─── PARTNER CONFIG MODAL ─────────────────────────────────────
function PartnerModal({
  open, onClose, carrier, storeId, onSaved, existingPartner,
}: {
  open: boolean; onClose: () => void; carrier: typeof KNOWN_CARRIERS[0] | null; storeId: string; onSaved: () => void;
  existingPartner?: DeliveryPartner | null;
}) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [feeHome, setFeeHome] = useState(existingPartner ? String(existingPartner.fee_home ?? '') : '');
  const [feeRelay, setFeeRelay] = useState(existingPartner ? String(existingPartner.fee_relay ?? '') : '');
  const [freeThreshold, setFreeThreshold] = useState(existingPartner ? String(existingPartner.free_shipping_threshold ?? '') : '');
  const [isSandbox, setIsSandbox] = useState(existingPartner ? existingPartner.is_sandbox : false);
  const [showKeys, setShowKeys] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; latency_ms: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedPartnerId, setSavedPartnerId] = useState<string | null>(existingPartner?.id ?? null);
  const [syncing, setSyncing] = useState(false);
  const [syncedFees, setSyncedFees] = useState<Array<{ wilayaId: number; homeFee: number; officeFee: number }>>([]);
  const [wilayaMode, setWilayaMode] = useState<'manual' | 'excel'>('manual');
  const [wilayaFees, setWilayaFees] = useState<WilayaFees>({});
  const [savingFees, setSavingFees] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [loadingFees, setLoadingFees] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    if (!existingPartner) return;
    setFeeHome(String(existingPartner.fee_home ?? ''));
    setFeeRelay(String(existingPartner.fee_relay ?? ''));
    setFreeThreshold(String(existingPartner.free_shipping_threshold ?? ''));
    setIsSandbox(existingPartner.is_sandbox ?? false);
    setSavedPartnerId(existingPartner.id ?? null);
  }, [open, existingPartner?.id, existingPartner?.fee_home, existingPartner?.fee_relay, existingPartner?.free_shipping_threshold]);

  useEffect(() => {
    if (!open || !existingPartner?.id) return;
    setLoadingFees(true);
    apiFetch(`/api/v1/delivery-partners/${existingPartner.id}/fees`)
      .then((res: any) => {
        const entries: Array<{ wilaya_id: number; home_fee: number; office_fee: number }> = res?.data ?? [];
        if (entries.length > 0) {
          const loaded: WilayaFees = {};
          for (const e of entries) {
            loaded[e.wilaya_id] = { home: String(e.home_fee || ''), desk: String(e.office_fee || '') };
          }
          setWilayaFees(loaded);
        }
      })
      .catch((e: any) => { console.error('[DeliveryPartners] fees load ERROR', e); })
      .finally(() => setLoadingFees(false));
  }, [open, existingPartner?.id]);

  if (!carrier) return null;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      if (carrier.id === 'noest') {
        const r = await apiFetch<{ ok: boolean; message: string; latency_ms: number }>(
          `/api/noest/test?store_id=${storeId}`,
          { method: 'POST', body: JSON.stringify({ api_token: form.api_token, guid: form.guid }) }
        );
        setTestResult(r);
      } else {
        if (!savedPartnerId) {
          toast.error('Enregistrez la configuration avant de tester.');
          return;
        }
        const r = await testDeliveryApi(carrier.id, storeId);
        setTestResult(r);
      }
    } catch (e: any) {
      setTestResult({ ok: false, message: e?.message || 'Impossible de joindre le serveur', latency_ms: 0 });
    } finally {
      setTesting(false);
    }
  };

  const handleSyncWilayas = async () => {
    if (!savedPartnerId) return;
    setSyncing(true);
    try {
      const res: any = await apiFetch(`/api/v1/delivery-partners/${savedPartnerId}/sync-fees`, { method: 'POST' });
      toast.success(res?.message ?? 'Tarifs synchronisés depuis l\\'API');
      
      setLoadingFees(true);
      const feesRes: any = await apiFetch(`/api/v1/delivery-partners/${savedPartnerId}/fees`);
      const entries: Array<{ wilaya_id: number; home_fee: number; office_fee: number }> = feesRes?.data ?? [];
      if (entries.length > 0) {
        const loaded: WilayaFees = {};
        for (const e of entries) {
          loaded[e.wilaya_id] = { home: String(e.home_fee || ''), desk: String(e.office_fee || '') };
        }
        setWilayaFees(loaded);
      }
      setLoadingFees(false);
      qc.invalidateQueries({ queryKey: ['delivery-partners'] });
    } catch (e: any) {
      toast.error(e?.message ?? 'Erreur synchronisation API');
      setLoadingFees(false);
    } finally {
      setSyncing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const feeHomeVal = parseFloat(feeHome) || 0;
      const feeRelayVal = parseFloat(feeRelay) || 0;
      const threshold = freeThreshold ? parseFloat(freeThreshold) : null;

      let partnerId = savedPartnerId;

      if (partnerId) {
        const patchBody = {
          is_sandbox: isSandbox,
          fee_home: feeHomeVal,
          fee_relay: feeRelayVal,
          free_shipping_threshold: threshold,
          ...(Object.keys(form).length > 0 ? { api_config: form } : {}),
        };
        await apiFetch(`/api/v1/delivery-partners/${partnerId}`, {
          method: 'PATCH',
          body: JSON.stringify(patchBody),
        });
      } else {
        const postBody = {
          store_id: storeId,
          carrier_id: carrier.id,
          name: carrier.name,
          is_sandbox: isSandbox,
          api_config: form,
          fee_home: feeHomeVal,
          fee_relay: feeRelayVal,
          free_shipping_threshold: threshold,
        };
        const res: any = await apiFetch('/api/v1/delivery-partners', {
          method: 'POST',
          body: JSON.stringify(postBody),
        });
        partnerId = res?.data?.id ?? res?.id ?? null;
        if (partnerId) setSavedPartnerId(partnerId);
      }

      if (partnerId) {
        const fees = Object.entries(wilayaFees)
          .filter(([, v]) => v.home !== '' || v.desk !== '')
          .map(([id, v]) => ({
            wilaya_id: parseInt(id),
            home_fee: parseFloat(v.home) || 0,
            office_fee: parseFloat(v.desk) || 0,
          }));
        if (fees.length > 0) {
          await apiFetch(`/api/v1/delivery-partners/${partnerId}/fees`, {
            method: 'POST',
            body: JSON.stringify({ fees }),
          });
        }
      }

      toast.success(`${carrier.name} — configuration enregistrée`);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveFees = async () => {
    const partnerId = savedPartnerId;
    if (!partnerId) {
      toast.error('Enregistrez d\\'abord la configuration API.');
      return;
    }
    const fees = Object.entries(wilayaFees)
      .filter(([, v]) => v.home !== '' || v.desk !== '')
      .map(([id, v]) => ({
        wilaya_id: parseInt(id),
        home_fee: parseFloat(v.home) || 0,
        office_fee: parseFloat(v.desk) || 0,
      }));

    if (fees.length === 0) {
      toast.error('Aucun tarif saisi.');
      return;
    }
    setSavingFees(true);
    try {
      await apiFetch(`/api/v1/delivery-partners/${partnerId}/fees`, {
        method: 'POST',
        body: JSON.stringify({ fees }),
      });
      toast.success(`${fees.length} tarifs sauvegardés`);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? 'Erreur sauvegarde des tarifs');
    } finally {
      setSavingFees(false);
    }
  };

  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['wilaya_id', 'wilaya_nom', 'domicile_da', 'stop_desk_da'],
      ...ALGERIAN_WILAYAS.map((name, i) => [i + 1, name, '', '']),
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Wilayas');
    XLSX.writeFile(wb, 'template_tarifs_wilayas.xlsx');
  };

  const handleExcelFile = (file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const wb = XLSX.read(data, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const newFees: WilayaFees = { ...wilayaFees };
        let count = 0;
        for (const row of rows) {
          const id = parseInt(row['wilaya_id'] ?? row['Wilaya ID'] ?? '');
          const home = String(row['domicile_da'] ?? row['Domicile'] ?? '').trim();
          const desk = String(row['stop_desk_da'] ?? row['Stop Desk'] ?? '').trim();
          if (!isNaN(id) && id >= 1 && id <= 58) {
            newFees[id] = { home, desk };
            count++;
          }
        }
        setWilayaFees(newFees);
        toast.success(`${count} wilayas importées depuis Excel`);
      } catch (err) {
        toast.error('Erreur lecture du fichier Excel');
      }
    };
    reader.readAsBinaryString(file);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="
        max-w-3xl p-0 border border-slate-100 shadow-2xl overflow-hidden flex flex-col
        w-[100vw] h-[100dvh] rounded-none
        sm:w-[96vw] sm:h-auto sm:max-h-[90dvh] sm:rounded-3xl bg-white
      ">
        {/* Header */}
        <div className="px-6 sm:px-8 py-5 text-white shrink-0 flex items-center justify-between gap-4" style={{ backgroundColor: carrier.color }}>
          <div className="flex items-center gap-4 min-w-0">
            <div className="size-12 rounded-2xl bg-white/20 backdrop-blur-xs flex items-center justify-center shrink-0">
              <CarrierIconBadge iconType={carrier.iconType} color="#FFFFFF" className="size-6" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-lg sm:text-xl font-black uppercase tracking-wider truncate">{carrier.name}</DialogTitle>
              <DialogDescription className="text-white/80 text-xs font-bold mt-0.5">
                Configuration API, Grille Wilayas & Webhooks
              </DialogDescription>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all shrink-0 cursor-pointer">
            <X className="size-5 text-white" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <Tabs defaultValue="config">
            <div className="px-6 sm:px-8 border-b border-slate-100 bg-[#F8F9FC]">
              <TabsList className="h-12 bg-transparent gap-6 border-0">
                <TabsTrigger value="config" className="h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-[#4b7bec] rounded-none px-0 text-xs font-black uppercase tracking-wider text-slate-400 data-[state=active]:text-slate-800 flex items-center gap-1.5">
                  <Settings className="size-3.5" /> Config API
                </TabsTrigger>
                <TabsTrigger value="wilayas" className="h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-[#4b7bec] rounded-none px-0 text-xs font-black uppercase tracking-wider text-slate-400 data-[state=active]:text-slate-800 flex items-center gap-1.5">
                  <MapPin className="size-3.5" /> Grille 58 Wilayas
                </TabsTrigger>
                <TabsTrigger value="info" className="h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-[#4b7bec] rounded-none px-0 text-xs font-black uppercase tracking-wider text-slate-400 data-[state=active]:text-slate-800 flex items-center gap-1.5">
                  <Info className="size-3.5" /> Traçabilité & Infos
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="p-6 sm:p-8 space-y-6">
              {/* ── Config Tab ── */}
              <TabsContent value="config" className="mt-0 space-y-5">
                <div className="flex items-center justify-between p-4 bg-[#F8F9FC] rounded-2xl border border-[#E9ECF0]">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-slate-800">Mode Sandbox (Test)</p>
                    <p className="text-[11px] text-[#636E72] font-medium mt-0.5">Activer pour pointer vers l\\'environnement de test du transporteur</p>
                  </div>
                  <button
                    onClick={() => setIsSandbox(s => !s)}
                    className={cn("relative w-12 h-6 rounded-full transition-all cursor-pointer", isSandbox ? "bg-amber-400" : "bg-emerald-500")}
                  >
                    <div className={cn("absolute top-1 size-4 rounded-full bg-white shadow transition-transform", isSandbox ? "left-1" : "left-7")} />
                  </button>
                </div>

                <div className="space-y-4">
                  {carrier.fields.map(field => (
                    <div key={field} className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                        {getFieldLabel(field)}
                      </label>
                      <div className="relative">
                        <Input
                          type={showKeys ? 'text' : 'password'}
                          value={form[field] || ''}
                          onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                          placeholder={field === 'api_url' ? `https://api.${carrier.id}.dz/v1` : `${field.toUpperCase()}_...`}
                          className="h-11 rounded-xl border-slate-200 bg-[#F8F9FC] font-mono text-xs pr-10 focus:bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => setShowKeys(s => !s)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                        >
                          {showKeys ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {carrier.fields.length > 0 && (
                  <div className="pt-2 space-y-3">
                    <Button
                      type="button"
                      onClick={handleTest}
                      disabled={testing || carrier.fields.some(f => !form[f])}
                      className="w-full h-11 rounded-xl font-black uppercase tracking-wider text-xs text-white shadow-sm"
                      style={{ backgroundColor: carrier.color }}
                    >
                      {testing ? <><Loader2 className="size-4 mr-2 animate-spin" />Test en cours...</> : <><Wifi className="size-4 mr-2" />Tester la connexion API</>}
                    </Button>

                    {testResult && (
                      <div className={cn("p-4 rounded-2xl flex items-start gap-3", testResult.ok ? "bg-emerald-50 border border-emerald-200" : "bg-rose-50 border border-rose-200")}>
                        {testResult.ok ? <CheckCircle2 className="size-5 text-emerald-600 shrink-0 mt-0.5" /> : <AlertCircle className="size-5 text-rose-600 shrink-0 mt-0.5" />}
                        <div>
                          <p className={cn("text-xs font-bold", testResult.ok ? "text-emerald-800" : "text-rose-800")}>{testResult.message}</p>
                          {testResult.ok && <p className="text-[10px] text-emerald-600 font-mono mt-0.5">Latence serveur: {testResult.latency_ms}ms</p>}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>

              {/* ── Wilayas Tab ── */}
              <TabsContent value="wilayas" className="mt-0 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Domicile par défaut (DA)</label>
                    <div className="relative">
                      <Input type="number" value={feeHome} onChange={e => setFeeHome(e.target.value)} placeholder={carrier.pricing.home} className="h-10 rounded-xl border-slate-200 bg-[#F8F9FC] pl-9 text-xs font-black" />
                      <span className="absolute left-3 top-1/2 -translate-y-1/2"><Truck className="size-4 text-slate-400" /></span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Stop Desk par défaut (DA)</label>
                    <div className="relative">
                      <Input type="number" value={feeRelay} onChange={e => setFeeRelay(e.target.value)} placeholder={carrier.pricing.relay} className="h-10 rounded-xl border-slate-200 bg-[#F8F9FC] pl-9 text-xs font-black" />
                      <span className="absolute left-3 top-1/2 -translate-y-1/2"><Package className="size-4 text-slate-400" /></span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Livraison gratuite dès (DA)</label>
                    <Input type="number" value={freeThreshold} onChange={e => setFreeThreshold(e.target.value)} placeholder="Ex: 8000" className="h-10 rounded-xl border-slate-200 bg-[#F8F9FC] text-xs font-black" />
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#F8F9FC] p-4 rounded-2xl border border-[#E9ECF0]">
                  <div className="flex items-center gap-3">
                    <MapPin className="size-5 text-[#4b7bec] shrink-0" />
                    <div>
                      <p className="text-xs font-black uppercase tracking-wider text-slate-800">Grille Tarifaire (58 Wilayas)</p>
                      <p className="text-[11px] text-[#636E72]">Tarification personnalisée par zone géographique</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {['yalidine', 'zr_express'].includes(carrier.id) && savedPartnerId && (
                      <Button
                        onClick={handleSyncWilayas}
                        disabled={syncing}
                        size="sm"
                        className="h-8 rounded-xl text-[10px] font-black uppercase bg-[#4b7bec] text-white hover:bg-blue-600"
                      >
                        {syncing ? <Loader2 className="size-3 animate-spin mr-1" /> : <RefreshCw className="size-3 mr-1" />}
                        Sync auto API
                      </Button>
                    )}
                  </div>
                </div>

                {/* Mode switcher */}
                <div className="flex gap-2 bg-[#F8F9FC] p-1 rounded-xl border border-[#E9ECF0]">
                  <button
                    onClick={() => setWilayaMode('manual')}
                    className={cn("flex-1 h-8 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer",
                      wilayaMode === 'manual' ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-800"
                    )}
                  >
                    Mode Manuel
                  </button>
                  <button
                    onClick={() => setWilayaMode('excel')}
                    className={cn("flex-1 h-8 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer",
                      wilayaMode === 'excel' ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-800"
                    )}
                  >
                    Import Excel (.xlsx)
                  </button>
                </div>

                {wilayaMode === 'manual' && (
                  <>
                    <div className="hidden sm:grid grid-cols-12 gap-3 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-slate-400">
                      <div className="col-span-1">#</div>
                      <div className="col-span-5">Wilaya</div>
                      <div className="col-span-3 text-center">Domicile (DA)</div>
                      <div className="col-span-3 text-center">Stop Desk (DA)</div>
                    </div>

                    <div className="space-y-1.5 max-h-[340px] overflow-y-auto pr-1 custom-scrollbar">
                      {ALGERIAN_WILAYAS.map((name, i) => {
                        const id = i + 1;
                        const synced = syncedFees.find(f => f.wilayaId === id);
                        const fees = wilayaFees[id] ?? { home: '', desk: '' };
                        return (
                          <div key={id} className={cn(
                            "flex sm:grid sm:grid-cols-12 gap-2 sm:gap-3 p-2.5 rounded-xl border items-center",
                            synced ? "bg-emerald-50 border-emerald-100" : "bg-white border-slate-100"
                          )}>
                            <div className="hidden sm:block col-span-1 text-[10px] font-black text-slate-400 shrink-0 font-mono">
                              {id.toString().padStart(2, '0')}
                            </div>
                            <div className="sm:col-span-5 text-xs font-bold text-slate-800 flex-1 min-w-0 truncate">{name}</div>
                            <div className="sm:col-span-3 shrink-0">
                              {synced ? (
                                <span className="text-xs font-black text-emerald-700 block text-center font-mono">{synced.homeFee} DA</span>
                              ) : (
                                <Input
                                  type="number"
                                  placeholder="DA"
                                  value={fees.home}
                                  onChange={e => setWilayaFees(f => ({ ...f, [id]: { ...f[id] ?? { desk: '' }, home: e.target.value } }))}
                                  className="h-8 rounded-lg border-slate-200 bg-[#F8F9FC] text-xs font-bold text-center w-20 sm:w-full"
                                />
                              )}
                            </div>
                            <div className="sm:col-span-3 shrink-0">
                              {synced ? (
                                <span className="text-xs font-black text-blue-700 block text-center font-mono">{synced.officeFee} DA</span>
                              ) : (
                                <Input
                                  type="number"
                                  placeholder="DA"
                                  value={fees.desk}
                                  onChange={e => setWilayaFees(f => ({ ...f, [id]: { ...f[id] ?? { home: '' }, desk: e.target.value } }))}
                                  className="h-8 rounded-lg border-slate-200 bg-[#F8F9FC] text-xs font-bold text-center w-20 sm:w-full"
                                />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <Button
                      onClick={handleSaveFees}
                      disabled={savingFees || loadingFees}
                      className="w-full h-11 rounded-xl font-black uppercase tracking-wider text-xs bg-[#4b7bec] text-white"
                    >
                      {(savingFees || loadingFees) ? <Loader2 className="size-4 animate-spin mr-2" /> : <Check className="size-4 mr-2" />}
                      {loadingFees ? 'Chargement...' : 'Sauvegarder les tarifs'}
                    </Button>
                  </>
                )}

                {wilayaMode === 'excel' && (
                  <div className="space-y-4">
                    <Button
                      onClick={handleDownloadTemplate}
                      variant="outline"
                      className="w-full h-11 rounded-xl font-black uppercase tracking-wider text-xs border-slate-200 text-slate-700 gap-2"
                    >
                      <Download className="size-4 text-[#4b7bec]" />
                      Télécharger le modèle Excel (58 Wilayas)
                    </Button>

                    <label
                      className={cn(
                        "flex flex-col items-center justify-center gap-3 w-full h-40 rounded-2xl border-2 border-dashed cursor-pointer transition-all",
                        dragOver
                          ? "border-[#4b7bec] bg-[#F0F5FF]"
                          : "border-slate-200 bg-[#F8F9FC] hover:border-slate-300 hover:bg-slate-100"
                      )}
                      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={e => {
                        e.preventDefault();
                        setDragOver(false);
                        const file = e.dataTransfer.files[0];
                        if (file) handleExcelFile(file);
                      }}
                    >
                      <div className={cn("size-10 rounded-xl flex items-center justify-center transition-all",
                        dragOver ? "bg-[#4b7bec]/10" : "bg-slate-200"
                      )}>
                        <Upload className={cn("size-5", dragOver ? "text-[#4b7bec]" : "text-slate-400")} />
                      </div>
                      <div className="text-center">
                        <p className="text-xs font-black text-slate-700">
                          {dragOver ? 'Déposez le fichier ici' : 'Glissez votre fichier Excel ou cliquez pour parcourir'}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-0.5">Format supporté : .xlsx, .xls</p>
                      </div>
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        className="hidden"
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (file) handleExcelFile(file);
                          e.target.value = '';
                        }}
                      />
                    </label>

                    {Object.keys(wilayaFees).length > 0 && (
                      <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-3">
                        <CheckCircle2 className="size-5 text-emerald-600 shrink-0" />
                        <div>
                          <p className="text-xs font-bold text-emerald-800">
                            {Object.keys(wilayaFees).length} wilayas chargées avec succès
                          </p>
                          <p className="text-[10px] text-emerald-600">Revenez au Mode Manuel pour enregistrer.</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>

              {/* ── Info Tab ── */}
              <TabsContent value="info" className="mt-0 space-y-5">
                <p className="text-xs font-medium text-slate-600 leading-relaxed">{carrier.description}</p>
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Fonctionnalités intégrées</p>
                  <div className="flex flex-wrap gap-2">
                    {carrier.features.map(f => (
                      <span key={f} className="px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-200 text-slate-700 bg-[#F8F9FC] flex items-center gap-1.5">
                        <Check className="size-3 text-emerald-500" />{f}
                      </span>
                    ))}
                  </div>
                </div>
                {carrier.api_docs && (
                  <a href={carrier.api_docs} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs font-black text-[#4b7bec] hover:underline">
                    <ExternalLink className="size-3.5" /> Documentation API officielle
                  </a>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
                    <p className="font-black text-amber-800 uppercase tracking-wider text-[9px] mb-1">Sandbox Endpoint</p>
                    <p className="font-mono text-amber-700 break-all text-[10px]">{carrier.sandbox_url || '—'}</p>
                  </div>
                  <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                    <p className="font-black text-emerald-800 uppercase tracking-wider text-[9px] mb-1">Production Endpoint</p>
                    <p className="font-mono text-emerald-700 break-all text-[10px]">{carrier.prod_url || '—'}</p>
                  </div>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>

        <div className="px-6 sm:px-8 py-4 border-t border-slate-100 bg-white flex justify-end gap-3 shrink-0">
          <Button variant="ghost" onClick={onClose} className="h-11 px-5 rounded-xl font-bold text-xs text-slate-500 hover:text-slate-800 cursor-pointer">
            Annuler
          </Button>
          {carrier.id !== 'add_new' && (
            <Button
              onClick={handleSave}
              disabled={saving || carrier.fields.some(f => !form[f])}
              className="h-11 px-8 rounded-xl font-black uppercase tracking-wider text-xs text-white cursor-pointer shadow-sm"
              style={{ backgroundColor: carrier.color }}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <><Check className="size-4 mr-1.5" />Enregistrer</>}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── TAB CONFIG ───────────────────────────────────────────────
const TAB_CONFIG = [
  { id: 'carriers', label: 'Carriers & API', desc: 'Gestion des transporteurs et intégrations API directes', icon: Truck },
  { id: 'tracking', label: 'Suivi Temps Réel', desc: 'Tableau de bord de suivi logistique interactif', icon: Activity },
  { id: 'orders', label: 'Commandes en Transit', desc: 'Flux et liste des colis en cours d\\'acheminement', icon: Package },
] as const;

type TabId = typeof TAB_CONFIG[number]['id'];

function normalizeTab(sv: string | null): TabId {
  if (!sv) return 'carriers';
  if (sv === 'tracking' || sv === 'Suivi de colis' || sv === 'stats' || sv === 'Statistiques') return 'tracking';
  if (sv === 'orders') return 'orders';
  return 'carriers';
}

// ─── CARRIER ORDERS LIST ──────────────────────────────────────
function CarrierOrdersList({ storeId, partners }: { storeId: string; partners: DeliveryPartner[] }) {
  const [selectedCarrierId, setSelectedCarrierId] = useState<string>('all');
  const [trackingSearch, setTrackingSearch] = useState('');
  const [page, setPage] = useState(1);
  const { setAdminView, setSelectedOrderId } = useAppStore();

  const openOrder = (orderId: string) => {
    setSelectedOrderId(orderId);
    setAdminView('orders', 'ALL');
  };

  const ordersQuery = useQuery({
    queryKey: ['carrier-orders', storeId, selectedCarrierId, trackingSearch, page],
    queryFn: () => {
      const params = new URLSearchParams({ store_id: storeId, page: String(page), pageSize: '20', status: 'SHIPPED' });
      if (selectedCarrierId !== 'all') params.set('carrier_id', selectedCarrierId);
      if (trackingSearch) params.set('search', trackingSearch);
      return apiFetch(`/api/v1/orders?${params}`);
    },
    enabled: !!storeId,
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
  });

  const orders: any[] = (ordersQuery.data as any)?.data ?? [];
  const total: number = (ordersQuery.data as any)?.total ?? 0;
  const totalPages: number = (ordersQuery.data as any)?.totalPages ?? 1;

  const allCarriers = partners.map(p => {
    const known = KNOWN_CARRIERS.find(k => k.id === p.carrier_id);
    return { id: p.id, name: p.name || known?.name || p.carrier_id, iconType: known?.iconType ?? 'truck', color: known?.color ?? '#4b7bec' };
  });

  return (
    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden space-y-0">
      <div className="px-6 py-5 border-b border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-blue-50 text-[#4b7bec] flex items-center justify-center shrink-0">
            <Package className="size-5" />
          </div>
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-800">Commandes en Acheminement</h3>
            <p className="text-xs text-[#636E72] font-medium mt-0.5">{total} colis actuellement en transit ou en livraison</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <select
            value={selectedCarrierId}
            onChange={e => { setSelectedCarrierId(e.target.value); setPage(1); }}
            className="h-9 rounded-xl border border-slate-200 bg-[#F8F9FC] text-xs font-bold text-slate-700 px-3 focus:outline-none focus:border-[#4b7bec]"
          >
            <option value="all">Tous les transporteurs</option>
            {allCarriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="relative flex-1 sm:flex-initial">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
            <Input
              value={trackingSearch}
              onChange={e => { setTrackingSearch(e.target.value); setPage(1); }}
              placeholder="N° Commande, Tracking..."
              className="h-9 pl-9 pr-3 rounded-xl border-slate-200 bg-[#F8F9FC] text-xs font-medium w-full sm:w-48"
            />
          </div>
          <button
            onClick={() => ordersQuery.refetch()}
            className="h-9 w-9 rounded-xl border border-slate-200 bg-[#F8F9FC] flex items-center justify-center text-slate-500 hover:text-[#4b7bec] hover:bg-white transition-all cursor-pointer"
          >
            <RefreshCw className={cn("size-3.5", ordersQuery.isFetching && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left min-w-[700px]">
          <thead>
            <tr className="bg-[#F8F9FC] border-b border-slate-100">
              {['Commande', 'Client', 'Transporteur', 'Wilaya', 'N° Tracking', 'Statut', 'Date expéd.'].map(h => (
                <th key={h} className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ordersQuery.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td colSpan={7} className="px-5 py-3"><div className="h-8 bg-slate-100 rounded-xl animate-pulse" /></td></tr>
              ))
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-slate-400">
                  <Package className="size-8 mx-auto mb-2 text-slate-300" />
                  <p className="text-xs font-bold uppercase tracking-wider">Aucune commande en cours d\\'acheminement</p>
                </td>
              </tr>
            ) : orders.map((order: any) => {
              const carrier = allCarriers.find(c => c.id === order.carrier_id) ?? { name: order.carrier_id ?? '—', iconType: 'truck', color: '#636E72' };
              const statusCfg = TRACKING_STATUS_CONFIG[order.delivery_status?.toUpperCase() ?? ''] ?? TRACKING_STATUS_CONFIG.PENDING;
              return (
                <tr key={order.id} onClick={() => openOrder(order.id)} className="hover:bg-slate-50/80 transition-colors group cursor-pointer">
                  <td className="px-5 py-3">
                    <p className="text-xs font-black text-[#4b7bec] font-mono group-hover:underline">
                      {order.store_sequence_number ? `Commande N°${order.store_sequence_number}` : (order.order_number ?? order.id?.slice(0, 8))}
                    </p>
                  </td>
                  <td className="px-5 py-3">
                    <p className="text-xs font-bold text-slate-800">{order.customer_name}</p>
                    <p className="text-[10px] text-slate-400 font-mono">{order.customer_phone}</p>
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700">
                      <CarrierIconBadge iconType={carrier.iconType} color={carrier.color} className="size-3.5" />
                      {carrier.name}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs font-medium text-slate-600">{order.customer_wilaya ?? '—'}</span>
                  </td>
                  <td className="px-5 py-3">
                    {order.tracking_number ? (
                      <code className="text-[10px] font-black font-mono bg-blue-50 border border-blue-100 px-2 py-1 rounded-md text-[#4b7bec]">{order.tracking_number}</code>
                    ) : <span className="text-slate-300 text-[10px]">—</span>}
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black" style={{ color: statusCfg.color, backgroundColor: statusCfg.bg }}>
                      {statusCfg.pulse && <span className="size-1.5 rounded-full animate-pulse inline-block" style={{ backgroundColor: statusCfg.color }} />}
                      {statusCfg.label}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-[10px] text-slate-400 font-mono">
                      {order.shipped_at ? new Date(order.shipped_at).toLocaleDateString('fr-FR') : order.updated_at ? new Date(order.updated_at).toLocaleDateString('fr-FR') : '—'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between bg-[#F8F9FC]">
          <span className="text-xs font-bold text-slate-500">{total} commandes au total</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="size-8 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-500 disabled:opacity-30 hover:text-[#4b7bec] transition-all cursor-pointer">
              <ChevronRight className="size-4 rotate-180" />
            </button>
            <span className="text-xs font-black text-slate-700">{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="size-8 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-500 disabled:opacity-30 hover:text-[#4b7bec] transition-all cursor-pointer">
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CUSTOM CARRIER MODAL ─────────────────────────────────────
function CustomCarrierModal({ open, onClose, storeId, onSaved }: { open: boolean; onClose: () => void; storeId: string; onSaved: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', api_url: '', api_key: '', fee_home: '', fee_relay: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Nom du transporteur requis'); return; }
    setSaving(true);
    try {
      const carrierId = form.name.toLowerCase().replace(/\\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      await apiFetch('/api/v1/delivery-partners', {
        method: 'POST',
        body: JSON.stringify({
          store_id: storeId,
          carrier_id: carrierId,
          name: form.name,
          is_sandbox: false,
          api_config: { api_url: form.api_url, api_key: form.api_key, notes: form.notes },
          fee_home: parseFloat(form.fee_home) || 0,
          fee_relay: parseFloat(form.fee_relay) || 0,
        }),
      });
      toast.success(`${form.name} ajouté avec succès`);
      qc.invalidateQueries({ queryKey: ['delivery-partners'] });
      onSaved();
      onClose();
      setForm({ name: '', api_url: '', api_key: '', fee_home: '', fee_relay: '', notes: '' });
    } catch (e: any) {
      toast.error(e?.message || 'Erreur lors de l\\'ajout');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-xl rounded-3xl p-0 overflow-hidden border border-slate-100 shadow-2xl bg-white">
        <div className="bg-[#2D3436] p-6 text-white flex items-center justify-between">
          <div>
            <DialogTitle className="text-base font-black uppercase tracking-wider">Ajouter un Transporteur Personnalisé</DialogTitle>
            <DialogDescription className="text-white/60 text-xs font-bold mt-0.5">Connectez n\\'importe quel transporteur avec ses identifiants API</DialogDescription>
          </div>
          <button onClick={onClose} className="size-8 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all cursor-pointer">
            <X className="size-4 text-white" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Nom du transporteur *</label>
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex: Swift Express DZ" className="h-11 rounded-xl border-slate-200 bg-[#F8F9FC]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Tarif domicile (DA)</label>
              <Input type="number" value={form.fee_home} onChange={e => setForm({ ...form, fee_home: e.target.value })} placeholder="350" className="h-11 rounded-xl border-slate-200 bg-[#F8F9FC]" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Tarif relais (DA)</label>
              <Input type="number" value={form.fee_relay} onChange={e => setForm({ ...form, fee_relay: e.target.value })} placeholder="250" className="h-11 rounded-xl border-slate-200 bg-[#F8F9FC]" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">URL API Endpoint (optionnel)</label>
            <Input value={form.api_url} onChange={e => setForm({ ...form, api_url: e.target.value })} placeholder="https://api.carrier.dz/v1" className="h-11 rounded-xl border-slate-200 bg-[#F8F9FC]" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Clé API / Token (optionnel)</label>
            <Input type="password" value={form.api_key} onChange={e => setForm({ ...form, api_key: e.target.value })} placeholder="••••••••••••" className="h-11 rounded-xl border-slate-200 bg-[#F8F9FC]" />
          </div>
        </div>
        <div className="px-6 pb-6 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} className="h-11 px-5 rounded-xl text-slate-500 font-bold text-xs uppercase tracking-wider">
            Annuler
          </Button>
          <Button onClick={handleSave} disabled={saving} className="h-11 px-6 rounded-xl bg-[#2D3436] text-white font-black text-xs uppercase tracking-wider hover:bg-black cursor-pointer shadow-sm">
            {saving ? <Loader2 className="size-4 animate-spin" /> : 'Ajouter le Transporteur'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── MAIN EXPORT COMPONENT ────────────────────────────────────
export default function DeliveryPartners() {
  const { activeStore, adminSubView } = useAppStore();
  const [search, setSearch] = useState('');
  const [selectedCarrier, setSelectedCarrier] = useState<typeof KNOWN_CARRIERS[0] | null>(null);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>(normalizeTab(adminSubView));
  const [statsPeriod, setStatsPeriod] = useState<'today' | '7d' | '30d' | 'all_time'>('30d');
  const qc = useQueryClient();

  useEffect(() => {
    setActiveTab(normalizeTab(adminSubView));
  }, [adminSubView]);

  const { data: partnersRaw, isLoading } = useQuery({
    queryKey: ['delivery-partners', activeStore?.id],
    queryFn: () => apiFetch(`/api/v1/delivery-partners?store_id=${activeStore?.id}`),
    enabled: !!activeStore?.id,
    retry: false,
  });

  const statsQuery = useQuery({
    queryKey: ['delivery-stats', activeStore?.id, statsPeriod],
    queryFn: () => apiFetch(`/api/v1/analytics?store_id=${activeStore?.id}&type=delivery&period=${statsPeriod}`),
    enabled: !!activeStore?.id && activeTab === 'tracking',
    retry: false,
    refetchInterval: activeTab === 'tracking' ? 60_000 : false,
    refetchIntervalInBackground: false,
  });

  const deletePartner = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/delivery-partners/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['delivery-partners'] });
      toast.success('Transporteur retiré avec succès');
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  });

  const partners: DeliveryPartner[] = Array.isArray(partnersRaw) ? partnersRaw : (partnersRaw as any)?.data ?? [];
  const configuredIds = new Set(partners.map(p => p.carrier_id));
  const configuredPartnerByCarrier = Object.fromEntries(partners.map(p => [p.carrier_id, p]));

  const filteredCarriers = KNOWN_CARRIERS.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-500">

      {/* ─── HEADER & ACTIONS (Meta Ads Style) ─── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
        <div>
          <h1 className="text-xl font-black uppercase tracking-wider flex items-center gap-2 text-slate-800">
            <Truck className="size-6 text-[#4b7bec]" /> Partenaires Livraison & Logistique
          </h1>
          <p className="text-xs font-bold text-[#636E72] mt-1">
            Intégration API carriers, synchronisation temps réel, grilles tarifaires 58 Wilayas et suivi de colis.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center w-full md:w-auto">
          <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-black border border-emerald-200">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            {configuredIds.size} Partenaire{configuredIds.size > 1 ? 's' : ''} Actif{configuredIds.size > 1 ? 's' : ''}
          </span>
          <button
            onClick={() => setShowCustomModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#2D3436] text-white text-xs font-black uppercase tracking-wider hover:bg-black transition-all cursor-pointer shadow-sm"
          >
            <Plus className="size-3.5" /> Nouveau Transporteur
          </button>
        </div>
      </div>

      {/* ─── TAB NAVIGATION BAR (Meta Ads Style) ─── */}
      <div className="flex items-center gap-2 bg-[#F8F9FC] p-1.5 rounded-2xl border border-[#E9ECF0] overflow-x-auto">
        {TAB_CONFIG.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap",
                isActive
                  ? "bg-[#4b7bec] text-white shadow-md shadow-blue-500/20"
                  : "text-[#636E72] hover:text-[#2D3436] hover:bg-white"
              )}
            >
              <Icon className="size-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ─── TAB 1: CARRIERS & API ─── */}
      {activeTab === 'carriers' && (
        <div className="space-y-6">
          {/* Search + Quick KPI Strip */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div className="lg:col-span-3 bg-white rounded-3xl border border-slate-100 px-5 py-3.5 flex items-center gap-3 shadow-sm">
              <Search className="size-4 text-slate-400 shrink-0" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher un transporteur (Yalidine, Noest, ZR Express...)..."
                className="flex-1 outline-none text-xs font-bold text-slate-800 bg-transparent placeholder:text-slate-400"
              />
              {search && (
                <button onClick={() => setSearch('')} className="text-xs text-slate-400 hover:text-slate-600 font-bold">
                  Effacer
                </button>
              )}
            </div>

            <div className="bg-[#2D3436] rounded-3xl p-4 flex items-center justify-between text-white shadow-sm">
              <div>
                <p className="text-[10px] font-black text-white/50 uppercase tracking-widest">Connectés</p>
                <p className="text-2xl font-black text-white tabular-nums">{configuredIds.size} / {KNOWN_CARRIERS.length - 1}</p>
              </div>
              <div className="size-10 rounded-2xl bg-white/10 flex items-center justify-center">
                <Truck className="size-5 text-white/80" />
              </div>
            </div>
          </div>

          {/* Carriers Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredCarriers.map(carrier => {
              const isAddNew = carrier.id === 'add_new';
              const isConfigured = !isAddNew && configuredIds.has(carrier.id);
              const partnerInfo = isConfigured ? configuredPartnerByCarrier[carrier.id] : null;

              if (isAddNew) {
                return (
                  <div
                    key={carrier.id}
                    onClick={() => setShowCustomModal(true)}
                    className="bg-white rounded-3xl border-2 border-dashed border-slate-200 p-7 flex flex-col items-center justify-center text-center gap-3 cursor-pointer hover:border-[#4b7bec] hover:bg-blue-50/20 transition-all min-h-[260px] group shadow-sm"
                  >
                    <div className="size-14 rounded-2xl bg-[#F8F9FC] border border-[#E9ECF0] flex items-center justify-center text-slate-400 group-hover:bg-[#4b7bec] group-hover:text-white group-hover:border-[#4b7bec] transition-all">
                      <Plus className="size-6" />
                    </div>
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 group-hover:text-[#4b7bec]">
                        Transporteur Personnalisé
                      </h3>
                      <p className="text-xs text-[#636E72] font-medium mt-1">
                        Connectez n\\'importe quel transporteur avec son API REST ou webhook
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[11px] font-black text-[#4b7bec] mt-1 group-hover:translate-x-0.5 transition-transform">
                      Configurer l\\'intégration <ArrowUpRight className="size-3" />
                    </span>
                  </div>
                );
              }

              return (
                <div
                  key={carrier.id}
                  className="bg-white rounded-3xl border border-slate-100 p-6 sm:p-7 shadow-sm hover:shadow-md transition-all group relative overflow-hidden flex flex-col justify-between"
                >
                  <div className="absolute top-0 left-0 right-0 h-1.5 rounded-t-3xl" style={{ backgroundColor: carrier.color }} />

                  <div>
                    {/* Top Carrier Header */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3.5">
                        <div className="size-12 rounded-2xl flex items-center justify-center border border-slate-100 bg-[#F8F9FC] shadow-2xs">
                          <CarrierIconBadge iconType={carrier.iconType} color={carrier.color} className="size-6" />
                        </div>
                        <div>
                          <h3 className="text-base font-black text-slate-900 tracking-tight">{carrier.name}</h3>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={cn(
                              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold",
                              isConfigured ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-slate-100 text-slate-500"
                            )}>
                              <span className={cn("size-1.5 rounded-full", isConfigured ? "bg-emerald-500 animate-pulse" : "bg-slate-400")} />
                              {isConfigured ? 'Actif' : 'Non configuré'}
                            </span>
                            {partnerInfo?.is_sandbox && (
                              <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold border border-amber-200">
                                Mode Test
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {carrier.website && (
                        <a
                          href={carrier.website}
                          target="_blank"
                          rel="noreferrer"
                          className="size-8 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors"
                          title="Site officiel"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      )}
                    </div>

                    <p className="text-xs text-[#636E72] font-medium leading-relaxed mb-4">
                      {carrier.description}
                    </p>

                    {/* Features Tags */}
                    <div className="flex flex-wrap gap-1.5 mb-5">
                      {carrier.features.map(f => (
                        <span key={f} className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-[#F8F9FC] text-slate-600 border border-[#E9ECF0] uppercase tracking-wide">
                          {f}
                        </span>
                      ))}
                    </div>

                    {/* Pricing Preview */}
                    <div className="p-3 bg-[#F8F9FC] rounded-2xl border border-[#E9ECF0] mb-5 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-[10px] font-black uppercase text-slate-400 block">Domicile</span>
                        <span className="font-bold text-slate-800">{carrier.pricing.home}</span>
                      </div>
                      <div>
                        <span className="text-[10px] font-black uppercase text-slate-400 block">Stop Desk</span>
                        <span className="font-bold text-slate-800">{carrier.pricing.relay}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions Footer */}
                  <div className="flex items-center justify-between pt-4 border-t border-slate-100 flex-wrap gap-2">
                    <div className="flex items-center gap-2 w-full justify-between">
                      {isConfigured && partnerInfo && (
                        <button
                          onClick={() => {
                            if (confirm(`Supprimer la configuration de ${carrier.name} ?`)) {
                              deletePartner.mutate(partnerInfo.id);
                            }
                          }}
                          disabled={deletePartner.isPending}
                          className="flex items-center justify-center size-9 rounded-xl text-rose-500 bg-rose-50 hover:bg-rose-500 hover:text-white transition-all cursor-pointer border border-rose-100"
                          title="Supprimer la configuration"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      )}

                      <button
                        onClick={() => setSelectedCarrier(carrier)}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider text-white transition-all shadow-sm hover:opacity-95 active:scale-[0.98] cursor-pointer"
                        style={{ backgroundColor: carrier.color }}
                      >
                        {isConfigured ? (
                          <><Settings className="size-3.5" /> Reconfigurer</>
                        ) : (
                          <><Plus className="size-3.5" /> Connecter</>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── TAB 2: SUIVI TEMPS RÉEL (UNIFIÉ) ─── */}
      {activeTab === 'tracking' && (() => {
        const sd = (statsQuery.data as any)?.data;
        const carriers: any[] = sd?.carriers ?? [];
        const summary = sd?.summary ?? {};
        const dailyBreakdown: any[] = sd?.dailyBreakdown ?? [];

        const totalOrders = summary.totalShipped ?? carriers.reduce((s: number, c: any) => s + (c.totalOrders ?? 0), 0);
        const totalDelivered = summary.totalDelivered ?? carriers.reduce((s: number, c: any) => s + (c.deliveredOrders ?? 0), 0);
        const totalReturned = summary.totalReturned ?? carriers.reduce((s: number, c: any) => s + (c.returnedOrders ?? 0), 0);
        const avgDeliveryRate = summary.avgDeliveryRate != null ? summary.avgDeliveryRate.toFixed(1) : (carriers.length > 0 ? (carriers.reduce((s: number, c: any) => s + (c.deliveryRate ?? 0), 0) / carriers.length).toFixed(1) : null);
        const avgReturnRate = summary.avgReturnRate != null ? summary.avgReturnRate.toFixed(1) : (totalOrders > 0 ? ((totalReturned / totalOrders) * 100).toFixed(1) : '0.0');
        const avgDays = carriers.length > 0 ? (carriers.reduce((s: number, c: any) => s + (c.avgDeliveryDays ?? 0), 0) / carriers.length).toFixed(1) : null;
        const topCarrier = carriers.length > 0 ? carriers.reduce((a: any, b: any) => (a.deliveryRate ?? 0) > (b.deliveryRate ?? 0) ? a : b) : null;

        const PERIOD_LABELS: Record<string, string> = { today: "Aujourd'hui", '7d': '7 Jours', '30d': '30 Jours', all_time: 'Tout' };
        const maxChartVal = Math.max(...dailyBreakdown.map((x: any) => Math.max(x.shipped || 0, x.delivered || 0, x.returned || 0, 1)), 5);

        return (
          <div className="space-y-6">
            {/* Section 1 : Suivi Colis Direct via Widget Noest Micro-Détails */}
            <TrackingLookup storeId={activeStore?.id ?? ''} />

            {/* Section 2 : Performance & Intelligence Temps Réel */}
            <div className="space-y-6">
              {/* Period Filter & Refresh Header (Meta Ads Style) */}
              <div className="bg-white rounded-3xl border border-slate-100 p-4 sm:p-5 flex items-center justify-between gap-4 shadow-sm flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest shrink-0">Période :</span>
                  {(['today', '7d', '30d', 'all_time'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setStatsPeriod(p)}
                      className={cn(
                        "h-9 px-3.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer",
                        statsPeriod === p ? "bg-[#4b7bec] text-white shadow-md shadow-blue-500/20" : "bg-[#F8F9FC] text-slate-600 hover:bg-slate-200"
                      )}
                    >
                      {PERIOD_LABELS[p]}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-slate-400 hidden sm:inline-block">
                    Fuseau : GMT+1 (Algérie)
                  </span>
                  <button 
                    onClick={() => statsQuery.refetch()} 
                    disabled={statsQuery.isFetching} 
                    className="h-9 px-4 rounded-xl bg-[#F8F9FC] border border-[#E9ECF0] hover:bg-slate-100 text-slate-700 flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer"
                  >
                    <RefreshCw className={cn("size-3.5 text-[#4b7bec]", statsQuery.isFetching && "animate-spin")} /> 
                    <span>Actualiser</span>
                  </button>
                </div>
              </div>

              {/* 6 KPI Cards Grid (Meta Ads Style) */}
              <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
                <div className="bg-white rounded-3xl border border-slate-100 p-5 shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="size-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                      <Package className="size-4" />
                    </span>
                    <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">GLOBAL</span>
                  </div>
                  <div>
                    <p className="text-2xl font-black text-slate-800 tabular-nums">
                      {statsQuery.isLoading ? '...' : totalOrders > 0 ? totalOrders : '0'}
                    </p>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Colis Expédiés</p>
                  </div>
                </div>

                <div className="bg-white rounded-3xl border border-slate-100 p-5 shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="size-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                      <CheckCircle2 className="size-4" />
                    </span>
                    <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">{totalDelivered} livrés</span>
                  </div>
                  <div>
                    <p className="text-2xl font-black text-emerald-600 tabular-nums">
                      {statsQuery.isLoading ? '...' : avgDeliveryRate != null ? `${avgDeliveryRate}%` : '0%'}
                    </p>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Taux Livraison (COD)</p>
                  </div>
                </div>

                <div className="bg-white rounded-3xl border border-slate-100 p-5 shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="size-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                      <Clock className="size-4" />
                    </span>
                    <span className="text-[9px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">SLA MOYEN</span>
                  </div>
                  <div>
                    <p className="text-2xl font-black text-slate-800 tabular-nums">
                      {statsQuery.isLoading ? '...' : avgDays != null ? `${avgDays}j` : '—'}
                    </p>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Délai Livraison</p>
                  </div>
                </div>

                <div className="bg-white rounded-3xl border border-slate-100 p-5 shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="size-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
                      <Activity className="size-4" />
                    </span>
                    <span className="text-[9px] font-black text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-100">{avgReturnRate}%</span>
                  </div>
                  <div>
                    <p className="text-2xl font-black text-rose-600 tabular-nums">
                      {statsQuery.isLoading ? '...' : totalReturned > 0 ? totalReturned : '0'}
                    </p>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Retours & Échecs</p>
                  </div>
                </div>

                <div className="bg-white rounded-3xl border border-slate-100 p-5 shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="size-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                      <Truck className="size-4" />
                    </span>
                    <span className="text-[9px] font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">RÉSEAU</span>
                  </div>
                  <div>
                    <p className="text-2xl font-black text-slate-800 tabular-nums">
                      {configuredIds.size}
                    </p>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Transporteurs Actifs</p>
                  </div>
                </div>

                <div className="bg-white rounded-3xl border border-slate-100 p-5 shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="size-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                      <Sparkles className="size-4" />
                    </span>
                    <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">LEADER</span>
                  </div>
                  <div>
                    <p className="text-xl font-black text-slate-800 truncate" title={topCarrier?.name ?? '—'}>
                      {statsQuery.isLoading ? '...' : topCarrier?.name ?? 'Noest'}
                    </p>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Top Acheminement</p>
                  </div>
                </div>
              </div>

              {/* Chart Activity Section */}
              {dailyBreakdown.length > 0 ? (
                <div className="bg-white rounded-3xl border border-slate-100 p-6 sm:p-7 shadow-sm space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                    <div>
                      <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                        <BarChart3 className="size-4 text-[#4b7bec]" />
                        Activité & Flux Journalier des Livraisons ({PERIOD_LABELS[statsPeriod]})
                      </h3>
                      <p className="text-xs text-[#636E72] mt-0.5">
                        Volume comparatif des expéditions, livraisons réussies et retours par date
                      </p>
                    </div>

                    <div className="flex items-center gap-4 text-xs font-bold">
                      <div className="flex items-center gap-1.5">
                        <span className="size-3 rounded-md bg-[#4b7bec]" />
                        <span className="text-slate-700">Expédiés ({totalOrders})</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="size-3 rounded-md bg-[#10B981]" />
                        <span className="text-slate-700">Livrés ({totalDelivered})</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="size-3 rounded-md bg-[#EF4444]" />
                        <span className="text-slate-700">Retours ({totalReturned})</span>
                      </div>
                    </div>
                  </div>

                  <div className="relative pt-6 pb-2">
                    <div className="absolute inset-x-0 top-6 bottom-8 flex flex-col justify-between pointer-events-none text-[10px] text-slate-300 font-mono">
                      <div className="border-b border-slate-100 w-full flex items-center justify-between">
                        <span className="bg-white pr-2 text-slate-400 font-bold">{maxChartVal} colis</span>
                      </div>
                      <div className="border-b border-slate-100/70 w-full flex items-center justify-between">
                        <span className="bg-white pr-2 text-slate-400 font-bold">{Math.round(maxChartVal / 2)} colis</span>
                      </div>
                      <div className="border-b border-slate-200 w-full flex items-center justify-between">
                        <span className="bg-white pr-2 text-slate-400 font-bold">0 colis</span>
                      </div>
                    </div>

                    <div className="overflow-x-auto custom-scrollbar pb-2">
                      <div className="min-w-[650px] sm:min-w-full flex items-end justify-between gap-1.5 sm:gap-2 h-56 px-2 relative z-10">
                        {dailyBreakdown.map((d: any, i: number) => {
                          const shippedH = maxChartVal > 0 ? Math.round(((d.shipped ?? 0) / maxChartVal) * 100) : 0;
                          const deliveredH = maxChartVal > 0 ? Math.round(((d.delivered ?? 0) / maxChartVal) * 100) : 0;
                          const returnedH = maxChartVal > 0 ? Math.round(((d.returned ?? 0) / maxChartVal) * 100) : 0;
                          const dailyRate = d.shipped > 0 ? Math.round(((d.delivered || 0) / d.shipped) * 100) : (d.delivered > 0 ? 100 : 0);

                          const dateObj = new Date(d.date);
                          const formattedDay = !isNaN(dateObj.getTime())
                            ? dateObj.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
                            : d.date?.slice(5) || '—';

                          return (
                            <div key={i} className="flex-1 flex flex-col items-center h-full justify-end group relative cursor-pointer">
                              <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs font-medium p-3 rounded-2xl shadow-2xl opacity-0 group-hover:opacity-100 transition-all pointer-events-none z-30 min-w-[150px] space-y-1">
                                <p className="font-black border-b border-slate-800 pb-1 text-slate-200 capitalize">
                                  {d.date}
                                </p>
                                <div className="flex justify-between text-blue-300 text-xs">
                                  <span>Expédiés :</span>
                                  <span className="font-bold font-mono">{d.shipped ?? 0}</span>
                                </div>
                                <div className="flex justify-between text-emerald-300 text-xs">
                                  <span>Livrés :</span>
                                  <span className="font-bold font-mono">{d.delivered ?? 0}</span>
                                </div>
                                {d.returned > 0 && (
                                  <div className="flex justify-between text-rose-300 text-xs">
                                    <span>Retours :</span>
                                    <span className="font-bold font-mono">{d.returned ?? 0}</span>
                                  </div>
                                )}
                                <div className="border-t border-slate-800 pt-1 flex justify-between text-[11px] text-slate-400">
                                  <span>Taux journalier :</span>
                                  <span className="font-bold text-white font-mono">{dailyRate}%</span>
                                </div>
                              </div>

                              <div className="flex items-end justify-center gap-1 w-full h-[82%]">
                                <div
                                  className="w-2.5 sm:w-3.5 bg-gradient-to-t from-[#3867d6] to-[#4b7bec] rounded-t-md transition-all duration-300 group-hover:brightness-110 shadow-sm"
                                  style={{ height: `${Math.max(shippedH, d.shipped > 0 ? 6 : 2)}%` }}
                                />
                                <div
                                  className="w-2.5 sm:w-3.5 bg-gradient-to-t from-[#059669] to-[#10B981] rounded-t-md transition-all duration-300 group-hover:brightness-110 shadow-sm"
                                  style={{ height: `${Math.max(deliveredH, d.delivered > 0 ? 6 : 2)}%` }}
                                />
                                {d.returned > 0 && (
                                  <div
                                    className="w-1.5 sm:w-2 bg-rose-500 rounded-t-md transition-all duration-300 shadow-sm"
                                    style={{ height: `${Math.max(returnedH, 6)}%` }}
                                  />
                                )}
                              </div>

                              <span className="text-[10px] font-mono text-slate-400 group-hover:text-slate-900 transition-colors mt-2 font-bold whitespace-nowrap">
                                {formattedDay}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-[#F8F9FC] rounded-2xl border border-[#E9ECF0] flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="font-bold text-slate-800">Synthèse ({PERIOD_LABELS[statsPeriod]}) :</span>
                      <span className="text-[#636E72]">{totalOrders} expédiés · {totalDelivered} livrés (COD) · {totalReturned} retours traités</span>
                    </div>
                    <div className="flex items-center gap-2 font-mono font-bold text-[#4b7bec]">
                      <span>Taux d\\'Acheminement :</span>
                      <span className="px-2 py-0.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-100">{avgDeliveryRate != null ? `${avgDeliveryRate}%` : '0%'}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-3xl border border-slate-100 p-8 text-center shadow-sm">
                  <BarChart3 className="size-8 mx-auto text-slate-300 mb-2" />
                  <p className="text-xs font-black text-slate-400 uppercase tracking-wider">
                    Aucune activité de livraison enregistrée sur cette période
                  </p>
                </div>
              )}

              {/* Table SLA Carriers (Meta Ads Style) */}
              {carriers.length > 0 && (
                <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm">
                  <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <BarChart3 className="size-4 text-[#4b7bec]" />
                      <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">Performance & SLA par Transporteur</h3>
                    </div>
                    <span className="text-xs font-bold text-slate-400">
                      {carriers.length} transporteur{carriers.length > 1 ? 's' : ''} actif{carriers.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-slate-100 bg-[#F8F9FC]">
                          <th className="px-6 py-3.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Transporteur</th>
                          <th className="px-6 py-3.5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Colis Confiés</th>
                          <th className="px-6 py-3.5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Taux Livraison</th>
                          <th className="px-6 py-3.5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Taux Retour</th>
                          <th className="px-6 py-3.5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Délai Moyen</th>
                          <th className="px-6 py-3.5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Statut API</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {carriers.map((c: any, i: number) => {
                          const kc = KNOWN_CARRIERS.find(k => k.id === c.id || k.name === c.name);
                          const rate = c.deliveryRate ?? 0;
                          const retRate = c.returnRate ?? 0;
                          return (
                            <tr key={i} className="hover:bg-slate-50/80 transition-colors">
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                  <div className="size-9 rounded-xl bg-[#F8F9FC] border border-[#E9ECF0] flex items-center justify-center">
                                    <CarrierIconBadge iconType={kc?.iconType ?? 'truck'} color={kc?.color ?? '#4b7bec'} className="size-4" />
                                  </div>
                                  <div>
                                    <span className="text-xs font-black text-slate-900 block">{c.name}</span>
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">{c.isSandbox ? 'Mode Test' : 'Production Directe'}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-center">
                                <span className="text-sm font-black text-slate-900 tabular-nums">{c.totalOrders ?? '0'}</span>
                                <span className="text-[10px] text-slate-400 block font-medium">colis traités</span>
                              </td>
                              <td className="px-6 py-4 text-center">
                                <div className="flex flex-col items-center gap-1">
                                  <span className="text-xs font-black text-emerald-600 font-mono">{rate}%</span>
                                  <div className="w-20 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(rate, 100)}%` }} />
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-center">
                                <div className="flex flex-col items-center gap-1">
                                  <span className="text-xs font-black text-rose-500 font-mono">{retRate}%</span>
                                  <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                    <div className="h-full bg-rose-500 rounded-full" style={{ width: `${Math.min(retRate, 100)}%` }} />
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-center">
                                <span className="inline-block px-2 py-0.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200/60 text-xs font-black font-mono">
                                  {c.avgDeliveryDays != null ? `${c.avgDeliveryDays}j` : '—'}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-center">
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200">
                                  <span className="size-1.5 rounded-full bg-emerald-500" /> Connecté
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ─── TAB 3: COMMANDES EN TRANSIT ─── */}
      {activeTab === 'orders' && (
        <CarrierOrdersList storeId={activeStore?.id ?? ''} partners={partners} />
      )}

      {/* Modals */}
      <PartnerModal
        key={selectedCarrier?.id ?? 'none'}
        open={!!selectedCarrier}
        onClose={() => setSelectedCarrier(null)}
        carrier={selectedCarrier}
        storeId={activeStore?.id ?? ''}
        onSaved={() => qc.invalidateQueries({ queryKey: ['delivery-partners'] })}
        existingPartner={selectedCarrier ? configuredPartnerByCarrier[selectedCarrier.id] ?? null : null}
      />

      <CustomCarrierModal
        open={showCustomModal}
        onClose={() => setShowCustomModal(false)}
        storeId={activeStore?.id ?? ''}
        onSaved={() => qc.invalidateQueries({ queryKey: ['delivery-partners'] })}
      />
    </div>
  );
}
