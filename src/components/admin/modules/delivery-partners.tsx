'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import {
  Truck, Plus, Search, Check, X, Loader2,
  RefreshCw, Eye, EyeOff, Wifi, Package, Clock,
  MapPin, BarChart3, AlertCircle, Settings, Trash2,
  CheckCircle2, ExternalLink, Activity, Zap, TrendingUp,
  ChevronRight, Radio, Upload, Download,
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

// ─── ALGERIAN WILAYAS ─────────────────────────────────────────
const ALGERIAN_WILAYAS = [
  'Adrar', 'Chlef', 'Laghouat', 'Oum El Bouaghi', 'Batna', 'Béjaïa', 'Biskra', 'Béchar',
  'Blida', 'Bouira', 'Tamanrasset', 'Tébessa', 'Tlemcen', 'Tiaret', 'Tizi Ouzou', 'Alger',
  'Djelfa', 'Jijel', 'Sétif', 'Saïda', 'Skikda', 'Sidi Bel Abbès', 'Annaba', 'Guelma',
  'Constantine', 'Médéa', 'Mostaganem', 'M\'Sila', 'Mascara', 'Ouargla', 'Oran', 'El Bayadh',
  'Illizi', 'Bordj Bou Arréridj', 'Boumerdès', 'El Tarf', 'Tindouf', 'Tissemsilt', 'El Oued',
  'Khenchela', 'Souk Ahras', 'Tipaza', 'Mila', 'Aïn Defla', 'Naâma', 'Aïn Témouchent',
  'Ghardaïa', 'Relizane', 'Timimoun', 'Bordj Badji Mokhtar', 'Ouled Djellal', 'Béni Abbès',
  'In Salah', 'In Guezzam', 'Touggourt', 'Djanet', 'El M\'Ghair', 'El Meniaa',
];

