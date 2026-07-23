'use client';

import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { AuditLog, PaginatedResponse } from '@/lib/types';
import {
  Scan,
  Terminal as TerminalIcon,
  ShieldCheck,
  Cpu,
  Database,
  Activity,
  AlertTriangle,
  Lock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';

export default function ProtocolScanner() {
  const { activeStore } = useAppStore();
  const storeId = activeStore?.id ?? '';
  const [streamLogs, setStreamLogs] = useState<string[]>([]);

  // ─── Telemetry Fetch ──────────────────────────────────
  const { data: auditRes } = useQuery<PaginatedResponse<AuditLog>>({
     queryKey: ['audit-telemetry', storeId],
     queryFn: () => apiFetch(`/api/v1/audit?storeId=${storeId}&pageSize=10`),
     refetchInterval: 60000,
     refetchIntervalInBackground: false,
     enabled: !!storeId
  });

  const realLogs = auditRes?.data ?? [];

  useEffect(() => {
    if (realLogs.length > 0) {
      const formatted = realLogs.map(log => 
        `[${log.action}] ${log.actor?.name || 'SYSTEM'} // ${log.entity} ID:${log.entity_id.slice(0, 8)}`
      );
      setStreamLogs(prev => {
        const combined = [...formatted, ...prev].slice(0, 15);
        return Array.from(new Set(combined)); // Deduplicate
      });
    }
  }, [realLogs]);

  // Initial boot sequence
  useEffect(() => {
    const boot = [
      "AZZOUG PROTOCOL v4.0.2 INITIALIZED",
      "ESTABLISHING SECURE TUNNEL TO ALGER_NODE_01",
      "HANDSHAKE SUCCESSFUL // AES-256-GCM",
      "SCANNING SYSTEM RESOURCES...",
      "SYNCING LOGISTICS DELTA...",
    ];
    let i = 0;
    const t = setInterval(() => {
      if (i < boot.length) {
        setStreamLogs(prev => [...prev, boot[i]]);
        i++;
      } else {
        clearInterval(t);
      }
    }, 800);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center space-y-12 animate-in fade-in duration-1000">
      {/* Scanner Visualizer */}
      <div className="relative group">
        <div className="size-72 border-2 border-[#E9ECF0] rounded-full flex items-center justify-center relative overflow-hidden bg-white shadow-2xl transition-all hover:scale-105">
          <div className="absolute inset-0 bg-[conic-gradient(from_0deg,#6C5CE7_20deg,transparent_40deg)] animate-[spin_3s_linear_infinity] opacity-10" />
          <div className="absolute inset-4 border border-dashed border-[#F0EDFF] rounded-full animate-[spin_10s_linear_infinity]" />
          <Scan className="size-24 text-[#2D3436] animate-pulse" />
          
          {/* Overlay Status */}
          <div className="absolute bottom-12 flex flex-col items-center">
             <div className="flex items-center gap-2">
                <div className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[9px] font-black text-[#6C5CE7] uppercase tracking-[0.2em]">En ligne</span>
             </div>
          </div>
        </div>
        
        {/* Corner Decors */}
        {[
          'top-0 left-0 border-t-2 border-l-2',
          'top-0 right-0 border-t-2 border-r-2',
          'bottom-0 left-0 border-b-2 border-l-2',
          'bottom-0 right-0 border-b-2 border-r-2'
        ].map((pos, i) => (
          <div key={i} className={cn("absolute size-10 border-[#6C5CE7]/30", pos)} />
        ))}
      </div>

      {/* Terminal View */}
      <div className="w-full max-w-2xl bg-[#2D3436] rounded-2xl p-8 space-y-6 font-mono relative overflow-hidden shadow-2xl border border-white/5">
        <div className="absolute top-0 left-0 w-full h-1 bg-[#6C5CE7] animate-pulse" />

        <div className="flex items-center justify-between border-b border-white/5 pb-4">
          <div className="flex items-center gap-3">
             <TerminalIcon className="size-4 text-[#6C5CE7]" />
             <span className="text-[10px] font-black uppercase tracking-[0.4em] text-white/40">Audit Telemetry Stream</span>
          </div>
          <div className="flex gap-1.5">
             <div className="size-2 rounded-full bg-[#E17055]" />
             <div className="size-2 rounded-full bg-[#FDCB6E]" />
             <div className="size-2 rounded-full bg-[#00B894]" />
          </div>
        </div>

        <div className="space-y-3 min-h-[220px]">
          {streamLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full opacity-20 py-10">
               <Activity className="size-10 mb-2 animate-spin-slow" />
               <p className="text-[10px] font-bold">ATTENTE DE DONNES...</p>
            </div>
          ) : (
            streamLogs.map((log, i) => (
              <div key={i} className="flex items-start gap-4 text-[11px] tracking-widest leading-relaxed family-mono transition-all animate-in fade-in slide-in-from-left-2 transition-all">
                 <span className="text-white/20 shrink-0 select-none">[{new Date().toLocaleTimeString()}]</span>
                 <span className={cn(
                    "font-bold",
                    log.includes('CREATE') ? 'text-emerald-400' :
                    log.includes('DELETE') ? 'text-rose-400' :
                    log.includes('UPDATE') ? 'text-amber-400' :
                    log.includes('SUCCESSFUL') ? 'text-[#6C5CE7]' :
                    'text-white/80'
                 )}>
                    <span className="opacity-40 mr-2">{` >>> `}</span>
                    {log}
                 </span>
              </div>
            ))
          )}
        </div>

        <div className="pt-6 border-t border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-6">
             <div className="flex items-center gap-2 text-white/20">
                <Activity className="size-3" />
                <span className="text-[8px] font-black uppercase">Buffer: OK</span>
             </div>
             <div className="flex items-center gap-2 text-white/20">
                <Lock className="size-3" />
                <span className="text-[8px] font-black uppercase">SSL_VERIFIED</span>
             </div>
          </div>
          <span className="text-[9px] font-black uppercase tracking-[0.3em] text-[#6C5CE7] italic">Azzoug_Industrial</span>
        </div>
      </div>
    </div>
  );
}
