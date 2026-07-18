'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
   Search,
   Filter,
   ChevronDown,
   ChevronUp,
   ChevronLeft,
   ChevronRight,
   FileText,
   Database,
   Activity,
   Terminal,
   RefreshCw,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
   Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAppStore } from '@/store/app-store';
import { apiFetch } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { AuditLog, AuditAction, PaginatedResponse } from '@/lib/types';

// ─── CODpilot Styling ─────────────────────────────────────
const C = {
   primary: '#6C5CE7', primaryBg: '#F0EDFF',
   success: '#00B894', successBg: '#E6FFF8',
   danger: '#E17055', dangerBg: '#FFEDE9',
   warning: '#FDCB6E', warningBg: '#FFF8E6',
   info: '#0984E3', infoBg: '#E8F4FE',
   text: '#2D3436', textLight: '#636E72', textDim: '#B2BEC3', border: '#E9ECF0', bg: '#F8F9FC',
};

const ENTITY_TYPES = [
   { value: 'all', label: 'Toutes les entités' },
   { value: 'Order', label: 'Commandes' },
   { value: 'Product', label: 'Produits' },
   { value: 'Store', label: 'Magasins' },
   { value: 'User', label: 'Utilisateurs' },
];

const ACTION_TYPES = [
   { value: 'all', label: 'Toutes les actions' },
   { value: 'CREATE', label: 'Création' },
   { value: 'UPDATE', label: 'Modification' },
   { value: 'DELETE', label: 'Suppression' },
   { value: 'STATUS_CHANGE', label: 'Changement de statut' },
   { value: 'LOGIN', label: 'Connexion' },
];

const ACTION_COLORS: Record<string, { bg: string; text: string }> = {
   CREATE: { bg: C.successBg, text: C.success },
   UPDATE: { bg: C.infoBg, text: C.info },
   DELETE: { bg: C.dangerBg, text: C.danger },
   STATUS_CHANGE: { bg: C.warningBg, text: C.warning },
   LOGIN: { bg: C.primaryBg, text: C.primary },
};