// ─── KNOWN CARRIERS ───────────────────────────────────────────
const KNOWN_CARRIERS = [
  {
    id: 'yalidine',
    name: 'Yalidine',
    logo: '🚀',
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
    logo: '🟦',
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
    id: 'add_new',
    name: 'Ajouter un transporteur',
    logo: '➕',
    color: '#B2BEC3',
    website: '',
    description: 'D\'autres transporteurs arrivent bientôt. Restez connecté pour les nouvelles intégrations.',
    features: ['Bientôt disponible'],
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

// ─── REAL-TIME TRACKING ───────────────────────────────────────
function TrackingLookup({ storeId }: { storeId: string }) {
  const [input, setInput] = useState('');
  const [carrierId, setCarrierId] = useState('yalidine');
  const [trackingNum, setTrackingNum] = useState<string | null>(null);
  const [activeCarrier, setActiveCarrier] = useState('yalidine');
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const trackingQuery = useQuery({
    queryKey: ['tracking-live', activeCarrier, trackingNum, storeId],
    queryFn: async () => {
      setError(null);
      try {
        const carrierPaths: Record<string, string> = {
          yalidine: `/api/yalidine/track/${trackingNum}?store_id=${storeId}`,
          noest: `/api/noest/track/${trackingNum}?store_id=${storeId}`,
        };
        const path = carrierPaths[activeCarrier] ?? `/api/v1/delivery-partners/track/${activeCarrier}/${trackingNum}?store_id=${storeId}`;
        const data = await apiFetch(path);
        setLastUpdated(new Date());
        return data as any;
      } catch (e: any) {
        setError(e?.detail ?? e?.message ?? 'Numéro introuvable ou carrier non configuré.');
        return null;
      }
    },
    enabled: !!trackingNum && !!storeId,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  const handleTrack = () => {
    const num = input.trim();
    if (!num) return;
    setError(null);
    setActiveCarrier(carrierId);
    setTrackingNum(num);
  };

  const handleClear = () => {
    setTrackingNum(null);
    setInput('');
    setError(null);
    setLastUpdated(null);
  };

  const result = trackingQuery.data;
  const events: any[] = result?.events ?? [];
  const statusKey = (result?.status ?? 'PENDING').toUpperCase().replace(/ /g, '_');
  const statusCfg = TRACKING_STATUS_CONFIG[statusKey] ?? TRACKING_STATUS_CONFIG.PENDING;
  const trackableCarriers = KNOWN_CARRIERS.filter(c => c.id !== 'add_new');

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-[32px] border border-slate-100 p-6 shadow-sm">
        <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight flex items-center gap-2 mb-5">
          <Radio className="size-4 text-[#4b7bec]" />
          Suivi temps réel
          {trackingNum && (
            <span className="ml-auto flex items-center gap-1.5 text-[10px] font-black text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
              Live · 30s
            </span>
          )}
        </h3>
        <div className="flex flex-col sm:flex-row gap-3">
          <select
            value={carrierId}
            onChange={e => setCarrierId(e.target.value)}
            className="h-14 rounded-2xl border border-slate-100 bg-slate-50 text-sm px-4 font-bold text-slate-700 shrink-0 focus:outline-none focus:border-[#4b7bec]"
          >
            {trackableCarriers.map(c => (
              <option key={c.id} value={c.id}>{c.logo} {c.name}</option>
            ))}
          </select>
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleTrack()}
            placeholder="Numéro de suivi (ex: YLD-2026-XXXXX)"
            className="h-14 rounded-2xl border-slate-100 bg-slate-50 font-mono text-sm flex-1"
          />
          <Button onClick={handleTrack} disabled={trackingQuery.isFetching || !input.trim()}
            className="h-14 px-8 rounded-2xl bg-[#4b7bec] text-white font-black uppercase tracking-widest text-[11px] shrink-0">
            {trackingQuery.isFetching ? <Loader2 className="size-5 animate-spin" /> : 'Tracer'}
          </Button>
          {trackingNum && (
            <Button onClick={handleClear} variant="ghost" className="h-14 px-4 rounded-2xl text-slate-400 shrink-0">
              <X className="size-5" />
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 rounded-2xl border border-rose-100 flex items-center gap-3">
          <AlertCircle className="size-5 text-rose-500 shrink-0" />
          <p className="text-sm text-rose-700 font-medium">{error}</p>
        </div>
      )}

      {trackingNum && !error && (
        <div className="bg-white rounded-[32px] border border-slate-100 overflow-hidden shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="p-7 border-b border-slate-100" style={{ borderLeftWidth: 4, borderLeftColor: statusCfg.color }}>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="size-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: statusCfg.bg }}>
                  <Package className="size-6" style={{ color: statusCfg.color }} />
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Numéro de suivi</p>
                  <p className="text-lg font-black font-mono text-slate-800">{trackingNum}</p>
                </div>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-black uppercase tracking-wider"
                  style={{ backgroundColor: statusCfg.bg, color: statusCfg.color }}>
                  {statusCfg.pulse && <span className="size-2 rounded-full animate-pulse inline-block" style={{ backgroundColor: statusCfg.color }} />}
                  {trackingQuery.isFetching ? 'Actualisation...' : statusCfg.label}
                </span>
                {lastUpdated && (
                  <p className="text-[9px] text-slate-300 mt-1.5 font-mono">
                    Mis à jour: {lastUpdated.toLocaleTimeString('fr-FR')}
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: 'Transporteur', value: trackableCarriers.find(c => c.id === activeCarrier)?.name ?? activeCarrier },
                { label: 'Dernier lieu', value: result?.last_location ?? '—' },
                { label: 'Dernier événement', value: result?.last_event ?? result?.status ?? '—' },
              ].map((item, i) => (
                <div key={i} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{item.label}</p>
                  <p className="text-xs font-bold text-slate-700">{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="p-7">
            <div className="flex items-center justify-between mb-5">
              <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Historique des événements</h4>
              <button onClick={() => trackingQuery.refetch()} disabled={trackingQuery.isFetching}
                className="flex items-center gap-1.5 text-[10px] font-black text-[#4b7bec] hover:underline disabled:opacity-50">
                <RefreshCw className={cn("size-3", trackingQuery.isFetching && "animate-spin")} /> Actualiser
              </button>
            </div>

            {trackingQuery.isLoading ? (
              <div className="space-y-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div>
            ) : events.length === 0 ? (
              <div className="text-center py-10 text-slate-300">
                <Package className="size-10 mx-auto mb-2" />
                <p className="text-xs font-bold uppercase">Aucun événement disponible</p>
              </div>
            ) : (
              <div className="space-y-0">
                {events.map((ev: any, i: number) => {
                  const isFirst = i === 0;
                  const isLast = i === events.length - 1;
                  return (
                    <div key={i} className="flex gap-4">
                      <div className="flex flex-col items-center shrink-0 w-8">
                        <div className={cn("size-3.5 rounded-full border-2 z-10 shrink-0 mt-1",
                          isFirst ? "border-[#4b7bec] bg-[#4b7bec]" : "border-slate-200 bg-white"
                        )} />
                        {!isLast && <div className="w-px flex-1 bg-slate-100 my-1" />}
                      </div>
                      <div className={cn("pb-5 flex-1", isLast && "pb-0")}>
                        <div className={cn("p-3 rounded-xl border transition-all", isFirst ? "bg-[#F0F5FF] border-[#4b7bec]/20" : "bg-slate-50 border-slate-100")}>
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className={cn("text-xs font-black", isFirst ? "text-[#4b7bec]" : "text-slate-700")}>
                                {ev.label ?? ev.status ?? ev.event}
                              </p>
                              {ev.location && (
                                <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                                  <MapPin className="size-3" /> {ev.location}
                                </p>
                              )}
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-[10px] font-bold text-slate-500">{ev.date}</p>
                              {ev.time && <p className="text-[9px] text-slate-400">{ev.time}</p>}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
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
  const qc = useQueryClient();

  if (!carrier) return null;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // For noest: send credentials directly in body (works before & after saving)
      if (carrier.id === 'noest') {
        const r = await apiFetch<{ ok: boolean; message: string; latency_ms: number }>(
          `/api/noest/test?store_id=${storeId}`,
          { method: 'POST', body: JSON.stringify({ api_token: form.api_token, guid: form.guid }) }
        );
        setTestResult(r);
      } else {
        if (!savedPartnerId) {
          toast.error('Enregistrez la configuration Yalidine avant de tester.');
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
    if (!storeId) return;
    setSyncing(true);
    try {
      const res: any = await apiFetch(`/api/yalidine/wilayas?store_id=${storeId}`, { method: 'POST' });
      toast.success(res?.message ?? 'Wilayas synchronisées');
      const fees: any = await apiFetch(`/api/yalidine/wilayas?store_id=${storeId}`);
      setSyncedFees(fees?.data ?? []);
      qc.invalidateQueries({ queryKey: ['delivery-partners'] });
    } catch (e: any) {
      toast.error(e?.message ?? 'Erreur synchronisation Yalidine');
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

      if (savedPartnerId) {
        // Update existing — PATCH only changed fields (no API key re-send needed)
        await apiFetch(`/api/v1/delivery-partners/${savedPartnerId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            is_sandbox: isSandbox,
            fee_home: feeHomeVal,
            fee_relay: feeRelayVal,
            free_shipping_threshold: threshold,
            ...(Object.keys(form).length > 0 ? { api_config: form } : {}),
          }),
        });
      } else {
        const res: any = await apiFetch('/api/v1/delivery-partners', {
          method: 'POST',
          body: JSON.stringify({
            store_id: storeId,
            carrier_id: carrier.id,
            name: carrier.name,
            is_sandbox: isSandbox,
            api_config: form,
            fee_home: feeHomeVal,
            fee_relay: feeRelayVal,
            free_shipping_threshold: threshold,
          }),
        });
        setSavedPartnerId(res?.data?.id ?? res?.id ?? null);
      }
      toast.success(`${carrier.name} configuré avec succès`);
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
      toast.error('Enregistrez la configuration API d\'abord.');
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
      toast.success('Tarifs par wilaya sauvegardés');
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
        max-w-3xl p-0 border-none shadow-2xl overflow-hidden flex flex-col
        w-[100vw] h-[100dvh] rounded-none
        sm:w-[96vw] sm:h-auto sm:max-h-[90dvh] sm:rounded-[40px]
      ">
        {/* Header */}
        <div className="px-6 sm:px-8 py-5 sm:py-6 text-white shrink-0 flex items-center gap-4 sm:gap-5" style={{ backgroundColor: carrier.color }}>
          <div className="size-12 sm:size-14 rounded-2xl bg-white/20 flex items-center justify-center text-2xl sm:text-3xl">{carrier.logo}</div>
          <div className="flex-1 min-w-0">
            <DialogTitle className="text-lg sm:text-xl font-black tracking-tight truncate">{carrier.name}</DialogTitle>
            <DialogDescription className="text-white/60 text-[10px] font-black uppercase tracking-widest mt-0.5">
              Intégration API livraison
            </DialogDescription>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/10 transition-all shrink-0">
            <X className="size-5 text-white/60" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <Tabs defaultValue="config">
            <div className="px-4 sm:px-8 border-b bg-slate-50/30 overflow-x-auto">
              <TabsList className="h-14 bg-transparent gap-3 sm:gap-6 border-0 flex-nowrap">
                {['config', 'wilayas', 'info'].map(tab => (
                  <TabsTrigger key={tab} value={tab}
                    className="h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 rounded-none px-0 text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-slate-400 data-[state=active]:text-slate-800 whitespace-nowrap"
                  >
                    {tab === 'config' ? '⚙️ Config API' : tab === 'wilayas' ? '🗺️ Wilayas' : '📋 Détails'}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <div className="p-5 sm:p-8 space-y-6">
              {/* ── Config Tab ── */}
              <TabsContent value="config" className="mt-0 space-y-5">
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <div>
                    <p className="text-sm font-black text-slate-700">Mode Sandbox (Test)</p>
                    <p className="text-[10px] text-slate-400 font-medium">Utilise l'environnement de développement du transporteur</p>
                  </div>
                  <button
                    onClick={() => setIsSandbox(s => !s)}
                    className={cn("relative w-12 h-6 rounded-full transition-all", isSandbox ? "bg-amber-400" : "bg-emerald-500")}
                  >
                    <div className={cn("absolute top-1 size-4 rounded-full bg-white shadow transition-transform", isSandbox ? "left-1" : "left-7")} />
                  </button>
                </div>

                <div className="space-y-3">
                  {carrier.fields.map(field => (
                    <div key={field} className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                        {getFieldLabel(field)}
                      </label>
                      <div className="relative">
                        <Input
                          type={showKeys ? 'text' : 'password'}
                          value={form[field] || ''}
                          onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                          placeholder={field === 'api_url' ? `https://api.${carrier.id}.dz/v1` : `${field.toUpperCase()}_...`}
                          className="h-12 rounded-2xl border-slate-100 bg-slate-50/50 font-mono text-sm pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowKeys(s => !s)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-600 transition-colors"
                        >
                          {showKeys ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {carrier.fields.length > 0 && (
                  <>
                    <Button
                      type="button"
                      onClick={handleTest}
                      disabled={testing || carrier.fields.some(f => !form[f])}
                      className="w-full h-12 rounded-2xl font-black uppercase tracking-widest text-[11px]"
                      style={{ backgroundColor: carrier.color }}
                    >
                      {testing ? <><Loader2 className="size-4 mr-2 animate-spin" />Test en cours...</> : <><Wifi className="size-4 mr-2" />Tester la connexion</>}
                    </Button>

                    {testResult && (
                      <div className={cn("p-4 rounded-2xl flex items-start gap-3", testResult.ok ? "bg-emerald-50 border border-emerald-100" : "bg-rose-50 border border-rose-100")}>
                        {testResult.ok ? <CheckCircle2 className="size-5 text-emerald-500 shrink-0 mt-0.5" /> : <AlertCircle className="size-5 text-rose-500 shrink-0 mt-0.5" />}
                        <div>
                          <p className={cn("text-sm font-bold", testResult.ok ? "text-emerald-700" : "text-rose-700")}>{testResult.message}</p>
                          {testResult.ok && <p className="text-[10px] text-emerald-500 mt-0.5">Latence: {testResult.latency_ms}ms</p>}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </TabsContent>

              {/* ── Wilayas Tab ── */}
              <TabsContent value="wilayas" className="mt-0 space-y-4">
                {/* Default fees (used as fallback when wilaya not in grid) */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Domicile par défaut (DA)</label>
                    <div className="relative">
                      <Input type="number" value={feeHome} onChange={e => setFeeHome(e.target.value)} placeholder={carrier.pricing.home} className="h-10 rounded-xl border-slate-100 bg-slate-50/50 pl-9 text-sm font-black" />
                      <span className="absolute left-3 top-1/2 -translate-y-1/2"><Truck className="size-4 text-slate-300" /></span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Stop Desk par défaut (DA)</label>
                    <div className="relative">
                      <Input type="number" value={feeRelay} onChange={e => setFeeRelay(e.target.value)} placeholder={carrier.pricing.relay} className="h-10 rounded-xl border-slate-100 bg-slate-50/50 pl-9 text-sm font-black" />
                      <span className="absolute left-3 top-1/2 -translate-y-1/2"><Package className="size-4 text-slate-300" /></span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Gratuit dès (DA)</label>
                    <Input type="number" value={freeThreshold} onChange={e => setFreeThreshold(e.target.value)} placeholder="Ex: 5000" className="h-10 rounded-xl border-slate-100 bg-slate-50/50 text-sm font-black" />
                  </div>
                </div>

                {/* Top bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <div className="flex items-center gap-3">
                    <MapPin className="size-5 text-[#4b7bec] shrink-0" />
                    <p className="text-xs font-bold text-slate-700 uppercase tracking-tight">Grille Tarifaire par Wilaya (58 Wilayas)</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {carrier.id === 'yalidine' && savedPartnerId && (
                      <Button
                        onClick={handleSyncWilayas}
                        disabled={syncing}
                        size="sm"
                        className="h-8 rounded-lg text-[10px] font-black uppercase bg-[#FF6B35] text-white hover:bg-[#e55a27]"
                      >
                        {syncing ? <Loader2 className="size-3 animate-spin mr-1" /> : <RefreshCw className="size-3 mr-1" />}
                        Sync Yalidine
                      </Button>
                    )}
                  </div>
                </div>

                {/* Mode switcher */}
                <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
                  <button
                    onClick={() => setWilayaMode('manual')}
                    className={cn("flex-1 h-9 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all",
                      wilayaMode === 'manual' ? "bg-white text-slate-800 shadow" : "text-slate-500"
                    )}
                  >
                    Mode Manuel
                  </button>
                  <button
                    onClick={() => setWilayaMode('excel')}
                    className={cn("flex-1 h-9 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all",
                      wilayaMode === 'excel' ? "bg-white text-slate-800 shadow" : "text-slate-500"
                    )}
                  >
                    Import Excel
                  </button>
                </div>

                {wilayaMode === 'manual' && (
                  <>
                    {/* Table header – hidden on mobile */}
                    <div className="hidden sm:grid grid-cols-12 gap-3 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-slate-400">
                      <div className="col-span-1">#</div>
                      <div className="col-span-5">Wilaya</div>
                      <div className="col-span-3 text-center">Domicile (DA)</div>
                      <div className="col-span-3 text-center">Stop Desk (DA)</div>
                    </div>

                    <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-1">
                      {ALGERIAN_WILAYAS.map((name, i) => {
                        const id = i + 1;
                        const synced = syncedFees.find(f => f.wilayaId === id);
                        const fees = wilayaFees[id] ?? { home: '', desk: '' };
                        return (
                          <div key={id} className={cn(
                            "flex sm:grid sm:grid-cols-12 gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-xl border items-center",
                            synced ? "bg-emerald-50 border-emerald-100" : "bg-white border-slate-100"
                          )}>
                            {/* Number – hidden on mobile */}
                            <div className="hidden sm:block col-span-1 text-[10px] font-black text-slate-300 shrink-0">
                              {id.toString().padStart(2, '0')}
                            </div>
                            {/* Name */}
                            <div className="sm:col-span-5 text-xs font-bold text-slate-700 flex-1 min-w-0 truncate">{name}</div>
                            {/* Domicile */}
                            <div className="sm:col-span-3 shrink-0">
                              {synced ? (
                                <span className="text-xs font-black text-emerald-700 block text-center">{synced.homeFee} DA</span>
                              ) : (
                                <Input
                                  type="number"
                                  placeholder="DA"
                                  value={fees.home}
                                  onChange={e => setWilayaFees(f => ({ ...f, [id]: { ...f[id] ?? { desk: '' }, home: e.target.value } }))}
                                  className="h-8 rounded-lg border-slate-100 bg-slate-50/50 text-xs font-bold text-center w-20 sm:w-full"
                                />
                              )}
                            </div>
                            {/* Stop Desk */}
                            <div className="sm:col-span-3 shrink-0">
                              {synced ? (
                                <span className="text-xs font-black text-blue-700 block text-center">{synced.officeFee} DA</span>
                              ) : (
                                <Input
                                  type="number"
                                  placeholder="DA"
                                  value={fees.desk}
                                  onChange={e => setWilayaFees(f => ({ ...f, [id]: { ...f[id] ?? { home: '' }, desk: e.target.value } }))}
                                  className="h-8 rounded-lg border-slate-100 bg-slate-50/50 text-xs font-bold text-center w-20 sm:w-full"
                                />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <Button
                      onClick={handleSaveFees}
                      disabled={savingFees}
                      className="w-full h-12 rounded-2xl font-black uppercase tracking-widest text-[11px] bg-[#4b7bec] text-white"
                    >
                      {savingFees ? <Loader2 className="size-4 animate-spin mr-2" /> : <Check className="size-4 mr-2" />}
                      Sauvegarder les tarifs
                    </Button>

                    {carrier.id === 'yalidine' && !savedPartnerId && (
                      <p className="text-[11px] text-slate-400 text-center font-medium">
                        Enregistrez la configuration pour synchroniser les tarifs depuis Yalidine
                      </p>
                    )}
                  </>
                )}

                {wilayaMode === 'excel' && (
                  <div className="space-y-4">
                    <Button
                      onClick={handleDownloadTemplate}
                      variant="outline"
                      className="w-full h-11 rounded-2xl font-black uppercase tracking-widest text-[11px] border-slate-200 text-slate-600 gap-2"
                    >
                      <Download className="size-4" />
                      Télécharger le template Excel
                    </Button>

                    {/* Dropzone */}
                    <label
                      className={cn(
                        "flex flex-col items-center justify-center gap-3 w-full h-44 rounded-2xl border-2 border-dashed cursor-pointer transition-all",
                        dragOver
                          ? "border-[#4b7bec] bg-[#F0F5FF]"
                          : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100"
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
                      <div className={cn("size-12 rounded-2xl flex items-center justify-center transition-all",
                        dragOver ? "bg-[#4b7bec]/10" : "bg-slate-200"
                      )}>
                        <Upload className={cn("size-6", dragOver ? "text-[#4b7bec]" : "text-slate-400")} />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-black text-slate-600">
                          {dragOver ? 'Déposez le fichier ici' : 'Glissez-déposez votre fichier Excel'}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">ou cliquez pour sélectionner (.xlsx)</p>
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

                    <p className="text-[10px] text-slate-400 text-center">
                      Le fichier doit contenir les colonnes: <span className="font-mono font-bold">wilaya_id, wilaya_nom, domicile_da, stop_desk_da</span>
                    </p>

                    {Object.keys(wilayaFees).length > 0 && (
                      <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-center gap-3">
                        <CheckCircle2 className="size-5 text-emerald-500 shrink-0" />
                        <div>
                          <p className="text-sm font-bold text-emerald-700">
                            {Object.keys(wilayaFees).length} wilaya(s) importée(s)
                          </p>
                          <p className="text-[10px] text-emerald-500">Allez en Mode Manuel pour vérifier et sauvegarder</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>

              {/* ── Info Tab ── */}
              <TabsContent value="info" className="mt-0 space-y-5">
                <p className="text-sm font-medium text-slate-600 leading-relaxed">{carrier.description}</p>
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Fonctionnalités</p>
                  <div className="flex flex-wrap gap-2">
                    {carrier.features.map(f => (
                      <span key={f} className="px-3 py-1.5 rounded-xl text-[11px] font-bold border border-slate-100 text-slate-600 bg-slate-50 flex items-center gap-1.5">
                        <Check className="size-3 text-emerald-500" />{f}
                      </span>
                    ))}
                  </div>
                </div>
                {carrier.api_docs && (
                  <a href={carrier.api_docs} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm font-bold text-[#4b7bec] hover:underline">
                    <ExternalLink className="size-4" /> Documentation API officielle
                  </a>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-amber-50 rounded-xl border border-amber-100">
                    <p className="font-black text-amber-700 uppercase tracking-wider text-[9px] mb-1">Sandbox URL</p>
                    <p className="font-mono text-amber-600 break-all text-[10px]">{carrier.sandbox_url || '—'}</p>
                  </div>
                  <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                    <p className="font-black text-emerald-700 uppercase tracking-wider text-[9px] mb-1">Production URL</p>
                    <p className="font-mono text-emerald-600 break-all text-[10px]">{carrier.prod_url || '—'}</p>
                  </div>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>

        <div className="px-5 sm:px-8 py-4 sm:py-5 border-t border-slate-100 bg-white flex justify-end gap-3 shrink-0">
          <Button variant="ghost" onClick={onClose} className="h-12 px-6 rounded-2xl font-black text-slate-400">Annuler</Button>
          {carrier.id !== 'add_new' && (
            <Button
              onClick={handleSave}
              disabled={saving || carrier.fields.some(f => !form[f])}
              className="h-12 px-10 rounded-2xl font-black uppercase tracking-widest text-[11px] text-white"
              style={{ backgroundColor: carrier.color }}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <><Check className="size-4 mr-2" />Enregistrer</>}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── TAB CONFIG ───────────────────────────────────────────────
const TAB_CONFIG = [
  { id: 'carriers', label: '🚚 Carriers & API', desc: 'Configurer les transporteurs' },
  { id: 'tracking', label: '📍 Suivi temps réel', desc: 'Suivre un colis en direct' },
  { id: 'stats', label: '📊 Statistiques', desc: 'Performance des livraisons' },
] as const;

type TabId = typeof TAB_CONFIG[number]['id'];

function normalizeTab(sv: string | null): TabId {
  if (!sv) return 'carriers';
  if (sv === 'tracking' || sv === 'Suivi de colis') return 'tracking';
  if (sv === 'stats' || sv === 'Statistiques') return 'stats';
  return 'carriers';
}

// ─── MAIN COMPONENT ───────────────────────────────────────────
export default function DeliveryPartners() {
  const { activeStore, adminSubView } = useAppStore();
  const [search, setSearch] = useState('');
  const [selectedCarrier, setSelectedCarrier] = useState<typeof KNOWN_CARRIERS[0] | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>(normalizeTab(adminSubView));
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
    queryKey: ['delivery-stats', activeStore?.id],
    queryFn: () => apiFetch(`/api/v1/analytics?store_id=${activeStore?.id}&type=shipping&period=30d`),
    enabled: !!activeStore?.id && activeTab === 'stats',
    retry: false,
  });

  const deletePartner = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/delivery-partners/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['delivery-partners'] }); toast.success('Transporteur retiré'); },
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

      {/* ── Header ── */}
      <div className="bg-white rounded-[40px] border border-slate-100 shadow-sm relative overflow-hidden">
        <div className="absolute -top-8 -right-8 opacity-[0.03]"><Truck className="size-48 text-[#4b7bec]" /></div>
        <div className="relative p-5 sm:p-8">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 sm:gap-6 mb-6 sm:mb-8">
            <div className="flex items-center gap-4 sm:gap-6">
              <div className="size-14 sm:size-16 rounded-3xl bg-[#F0F5FF] flex items-center justify-center shrink-0">
                <Truck className="size-7 sm:size-8 text-[#4b7bec]" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-slate-900 uppercase tracking-tight">Partenaires Livraison</h1>
                <p className="text-xs sm:text-sm text-slate-400 font-bold mt-1">Intégration API carriers & suivi de colis temps réel</p>
              </div>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 bg-slate-50 p-1.5 rounded-2xl border border-slate-100 flex-wrap">
              {TAB_CONFIG.map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={cn("h-10 sm:h-11 px-3 sm:px-5 rounded-xl text-[10px] sm:text-[11px] font-black uppercase tracking-widest transition-all whitespace-nowrap",
                    activeTab === tab.id ? "bg-[#4b7bec] text-white shadow-lg shadow-indigo-200" : "text-slate-500 hover:bg-white hover:text-slate-700"
                  )}>
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 flex-wrap">
            <ChevronRight className="size-3.5" />
            {TAB_CONFIG.find(t => t.id === activeTab)?.desc}
            {activeTab === 'tracking' && (
              <span className="flex items-center gap-1 text-emerald-500 ml-2">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                Actualisation auto toutes les 30s
              </span>
            )}
          </div>
        </div>
      </div>

      {activeTab === 'carriers' && (
        <>
          {/* Search + status bar */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div className="lg:col-span-3 bg-white rounded-[28px] border border-slate-100 px-5 sm:px-6 py-4 flex items-center gap-4 shadow-sm">
              <Search className="size-5 text-slate-300 shrink-0" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher un transporteur..."
                className="flex-1 outline-none text-sm font-bold text-slate-700 bg-transparent placeholder:text-slate-300"
              />
            </div>
            <div className="bg-[#2D3436] rounded-[28px] p-5 flex items-center justify-between">
              <div>
                <p className="text-[9px] font-black text-white/40 uppercase tracking-widest mb-1">Actifs</p>
                <p className="text-3xl font-black text-white">{configuredIds.size}</p>
              </div>
              <div className="size-12 rounded-2xl bg-white/10 flex items-center justify-center"><Truck className="size-6 text-white/60" /></div>
            </div>
          </div>

          {/* Carriers grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 sm:gap-6">
            {filteredCarriers.map(carrier => {
              const isAddNew = carrier.id === 'add_new';
              const isConfigured = !isAddNew && configuredIds.has(carrier.id);

              if (isAddNew) {
                return (
                  <div
                    key={carrier.id}
                    onClick={() => toast.info('Bientôt disponible — de nouveaux transporteurs arrivent prochainement !')}
                    className="bg-white rounded-[32px] border-2 border-dashed border-slate-200 p-7 flex flex-col items-center justify-center text-center gap-3 cursor-pointer hover:border-slate-300 hover:bg-slate-50 transition-all min-h-[220px] group"
                  >
                    <div className="size-14 rounded-2xl bg-slate-100 flex items-center justify-center text-3xl group-hover:bg-slate-200 transition-all">
                      ➕
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-slate-500">{carrier.name}</h3>
                      <p className="text-[11px] text-slate-400 font-medium mt-1">Bientôt disponible</p>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={carrier.id}
                  className="bg-white rounded-[32px] border border-slate-100 p-7 hover:shadow-xl hover:shadow-slate-100 transition-all group relative overflow-hidden"
                >
                  <div className="absolute top-0 left-0 right-0 h-1 rounded-t-[32px]" style={{ backgroundColor: carrier.color }} />

                  <div className="flex items-start justify-between mb-5">
                    <div className="flex items-center gap-4">
                      <div className="size-14 rounded-2xl flex items-center justify-center text-3xl border border-slate-100 bg-slate-50">
                        {carrier.logo}
                      </div>
                      <div>
                        <h3 className="text-base font-black text-slate-900">{carrier.name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <div className={cn("size-2 rounded-full", isConfigured ? "bg-emerald-500 shadow-[0_0_6px_#20bf6b]" : "bg-slate-200")} />
                          <span className="text-[10px] font-bold text-slate-400">{isConfigured ? 'Configuré' : 'Non configuré'}</span>
                        </div>
                      </div>
                    </div>
                    {isConfigured && (
                      <span className="px-2 py-1 bg-emerald-50 text-emerald-600 text-[9px] font-black uppercase tracking-wider rounded-lg border border-emerald-100">Actif</span>
                    )}
                  </div>

                  <p className="text-xs text-slate-400 font-medium leading-relaxed mb-4">{carrier.description}</p>

                  <div className="flex flex-wrap gap-1.5 mb-5">
                    {carrier.features.slice(0, 3).map(f => (
                      <span key={f} className="text-[9px] font-bold px-2 py-1 rounded-lg bg-slate-100 text-slate-500 uppercase tracking-wide">{f}</span>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-slate-50 flex-wrap gap-2">

                    <div className="flex items-center gap-2">
                      {isConfigured && (
                        <button
                          onClick={() => {
                            const p = configuredPartnerByCarrier[carrier.id];
                            if (p && confirm(`Supprimer la configuration de ${carrier.name} ?`)) deletePartner.mutate(p.id);
                          }}
                          disabled={deletePartner.isPending}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-black text-[#E17055] bg-[#FFEDE9] hover:bg-[#E17055] hover:text-white transition-all"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => setSelectedCarrier(carrier)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-black text-white transition-all shadow-sm"
                        style={{ backgroundColor: carrier.color }}
                      >
                        {isConfigured ? <><Settings className="size-3.5" />Reconfigurer</> : <><Plus className="size-3.5" />Connecter</>}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {activeTab === 'tracking' && (
        <div className="max-w-3xl mx-auto">
          <TrackingLookup storeId={activeStore?.id ?? ''} />
        </div>
      )}

      {activeTab === 'stats' && (() => {
        const sd = (statsQuery.data as any)?.data;
        const carriers: any[] = sd?.carriers ?? [];
        const totalOrders = carriers.reduce((s: number, c: any) => s + (c.totalOrders ?? 0), 0);
        const avgDeliveryRate = carriers.length > 0
          ? (carriers.reduce((s: number, c: any) => s + (c.deliveryRate ?? 0), 0) / carriers.length).toFixed(1)
          : '—';
        const avgDays = carriers.length > 0
          ? (carriers.reduce((s: number, c: any) => s + (c.avgDays ?? 0), 0) / carriers.length).toFixed(1)
          : '—';
        const totalReturns = carriers.reduce((s: number, c: any) => s + Math.round((c.totalOrders ?? 0) * (c.returnRate ?? 0) / 100), 0);
        const topCarrier = carriers.length > 0 ? carriers.reduce((a: any, b: any) => (a.deliveryRate ?? 0) > (b.deliveryRate ?? 0) ? a : b) : null;
        return (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {[
                { label: 'Colis ce mois', value: statsQuery.isLoading ? '...' : totalOrders > 0 ? totalOrders : '—', icon: '📦', color: '#4b7bec' },
                { label: 'Taux livraison moy.', value: statsQuery.isLoading ? '...' : carriers.length > 0 ? `${avgDeliveryRate}%` : '—', icon: '✅', color: '#20bf6b' },
                { label: 'Délai moyen (j)', value: statsQuery.isLoading ? '...' : carriers.length > 0 ? `${avgDays}j` : '—', icon: '⏱️', color: '#f7b731' },
                { label: 'Retours estimés', value: statsQuery.isLoading ? '...' : totalReturns > 0 ? totalReturns : '—', icon: '🔄', color: '#eb4d4b' },
                { label: 'Transporteurs actifs', value: configuredIds.size, icon: '🚚', color: '#6C5CE7' },
                { label: 'Top carrier', value: statsQuery.isLoading ? '...' : topCarrier?.name ?? '—', icon: '🏆', color: '#00B894' },
              ].map(stat => (
                <div key={stat.label} className="bg-white rounded-[28px] border border-slate-100 p-5 sm:p-6 flex items-center gap-4">
                  <div className="text-2xl sm:text-3xl">{stat.icon}</div>
                  <div>
                    <p className="text-lg sm:text-xl font-black text-slate-800">{stat.value}</p>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5 leading-tight">{stat.label}</p>
                  </div>
                </div>
              ))}
            </div>
            {carriers.length > 0 ? (
              <div className="bg-white rounded-[28px] border border-slate-100 overflow-hidden">
                <div className="px-7 py-5 border-b border-slate-100 flex items-center gap-3">
                  <BarChart3 className="size-4 text-[#4b7bec]" />
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Performance par Transporteur</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50">
                        <th className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Transporteur</th>
                        <th className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Colis</th>
                        <th className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Taux livraison</th>
                        <th className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Taux retour</th>
                        <th className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Délai moy.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {carriers.map((c: any, i: number) => {
                        const kc = KNOWN_CARRIERS.find(k => k.id === c.id || k.name === c.name);
                        return (
                          <tr key={i} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <span className="text-lg">{kc?.logo ?? '📦'}</span>
                                <span className="text-sm font-black text-slate-800">{c.name}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-center text-sm font-extrabold text-[#4b7bec]">{c.totalOrders ?? '—'}</td>
                            <td className="px-6 py-4 text-center">
                              <span className="text-sm font-black text-emerald-600">{c.deliveryRate != null ? `${c.deliveryRate}%` : '—'}</span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className="text-sm font-black text-rose-500">{c.returnRate != null ? `${c.returnRate}%` : '—'}</span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className="text-sm font-black text-amber-500">{c.avgDays != null ? `${c.avgDays}j` : '—'}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="bg-slate-50 rounded-[28px] border border-slate-100 p-10 text-center">
                <BarChart3 className="size-12 mx-auto text-slate-200 mb-3" />
                <p className="text-sm font-black text-slate-400 uppercase tracking-widest">
                  {configuredIds.size === 0 ? 'Configurez un transporteur pour voir les statistiques' : 'Aucune donnée disponible pour cette période'}
                </p>
              </div>
            )}
          </div>
        );
      })()}

      <PartnerModal
        open={!!selectedCarrier}
        onClose={() => setSelectedCarrier(null)}
        carrier={selectedCarrier}
        storeId={activeStore?.id ?? ''}
        onSaved={() => qc.invalidateQueries({ queryKey: ['delivery-partners'] })}
        existingPartner={selectedCarrier ? configuredPartnerByCarrier[selectedCarrier.id] ?? null : null}
      />
    </div>
  );
}
