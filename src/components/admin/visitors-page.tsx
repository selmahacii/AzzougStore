'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';
import {
  Users, Phone, Mail, Globe, Search, Filter, TrendingUp,
  Eye, CheckCircle, Clock, RefreshCw, Download,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  facebook:  { label: 'Facebook',  color: '#1877F2' },
  instagram: { label: 'Instagram', color: '#E4405F' },
  tiktok:    { label: 'TikTok',    color: '#000000' },
  google:    { label: 'Google',    color: '#4285F4' },
  whatsapp:  { label: 'WhatsApp',  color: '#25D366' },
  friend:    { label: 'Recommandation', color: '#8B5CF6' },
  direct:    { label: 'Autre',     color: '#6B7280' },
};

function fmt(dateStr: string | null) {
  if (!dateStr) return '—';
  return new Intl.DateTimeFormat('fr-DZ', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(dateStr));
}

export default function VisitorsPage() {
  const { activeStore } = useAppStore();
  const storeId = activeStore?.id ?? '';
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'converted' | 'pending'>('all');
  const [page, setPage] = useState(1);

  const converted = filter === 'converted' ? true : filter === 'pending' ? false : undefined;

  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ['visitors', storeId, search, filter, page],
    queryFn: () => {
      const params = new URLSearchParams({ store_id: storeId, page: String(page), page_size: '50' });
      if (search) params.set('search', search);
      if (converted !== undefined) params.set('converted', String(converted));
      return apiFetch(`/api/v1/marketing/visitors?${params}`);
    },
    enabled: !!storeId,
  });

  const visitors: any[] = data?.data ?? [];
  const total: number = data?.total ?? 0;

  // KPI counters
  const totalVisitors = total;
  const convertedCount = filter === 'all' ? visitors.filter(v => v.converted).length : (filter === 'converted' ? visitors.length : 0);
  const convRate = totalVisitors > 0 ? ((convertedCount / totalVisitors) * 100).toFixed(1) : '0';

  const sources = visitors.reduce((acc: Record<string, number>, v) => {
    const s = v.source || 'direct';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  const exportCsv = () => {
    const rows = [
      ['Nom', 'Téléphone', 'Email', 'Source', 'Converti', 'Date de visite'],
      ...visitors.map(v => [
        v.name ?? '', v.phone ?? '', v.email ?? '',
        SOURCE_LABELS[v.source]?.label ?? v.source ?? '',
        v.converted ? 'Oui' : 'Non',
        fmt(v.visited_at),
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `visiteurs_${activeStore?.slug ?? 'boutique'}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="size-12 rounded-2xl bg-violet-50 flex items-center justify-center">
            <Users className="size-6 text-violet-600" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Visiteurs</h1>
            <p className="text-sm text-slate-400 font-medium">Leads & prospects capturés depuis la boutique</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="size-9 rounded-xl border border-slate-100 flex items-center justify-center text-slate-400 hover:bg-slate-50 transition-all">
            <RefreshCw className="size-4" />
          </button>
          <button
            onClick={exportCsv}
            disabled={visitors.length === 0}
            className="flex items-center gap-2 px-4 py-2 text-[11px] font-black uppercase tracking-widest bg-violet-600 text-white rounded-xl hover:bg-violet-700 transition-all disabled:opacity-40"
          >
            <Download className="size-3.5" /> Exporter CSV
          </button>
        </div>
      </div>

      {/* ── KPI Cards ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Visiteurs', value: totalVisitors, icon: Eye, color: 'text-violet-600', bg: 'bg-violet-50' },
          { label: 'Convertis', value: convertedCount, icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Taux Conversion', value: `${convRate}%`, icon: TrendingUp, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'En attente', value: totalVisitors - convertedCount, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
        ].map((k, i) => (
          <div key={i} className="bg-white rounded-2xl border border-slate-100 p-5 flex items-center gap-4">
            <div className={`size-11 rounded-xl flex items-center justify-center shrink-0 ${k.bg}`}>
              <k.icon className={`size-5 ${k.color}`} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{k.label}</p>
              <p className="text-xl font-black text-slate-900 mt-0.5">{k.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Source breakdown ─────────────────────────────────── */}
      {Object.keys(sources).length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4">Répartition par source</p>
          <div className="flex flex-wrap gap-3">
            {Object.entries(sources).sort((a, b) => b[1] - a[1]).map(([src, count]) => {
              const meta = SOURCE_LABELS[src] ?? { label: src, color: '#6B7280' };
              const pct = Math.round((count / visitors.length) * 100);
              return (
                <div key={src} className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-[11px] font-bold"
                  style={{ borderColor: `${meta.color}30`, backgroundColor: `${meta.color}10`, color: meta.color }}>
                  {meta.label}
                  <span className="font-black">{count}</span>
                  <span className="text-[9px] opacity-60">({pct}%)</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Filters + Search ─────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-slate-300" />
          <Input
            placeholder="Rechercher nom, téléphone, email…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="pl-10 h-10 rounded-xl border-slate-100 bg-slate-50/50 text-sm"
          />
        </div>
        <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
          {(['all', 'converted', 'pending'] as const).map(f => (
            <button
              key={f}
              onClick={() => { setFilter(f); setPage(1); }}
              className={cn(
                'px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all',
                filter === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'
              )}
            >
              {f === 'all' ? 'Tous' : f === 'converted' ? 'Convertis' : 'En attente'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-50 bg-slate-50/80">
                <th className="px-5 py-3.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Visiteur</th>
                <th className="px-5 py-3.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Contact</th>
                <th className="px-5 py-3.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Source</th>
                <th className="px-5 py-3.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Statut</th>
                <th className="px-5 py-3.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="px-5 py-4">
                        <div className="h-4 bg-slate-100 rounded animate-pulse" style={{ width: `${60 + Math.random() * 30}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : visitors.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-20 text-center">
                    <div className="flex flex-col items-center gap-3 text-slate-300">
                      <Users className="size-10" />
                      <p className="text-sm font-bold text-slate-400">
                        {search ? 'Aucun résultat pour cette recherche' : 'Aucun visiteur capturé pour l\'instant'}
                      </p>
                      <p className="text-xs text-slate-300">
                        Le formulaire de capture s'affiche automatiquement sur le site
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                visitors.map((v) => {
                  const src = SOURCE_LABELS[v.source] ?? { label: v.source ?? '—', color: '#6B7280' };
                  return (
                    <tr key={v.id} className="hover:bg-slate-50/60 transition-colors">
                      {/* Name */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="size-8 rounded-full bg-violet-100 flex items-center justify-center text-[11px] font-black text-violet-600 shrink-0">
                            {v.name ? v.name.charAt(0).toUpperCase() : '?'}
                          </div>
                          <span className="text-sm font-bold text-slate-900">{v.name || <span className="text-slate-300 font-medium italic">Anonyme</span>}</span>
                        </div>
                      </td>
                      {/* Contact */}
                      <td className="px-5 py-4">
                        <div className="space-y-0.5">
                          {v.phone && (
                            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                              <Phone className="size-3 text-slate-300 shrink-0" /> {v.phone}
                            </div>
                          )}
                          {v.email && (
                            <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
                              <Mail className="size-3 text-slate-300 shrink-0" /> {v.email}
                            </div>
                          )}
                        </div>
                      </td>
                      {/* Source */}
                      <td className="px-5 py-4">
                        <span
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider"
                          style={{ backgroundColor: `${src.color}15`, color: src.color }}
                        >
                          <Globe className="size-2.5" /> {src.label}
                        </span>
                      </td>
                      {/* Status */}
                      <td className="px-5 py-4">
                        {v.converted ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-700">
                            <CheckCircle className="size-3" /> Converti
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black bg-amber-50 text-amber-700">
                            <Clock className="size-3" /> En attente
                          </span>
                        )}
                      </td>
                      {/* Date */}
                      <td className="px-5 py-4 text-xs text-slate-400 font-medium whitespace-nowrap">
                        {fmt(v.visited_at)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > 50 && (
          <div className="px-5 py-4 border-t border-slate-50 flex items-center justify-between">
            <span className="text-xs text-slate-400 font-medium">{total} visiteurs au total</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 text-xs font-bold border border-slate-100 rounded-lg disabled:opacity-40 hover:bg-slate-50 transition-all">
                Précédent
              </button>
              <button onClick={() => setPage(p => p + 1)} disabled={page * 50 >= total}
                className="px-3 py-1.5 text-xs font-bold border border-slate-100 rounded-lg disabled:opacity-40 hover:bg-slate-50 transition-all">
                Suivant
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