function TablePagination({ total, page, totalPages, setPage }: { total: number; page: number; totalPages: number; setPage: (p: number) => void; }) {
   return (
      <div className="px-5 py-3.5 border-t flex items-center justify-between" style={{ borderColor: C.border, backgroundColor: C.bg }}>
         <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-[#636E72]">Total {total}</span>
            <div className="flex items-center border rounded-lg overflow-hidden bg-white" style={{ borderColor: C.border }}>
               <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className="size-8 flex items-center justify-center hover:bg-[#F8F9FC] text-[#636E72] disabled:opacity-30"><ChevronLeft className="size-4" /></button>
               <div className="px-4 flex items-center justify-center border-l bg-white text-[10px] font-black text-[#2D3436]" style={{ borderColor: C.border }}>
                  PAGE {page} / {totalPages || 1}
               </div>
               <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="size-8 flex items-center justify-center hover:bg-[#F8F9FC] text-[#636E72] disabled:opacity-30 border-l" style={{ borderColor: C.border }}><ChevronRight className="size-4" /></button>
            </div>
         </div>
         <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-[#B2BEC3]">30 / page</span>
         </div>
      </div>
   );
}

export default function AuditPage() {
   const { activeStore, adminSearchTerm, setAdminSearchTerm } = useAppStore();
   const storeId = activeStore?.id ?? '';

   const [page, setPage] = useState(1);
   const [entityFilter, setEntityFilter] = useState('all');
   const [actionFilter, setActionFilter] = useState('all');
   const [search, setSearch] = useState(adminSearchTerm || '');
   const [expandedRow, setExpandedRow] = useState<string | null>(null);

   useEffect(() => {
      if (adminSearchTerm) {
         setSearch(adminSearchTerm);
         setEntityFilter('all');
         setActionFilter('all');
      }
   }, [adminSearchTerm]);

   const pageSize = 30;

   const auditQuery = useQuery<PaginatedResponse<AuditLog>>({
      queryKey: ['audit', storeId, page, entityFilter, actionFilter, search],
      queryFn: () => {
         const params = new URLSearchParams({ store_id: storeId, page: page.toString(), pageSize: pageSize.toString() });
         if (entityFilter !== 'all') params.set('entity', entityFilter);
         if (actionFilter !== 'all') params.set('action', actionFilter);
         if (search) params.set('search', search);
         return apiFetch(`/api/v1/audit?${params.toString()}`);
      },
   });

   const auditLogs = auditQuery.data?.data ?? [];
   const totalPages = auditQuery.data?.totalPages ?? 1;
   const total = auditQuery.data?.total ?? 0;

   const toggleRow = (id: string) => { setExpandedRow((prev) => (prev === id ? null : id)); };

   const formatDate = (dateStr: string) => {
      return new Date(dateStr).toLocaleString('fr-FR', {
         day: '2-digit', month: 'short', year: 'numeric',
         hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
   };

   const renderValue = (v: unknown): string => {
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'object') return JSON.stringify(v, null, 0).slice(0, 120);
      return String(v);
   };

   const formatDiff = (diff: Record<string, { from: unknown; to: unknown }> | string | null) => {
      if (!diff) return null;
      let parsed: Record<string, { from: unknown; to: unknown }> = {};
      if (typeof diff === 'string') {
         try { parsed = JSON.parse(diff); } catch { return <p className="p-4 text-xs text-slate-400 font-mono">{diff}</p>; }
      } else {
         parsed = diff;
      }
      return (
         <div className="grid grid-cols-1 gap-2 p-5 bg-[#F8F9FC] border-t" style={{ borderColor: C.border }}>
            {Object.entries(parsed).map(([key, change]) => (
               <div key={key} className="flex flex-col sm:flex-row sm:items-start gap-4 text-xs">
                  <div className="w-48 shrink-0 font-bold text-[#636E72] uppercase tracking-wider pt-0.5">{key}</div>
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                     <span className="font-mono text-red-400 line-through decoration-red-200 bg-red-50 px-2 py-0.5 rounded break-all">{renderValue(change?.from)}</span>
                     <Terminal className="size-3 text-[#B2BEC3] shrink-0 mt-1" />
                     <span className="font-mono text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded break-all">{renderValue(change?.to)}</span>
                  </div>
               </div>
            ))}
         </div>
      );
   };

   return (
      <div className="space-y-5 pb-28 animate-in fade-in duration-500">
         {/* ─── Header ─── */}
         <div className="bg-white rounded-xl border px-6 py-5 flex items-center justify-between" style={{ borderColor: C.border }}>
            <div className="flex items-center gap-3">
               <div className="size-8 rounded-lg flex items-center justify-center bg-[#F0F3F6]">
                  <FileText className="size-4" style={{ color: C.text }} />
               </div>
               <div>
                  <h1 className="text-sm font-extrabold uppercase tracking-wider text-[#2D3436]">Journal d'audit</h1>
                  <p className="text-[10px] font-bold text-[#B2BEC3] uppercase tracking-widest mt-0.5">Traces des opérations réseau</p>
               </div>
            </div>
            <div className="flex gap-4 text-right">
               <div>
                  <p className="text-[10px] font-semibold text-[#636E72] uppercase tracking-wider">Entrées</p>
                  <p className="text-sm font-extrabold text-[#2D3436]">{total}</p>
               </div>
               <div>
                  <p className="text-[10px] font-semibold text-[#636E72] uppercase tracking-wider">Sécurité</p>
                  <p className="text-sm font-extrabold" style={{ color: C.success }}>Actif</p>
               </div>
            </div>
         </div>

         {/* ─── Search & Filters ─── */}
         <div className="bg-white rounded-xl border px-6 py-4 flex flex-col md:flex-row md:items-center gap-4 justify-between" style={{ borderColor: C.border }}>
            <div className="relative max-w-sm flex-1">
               <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#B2BEC3]" />
               <Input placeholder="Rechercher utilisateur ou ID..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-10 h-10 bg-[#F8F9FC] border-[#E9ECF0] rounded-lg text-sm" />
            </div>
            <div className="flex gap-3">
               <Select value={entityFilter} onValueChange={(v) => { setEntityFilter(v); setPage(1); }}>
                  <SelectTrigger className="h-10 w-[180px] bg-white border-[#E9ECF0] rounded-lg text-xs font-semibold"><SelectValue placeholder="Entité" /></SelectTrigger>
                  <SelectContent className="bg-white border-[#E9ECF0] rounded-xl text-xs font-semibold">
                     {ENTITY_TYPES.map(e => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                  </SelectContent>
               </Select>
               <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1); }}>
                  <SelectTrigger className="h-10 w-[180px] bg-white border-[#E9ECF0] rounded-lg text-xs font-semibold"><SelectValue placeholder="Action" /></SelectTrigger>
                  <SelectContent className="bg-white border-[#E9ECF0] rounded-xl text-xs font-semibold">
                     {ACTION_TYPES.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                  </SelectContent>
               </Select>
               <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold border" style={{ borderColor: C.border, color: C.textLight }}>
                  <RefreshCw className="size-3.5" />
               </button>
            </div>
         </div>

         {/* ─── Table ─── */}
         <div className="bg-white rounded-xl border overflow-hidden relative" style={{ borderColor: C.border }}>
            {auditQuery.isLoading && (
               <div className="absolute inset-0 z-10 bg-white/50 backdrop-blur-sm flex items-center justify-center">
                  <Activity className="size-8 animate-spin" style={{ color: C.primary }} />
               </div>
            )}
            <div className="overflow-x-auto">
               <table className="w-full text-left">
                  <thead>
                     <tr className="border-b" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                        <th className="px-4 py-3 w-10"></th>
                        <th className="px-4 py-3 text-xs font-bold text-[#636E72] whitespace-nowrap">Date & Heure</th>
                        <th className="px-4 py-3 text-xs font-bold text-[#636E72] whitespace-nowrap">Utilisateur</th>
                        <th className="px-4 py-3 text-xs font-bold text-[#636E72] whitespace-nowrap">Entité</th>
                        <th className="px-4 py-3 text-xs font-bold text-[#636E72] whitespace-nowrap">Action</th>
                        <th className="px-4 py-3 text-xs font-bold text-[#636E72] text-right whitespace-nowrap">ID cible</th>
                     </tr>
                  </thead>
                  <tbody>
                     {auditLogs.length === 0 && !auditQuery.isLoading ? (
                        <tr><td colSpan={6} className="px-6 py-16 text-center text-sm font-semibold text-[#B2BEC3]"><Database className="mx-auto size-8 text-[#E9ECF0] mb-3" />Aucun journal trouvé</td></tr>
                     ) : (
                        auditLogs.map((log) => {
                           const aColor = ACTION_COLORS[log.action] || { bg: C.bg, text: C.textLight };
                           const hasDiff = !!log.diff && Object.keys(log.diff).length > 0;
                           const isExpanded = expandedRow === log.id;

                           return (
                              <React.Fragment key={log.id}>
                                 <tr onClick={() => hasDiff && toggleRow(log.id)} className={cn("border-b transition-colors hover:bg-[#FAFBFD]", isExpanded ? "bg-[#F8F9FC]" : "", hasDiff ? "cursor-pointer" : "")} style={{ borderColor: C.border }}>
                                    <td className="px-4 py-3 text-center">
                                       {hasDiff && (isExpanded ? <ChevronUp className="size-4 mx-auto text-[#2D3436]" /> : <ChevronDown className="size-4 mx-auto text-[#B2BEC3]" />)}
                                    </td>
                                    <td className="px-4 py-3 text-xs font-semibold text-[#636E72] font-mono">{formatDate(log.created_at)}</td>
                                    <td className="px-4 py-3 text-sm font-bold text-[#2D3436]">
                                       {log.actor?.name ?? 'SYSTÈME'}
                                       {log.actor?.role && <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-[#B2BEC3]">({log.actor.role})</span>}
                                    </td>
                                    <td className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-[#636E72]">{ENTITY_TYPES.find(e => e.value === log.entity)?.label ?? log.entity}</td>
                                    <td className="px-4 py-3">
                                       <span className="px-2 py-1 rounded-[4px] text-[10px] font-bold uppercase tracking-wider" style={{ backgroundColor: aColor.bg, color: aColor.text }}>
                                          {ACTION_TYPES.find(a => a.value === log.action)?.label ?? log.action}
                                       </span>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                       <span className="px-2 py-1 bg-[#F8F9FC] border rounded-md text-[10px] font-mono font-bold text-[#636E72]" style={{ borderColor: C.border }}>
                                          {log.entity_id.slice(0, 8)}
                                       </span>
                                    </td>
                                 </tr>
                                 {isExpanded && log.diff && (
                                    <tr>
                                       <td colSpan={6} className="p-0 border-b" style={{ borderColor: C.border }}>
                                          {formatDiff(log.diff)}
                                       </td>
                                    </tr>
                                 )}
                              </React.Fragment>
                           );
                        })
                     )}
                  </tbody>
               </table>
            </div>
            <TablePagination total={total} page={page} totalPages={totalPages} setPage={setPage} />
         </div>
      </div>
   );
}
