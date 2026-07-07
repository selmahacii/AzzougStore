'use client';

import React, { useState } from 'react';
import { Banknote, RefreshCw, CheckCircle, ChevronDown, ChevronUp, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Monthly payroll reminder for the super-admin.
 * - Shows a banner when last month's payroll is not generated or has unpaid records.
 * - Expands into the full payroll table with per-employee mark-as-paid.
 */
export function PayrollBanner() {
  const user = useAppStore((s) => s.user);
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const isSuperAdmin = user && ['SUPER_ADMIN', 'ADMIN'].includes(user.role);

  const remindersQuery = useQuery({
    queryKey: ['payroll_reminders'],
    queryFn: () => apiFetch<any>('/api/v1/payroll/reminders'),
    enabled: !!isSuperAdmin,
    refetchInterval: 5 * 60 * 1000,
  });

  const period = remindersQuery.data?.period;

  const payrollQuery = useQuery({
    queryKey: ['payroll_list', period],
    queryFn: () => apiFetch<any>(`/api/v1/payroll?period=${period}`),
    enabled: !!isSuperAdmin && !!period && expanded,
  });

  const generateMutation = useMutation({
    mutationFn: () => apiFetch<any>(`/api/v1/payroll/generate?period=${period}`, { method: 'POST' }),
    onSuccess: (res) => {
      toast.success(res?.message || 'Paie générée.');
      queryClient.invalidateQueries({ queryKey: ['payroll_reminders'] });
      queryClient.invalidateQueries({ queryKey: ['payroll_list'] });
      setExpanded(true);
    },
    onError: (err: any) => toast.error(err.message || 'Erreur lors de la génération.'),
  });

  const markPaidMutation = useMutation({
    mutationFn: (recordId: string) => apiFetch<any>(`/api/v1/payroll/${recordId}/mark-paid`, { method: 'POST' }),
    onSuccess: (res) => {
      toast.success(res?.message || 'Marquée payée.');
      queryClient.invalidateQueries({ queryKey: ['payroll_reminders'] });
      queryClient.invalidateQueries({ queryKey: ['payroll_list'] });
    },
    onError: (err: any) => toast.error(err.message || 'Erreur.'),
  });

  if (!isSuperAdmin || dismissed) return null;

  const reminders: any[] = remindersQuery.data?.reminders || [];
  if (reminders.length === 0) return null;

  const reminder = reminders[0];
  const records: any[] = payrollQuery.data?.data || [];
  const summary = payrollQuery.data?.summary;

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 overflow-hidden animate-in fade-in duration-300">
      <div className="p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="size-10 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0">
            <Banknote className="size-5 text-amber-600" />
          </span>
          <div>
            <p className="text-xs font-black text-amber-800 uppercase tracking-wider">Rappel Paie — {reminder.period}</p>
            <p className="text-sm font-bold text-amber-900 mt-0.5">{reminder.message}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {reminder.type === 'GENERATE' ? (
            <button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              className="flex items-center gap-1.5 px-4 h-9 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-black transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn('size-3.5', generateMutation.isPending && 'animate-spin')} />
              Générer la paie {reminder.period}
            </button>
          ) : (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1.5 px-4 h-9 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-black transition-colors"
            >
              {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              Voir les fiches ({reminder.pending_count})
            </button>
          )}
          <button onClick={() => setDismissed(true)} className="p-2 hover:bg-amber-100 rounded-lg" title="Masquer jusqu'au prochain chargement">
            <X className="size-4 text-amber-400" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-amber-200 bg-white">
          {summary && (
            <div className="px-4 py-3 flex items-center gap-4 flex-wrap text-xs border-b border-amber-100">
              <span className="font-black text-slate-700">Total : {formatPrice(summary.total || 0)}</span>
              <span className="font-bold text-amber-700">En attente : {formatPrice(summary.total_pending || 0)} ({summary.pending_count})</span>
              <span className="font-bold text-emerald-600">Payé : {formatPrice(summary.total_paid || 0)} ({summary.paid_count})</span>
              <button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                className="ml-auto flex items-center gap-1 text-[10px] font-black text-slate-500 hover:text-slate-700 uppercase"
                title="Recalcule les fiches PENDING (les payées ne sont jamais modifiées)"
              >
                <RefreshCw className={cn('size-3', generateMutation.isPending && 'animate-spin')} />
                Actualiser
              </button>
            </div>
          )}
          <div className="divide-y divide-slate-50 max-h-80 overflow-y-auto">
            {payrollQuery.isLoading ? (
              <div className="p-6 text-center text-xs text-slate-400 font-bold">Chargement...</div>
            ) : records.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400 font-bold">Aucune fiche pour cette période.</div>
            ) : records.map((r) => (
              <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black text-slate-800">{r.user_name || r.user_id}</p>
                  <p className="text-[10px] text-slate-400 font-bold">
                    {r.user_role} · {r.delivered_count} livrée(s)
                    {r.recovered_count > 0 && ` + ${r.recovered_count} panier(s) récupéré(s)`}
                    {r.payment_type === 'MONTHLY_SALARY' ? ' · Salaire fixe' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm font-black text-slate-900 tabular-nums">{formatPrice(r.total)}</p>
                    {r.bonus > 0 && <p className="text-[9px] font-bold text-violet-500">dont bonus {formatPrice(r.bonus)}</p>}
                  </div>
                  {r.status === 'PAID' ? (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-600 text-[10px] font-black border border-emerald-100">
                      <CheckCircle className="size-3" /> PAYÉ
                    </span>
                  ) : (
                    <button
                      onClick={() => markPaidMutation.mutate(r.id)}
                      disabled={markPaidMutation.isPending}
                      className="px-3 h-8 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black transition-colors disabled:opacity-50"
                    >
                      Marquer payé
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
