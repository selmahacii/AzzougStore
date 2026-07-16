'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { Loader2, CheckCircle2, XCircle, HelpCircle, MinusCircle } from 'lucide-react';

interface OrderTrackingReportProps {
  orderId: string;
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-2 text-xs py-1 border-b border-slate-50 last:border-0">
      <span className="text-slate-400 font-bold shrink-0">{label}</span>
      <span className={value ? 'text-slate-700 font-mono text-right truncate max-w-[220px]' : 'text-slate-300 italic'} title={value || undefined}>
        {value || 'Non disponible'}
      </span>
    </div>
  );
}

function StepIcon({ status }: { status: string }) {
  if (status === 'ok') return <CheckCircle2 className="size-3.5 text-emerald-500" />;
  if (status === 'fail') return <XCircle className="size-3.5 text-red-500" />;
  if (status === 'not_attempted') return <MinusCircle className="size-3.5 text-slate-300" />;
  return <HelpCircle className="size-3.5 text-slate-300" />; // non_verifiable
}

const STEP_LABELS: Record<string, string> = {
  erp: 'ERP', pixel: 'Pixel', relay: 'Relay', queue: 'Queue',
  capi: 'CAPI', meta: 'Meta', ads_manager: 'Ads Manager',
};

export function OrderTrackingReport({ orderId }: OrderTrackingReportProps) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ['order-tracking', orderId],
    queryFn: () => apiFetch(`/api/v1/orders/${orderId}/tracking`),
    refetchOnWindowFocus: false,
  });
  const d = data?.data;

  if (isLoading) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="size-5 animate-spin text-slate-300" /></div>;
  }
  if (!d) return null;

  return (
    <div className="space-y-4">
      {/* Qualité du tracking */}
      <div className="rounded-xl border border-slate-100 p-3 bg-slate-50">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Qualité du Tracking</p>
          {d.tracking_quality.score != null && (
            <span className="text-sm font-black text-slate-700">Score : {d.tracking_quality.score}%</span>
          )}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {Object.entries(d.tracking_quality.steps).map(([key, step]: [string, any]) => (
            <div key={key} className="flex flex-col items-center gap-0.5" title={step.reason || step.status}>
              <StepIcon status={step.status} />
              <span className="text-[8px] font-bold text-slate-400 uppercase">{STEP_LABELS[key] || key}</span>
            </div>
          ))}
        </div>
        <p className="text-[8px] text-slate-400 mt-2">{d.tracking_quality.score_basis}</p>
        {d.tracking_quality.failure_detail && (
          <div className="mt-2 rounded-lg bg-red-50 border border-red-100 p-2 text-[10px] text-red-700">
            ❌ {d.tracking_quality.failure_detail.error_category || 'Erreur'} — {d.tracking_quality.failure_detail.error_message}
            {d.tracking_quality.failure_detail.retry_count > 0 && ` (${d.tracking_quality.failure_detail.retry_count} tentative(s))`}
          </div>
        )}
      </div>

      {/* Type d'envoi Purchase — temps réel / backfill / en attente / échec */}
      {d.capi_classification && (
        <div className="rounded-xl border border-slate-100 p-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Envoi Purchase</p>
          <div className="flex items-center gap-2 mb-2">
            <span className={'text-xs font-black ' + (
              d.capi_classification.type === 'realtime' ? 'text-emerald-600' :
              d.capi_classification.type === 'backfill' ? 'text-amber-600' :
              d.capi_classification.type === 'failed' ? 'text-red-600' : 'text-slate-400'
            )}>
              {d.capi_classification.type === 'realtime' ? '🟢' : d.capi_classification.type === 'backfill' ? '🟡' : d.capi_classification.type === 'failed' ? '🔴' : '🔵'} {d.capi_classification.label}
            </span>
          </div>
          <Field label="Date de création" value={d.capi_classification.created_at ? new Date(d.capi_classification.created_at).toLocaleString('fr-FR') : null} />
          <Field label="Date d'envoi CAPI" value={d.capi_classification.sent_at ? new Date(d.capi_classification.sent_at).toLocaleString('fr-FR') : null} />
          <Field label="Délai" value={d.capi_classification.delay_hours != null ? `${d.capi_classification.delay_hours}h` : null} />
          {d.capi_classification.retry_count != null && <Field label="Tentatives" value={String(d.capi_classification.retry_count)} />}
          {d.capi_classification.error_message && <Field label="Dernière erreur" value={d.capi_classification.error_message} />}
        </div>
      )}

      {/* Attribution */}
      <div className="rounded-xl border border-slate-100 p-3">
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Attribution Marketing</p>
        <p className="text-sm font-black text-slate-700">{d.attribution.source}</p>
        <p className="text-[10px] text-slate-400">Confiance : {d.attribution.confidence}</p>
      </div>

      {/* Origine du trafic */}
      <div className="rounded-xl border border-slate-100 p-3">
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Origine du Trafic</p>
        <Field label="Source" value={d.traffic_origin.source} />
        <Field label="Medium" value={d.traffic_origin.utm_medium} />
        <Field label="Campaign" value={d.traffic_origin.utm_campaign} />
        <Field label="Content" value={d.traffic_origin.utm_content} />
        <Field label="Term" value={d.traffic_origin.utm_term} />
        <Field label="Referrer" value={d.traffic_origin.referrer} />
        <Field label="Landing Page" value={d.traffic_origin.landing_page_url} />
        <Field label="Heure de commande" value={d.traffic_origin.order_time ? new Date(d.traffic_origin.order_time).toLocaleString('fr-FR') : null} />
        <Field label="Première page visitée" value={d.traffic_origin.first_page_visited} />
        <Field label="Dernière page avant achat" value={d.traffic_origin.last_page_before_purchase} />
      </div>

      {/* Meta */}
      <div className="rounded-xl border border-slate-100 p-3">
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Informations Meta</p>
        <Field label="Pixel ID" value={d.meta_info.pixel_id} />
        <Field label="Event ID" value={d.meta_info.event_id} />
        <Field label="Event Name" value={d.meta_info.event_name} />
        <Field label="Event Time" value={d.meta_info.event_time ? new Date(d.meta_info.event_time).toLocaleString('fr-FR') : null} />
        <Field label="FBP" value={d.meta_info.fbp} />
        <Field label="FBC" value={d.meta_info.fbc} />
        <Field label="FBCLID" value={d.meta_info.fbclid} />
      </div>

      {/* Campagne */}
      {(d.campaign_info.campaign_id || d.campaign_info.campaign_name) && (
        <div className="rounded-xl border border-slate-100 p-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Campagne Meta</p>
          <Field label="Campagne" value={d.campaign_info.campaign_name} />
          <Field label="Ad Set" value={d.campaign_info.adset_name} />
          <Field label="Publicité" value={d.campaign_info.ad_name} />
          <Field label="Campaign ID" value={d.campaign_info.campaign_id} />
          <Field label="AdSet ID" value={d.campaign_info.adset_id} />
          <Field label="Ad ID" value={d.campaign_info.ad_id} />
        </div>
      )}

      {/* Timeline */}
      {d.timeline?.length > 0 && (
        <div className="rounded-xl border border-slate-100 p-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Historique de l'événement</p>
          <div className="space-y-1.5">
            {d.timeline.map((t: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-[10px]">
                <span className="font-mono text-slate-400 shrink-0">{new Date(t.time).toLocaleTimeString('fr-FR')}</span>
                <span className="text-slate-600">{t.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
