'use client';

import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
   Users,
   Plus,
   Pencil,
   UserX,
   Loader2,
   Search,
   RefreshCw,
   Shield,
   UserCheck,
   Megaphone,
   Eye,
   Info,
   RotateCcw,
   ChevronLeft,
   ChevronRight,
   Settings2,
   Radio,
   CircleDot,
   Package,
   Mail,
   Phone,
   Activity,
   Filter,
   RadioTower,
   Zap,
   Banknote,
   ShieldCheck,
   Check,
   X,
   Calendar,
   Trash,
   Target,
   Clock,
   TrendingUp,
   Truck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
   Dialog,
   DialogContent,
   DialogDescription,
   DialogFooter,
   DialogHeader,
   DialogTitle,
} from '@/components/ui/dialog';
import {
   AlertDialog,
   AlertDialogAction,
   AlertDialogCancel,
   AlertDialogContent,
   AlertDialogDescription,
   AlertDialogFooter,
   AlertDialogHeader,
   AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import type { EmployeeStats, ApiResponse, UserRole, Product } from '@/lib/types';
import { ROLE_LABELS } from '@/lib/types';
import { formatPrice } from '@/lib/format';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';
import { ALGERIAN_COMMUNES } from '@/lib/algerian-communes';

const isValidIsoDate = (val: string): boolean => {
   if (!val) return false;
   const match = val.match(/^(\d{4})-\d{2}-\d{2}$/);
   if (!match) return false;
   const y = parseInt(match[1], 10);
   return y >= 2020 && y <= 2050;
};

// ═══════════════════════════════════════════════════════════════
// Human Made Design System (Denim Blue)
// ═══════════════════════════════════════════════════════════════
const C = {
   primary: '#4b7bec',       // Bleu Jean
   primaryBg: '#F0F5FF',    // Soft Denim Tint
   success: '#26de81',
   successBg: '#EBFFF5',
   danger: '#eb4d4b',
   dangerBg: '#FFF0F0',
   text: '#2d3436',
   textLight: '#4b6584',
   textDim: '#a5b1c2',
   border: '#f1f2f6',
   bg: '#f8f9fc',
};

const ALGERIAN_PHONE_REGEX = /^0[5-7]\d{8}$/;

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
   { value: 'SUPER_ADMIN', label: ROLE_LABELS.SUPER_ADMIN },
   { value: 'ADMIN', label: ROLE_LABELS.ADMIN },
   { value: 'MANAGER', label: ROLE_LABELS.MANAGER },
   { value: 'CONFIRMATEUR', label: ROLE_LABELS.CONFIRMATEUR },
   { value: 'LIVREUR', label: 'Livreur (Interne)' },
   { value: 'MARKETER', label: ROLE_LABELS.MARKETER },
];

// ═══════════════════════════════════════════════════════════════
// Sub-tabs configuration
// ═══════════════════════════════════════════════════════════════
const TABS = [
   { id: 'infra', label: 'Infrastructure Core', icon: RadioTower },
   { id: 'roles', label: 'Matrice des Rôles', icon: Shield },
   { id: 'admins', label: 'Administration', icon: UserCheck },
   { id: 'agents', label: 'Force de Vente', icon: Users },
   { id: 'marketers', label: 'Affiliés & Médias', icon: Megaphone },
   { id: 'assignment-rules', label: "Règles d'Assignation", icon: Target },
];

// ═══════════════════════════════════════════════════════════════
// Reusable Table Pagination
// ═══════════════════════════════════════════════════════════════
function TablePagination({ total, page, totalPages, onPageChange }: {
   total: number; page: number; totalPages: number; onPageChange: (p: number) => void;
}) {
   const [goTo, setGoTo] = useState('');
   return (
      <div className="px-5 py-3.5 border-t flex items-center justify-between" style={{ borderColor: C.border, backgroundColor: C.bg }}>
         <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-[#636E72]">Total {total}</span>
            <div className="flex items-center border rounded-lg overflow-hidden" style={{ borderColor: C.border }}>
               <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1}
                  className="size-8 flex items-center justify-center hover:bg-white text-[#636E72] disabled:opacity-30">
                  <ChevronLeft className="size-4" />
               </button>
               {Array.from({ length: Math.min(totalPages, 5) }).map((_, i) => (
                  <button key={i} onClick={() => onPageChange(i + 1)}
                     className={cn("size-8 flex items-center justify-center text-xs font-bold border-l transition-colors",
                        page === i + 1 ? "text-white" : "text-[#636E72] hover:bg-white"
                     )}
                     style={{ borderColor: C.border, ...(page === i + 1 ? { backgroundColor: C.primary } : {}) }}>
                     {i + 1}
                  </button>
               ))}
               <button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages}
                  className="size-8 flex items-center justify-center hover:bg-white text-[#636E72] disabled:opacity-30 border-l"
                  style={{ borderColor: C.border }}>
                  <ChevronRight className="size-4" />
               </button>
            </div>
         </div>
         <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-[#B2BEC3]">15 / page</span>
            <div className="flex items-center gap-2">
               <span className="text-xs font-semibold text-[#B2BEC3]">Go to</span>
               <Input value={goTo} onChange={(e) => setGoTo(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { const p = parseInt(goTo); if (p >= 1 && p <= totalPages) onPageChange(p); setGoTo(''); } }}
                  className="w-14 h-8 text-center text-xs font-bold border-[#E9ECF0] rounded-lg" placeholder="1" />
            </div>
         </div>
      </div>
   );
}

// ═══════════════════════════════════════════════════════════════
// Roles Table Sub-View
// ═══════════════════════════════════════════════════════════════
interface RolePermission {
    name: string;
    description: string;
    color: string;
    count: number;
    permissions: string[];
}

const ALL_PERMISSIONS = [
   { group: '📦 Produits & Stock', perms: ['products.view', 'products.create', 'products.edit', 'products.delete', 'stock.view', 'stock.adjust'] },
   { group: '🛒 Commandes', perms: ['orders.view', 'orders.create', 'orders.confirm', 'orders.cancel', 'orders.edit'] },
   { group: '👥 Clients & CRM', perms: ['customers.view', 'customers.edit', 'customers.export'] },
   { group: '💰 Finance & Dépenses', perms: ['finance.view', 'finance.transactions', 'expenses.view', 'expenses.create', 'expenses.delete'] },
   { group: '📈 Analytics & Audit', perms: ['analytics.view', 'audit.view', 'reports.export'] },
   { group: '👤 Équipe & RH', perms: ['users.view', 'users.create', 'users.edit', 'users.delete', 'roles.manage'] },
   { group: '🚚 Livraison & Partenaires', perms: ['delivery.view', 'delivery.manage', 'partners.view', 'partners.edit'] },
   { group: '📣 Marketing & Promotions', perms: ['marketing.view', 'marketing.create', 'promotions.view', 'promotions.manage'] },
   { group: '⚙️ Paramètres', perms: ['settings.view', 'settings.edit', 'api_keys.manage', 'stores.manage'] },
];

const ROLE_COLORS = ['#4b7bec', '#20bf6b', '#f7b731', '#eb4d4b', '#a55eea', '#fd9644', '#45aaf2'];

function NewRoleModal({ open, onClose, storeId, onSuccess }: { open: boolean; onClose: () => void; storeId: string; onSuccess: () => void }) {
   const [form, setForm] = useState({ name: '', description: '', color: ROLE_COLORS[0] });
   const [selectedPerms, setSelectedPerms] = useState<string[]>([]);
   const [saving, setSaving] = useState(false);

   React.useEffect(() => {
      if (open) { setForm({ name: '', description: '', color: ROLE_COLORS[0] }); setSelectedPerms([]); }
   }, [open]);

   const togglePerm = (p: string) => setSelectedPerms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
   const toggleGroup = (perms: string[]) => {
      const allSelected = perms.every(p => selectedPerms.includes(p));
      if (allSelected) setSelectedPerms(prev => prev.filter(p => !perms.includes(p)));
      else setSelectedPerms(prev => [...new Set([...prev, ...perms])]);
   };

   const handleSave = async () => {
      if (!form.name.trim()) { toast.error('Le nom du rôle est obligatoire'); return; }
      if (selectedPerms.length === 0) { toast.error('Sélectionnez au moins une permission'); return; }
      setSaving(true);
      try {
         await apiFetch('/api/v1/users/roles', {
            method: 'POST',
            body: JSON.stringify({ ...form, name: form.name.trim(), permissions: selectedPerms, store_id: storeId }),
         });
         toast.success(`Rôle "${form.name}" créé avec succès`);
         onSuccess();
         onClose();
      } catch (err: any) {
         toast.error(err?.message || 'Erreur lors de la création du rôle');
      } finally {
         setSaving(false);
      }
   };

   return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
         <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto rounded-[2rem] p-0 gap-0 border-0 shadow-2xl">
            <DialogHeader className="px-8 py-6 border-b border-slate-100 bg-white sticky top-0 z-10">
               <div className="flex items-center gap-4">
                  <div className="size-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: form.color + '20' }}>
                     <Shield className="size-6" style={{ color: form.color }} />
                  </div>
                  <div>
                     <DialogTitle className="text-xl font-black text-slate-800">Nouveau Rôle</DialogTitle>
                     <DialogDescription className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">Définissez les accès et permissions</DialogDescription>
                  </div>
               </div>
            </DialogHeader>

            <div className="p-8 space-y-8 bg-[#F8FAFC]">
               {/* Identity */}
               <div className="bg-white rounded-3xl p-6 border border-slate-100 space-y-5">
                  <h4 className="text-xs font-black uppercase text-slate-400 tracking-widest">Identité du rôle</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <label className="text-[11px] font-black uppercase text-[#636E72] tracking-widest">Nom du rôle *</label>
                        <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                           placeholder="Ex: Responsable Régional" className="h-12 rounded-2xl border-slate-100 bg-slate-50 font-bold" />
                     </div>
                     <div className="space-y-2">
                        <label className="text-[11px] font-black uppercase text-[#636E72] tracking-widest">Couleur distinctive</label>
                        <div className="flex gap-2 flex-wrap">
                           {ROLE_COLORS.map(c => (
                              <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))}
                                 className="size-9 rounded-xl border-2 transition-all"
                                 style={{ backgroundColor: c, borderColor: form.color === c ? '#2D3436' : 'transparent' }}
                              />
                           ))}
                        </div>
                     </div>
                  </div>
                  <div className="space-y-2">
                     <label className="text-[11px] font-black uppercase text-[#636E72] tracking-widest">Description du rôle</label>
                     <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                        placeholder="Ex: Gère les stocks et les livraisons régionales" className="h-12 rounded-2xl border-slate-100 bg-slate-50 font-medium" />
                  </div>
               </div>

               {/* Permissions matrix */}
               <div className="bg-white rounded-3xl p-6 border border-slate-100 space-y-5">
                  <div className="flex items-center justify-between">
                     <h4 className="text-xs font-black uppercase text-slate-400 tracking-widest">Matrice des permissions</h4>
                     <span className="text-xs font-bold text-[#4b7bec] bg-indigo-50 px-3 py-1 rounded-xl">{selectedPerms.length} sélectionnées</span>
                  </div>
                  <div className="space-y-4">
                     {ALL_PERMISSIONS.map(({ group, perms }) => {
                        const allSelected = perms.every(p => selectedPerms.includes(p));
                        const someSelected = perms.some(p => selectedPerms.includes(p));
                        return (
                           <div key={group} className="rounded-2xl border border-slate-100 overflow-hidden">
                              <button type="button" onClick={() => toggleGroup(perms)}
                                 className="w-full flex items-center justify-between px-5 py-3 bg-slate-50 hover:bg-slate-100 transition-all">
                                 <span className="text-xs font-black text-slate-600">{group}</span>
                                 <div className={cn("size-5 rounded-md border-2 flex items-center justify-center transition-all",
                                    allSelected ? "bg-[#4b7bec] border-[#4b7bec]" : someSelected ? "bg-indigo-100 border-[#4b7bec]" : "bg-white border-slate-200"
                                 )}>
                                    {allSelected && <Check className="size-3 text-white" />}
                                    {someSelected && !allSelected && <div className="size-2 rounded-sm bg-[#4b7bec]" />}
                                 </div>
                              </button>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-4">
                                 {perms.map(p => (
                                    <label key={p} onClick={() => togglePerm(p)}
                                       className={cn("flex items-center gap-2 p-2 rounded-xl cursor-pointer transition-all border text-xs font-bold",
                                          selectedPerms.includes(p) ? "bg-indigo-50 border-indigo-200 text-[#4b7bec]" : "bg-white border-slate-100 text-slate-500 hover:border-slate-200"
                                       )}>
                                       <div className={cn("size-4 rounded shrink-0 flex items-center justify-center border transition-all",
                                          selectedPerms.includes(p) ? "bg-[#4b7bec] border-[#4b7bec]" : "border-slate-200"
                                       )}>
                                          {selectedPerms.includes(p) && <Check className="size-2.5 text-white" />}
                                       </div>
                                       <span className="truncate font-mono text-[10px]">{p.split('.')[1]}</span>
                                    </label>
                                 ))}
                              </div>
                           </div>
                        );
                     })}
                  </div>
               </div>
            </div>

            <div className="px-8 py-5 border-t border-slate-100 bg-white flex items-center justify-end gap-3 sticky bottom-0">
               <button onClick={onClose} className="h-12 px-6 rounded-2xl font-black text-[11px] uppercase tracking-widest text-slate-400 hover:bg-slate-50 transition-all">Annuler</button>
               <button onClick={handleSave} disabled={saving}
                  className="h-12 px-8 rounded-2xl bg-[#4b7bec] hover:bg-[#3867d6] text-white font-black text-[11px] uppercase tracking-widest shadow-lg shadow-indigo-200 transition-all disabled:opacity-50">
                  {saving ? <Loader2 className="size-4 animate-spin" /> : `Créer le rôle — ${selectedPerms.length} permissions`}
               </button>
            </div>
         </DialogContent>
      </Dialog>
   );
}

function RolesView({ roles, isLoading, onRefresh, onNewRole }: { roles: RolePermission[]; isLoading: boolean; onRefresh: () => void; onNewRole: () => void }) {
   const [exploredRole, setExploredRole] = useState<RolePermission | null>(null);
   if (isLoading) return <div className="p-10 flex justify-center"><Loader2 className="size-8 animate-spin text-slate-300" /></div>;
   if (!Array.isArray(roles)) return <div className="p-10 flex justify-center"><Loader2 className="size-8 animate-spin text-slate-300" /></div>;

   return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
         {/* Header */}
         <div className="bg-white rounded-3xl border px-8 py-6 shadow-sm flex items-center justify-between" style={{ borderColor: C.border }}>
            <div className="flex items-center gap-4">
               <div className="size-12 rounded-xl flex items-center justify-center shadow-inner" style={{ backgroundColor: C.primaryBg }}>
                  <Shield className="size-6" style={{ color: C.primary }} />
               </div>
               <div>
                  <h2 className="text-lg font-bold text-slate-900">Hiérarchie des rôles</h2>
                  <p className="text-sm font-medium text-slate-400 mt-1">Structure des permissions et accès (Temps réel)</p>
               </div>
            </div>
            <div className="flex gap-3">
               <button onClick={onRefresh} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold border hover:bg-[#F8F9FC] transition-all" style={{ borderColor: C.border, color: C.textLight }}>
                  <RefreshCw className="size-4" /> Rafraîchir
               </button>
               <Button onClick={onNewRole} className="h-11 px-6 rounded-xl text-xs font-bold bg-[#4b7bec] hover:bg-[#3867d6] text-white shadow-lg shadow-indigo-100 transition-all flex items-center group border-none">
                  <Plus className="mr-2 size-4 text-white transition-transform group-hover:scale-110" /> Nouveau rôle
               </Button>
            </div>
         </div>

         {/* Grid Distribution */}
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {roles.map((r, i) => (
               <div key={i} className="bg-white rounded-3xl border p-6 group hover:shadow-md transition-all" style={{ borderColor: C.border }}>
                  <div className="flex items-center justify-between mb-5">
                     <div className="size-10 rounded-xl flex items-center justify-center font-bold text-white shadow-sm" style={{ backgroundColor: r.color }}>{r.count}</div>
                     <Badge variant="outline" className="text-[10px] font-bold" style={{ color: r.color, borderColor: r.color + '30' }}>Actif</Badge>
                  </div>
                  <h3 className="text-sm font-bold text-slate-900">{r.name}</h3>
                  <p className="text-xs font-medium text-slate-400 mt-2 leading-relaxed">{r.description}</p>
                  <div className="mt-5 pt-5 border-t flex items-center justify-between" style={{ borderColor: C.border }}>
                     <span className="text-[11px] font-bold text-slate-500">{r.permissions.length} permissions</span>
                     <button className="size-8 rounded-lg flex items-center justify-center hover:bg-slate-50 text-slate-300 transition-colors"><Settings2 className="size-4" /></button>
                  </div>
               </div>
            ))}
         </div>

         {/* Detailed Table */}
         <div className="bg-white rounded-3xl border shadow-sm overflow-hidden" style={{ borderColor: C.border }}>
            <table className="w-full text-left">
               <thead>
                  <tr className="border-b" style={{ borderColor: C.border, backgroundColor: '#FAFBFD' }}>
                     <th className="px-8 py-4 text-xs font-bold text-slate-500">Définition du rôle</th>
                     <th className="px-8 py-4 text-xs font-bold text-slate-500">Matrice de permissions</th>
                     <th className="px-8 py-4 text-xs font-bold text-slate-500 text-right">Contrôle</th>
                  </tr>
               </thead>
               <tbody className="divide-y" style={{ borderColor: C.border }}>
                  {roles.map((role) => (
                     <tr key={role.name} className="hover:bg-[#FAFBFD]/50 transition-colors group">
                        <td className="px-8 py-6 align-top">
                           <div className="flex flex-col">
                              <span className="text-sm font-bold text-slate-800 tracking-tight group-hover:text-[#4b7bec] transition-colors">{role.name}</span>
                              <span className="text-xs font-medium text-slate-400 mt-1">{role.description}</span>
                           </div>
                        </td>
                        <td className="px-8 py-6">
                           <div className="flex flex-wrap gap-2">
                              {role.permissions.map((perm) => (
                                 <span key={perm} className="px-3 py-1.5 text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-100 rounded-lg">
                                    {perm}
                                 </span>
                              ))}
                           </div>
                        </td>
                        <td className="px-8 py-6 text-right align-top">
                           <div className="flex items-center justify-end gap-2">
                              <button onClick={() => setExploredRole(role)} className="h-9 px-4 rounded-xl flex items-center gap-2 border hover:bg-white text-xs font-bold text-slate-500 transition-all shadow-sm" style={{ borderColor: C.border }}>
                                 <Eye className="size-3.5" /> Explorer
                              </button>
                           </div>
                        </td>
                     </tr>
                  ))}
               </tbody>
            </table>
         </div>

         <Dialog open={!!exploredRole} onOpenChange={(o) => { if (!o) setExploredRole(null); }}>
            <DialogContent className="max-w-lg rounded-[2rem] p-0 gap-0 border-0 shadow-2xl overflow-hidden">
               {exploredRole && (
                  <>
                     <DialogHeader className="px-8 py-6 border-b border-slate-100 bg-white">
                        <div className="flex items-center gap-4">
                           <div className="size-12 rounded-xl flex items-center justify-center font-bold text-white shadow-sm" style={{ backgroundColor: exploredRole.color }}>{exploredRole.count}</div>
                           <div>
                              <DialogTitle className="text-lg font-black text-slate-800">{exploredRole.name}</DialogTitle>
                              <DialogDescription className="text-xs font-medium text-slate-400 mt-0.5">{exploredRole.description}</DialogDescription>
                           </div>
                        </div>
                     </DialogHeader>
                     <div className="px-8 py-6 space-y-4">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                           <span>{exploredRole.count} utilisateur{exploredRole.count > 1 ? 's' : ''} actif{exploredRole.count > 1 ? 's' : ''}</span>
                           <span>{exploredRole.permissions.length} permission{exploredRole.permissions.length > 1 ? 's' : ''}</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                           {exploredRole.permissions.map((perm) => (
                              <span key={perm} className="px-3 py-1.5 text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-100 rounded-lg">
                                 {perm}
                              </span>
                           ))}
                        </div>
                     </div>
                  </>
               )}
            </DialogContent>
         </Dialog>
      </div>
   );
}

// ═══════════════════════════════════════════════════════════════
// Human Infrastructure // Core View
// ═══════════════════════════════════════════════════════════════
interface InfrastructureStats {
    totalEffectif: number;
    onlineCount: number;
    qualityIndex: number;
    interactionDelay: number;
    securityLevel: string;
    nodeId: string;
}

function InfrastructureView({ stats, logs, isLoading }: { stats: InfrastructureStats; logs: any[]; isLoading: boolean }) {
   if (isLoading) return <div className="p-10 flex justify-center"><Loader2 className="size-8 animate-spin text-slate-300" /></div>;

   return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-3 duration-1000">
         {/* Human Core Header */}
         <div className="bg-white rounded-[40px] p-10 border shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden" style={{ borderColor: C.border }}>
            <div className="absolute -top-20 -right-20 size-80 bg-indigo-50/50 rounded-full blur-[80px]" />
            <div className="absolute top-10 right-10 opacity-[0.03] text-indigo-600"><RadioTower className="size-48" /></div>
            
            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-12">
               <div className="flex-1 space-y-5">
                  <div className="flex items-center gap-3">
                     <span className="px-3.5 py-1 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100/50 text-[11px] font-bold flex items-center gap-2">
                        <div className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]" />
                        Système opérationnel
                     </span>
                     <span className="text-[11px] font-medium text-slate-300 tracking-tight">Poste de contrôle : {stats.nodeId}</span>
                  </div>
                  <div className="space-y-2">
                     <h2 className="text-3xl font-bold tracking-tight text-slate-900">
                        Votre infrastructure <span className="text-indigo-600">humaine</span>
                     </h2>
                     <p className="text-base font-medium text-slate-500 max-w-lg leading-relaxed">
                        Suivez l'activité de vos équipes et la santé de votre organisation en temps réel, synchronisé avec le backend.
                     </p>
                  </div>
               </div>
               
               <div className="flex flex-wrap gap-4">
                  <div className="bg-[#F8F9FC] rounded-[24px] p-7 min-w-[180px] border border-white">
                     <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Effectif total</p>
                     <div className="flex items-baseline gap-2">
                        <span className="text-4xl font-bold text-slate-900 tracking-tighter">{stats.totalEffectif}</span>
                        <span className="text-xs font-semibold text-emerald-500">{stats.onlineCount} actifs</span>
                     </div>
                  </div>
                  <div className="bg-indigo-50/30 rounded-[24px] p-7 min-w-[180px] border border-indigo-100/30">
                     <p className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider mb-2">Taux de confirmation moyen</p>
                     <div className="flex items-baseline gap-2">
                        {stats.qualityIndex != null ? (
                           <span className="text-4xl font-bold text-indigo-600 tracking-tighter">{stats.qualityIndex}%</span>
                        ) : (
                           <span className="text-sm font-semibold text-slate-300">Aucune commande sur 30j</span>
                        )}
                     </div>
                  </div>
               </div>
            </div>
         </div>
         
         <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
            <div className="xl:col-span-2 space-y-8">
               <div className="bg-white rounded-[40px] p-10 border shadow-sm" style={{ borderColor: C.border }}>
                  <div className="flex items-center justify-between mb-10">
                     <div className="flex items-center gap-4">
                        <div className="size-11 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                           <Activity className="size-5" />
                        </div>
                        <div>
                           <h3 className="text-lg font-bold text-slate-900 leading-none">Activité des équipes</h3>
                           <p className="text-sm font-medium text-slate-400 mt-1.5">Analyse de la présence et du flux de travail</p>
                        </div>
                     </div>
                  </div>
                  
                  {/* No time-series activity data exists yet to chart honestly
                      (would need a dedicated events-over-time endpoint) — an
                      empty state beats a decorative placeholder pretending to
                      be a live monitor. */}
                  <div className="h-64 w-full rounded-[30px] bg-[#F8F9FC] border border-slate-100 flex items-center justify-center relative overflow-hidden">
                     <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'radial-gradient(#6C5CE7 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
                     <div className="flex flex-col items-center gap-3 relative z-10">
                        <div className="size-16 rounded-full bg-white shadow-md flex items-center justify-center mb-2">
                           <Users className="size-7 text-slate-300" />
                        </div>
                        <span className="text-sm font-bold text-slate-400">Graphique d'activité non disponible pour le moment</span>
                     </div>
                  </div>
               </div>

               <div className="grid grid-cols-1 gap-8">
                  <div className="bg-white rounded-[32px] border p-8 shadow-sm flex items-center gap-5 hover:border-indigo-100 transition-all group" style={{ borderColor: C.border }}>
                     <div className="size-14 rounded-2xl bg-orange-50 flex items-center justify-center text-orange-500 group-hover:bg-orange-100 transition-colors"><Zap className="size-6" /></div>
                     <div>
                        <p className="text-xs font-bold text-slate-400 mb-1">Délai d'interaction (30j)</p>
                        {stats.interactionDelay != null ? (
                           <p className="text-2xl font-bold text-slate-900 tracking-tight">{stats.interactionDelay} min <span className="text-[10px] font-medium text-slate-400">moy.</span></p>
                        ) : (
                           <p className="text-sm font-semibold text-slate-300">Aucune donnée sur 30j</p>
                        )}
                     </div>
                  </div>
                  <div className="bg-amber-50/50 rounded-[32px] border border-amber-200/50 p-6 flex items-center justify-between gap-6">
                     <div className="flex items-center gap-4">
                        <div className="size-12 rounded-2xl bg-amber-100 flex items-center justify-center text-amber-600">
                           <Activity className="size-6" />
                        </div>
                        <div>
                           <h4 className="text-sm font-black text-amber-900 uppercase tracking-tight">Vigilance SLA (2h)</h4>
                           <p className="text-[11px] font-medium text-amber-700/70">Alerte automatique si une commande n'est pas traitée dans les 120 min.</p>
                        </div>
                     </div>
                     <div className="px-4 py-2 bg-amber-100 rounded-xl text-amber-700 text-[10px] font-black uppercase">Service Actif</div>
                  </div>
               </div>
            </div>

            <div className="bg-white rounded-[40px] border shadow-sm overflow-hidden flex flex-col" style={{ borderColor: C.border }}>
               <div className="p-8 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
                  <div className="space-y-1">
                     <h3 className="text-lg font-bold text-slate-900">Fil d'activité</h3>
                     <p className="text-xs font-medium text-slate-400">Audit logs en temps réel</p>
                  </div>
                  <div className="size-2 rounded-full bg-emerald-500 animate-pulse" />
               </div>
               
               <div className="flex-1 overflow-y-auto max-h-[600px] custom-scrollbar">
                  {logs.length > 0 ? logs.map((log: any, i: number) => (
                     <div key={i} className="flex px-8 py-5 gap-5 hover:bg-slate-50/50 transition-colors border-b border-slate-50 last:border-0">
                        <span className="text-[10px] font-bold text-slate-300 min-w-[50px]">{new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <div className="flex items-center gap-3 min-w-0">
                           <div className="size-1.5 rounded-full bg-indigo-500 shrink-0 shadow-[0_0_8px_currentColor]" />
                           <p className="text-[11px] font-semibold text-slate-600">
                             <span className="font-bold text-slate-900">{log.actor?.name || 'Système'}</span> : {log.action} sur {log.entity}
                           </p>
                        </div>
                     </div>
                  )) : (
                     <div className="p-10 text-center text-slate-300 text-xs font-bold">Aucune activité récente</div>
                  )}
               </div>
            </div>
         </div>
      </div>
   );
}

// ═══════════════════════════════════════════════════════════════
// Admins Table Sub-View
// ═══════════════════════════════════════════════════════════════
const ADMINS_PAGE_SIZE = 15;

function AdminsView({ employees, isLoading, onEdit, onDeactivate, onCreate, totalStaff }: {
   employees: any[]; isLoading: boolean; onEdit: (e: any) => void; onDeactivate: (e: any) => void; onCreate: () => void; totalStaff?: number;
}) {
   const [search, setSearch] = useState('');
   const [page, setPage] = useState(1);

   // Real, derivable stats only — no invented percentages. "Actifs" counts
   // employees with is_active=true (a real column); "Accès privilégiés"
   // counts real SUPER_ADMIN/ADMIN accounts. There is no last-activity
   // tracking anywhere in this schema, so the previous "Actifs 24h: 100%"
   // and "Sécurité: Maximale" tiles — and the per-row "Dernière active:
   // Actif" shown identically for every employee, including deactivated
   // ones — were fabricated, not computed from anything.
   const activeCount = employees.filter(e => e.is_active).length;
   const activePct = employees.length > 0 ? Math.round((activeCount / employees.length) * 100) : 0;
   const privilegedCount = employees.filter(e => e.role === 'SUPER_ADMIN' || e.role === 'ADMIN').length;

   const filtered = search.trim()
      ? employees.filter(e =>
           e.name.toLowerCase().includes(search.toLowerCase()) ||
           e.email.toLowerCase().includes(search.toLowerCase())
        )
      : employees;

   const totalPages = Math.max(1, Math.ceil(filtered.length / ADMINS_PAGE_SIZE));
   const pageSafe = Math.min(page, totalPages);
   const pageEmployees = filtered.slice((pageSafe - 1) * ADMINS_PAGE_SIZE, pageSafe * ADMINS_PAGE_SIZE);

   return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
         {/* Top Stats Bar */}
         <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white rounded-3xl border p-6 flex items-center gap-4" style={{ borderColor: C.border }}>
               <div className="size-12 rounded-2xl flex items-center justify-center bg-indigo-50 text-[#4b7bec] shadow-inner"><Shield className="size-6" /></div>
               <div><p className="text-xs font-bold text-slate-400">Total staff</p><p className="text-xl font-bold text-slate-900">{totalStaff ?? employees.length}</p></div>
            </div>
            <div className="bg-white rounded-3xl border p-6 flex items-center gap-4" style={{ borderColor: C.border }}>
               <div className="size-12 rounded-2xl flex items-center justify-center bg-emerald-50 text-emerald-500 shadow-inner"><Activity className="size-6" /></div>
               <div><p className="text-xs font-bold text-slate-400">Comptes actifs</p><p className="text-xl font-bold text-slate-900">{activePct}% <span className="text-xs font-medium text-slate-400">({activeCount}/{employees.length})</span></p></div>
            </div>
            <div className="bg-white rounded-3xl border p-6 flex items-center gap-4" style={{ borderColor: C.border }}>
               <div className="size-12 rounded-2xl flex items-center justify-center bg-amber-50 text-amber-500 shadow-inner"><Radio className="size-6" /></div>
               <div><p className="text-xs font-bold text-slate-400">Accès privilégiés</p><p className="text-xl font-bold text-slate-900">{privilegedCount}</p></div>
            </div>
         </div>

         <div className="bg-white rounded-3xl border px-8 py-6 shadow-sm flex items-center justify-between" style={{ borderColor: C.border }}>
            <div className="flex items-center gap-4">
               <div className="size-12 rounded-xl flex items-center justify-center shadow-inner" style={{ backgroundColor: C.primaryBg }}>
                  <UserCheck className="size-6" style={{ color: C.primary }} />
               </div>
               <div>
                  <h2 className="text-lg font-bold text-slate-900">Staff & Équipes</h2>
                  <p className="text-sm font-medium text-slate-400 mt-1">Gestion complète du personnel</p>
               </div>
            </div>
            <button onClick={onCreate} className="h-11 px-6 rounded-xl flex items-center gap-2 bg-[#4b7bec] text-white text-xs font-bold shadow-lg shadow-indigo-100 transition-all hover:scale-105" style={{ backgroundColor: C.primary }}>
               <Plus className="size-4" /> Nouvel admin
            </button>
         </div>

         <div className="bg-white rounded-3xl border px-6 py-4 flex items-center justify-between shadow-sm" style={{ borderColor: C.border }}>
            <div className="relative max-w-md flex-1">
               <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-300" />
               <Input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  placeholder="Rechercher par nom ou email..."
                  className="pl-10 h-11 bg-slate-50/50 border-slate-100 rounded-2xl text-sm font-medium focus-visible:ring-[#4b7bec]"
               />
            </div>
         </div>

         <div className="bg-white rounded-3xl border shadow-sm overflow-hidden" style={{ borderColor: C.border }}>
            {isLoading ? (
               <div className="p-10 space-y-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}</div>
            ) : (
               <div className="overflow-x-auto">
                  <table className="w-full text-left min-w-[1000px]">
                     <thead>
                        <tr className="border-b" style={{ borderColor: C.border, backgroundColor: '#FAFBFD' }}>
                           <th className="px-8 py-4 text-xs font-bold text-slate-500">Identité</th>
                           <th className="px-8 py-4 text-xs font-bold text-slate-500">Communications</th>
                           <th className="px-8 py-4 text-xs font-bold text-slate-500">Accréditation</th>
                           <th className="px-8 py-4 text-xs font-bold text-slate-500 text-center">Statut</th>
                           <th className="px-8 py-4 text-xs font-bold text-slate-500 text-right w-32">Actions</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y" style={{ borderColor: C.border }}>
                        {pageEmployees.length === 0 ? (
                           <tr><td colSpan={5} className="px-8 py-16 text-center text-sm text-slate-400 font-medium">
                              {search ? 'Aucun membre ne correspond à votre recherche.' : 'Aucun membre pour le moment.'}
                           </td></tr>
                        ) : pageEmployees.map((emp) => (
                           <tr key={emp.id} className="hover:bg-[#FAFBFD]/50 transition-colors group">
                              <td className="px-8 py-5">
                                 <div className="flex items-center gap-4">
                                    <div className="size-10 rounded-[14px] flex items-center justify-center text-sm font-bold text-white shadow-sm relative" style={{ backgroundColor: emp.role === 'SUPER_ADMIN' ? '#2d3436' : C.primary }}>
                                       {emp.name.charAt(0)}
                                       {emp.is_active && <div className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-emerald-500 border-2 border-white" />}
                                    </div>
                                    <div className="flex flex-col">
                                       <span className="text-sm font-bold text-slate-800 tracking-tight group-hover:text-[#4b7bec] transition-colors">{emp.name}</span>
                                       <span className="text-[10px] font-bold text-slate-400 uppercase mt-0.5 tracking-tight">ID: {emp.id.split('-')[0]}</span>
                                    </div>
                                 </div>
                              </td>
                              <td className="px-8 py-5">
                                 <div className="flex flex-col gap-1.5 text-xs font-medium text-slate-500">
                                    <div className="flex items-center gap-2">
                                       <Mail className="size-3 text-slate-300" /> {emp.email}
                                    </div>
                                    <div className="flex items-center gap-2">
                                       <Phone className="size-3 text-slate-300" /> {emp.phone || 'Non renseigné'}
                                    </div>
                                 </div>
                              </td>
                              <td className="px-8 py-5">
                                 <Badge variant="outline" className="text-[10px] font-bold border-indigo-100 text-[#4b7bec] bg-indigo-50/30 uppercase tracking-widest px-3 py-1">
                                    {emp.role}
                                 </Badge>
                              </td>
                              <td className="px-8 py-5 text-center">
                                 <span className={cn("text-xs font-bold", emp.is_active ? "text-emerald-600" : "text-slate-400")}>
                                    {emp.is_active ? 'Actif' : 'Inactif'}
                                 </span>
                              </td>
                              <td className="px-8 py-5 text-right w-32">
                                 <div className="flex items-center justify-end gap-2">
                                    <button onClick={() => onEdit(emp)} className="size-9 rounded-xl flex items-center justify-center bg-white border border-slate-100 text-slate-300 hover:text-[#4b7bec] hover:border-[#4b7bec] transition-all shadow-sm">
                                       <Pencil className="size-4" />
                                    </button>
                                    <button onClick={() => onDeactivate(emp)} className="size-9 rounded-xl flex items-center justify-center bg-white border border-slate-100 text-slate-300 hover:text-red-500 hover:border-red-500 transition-all shadow-sm">
                                       <UserX className="size-4" />
                                    </button>
                                 </div>
                              </td>
                           </tr>
                        ))}
                     </tbody>
                  </table>
               </div>
            )}
            <TablePagination total={filtered.length} page={pageSafe} totalPages={totalPages} onPageChange={setPage} />
         </div>
      </div>
   );
}

// ═══════════════════════════════════════════════════════════════
// Agents Table Sub-View
// ═══════════════════════════════════════════════════════════════
function AgentRow({ agent, onEdit, onDeactivate, onDelete, perfSummary }: {
   agent: any; onEdit: (e: any) => void; onDeactivate: (e: any) => void; onDelete: (e: any) => void; perfSummary?: any;
}) {
   // Stats come from ONE bulk /users/performance-summary call made once by
   // AgentsView for the whole visible page, not a per-row query — see that
   // endpoint's docstring for why (N+1 was firing one full /performance
   // call, and its recent_orders/audit_logs/daily-chart queries, PER AGENT
   // ROW just to paint this badge).
   const stats = perfSummary ?? {};
   const total = stats.total_assigned ?? 0;
   const confirmed = stats.confirmed_count ?? 0;
   const rate = stats.confirmation_rate ?? (total > 0 ? Math.round((confirmed / total) * 100) : null);

   // Salary calc
   const paymentType = agent.payment_type ?? '';
   const paymentAmount = agent.payment_amount ?? 0;
   const delivered = stats.delivered_count ?? 0;
   const salary = stats.salary ?? (
      paymentType === 'MONTHLY_SALARY' ? paymentAmount : delivered * paymentAmount
   );

   return (
      <tr className="hover:bg-slate-50/50 transition-all group">
         <td className="px-8 py-6">
            <div className="flex items-center gap-4">
               <div className="size-11 rounded-2xl flex items-center justify-center text-sm font-bold text-white shadow-sm" style={{ backgroundColor: C.primary }}>{agent.name.charAt(0)}</div>
               <div className="flex flex-col">
                  <span className="text-sm font-bold text-slate-900 group-hover:text-[#4b7bec] transition-colors">{agent.name}</span>
                  <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider mt-1">
                     AGN-{agent.id.split('-')[0].toUpperCase()}
                     {agent.assigned_store_id ? '' : ' · Toutes boutiques'}
                  </span>
               </div>
            </div>
         </td>
         <td className="px-8 py-6">
            <div className="flex flex-col gap-1 text-xs font-medium text-slate-500">
               <span className="flex items-center gap-2"><Mail className="size-3.5 text-slate-200" /> {agent.email}</span>
               <span className="flex items-center gap-2"><Phone className="size-3.5 text-slate-200" /> {agent.phone || 'N/A'}</span>
            </div>
         </td>
         <td className="px-8 py-6 text-center">
            <div className="flex flex-col items-center gap-1">
               {rate !== null ? (
                  <>
                     <div className="flex items-center gap-1.5">
                        <span className="text-sm font-black text-slate-900">{rate}%</span>
                        <span className="text-[10px] text-slate-400">conf.</span>
                     </div>
                     <span className="text-[10px] text-slate-400">{confirmed}/{total} cmd</span>
                     <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${rate}%`, backgroundColor: rate >= 70 ? '#00B894' : rate >= 40 ? '#FDCB6E' : '#E17055' }} />
                     </div>
                     <div className="flex items-center gap-1 mt-1 text-[10px] font-bold">
                        <span className="text-blue-600 bg-blue-50 px-1.5 py-0.2 rounded border border-blue-100" title="Commandes normales livrées">
                           🟦 {stats.normal_delivered_count ?? Math.max(0, delivered - (stats.recovered_delivered_count || 0))}
                        </span>
                        {(stats.recovered_delivered_count || 0) > 0 && (
                           <span className="text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200 font-black" title="Paniers abandonnés récupérés et livrés">
                              🟩 +{stats.recovered_delivered_count}
                           </span>
                        )}
                     </div>
                  </>
               ) : (
                  <span className="text-[10px] text-slate-300">—</span>
               )}
            </div>
         </td>
         <td className="px-8 py-6 text-center">
            <div className="flex flex-col items-center gap-1">
               <span className="text-sm font-black text-[#2D3436] font-mono">{Number(salary).toLocaleString()} DA</span>
               <span className="text-[9px] text-slate-400 uppercase tracking-wide font-bold">
                  {paymentType === 'PER_DELIVERED_ORDER' ? 'par livraison' : paymentType === 'MONTHLY_SALARY' ? 'fixe' : '—'}
               </span>
            </div>
         </td>
         <td className="px-8 py-6 text-center">
            <div className={cn("inline-flex items-center gap-2 px-3 py-1 rounded-full border", agent.is_active ? "bg-emerald-50 border-emerald-100/50" : "bg-slate-50 border-slate-100")}>
               <div className={cn("size-1.5 rounded-full", agent.is_active ? "bg-emerald-500" : "bg-slate-300")} />
               <span className={cn("text-[11px] font-bold", agent.is_active ? "text-emerald-600" : "text-slate-400")}>{agent.is_active ? 'Actif' : 'Inactif'}</span>
            </div>
         </td>
         <td className="px-8 py-6 text-right">
            <div className="flex items-center justify-end gap-2">
               <SalaryCalculatorButton employee={agent} />
               <button onClick={() => onEdit(agent)} className="size-9 rounded-xl flex items-center justify-center bg-white border border-slate-100 text-slate-300 hover:text-[#4b7bec] hover:border-[#4b7bec] transition-all shadow-sm" title="Modifier"><Pencil className="size-4" /></button>
               <button onClick={() => onDeactivate(agent)} className="size-9 rounded-xl flex items-center justify-center bg-white border border-slate-100 text-slate-300 hover:text-amber-600 hover:border-amber-600 transition-all shadow-sm" title="Désactiver"><UserX className="size-4" /></button>
               <button onClick={() => onDelete(agent)} className="size-9 rounded-xl flex items-center justify-center bg-white border border-slate-100 text-slate-300 hover:text-red-600 hover:border-red-600 transition-all shadow-sm" title="Supprimer définitivement"><Trash className="size-4" /></button>
            </div>
         </td>
      </tr>
   );
}

const AGENTS_PAGE_SIZE = 15;

function AgentsView({ employees, isLoading, onEdit, onDeactivate, onDelete, onCreate, totalStaff }: {
   employees: any[]; isLoading: boolean; onEdit: (e: any) => void; onDeactivate: (e: any) => void; onDelete: (e: any) => void; onCreate: () => void; totalStaff?: number;
}) {
   const { activeStore } = useAppStore();
   const storeId = activeStore?.id ?? '';
   const allAgents = employees.filter(e => e.role === 'CONFIRMATEUR');
   const [search, setSearch] = useState('');
   const [page, setPage] = useState(1);

   const agents = search.trim()
      ? allAgents.filter(a =>
           a.name.toLowerCase().includes(search.toLowerCase()) ||
           a.email.toLowerCase().includes(search.toLowerCase())
        )
      : allAgents;

   const totalPages = Math.max(1, Math.ceil(agents.length / AGENTS_PAGE_SIZE));
   const pageSafe = Math.min(page, totalPages);
   const pageAgents = agents.slice((pageSafe - 1) * AGENTS_PAGE_SIZE, pageSafe * AGENTS_PAGE_SIZE);

   // ONE bulk call for whichever agents are actually visible on this page —
   // see /users/performance-summary docstring for why this replaced N
   // per-row queries.
   const idsKey = pageAgents.map(a => a.id).join(',');
   const perfQuery = useQuery<any>({
      queryKey: ['employees-perf-summary', idsKey, storeId],
      queryFn: () => apiFetch(`/api/v1/users/performance-summary?user_ids=${idsKey}&store_id=${storeId}`),
      enabled: !!storeId && pageAgents.length > 0,
   });
   const perfByAgent: Record<string, any> = perfQuery.data?.data ?? {};

   return (
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
         {/* Agents Header */}
         <div className="bg-white rounded-[32px] border px-8 py-7 shadow-sm flex items-center justify-between" style={{ borderColor: C.border }}>
            <div className="flex items-center gap-5">
               <div className="size-14 rounded-2xl flex items-center justify-center bg-[#F0F5FF] text-[#4b7bec] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]">
                  <Users className="size-7" />
               </div>
               <div>
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight">Force de vente</h2>
                  <p className="text-sm font-medium text-slate-400 mt-1">Vos équipes de confirmation et support client</p>
               </div>
            </div>
            <button onClick={onCreate} className="h-11 px-8 rounded-2xl flex items-center gap-2 bg-[#4b7bec] text-white text-xs font-bold shadow-lg shadow-indigo-100/50 transition-all hover:scale-[1.02]">
               <Plus className="size-4" /> Nouvel agent
            </button>
         </div>

         {/* Agents Table */}
         <div className="bg-white rounded-[32px] border shadow-sm overflow-hidden" style={{ borderColor: C.border }}>
            <div className="px-8 py-6 border-b flex items-center justify-between bg-slate-50/30" style={{ borderColor: C.border }}>
               <div className="relative max-sm-sm flex-1">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-300" />
                  <Input
                     value={search}
                     onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                     placeholder="Rechercher un agent..."
                     className="pl-10 h-11 bg-white border-slate-100 rounded-2xl text-sm font-medium"
                  />
               </div>
            </div>

            <div className="overflow-x-auto">
               <table className="w-full text-left min-w-[1000px]">
                  <thead>
                     <tr className="border-b" style={{ borderColor: C.border, backgroundColor: '#FAFBFD' }}>
                        <th className="px-8 py-5 text-xs font-bold text-slate-500">Agent</th>
                        <th className="px-8 py-5 text-xs font-bold text-slate-500">Contact</th>
                        <th className="px-8 py-5 text-xs font-bold text-slate-500 text-center">Taux Confirmation</th>
                        <th className="px-8 py-5 text-xs font-bold text-slate-500 text-center">Salaire Estimé</th>
                        <th className="px-8 py-5 text-xs font-bold text-slate-500 text-center">Statut</th>
                        <th className="px-8 py-5 text-xs font-bold text-slate-500 text-right">Actions</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: C.border }}>
                     {pageAgents.length === 0 ? (
                        <tr><td colSpan={6} className="px-8 py-16 text-center text-sm text-slate-400 font-medium">
                           {isLoading ? 'Chargement…' : search ? 'Aucun agent ne correspond à votre recherche.' : 'Aucun agent pour le moment.'}
                        </td></tr>
                     ) : pageAgents.map((agent) => (
                        <AgentRow key={agent.id} agent={agent} onEdit={onEdit} onDeactivate={onDeactivate} onDelete={onDelete} perfSummary={perfByAgent[agent.id]} />
                     ))}
                  </tbody>
               </table>
            </div>
            <TablePagination total={agents.length} page={pageSafe} totalPages={totalPages} onPageChange={setPage} />
         </div>
      </div>
   );
}

// ═══════════════════════════════════════════════════════════════
// Marketers Sub-View
// ═══════════════════════════════════════════════════════════════
interface MarketerPerformance {
    id: string;
    name: string;
    pixel: string;
    product: string;
    roas: number;
    leads: number;
    is_active: boolean;
    budget: number;
}

// ═══════════════════════════════════════════════════════════════
// Assignment Rules View — configuration du moteur d'assignation
// (confirmatrices : PRODUCT > STORE > CATEGORY > BRAND, avec exceptions ;
// livreurs : COMMUNE > WILAYA, auto-assignation directe). Consomme
// /api/v1/assignment-rules — aucune logique de résolution ici, seulement
// du CRUD sur les règles ; la résolution vit côté backend
// (order_service.py resolve_assignment_rule / resolve_courier_rule).
// ═══════════════════════════════════════════════════════════════

const RULE_TYPE_LABELS: Record<string, string> = {
   PRODUCT: 'Produit', STORE: 'Boutique', CATEGORY: 'Catégorie', BRAND: 'Marque',
   COMMUNE: 'Commune', WILAYA: 'Wilaya',
};

function AssignmentRulesView({ employees }: { employees: any[] }) {
   const qc = useQueryClient();
   const [section, setSection] = useState<'confirmatrices' | 'livreurs'>('confirmatrices');

   const rulesQuery = useQuery<any>({
      queryKey: ['assignment-rules'],
      queryFn: () => apiFetch('/api/v1/assignment-rules/'),
   });
   const storesQuery = useQuery<any>({
      queryKey: ['stores'],
      queryFn: () => apiFetch('/api/v1/stores'),
   });

   const allRules: any[] = (Array.isArray(rulesQuery.data) ? rulesQuery.data : rulesQuery.data?.data) ?? [];
   const confirmatriceRules = allRules.filter(r => ['PRODUCT', 'STORE', 'CATEGORY', 'BRAND'].includes(r.rule_type));
   const courierRules = allRules.filter(r => ['COMMUNE', 'WILAYA'].includes(r.rule_type));
   const stores: any[] = (Array.isArray(storesQuery.data) ? storesQuery.data : storesQuery.data?.data) ?? [];

   const confirmatriceAgents = employees.filter(e => ['CONFIRMATEUR', 'AGENT', 'AGENT_MANAGER'].includes(e.role));
   const livreurAgents = employees.filter(e => e.role === 'LIVREUR');

   const deactivateMutation = useMutation({
      mutationFn: (ruleId: string) => apiFetch(`/api/v1/assignment-rules/${ruleId}/deactivate`, { method: 'PATCH' }),
      onSuccess: () => { qc.invalidateQueries({ queryKey: ['assignment-rules'] }); toast.success('Règle désactivée.'); },
      onError: (e: any) => toast.error(e?.message || 'Échec de la désactivation.'),
   });

   const createRuleMutation = useMutation({
      mutationFn: (payload: any) => apiFetch('/api/v1/assignment-rules/', { method: 'POST', body: JSON.stringify(payload) }),
      onSuccess: () => { qc.invalidateQueries({ queryKey: ['assignment-rules'] }); toast.success('Règle créée.'); },
      onError: (e: any) => toast.error(e?.message || 'Échec de la création — vérifiez qu\'aucune règle active ne cible déjà cette cible.'),
   });

   const courierZonesMutation = useMutation({
      mutationFn: (payload: any) => apiFetch('/api/v1/assignment-rules/courier-zones', { method: 'POST', body: JSON.stringify(payload) }),
      onSuccess: (res: any) => {
         qc.invalidateQueries({ queryKey: ['assignment-rules'] });
         const created = res?.data?.created?.length ?? 0;
         const skipped = res?.data?.skipped?.length ?? 0;
         toast.success(`${created} zone(s) associée(s)${skipped ? `, ${skipped} ignorée(s) (déjà prises)` : ''}.`);
      },
      onError: (e: any) => toast.error(e?.message || 'Échec de l\'association.'),
   });

   // ── Formulaire règle confirmatrice ──
   const [ruleType, setRuleType] = useState<'PRODUCT' | 'STORE' | 'CATEGORY' | 'BRAND'>('STORE');
   const [ruleTargetId, setRuleTargetId] = useState('');
   const [ruleAgentId, setRuleAgentId] = useState('');
   const [ruleIsExclusion, setRuleIsExclusion] = useState(false);

   // ── Formulaire zones livreur (bulk) ──
   const [courierAgentId, setCourierAgentId] = useState('');
   const [courierWilaya, setCourierWilaya] = useState('');
   const [selectedCommunes, setSelectedCommunes] = useState<string[]>([]);
   const communesForWilaya = courierWilaya ? (ALGERIAN_COMMUNES[courierWilaya] || []) : [];

   const agentName = (id: string) => employees.find(e => e.id === id)?.name || id;

   return (
      <div className="space-y-6">
         <div className="flex items-center gap-2 bg-white rounded-2xl border p-1.5 w-fit">
            {([['confirmatrices', 'Confirmatrices'], ['livreurs', 'Livreurs']] as const).map(([id, label]) => (
               <button key={id} onClick={() => setSection(id)}
                  className={cn('px-4 py-2 rounded-xl text-xs font-bold transition-all',
                     section === id ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50')}>
                  {label}
               </button>
            ))}
         </div>

         {section === 'confirmatrices' ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
               <div className="bg-white rounded-3xl border shadow-sm p-6 space-y-4">
                  <h3 className="text-sm font-black uppercase tracking-wider text-slate-800">Nouvelle règle</h3>
                  <p className="text-[11px] text-slate-400 -mt-2">Priorité : Produit &gt; Boutique &gt; Catégorie &gt; Marque — la plus spécifique gagne toujours.</p>

                  <div className="space-y-1.5">
                     <label className="text-[10px] font-bold text-slate-500 uppercase">Type de règle</label>
                     <select value={ruleType} onChange={e => { setRuleType(e.target.value as any); setRuleTargetId(''); }} className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold px-3">
                        <option value="STORE">Boutique — responsable de toute la boutique</option>
                        <option value="PRODUCT">Produit — responsable d'un produit précis (gagne même hors de sa boutique)</option>
                        <option value="CATEGORY">Catégorie</option>
                        <option value="BRAND">Marque</option>
                     </select>
                  </div>

                  <div className="space-y-1.5">
                     <label className="text-[10px] font-bold text-slate-500 uppercase">
                        {ruleType === 'STORE' ? 'Boutique' : ruleType === 'PRODUCT' ? 'ID du produit' : ruleType === 'CATEGORY' ? 'Nom de la catégorie' : 'Nom de la marque'}
                     </label>
                     {ruleType === 'STORE' ? (
                        <select value={ruleTargetId} onChange={e => setRuleTargetId(e.target.value)} className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold px-3">
                           <option value="">Sélectionner une boutique…</option>
                           {stores.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                     ) : (
                        <Input value={ruleTargetId} onChange={e => setRuleTargetId(e.target.value)}
                           placeholder={ruleType === 'PRODUCT' ? 'Coller l\'ID du produit (page Produits)' : 'Ex: Bagagerie'}
                           className="h-10 text-xs rounded-xl" />
                     )}
                  </div>

                  <div className="space-y-1.5">
                     <label className="text-[10px] font-bold text-slate-500 uppercase">Agent responsable</label>
                     <select value={ruleAgentId} onChange={e => setRuleAgentId(e.target.value)} className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold px-3">
                        <option value="">Sélectionner un agent…</option>
                        {confirmatriceAgents.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                     </select>
                  </div>

                  <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 cursor-pointer">
                     <input type="checkbox" checked={ruleIsExclusion} onChange={e => setRuleIsExclusion(e.target.checked)} className="size-4 rounded" />
                     Exception (cet agent est EXCLU de cette cible, malgré une règle plus large)
                  </label>

                  <Button
                     disabled={!ruleTargetId || !ruleAgentId || createRuleMutation.isPending}
                     onClick={() => createRuleMutation.mutate({ rule_type: ruleType, target_id: ruleTargetId, agent_id: ruleAgentId, is_exclusion: ruleIsExclusion })}
                     className="w-full h-10 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-black"
                  >
                     {createRuleMutation.isPending ? 'Création…' : 'Créer la règle'}
                  </Button>
               </div>

               <div className="lg:col-span-2 bg-white rounded-3xl border shadow-sm p-6">
                  <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 mb-4">Règles actives ({confirmatriceRules.length})</h3>
                  {rulesQuery.isLoading ? (
                     <div className="text-xs text-slate-400 font-bold py-8 text-center">Chargement…</div>
                  ) : confirmatriceRules.length === 0 ? (
                     <div className="text-xs text-slate-400 font-bold py-8 text-center italic">Aucune règle configurée — l'assignation automatique classique (spécialiste produit / boutique / moins chargé) s'applique.</div>
                  ) : (
                     <div className="space-y-2">
                        {confirmatriceRules.map((r: any) => (
                           <div key={r.id} className={cn("flex items-center justify-between p-3 rounded-2xl border", r.is_exclusion ? "bg-rose-50 border-rose-100" : "bg-slate-50 border-slate-100")}>
                              <div className="flex items-center gap-3">
                                 <Badge className={cn("text-[9px] font-black uppercase rounded-lg border-none", r.is_exclusion ? "bg-rose-100 text-rose-700" : "bg-slate-900 text-white")}>
                                    {r.is_exclusion ? 'Exception' : RULE_TYPE_LABELS[r.rule_type] || r.rule_type}
                                 </Badge>
                                 <span className="text-xs font-bold text-slate-800">{r.target_id}</span>
                                 <span className="text-xs text-slate-400">→</span>
                                 <span className="text-xs font-bold text-[#4b7bec]">{agentName(r.agent_id)}</span>
                              </div>
                              <button onClick={() => deactivateMutation.mutate(r.id)} className="text-[10px] font-black text-rose-500 hover:text-rose-700 uppercase tracking-wider">
                                 Désactiver
                              </button>
                           </div>
                        ))}
                     </div>
                  )}
               </div>
            </div>
         ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
               <div className="bg-white rounded-3xl border shadow-sm p-6 space-y-4">
                  <h3 className="text-sm font-black uppercase tracking-wider text-slate-800">Zones d'un livreur</h3>
                  <p className="text-[11px] text-slate-400 -mt-2">Les commandes de ces communes lui sont attribuées directement, sans passer par une confirmatrice.</p>

                  <div className="space-y-1.5">
                     <label className="text-[10px] font-bold text-slate-500 uppercase">Livreur</label>
                     <select value={courierAgentId} onChange={e => setCourierAgentId(e.target.value)} className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold px-3">
                        <option value="">Sélectionner un livreur…</option>
                        {livreurAgents.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                     </select>
                  </div>

                  <div className="space-y-1.5">
                     <label className="text-[10px] font-bold text-slate-500 uppercase">Wilaya</label>
                     <select value={courierWilaya} onChange={e => { setCourierWilaya(e.target.value); setSelectedCommunes([]); }} className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold px-3">
                        <option value="">Sélectionner une wilaya…</option>
                        {Object.keys(ALGERIAN_COMMUNES).map(w => <option key={w} value={w}>{w}</option>)}
                     </select>
                  </div>

                  {courierWilaya && (
                     <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Communes ({selectedCommunes.length} sélectionnée{selectedCommunes.length > 1 ? 's' : ''})</label>
                        <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-xl p-2 space-y-1 bg-slate-50">
                           {communesForWilaya.map(c => (
                              <label key={c.id} className="flex items-center gap-2 text-[11px] font-bold text-slate-600 px-2 py-1 rounded-lg hover:bg-white cursor-pointer">
                                 <input
                                    type="checkbox"
                                    checked={selectedCommunes.includes(c.nameAscii)}
                                    onChange={e => setSelectedCommunes(prev => e.target.checked ? [...prev, c.nameAscii] : prev.filter(v => v !== c.nameAscii))}
                                    className="size-3.5 rounded"
                                 />
                                 {c.nameAscii}
                              </label>
                           ))}
                        </div>
                     </div>
                  )}

                  <Button
                     disabled={!courierAgentId || selectedCommunes.length === 0 || courierZonesMutation.isPending}
                     onClick={() => courierZonesMutation.mutate({ agent_id: courierAgentId, communes: selectedCommunes })}
                     className="w-full h-10 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-black"
                  >
                     {courierZonesMutation.isPending ? 'Association…' : `Associer ${selectedCommunes.length || ''} commune${selectedCommunes.length > 1 ? 's' : ''}`}
                  </Button>
               </div>

               <div className="lg:col-span-2 bg-white rounded-3xl border shadow-sm p-6">
                  <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 mb-4">Zones actives ({courierRules.length})</h3>
                  {rulesQuery.isLoading ? (
                     <div className="text-xs text-slate-400 font-bold py-8 text-center">Chargement…</div>
                  ) : courierRules.length === 0 ? (
                     <div className="text-xs text-slate-400 font-bold py-8 text-center italic">Aucune zone configurée — toutes les commandes passent par le workflow confirmatrice normal.</div>
                  ) : (
                     <div className="space-y-2">
                        {courierRules.map((r: any) => (
                           <div key={r.id} className="flex items-center justify-between p-3 rounded-2xl border bg-slate-50 border-slate-100">
                              <div className="flex items-center gap-3">
                                 <Badge className="text-[9px] font-black uppercase rounded-lg border-none bg-slate-900 text-white">
                                    {RULE_TYPE_LABELS[r.rule_type] || r.rule_type}
                                 </Badge>
                                 <span className="text-xs font-bold text-slate-800">{r.target_id}</span>
                                 <span className="text-xs text-slate-400">→</span>
                                 <span className="text-xs font-bold text-[#4b7bec]">{agentName(r.agent_id)}</span>
                              </div>
                              <button onClick={() => deactivateMutation.mutate(r.id)} className="text-[10px] font-black text-rose-500 hover:text-rose-700 uppercase tracking-wider">
                                 Désactiver
                              </button>
                           </div>
                        ))}
                     </div>
                  )}
               </div>
            </div>
         )}
      </div>
   );
}

function MarketersView({ marketers, isLoading, onCreate }: { marketers: MarketerPerformance[]; isLoading: boolean; onCreate: () => void }) {
   if (isLoading) return <div className="p-10 flex justify-center"><Loader2 className="size-8 animate-spin text-slate-300" /></div>;

   const totalLeads = marketers.reduce((acc, m) => acc + m.leads, 0);
   const avgRoas = marketers.length > 0 ? (marketers.reduce((acc, m) => acc + m.roas, 0) / marketers.length).toFixed(2) : '0';
   const totalBudget = marketers.reduce((acc, m) => acc + m.budget, 0);

   return (
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
         {/* Marketers Header */}
         <div className="bg-white rounded-[32px] border px-8 py-7 shadow-sm flex items-center justify-between" style={{ borderColor: C.border }}>
            <div className="flex items-center gap-5">
               <div className="size-14 rounded-2xl flex items-center justify-center bg-orange-50 text-orange-500 shadow-inner">
                  <Megaphone className="size-7" />
               </div>
               <div>
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight">Marketing & Affiliés</h2>
                  <p className="text-sm font-medium text-slate-400 mt-1">Acquisition de trafic et tracking de performance (Temps réel)</p>
               </div>
            </div>
            <Button onClick={onCreate} className="h-11 px-8 rounded-2xl text-xs font-bold bg-[#4b7bec] hover:bg-[#3867d6] text-white shadow-lg shadow-indigo-100 transition-all flex items-center group border-none">
               <Plus className="mr-2 size-4 text-white transition-transform group-hover:scale-110" /> Nouveau partenaire
            </Button>
         </div>

         {/* Distribution KPIs */}
         <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
               { label: 'Leads générés', val: totalLeads.toLocaleString(), diff: '+12%', color: 'orange' },
               { label: 'ROAS moyen', val: `x${avgRoas}`, dot: 'emerald' },
               { label: 'Budget géré', val: formatPrice(totalBudget), dot: 'indigo' },
               { label: 'Partenaires actifs', val: marketers.filter(m => m.is_active).length.toString(), pulse: true },
            ].map((kpi, i) => (
               <div key={i} className="bg-white rounded-3xl border p-6 hover:shadow-md transition-all" style={{ borderColor: C.border }}>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">{kpi.label}</p>
                  <div className="flex items-center justify-between">
                     <span className="text-2xl font-bold text-slate-900 tracking-tighter">{kpi.val}</span>
                     {kpi.diff && <span className="px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-600 text-[10px] font-bold">+{kpi.diff}</span>}
                     {kpi.dot && <div className={`size-2 rounded-full bg-${kpi.dot}-500 shadow-[0_0_8px_currentColor]`} />}
                     {kpi.pulse && <Activity className="size-4 text-emerald-500 animate-pulse" />}
                  </div>
               </div>
            ))}
         </div>

         {/* Filters & Table */}
         <div className="bg-white rounded-[32px] border shadow-sm overflow-hidden" style={{ borderColor: C.border }}>
            <div className="px-8 py-6 border-b flex items-center justify-between bg-slate-50/30" style={{ borderColor: C.border }}>
               <div className="relative max-w-sm flex-1">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-300" />
                  <Input placeholder="Rechercher un marketer..." className="pl-10 h-11 bg-white border-slate-100 rounded-2xl text-sm font-medium" />
               </div>
            </div>
            
            <div className="overflow-x-auto">
               <table className="w-full text-left min-w-[1100px]">
                  <thead>
                     <tr className="border-b" style={{ borderColor: C.border, backgroundColor: '#FAFBFD' }}>
                        <th className="px-8 py-5 text-xs font-bold text-slate-500">Partenaire</th>
                        <th className="px-8 py-5 text-xs font-bold text-slate-500">Tracking (Pixel)</th>
                        <th className="px-8 py-5 text-xs font-bold text-slate-500 text-center">Performance</th>
                        <th className="px-8 py-5 text-xs font-bold text-slate-500 text-center">ROAS</th>
                        <th className="px-8 py-5 text-xs font-bold text-slate-500 text-right">Actions</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: C.border }}>
                     {marketers.map((m) => (
                        <tr key={m.id} className="hover:bg-slate-50/50 transition-all group">
                           <td className="px-8 py-6">
                              <div className="flex items-center gap-4">
                                 <div className="size-11 rounded-2xl flex items-center justify-center text-sm font-bold text-orange-500 bg-orange-50 active:scale-95 transition-transform">{m.name.charAt(0)}</div>
                                 <div className="flex flex-col">
                                    <span className="text-sm font-bold text-slate-900 group-hover:text-[#4b7bec] transition-colors">{m.name}</span>
                                    <span className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-wider">Agence Certifiée</span>
                                 </div>
                              </div>
                           </td>
                           <td className="px-8 py-6">
                              <code className="text-[11px] font-bold font-mono text-slate-500 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100 tracking-tight">{m.pixel}</code>
                           </td>
                           <td className="px-8 py-6 text-center">
                              <div className="flex flex-col items-center">
                                 <span className="text-sm font-bold text-slate-900">{m.leads.toLocaleString()}</span>
                                 <span className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tight">Leads générés</span>
                              </div>
                           </td>
                           <td className="px-8 py-6 text-center">
                              <div className="inline-flex flex-col items-center px-4 py-2 rounded-2xl bg-indigo-50 border border-indigo-100">
                                 <span className="text-xs font-bold text-indigo-600">x{m.roas}</span>
                                 <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-tighter mt-1">Efficiency</span>
                              </div>
                           </td>
                           <td className="px-8 py-6 text-right">
                              <div className="flex items-center justify-end gap-2">
                                 <button className="size-10 rounded-xl flex items-center justify-center bg-white border border-slate-100 text-slate-300 hover:text-[#4b7bec] hover:border-[#4b7bec] transition-all shadow-sm"><Pencil className="size-4" /></button>
                              </div>
                           </td>
                        </tr>
                     ))}
                  </tbody>
               </table>
            </div>
         </div>
      </div>
   );
}

// ═══════════════════════════════════════════════════════════════
// Employee Form Dialog (CODpilot Style)
// ═══════════════════════════════════════════════════════════════
function EmployeeFormDialog({ open, onOpenChange, editingEmployee, storeId, createMutation, updateMutation }: {
   open: boolean; onOpenChange: (open: boolean) => void; editingEmployee: any | null; storeId: string;
    createMutation: ReturnType<typeof useMutation<any, Error, Record<string, unknown>>>;
    updateMutation: ReturnType<typeof useMutation<any, Error, { id: string; data: Record<string, unknown> }>>;
}) {
   const isEditing = !!editingEmployee;
   const [productSearch, setProductSearch] = useState('');
   const { data: storesData } = useQuery({
      queryKey: ['stores-list'],
      queryFn: () => apiFetch<any>('/api/v1/stores'),
   });
   const storesList: any[] = Array.isArray(storesData) ? storesData : (storesData?.data ?? []);

   const { data: allProductsData } = useQuery({
      queryKey: ['all-products-list'],
      queryFn: () => apiFetch<any>('/api/v1/products?minimal=true&pageSize=100', { allStores: true }),
      enabled: open,
   });
   const productsList = (Array.isArray(allProductsData) ? allProductsData : (allProductsData?.data ?? [])) as Product[];

   // Conflict awareness: a PRODUCT/STORE Assignment Rule (Règles
   // d'Assignation widget) always wins over this form's Produits/Boutique
   // Assignés for a CONFIRMATEUR (see resolve_assignment_rule) — assigning
   // a product here to someone a rule already claims for a DIFFERENT agent
   // is exactly the silent-conflict configuration mistake that caused
   // orders to keep routing to the wrong confirmatrice (2026-07-22 fix).
   // Surfaced here so the admin sees it BEFORE saving, not after.
   const { data: assignmentRulesData } = useQuery({
      queryKey: ['assignment-rules-for-conflict-check'],
      queryFn: () => apiFetch<any>('/api/v1/assignment-rules/?active_only=true'),
      enabled: open,
   });
   const activeRules: any[] = assignmentRulesData?.data ?? [];
   const productRuleOwner: Record<string, { agentId: string; agentName: string }> = {};
   const storeRuleOwner: Record<string, { agentId: string; agentName: string }> = {};
   for (const r of activeRules) {
      if (r.is_exclusion) continue;
      const owner = { agentId: r.agent_id, agentName: r.agent_name || r.agent_id };
      if (r.rule_type === 'PRODUCT') productRuleOwner[r.target_id] = owner;
      if (r.rule_type === 'STORE') storeRuleOwner[r.target_id] = owner;
   }

   const [formData, setFormData] = useState({
      name: '', email: '', password: '', phone: '',
      role: '' as UserRole | '', daily_target: 10, is_active: true,
      payment_type: '' as 'PER_DELIVERED_ORDER' | 'MONTHLY_SALARY' | '',
      payment_amount: '' as number | '',
      payment_recovered_cart: '' as number | '',
      payment_lost_cart: '' as number | '',
      payment_upsell: '' as number | '',
      payment_marketplace_upsell_only: '' as number | '',
      payment_store_pickup: 100 as number | '',
      payment_recovered_store_pickup: 150 as number | '',
      assigned_store_scope: 'ALL' as 'ALL' | 'SPECIFIC',
      assigned_store_ids: [] as string[],
      assigned_product_ids: [] as string[],
      permissions: [] as string[],
      module_visibility: {} as Record<string, boolean>,
   });
   const [errors, setErrors] = useState<Record<string, string>>({});
   const isSubmitting = createMutation.isPending || updateMutation.isPending;

   // Products always shown from ALL stores — a confirmateur can be responsible
   // for specific products across multiple different stores.
   const filteredProducts = productsList;

   React.useEffect(() => {
      if (open && editingEmployee) {
         setFormData({
            name: editingEmployee.name || '',
            email: editingEmployee.email || '',
            password: '',
            phone: editingEmployee.phone || '',
            role: editingEmployee.role,
            daily_target: editingEmployee.daily_target || 10,
            is_active: editingEmployee.is_active ?? true,
            payment_type: editingEmployee.payment_type || '',
            payment_amount: editingEmployee.payment_amount ?? '',
            payment_recovered_cart: editingEmployee.payment_recovered_cart ?? '',
            payment_lost_cart: editingEmployee.payment_lost_cart ?? '',
            payment_upsell: editingEmployee.payment_upsell ?? '',
            payment_marketplace_upsell_only: editingEmployee.payment_marketplace_upsell_only ?? '',
            payment_store_pickup: editingEmployee.payment_store_pickup ?? 100,
            payment_recovered_store_pickup: editingEmployee.payment_recovered_store_pickup ?? 150,
            assigned_store_scope: editingEmployee.assigned_store_ids?.length > 0 ? 'SPECIFIC' : (editingEmployee.assigned_store_id ? 'SPECIFIC' : 'ALL'),
            assigned_store_ids: editingEmployee.assigned_store_ids || (editingEmployee.assigned_store_id ? [editingEmployee.assigned_store_id] : []),
            assigned_product_ids: editingEmployee.assigned_product_ids || [],
            permissions: editingEmployee.permissions || [],
            module_visibility: editingEmployee.module_visibility || { orders: true, inventory: true, deliveries: true, transfers: true, returns: true, analytics: true, products: true, customers: true, finances: true, promotions: true },
         });
      } else if (open) {
         setFormData({ name: '', email: '', password: '', phone: '', role: '', daily_target: 10, is_active: true, payment_type: '', payment_amount: '', payment_recovered_cart: '', payment_lost_cart: '', payment_upsell: '', payment_marketplace_upsell_only: '', payment_store_pickup: 100, payment_recovered_store_pickup: 150, assigned_store_scope: 'ALL', assigned_store_ids: [], assigned_product_ids: [], permissions: [], module_visibility: { orders: true, inventory: true, deliveries: true, transfers: true, returns: true, analytics: true, products: true, customers: true, finances: true, promotions: true } });
      }
      setErrors({});
   }, [open, editingEmployee]);

   const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      const errs: Record<string, string> = {};
      if (!formData.name || formData.name.trim().length < 2) errs.name = 'Le nom est requis';
      if (!isEditing && (!formData.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email))) errs.email = 'Email invalide';
      if (!isEditing && (!formData.password || formData.password.length < 6)) errs.password = 'Min. 6 caractères';
      if (!formData.role) errs.role = 'Rôle requis';
      if (Object.keys(errs).length > 0) { setErrors(errs); return; }

      const paymentPayload = {
         payment_type: formData.payment_type || null,
         payment_amount: formData.payment_type ? (Number(formData.payment_amount) || 0) : null,
         payment_recovered_cart: Number(formData.payment_recovered_cart) || 0,
         payment_lost_cart: Number(formData.payment_lost_cart) || 0,
         payment_upsell: Number(formData.payment_upsell) || 0,
         payment_marketplace_upsell_only: Number(formData.payment_marketplace_upsell_only) || 50,
         payment_store_pickup: Number(formData.payment_store_pickup) || 100,
         payment_recovered_store_pickup: Number(formData.payment_recovered_store_pickup) || 150,
      };

      const storePayload = formData.assigned_store_scope === 'SPECIFIC'
         ? { assigned_store_ids: formData.assigned_store_ids }
         : { assigned_store_ids: [] };

      const productsPayload = { assigned_product_ids: formData.assigned_product_ids };
      const accessPayload = { permissions: formData.permissions || [], module_visibility: formData.module_visibility || {} };

      if (isEditing && editingEmployee) {
         updateMutation.mutate({
            id: editingEmployee.id,
            data: {
               name: formData.name.trim(),
               email: formData.email.trim().toLowerCase(),
               phone: formData.phone.trim(),
               role: formData.role,
               daily_target: formData.daily_target,
               is_active: formData.is_active,
               ...paymentPayload,
               ...storePayload,
               ...productsPayload,
               ...accessPayload,
            }
         }, { onSuccess: () => onOpenChange(false) });
      } else {
         createMutation.mutate({
            name: formData.name.trim(),
            email: formData.email.trim().toLowerCase(),
            password: formData.password,
            phone: formData.phone.trim() || undefined,
            role: formData.role || 'CONFIRMATEUR',
            daily_target: formData.daily_target,
            ...(storeId ? { employee_store_id: storeId } : {}),
            ...storePayload,
            ...productsPayload,
            ...paymentPayload,
            ...accessPayload,
         }, {
            onSuccess: () => onOpenChange(false),
            onError: (err: any) => {
               const msg: string = err?.message || '';
               if (msg.toLowerCase().includes('courriel') || msg.toLowerCase().includes('email') || msg.toLowerCase().includes('utilisé')) {
                  setErrors({ email: msg || 'Cette adresse email est déjà utilisée' });
               } else {
                  toast.error(msg || 'Erreur lors de la création');
               }
            }
         });
      }
   };

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent className="bg-white border-[#E9ECF0] max-w-3xl w-[96vw] p-0 rounded-[40px] shadow-2xl">
            <div className="px-6 py-4 border-b flex items-center gap-3" style={{ borderColor: C.border }}>
               <div className="size-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: C.primaryBg }}>
                  <Users className="size-4" style={{ color: C.primary }} />
               </div>
               <DialogTitle className="text-sm font-bold text-[#2D3436]">{isEditing ? 'Modifier l\'employé' : 'Nouvel employé'}</DialogTitle>
            </div>
            <form onSubmit={handleSubmit} className="p-0">
               <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 max-h-[65vh] overflow-y-auto custom-scrollbar">
                  {/* Informations Générales */}
                  <div className="space-y-4">
                     <h4 className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3] pb-2 border-b" style={{ borderColor: C.border }}>Informations Générales</h4>
                     <div className="space-y-1.5">
                        <Label className="text-[11px] font-semibold text-[#636E72]">Nom complet *</Label>
                        <Input value={formData.name} onChange={(e) => setFormData(p => ({ ...p, name: e.target.value }))} className="h-10 border-[#E9ECF0] rounded-lg focus:border-[#6C5CE7] bg-[#F8F9FC]" />
                        {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
                     </div>
                     {!isEditing && (
                        <>
                           <div className="space-y-1.5">
                              <Label className="text-[11px] font-semibold text-[#636E72]">Email *</Label>
                              <Input type="email" value={formData.email} onChange={(e) => setFormData(p => ({ ...p, email: e.target.value }))} className="h-10 border-[#E9ECF0] rounded-lg focus:border-[#6C5CE7] bg-[#F8F9FC]" />
                              {errors.email && <p className="text-xs text-red-500">{errors.email}</p>}
                           </div>
                           <div className="space-y-1.5">
                              <Label className="text-[11px] font-semibold text-[#636E72]">Mot de passe *</Label>
                              <Input type="password" value={formData.password} onChange={(e) => setFormData(p => ({ ...p, password: e.target.value }))} className="h-10 border-[#E9ECF0] rounded-lg focus:border-[#6C5CE7] bg-[#F8F9FC]" />
                              {errors.password && <p className="text-xs text-red-500">{errors.password}</p>}
                           </div>
                        </>
                     )}
                     <div className="space-y-1.5">
                        <Label className="text-[11px] font-semibold text-[#636E72]">Téléphone</Label>
                        <Input value={formData.phone} onChange={(e) => setFormData(p => ({ ...p, phone: e.target.value }))} placeholder="0555 12 34 56" className="h-10 border-[#E9ECF0] rounded-lg bg-[#F8F9FC]" />
                     </div>
                  </div>

                  {/* Sécurité & Assignation */}
                  <div className="space-y-4">
                     <h4 className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3] pb-2 border-b" style={{ borderColor: C.border }}>Sécurité & Assignation</h4>
                     <div className="space-y-1.5">
                        <Label className="text-[11px] font-semibold text-[#636E72]">Rôle Système *</Label>
                        <Select value={formData.role} onValueChange={(val) => setFormData(p => ({ ...p, role: val as UserRole }))}>
                           <SelectTrigger className="h-10 border-[#E9ECF0] rounded-lg bg-[#F8F9FC]"><SelectValue placeholder="Sélectionner un rôle" /></SelectTrigger>
                           <SelectContent className="bg-white border-[#E9ECF0] rounded-xl">
                              {ROLE_OPTIONS.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                           </SelectContent>
                        </Select>
                        {errors.role && <p className="text-xs text-red-500">{errors.role}</p>}
                     </div>
                     
                      <div className="space-y-2 p-4 rounded-xl border bg-indigo-50/30" style={{ borderColor: '#e0e7ff' }}>
                        <Label className="text-[11px] font-semibold text-[#636E72] flex items-center justify-between">
                           Produits Assignés
                           <span className="text-[9px] font-black text-indigo-500 uppercase">{formData.assigned_product_ids.length} sélectionnés</span>
                        </Label>
                        
                        <div className="relative mb-2">
                           <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3 text-slate-400" />
                           <Input 
                              placeholder="Rechercher un produit..." 
                              className="h-8 pl-8 text-[10px] border-indigo-100 bg-white"
                              onChange={(e) => {
                                 const val = e.target.value.toLowerCase();
                                 setProductSearch(val);
                              }}
                           />
                        </div>

                        <div className="max-h-[150px] overflow-y-auto custom-scrollbar space-y-1.5 pr-1">
                           {filteredProducts
                             .filter(p => p.name.toLowerCase().includes(productSearch))
                             .map((prod: any) => {
                              // A PRODUCT or STORE rule already claiming this
                              // product for a DIFFERENT agent always wins over
                              // this checkbox (resolve_assignment_rule) — flag
                              // it here so the conflict is visible BEFORE
                              // saving, not discovered later as "orders keep
                              // going to the wrong person".
                              const owner = productRuleOwner[prod.id] || storeRuleOwner[prod.store_id];
                              const isConflict = !!owner && owner.agentId !== editingEmployee?.id;
                              return (
                              <button
                                 key={prod.id}
                                 type="button"
                                 onClick={() => {
                                    const exist = formData.assigned_product_ids.includes(prod.id);
                                    setFormData(p => ({
                                       ...p,
                                       assigned_product_ids: exist
                                          ? p.assigned_product_ids.filter(id => id !== prod.id)
                                          : [...p.assigned_product_ids, prod.id]
                                    }));
                                 }}
                                 className={cn(
                                    "w-full flex items-center justify-between px-3 py-2 rounded-lg text-[10px] font-bold border transition-all",
                                    formData.assigned_product_ids.includes(prod.id) ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-600 border-slate-100 hover:border-indigo-200"
                                 )}
                              >
                                 <div className="flex flex-col items-start truncate">
                                    <span className="truncate">{prod.name}</span>
                                    <span className="text-[8px] opacity-60 uppercase tracking-wider">{storesList.find(s => s.id === prod.store_id)?.name || 'Boutique Inconnue'}</span>
                                    {isConflict && (
                                       <span className="text-[8px] font-black text-amber-600 uppercase tracking-wider" title="Une règle d'assignation (Produit/Boutique) plus prioritaire donnera toujours cette commande à cet agent, quoi que vous cochiez ici.">
                                          ⚠ Déjà assigné à {owner!.agentName} par une règle
                                       </span>
                                    )}
                                 </div>
                                 {formData.assigned_product_ids.includes(prod.id) ? <Check className="size-3" /> : <Plus className="size-3 text-slate-300" />}
                              </button>
                              );
                           })}
                           {filteredProducts.filter(p => p.name.toLowerCase().includes(productSearch)).length === 0 && (
                              <div className="text-center py-6 border-2 border-dashed border-slate-100 rounded-xl">
                                 <Package className="size-6 mx-auto mb-2 text-slate-200" />
                                 <p className="text-[10px] text-slate-300 italic">Aucun produit trouvé</p>
                              </div>
                           )}
                        </div>
                        <p className="text-[9px] text-slate-400 leading-tight">
                           Le confirmateur reçoit les commandes de <strong>toutes les boutiques</strong> contenant ses produits assignés, peu importe la boutique d'origine.
                        </p>
                      </div>

                     <div className="space-y-1.5">
                        <Label className="text-[11px] font-semibold text-[#636E72]">Objectif Quotidien (KPI)</Label>
                        <div className="flex items-center gap-2">
                           <Input type="number" value={formData.daily_target} min={1} max={500} onChange={e => setFormData(p => ({ ...p, daily_target: parseInt(e.target.value) || 10 }))} className="h-10 border-[#E9ECF0] rounded-lg flex-1 bg-[#F8F9FC]" />
                           <span className="text-[10px] font-bold text-[#B2BEC3] uppercase">Commandes/Jour</span>
                        </div>
                     </div>

                     {/* ── Boutique assignée ── */}
                     <div className="space-y-2 p-4 rounded-xl border bg-blue-50/40" style={{ borderColor: '#bfdbfe' }}>
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-blue-700 flex items-center gap-2">
                           <Shield className="size-3.5" /> Boutique assignée
                        </h4>
                        <div className="flex gap-2">
                           {(['ALL', 'SPECIFIC'] as const).map(scope => (
                              <button
                                 key={scope}
                                 type="button"
                                 onClick={() => setFormData(p => ({ ...p, assigned_store_scope: scope, assigned_store_id: '' }))}
                                 className={`flex-1 h-9 rounded-lg text-[10px] font-black uppercase tracking-wider border-2 transition-all ${formData.assigned_store_scope === scope ? 'border-blue-400 bg-blue-100 text-blue-700' : 'border-slate-100 bg-white text-slate-400'}`}
                              >
                                 {scope === 'ALL' ? 'Toutes les boutiques' : 'Boutique spécifique'}
                              </button>
                           ))}
                        </div>
                        {formData.assigned_store_scope === 'SPECIFIC' && (
                           <div className="space-y-3">
                              <Label className="text-[10px] font-bold text-slate-500 uppercase">Choisir les boutiques</Label>
                              <div className="grid grid-cols-2 gap-2">
                                 {storesList.map((s: any) => (
                                    <button
                                       key={s.id}
                                       type="button"
                                       onClick={() => {
                                          const exist = formData.assigned_store_ids.includes(s.id);
                                          setFormData(p => ({
                                             ...p,
                                             assigned_store_ids: exist 
                                                ? p.assigned_store_ids.filter(id => id !== s.id)
                                                : [...p.assigned_store_ids, s.id]
                                          }));
                                       }}
                                       className={cn(
                                          "flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-bold border transition-all",
                                          formData.assigned_store_ids.includes(s.id) ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-100 hover:border-blue-200"
                                       )}
                                    >
                                       {formData.assigned_store_ids.includes(s.id) ? <Check className="size-3" /> : <Plus className="size-3" />}
                                       <span className="truncate">{s.name}</span>
                                    </button>
                                 ))}
                              </div>
                           </div>
                        )}
                        <p className="text-[10px] text-slate-400">
                           {formData.assigned_store_scope === 'ALL' ? 'Accès à toutes les boutiques' : `${formData.assigned_store_ids.length} boutique(s) sélectionnée(s)`}
                        </p>
                     </div>

                     {/* ── Rémunération ── */}
                     <div className="mt-5 space-y-3 p-4 rounded-xl border bg-emerald-50/40" style={{ borderColor: '#d1fae5' }}>
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-emerald-700 flex items-center gap-2">
                           <Banknote className="size-3.5" /> Configuration de Rémunération
                        </h4>
                        <div className="space-y-1.5">
                           <Label className="text-[11px] font-semibold text-[#636E72]">Mode de paiement</Label>
                           <Select
                              value={formData.payment_type}
                              onValueChange={(val) => setFormData(p => ({ ...p, payment_type: val as any, payment_amount: '' }))}
                           >
                              <SelectTrigger className="h-10 border-emerald-100 rounded-lg bg-white">
                                 <SelectValue placeholder="Choisir un mode..." />
                              </SelectTrigger>
                              <SelectContent className="bg-white border-[#E9ECF0] rounded-xl">
                                 <SelectItem value="PER_DELIVERED_ORDER">Par livraison (par commande livrée)</SelectItem>
                                 <SelectItem value="MONTHLY_SALARY">Salaire mensuel fixe</SelectItem>
                              </SelectContent>
                           </Select>
                        </div>
                        {formData.payment_type && (
                           <div className="space-y-1.5">
                              <Label className="text-[11px] font-semibold text-[#636E72]">
                                 {formData.payment_type === 'PER_DELIVERED_ORDER' ? 'Montant par livraison (DA)' : 'Salaire mensuel (DA)'}
                              </Label>
                              <div className="relative">
                                 <Input
                                    type="number"
                                    min={0}
                                    value={formData.payment_amount}
                                    onChange={e => setFormData(p => ({ ...p, payment_amount: e.target.value === '' ? '' : Number(e.target.value) }))}
                                    placeholder={formData.payment_type === 'MONTHLY_SALARY' ? 'Ex: 35000' : 'Ex: 400'}
                                    className="h-10 border-emerald-100 rounded-lg bg-white pr-12 font-black"
                                 />
                                 <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400">DA</span>
                              </div>
                              <p className="text-[10px] text-slate-400">
                                 {formData.payment_type === 'PER_DELIVERED_ORDER'
                                    ? 'Calculé uniquement sur les commandes avec statut LIVRÉ'
                                    : 'Versé indépendamment du nombre de commandes traitées'}
                              </p>
                           </div>
                        )}

                        <div className="border-t border-emerald-100/50 pt-3 mt-3 space-y-3">
                           <h5 className="text-[9px] font-black uppercase tracking-wider text-emerald-800">
                              Commission récupération panier abandonné
                           </h5>
                           <div className="space-y-1.5">
                               <Label className="text-[10px] font-semibold text-[#636E72]">Panier récupéré (DA)</Label>
                               <div className="relative">
                                  <Input
                                     type="number"
                                     min={0}
                                     value={formData.payment_recovered_cart}
                                     onChange={e => setFormData(p => ({ ...p, payment_recovered_cart: e.target.value === '' ? '' : Number(e.target.value) }))}
                                     placeholder="Ex: 500"
                                     className="h-10 border-emerald-100 rounded-lg bg-white pr-12 font-black text-xs"
                                  />
                                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-400">DA</span>
                               </div>
                            </div>
                            <p className="text-[9px] text-[#4b6584] leading-normal font-medium">
                               La commission panier récupéré s'applique sur les paniers abandonnés récupérés qui passent à Livré.
                            </p>
                        </div>

                        <div className="border-t border-emerald-100/50 pt-3 mt-3 space-y-3">
                           <h5 className="text-[9px] font-black uppercase tracking-wider text-emerald-800">
Commission Upsell
                           </h5>
                           <div className="space-y-1.5">
                               <Label className="text-[10px] font-semibold text-[#636E72]">Commande Upsell livrée (DA)</Label>
                               <div className="relative">
                                  <Input
                                     type="number"
                                     min={0}
                                     value={formData.payment_upsell}
                                     onChange={e => setFormData(p => ({ ...p, payment_upsell: e.target.value === '' ? '' : Number(e.target.value) }))}
                                     placeholder="Ex: 250"
                                     className="h-10 border-emerald-100 rounded-lg bg-white pr-12 font-black text-xs"
                                  />
                                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-400">DA</span>
                               </div>
                            </div>
                            <p className="text-[9px] text-[#4b6584] leading-normal font-medium">
                               Bonus versé EN PLUS de sa commission normale pour chaque commande contenant un produit ajouté en upsell, une fois livrée.
                            </p>
                        </div>

                        <div className="border-t border-emerald-100/50 pt-3 mt-3 space-y-3">
                           <h5 className="text-[9px] font-black uppercase tracking-wider text-emerald-800">
                              Commissions Retrait Point de Vente (Vente Directe)
                           </h5>
                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className="space-y-1.5">
                                 <Label className="text-[10px] font-semibold text-[#636E72]">Point de Vente - Normale (DA)</Label>
                                 <div className="relative">
                                    <Input
                                       type="number"
                                       min={0}
                                       value={formData.payment_store_pickup}
                                       onChange={e => setFormData(p => ({ ...p, payment_store_pickup: e.target.value === '' ? '' : Number(e.target.value) }))}
                                       placeholder="Ex: 100"
                                       className="h-10 border-emerald-100 rounded-lg bg-white pr-12 font-black text-xs"
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-400">DA</span>
                                 </div>
                              </div>
                              <div className="space-y-1.5">
                                 <Label className="text-[10px] font-semibold text-[#636E72]">Point de Vente - Panier Récupéré (DA)</Label>
                                 <div className="relative">
                                    <Input
                                       type="number"
                                       min={0}
                                       value={formData.payment_recovered_store_pickup}
                                       onChange={e => setFormData(p => ({ ...p, payment_recovered_store_pickup: e.target.value === '' ? '' : Number(e.target.value) }))}
                                       placeholder="Ex: 150"
                                       className="h-10 border-emerald-100 rounded-lg bg-white pr-12 font-black text-xs"
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-400">DA</span>
                                 </div>
                              </div>
                           </div>
                           <p className="text-[9px] text-[#4b6584] leading-normal font-medium">
                              Commission attribuée lorsque le client récupère sa commande directement en magasin (100 DA normale par défaut, 150 DA si panier récupéré).
                           </p>
                        </div>

                        <div className="border-t border-emerald-100/50 pt-3 mt-3 space-y-3">
                           <h5 className="text-[9px] font-black uppercase tracking-wider text-emerald-800">
                              Commission Marketplace (50 DA)
                           </h5>
                           <div className="space-y-1.5">
                               <Label className="text-[10px] font-semibold text-[#636E72]">Commande Marketplace livrée (DA)</Label>
                               <div className="relative">
                                  <Input
                                     type="number"
                                     min={0}
                                     value={formData.payment_marketplace_upsell_only}
                                     onChange={e => setFormData(p => ({ ...p, payment_marketplace_upsell_only: e.target.value === '' ? '' : Number(e.target.value) }))}
                                     placeholder="Ex: 50"
                                     className="h-10 border-emerald-100 rounded-lg bg-white pr-12 font-black text-xs"
                                  />
                                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-400">DA</span>
                               </div>
                            </div>
                            <p className="text-[9px] text-[#4b6584] leading-normal font-medium">
                               Commission fixe de 50 DA (par défaut) attribuée à la confirmatrice pour chaque commande marketplace livrée (remplace la commission normale).
                            </p>
                        </div>
                     </div>

                     {/* ── Droits d'Accès & Visibilité des Modules (Livreur & rôles personnalisés) ── */}
                     {(formData.role === 'LIVREUR' || formData.role === 'CONFIRMATEUR') && (
                        <div className="mt-5 space-y-4 p-4 rounded-2xl border bg-purple-50/50 border-purple-200">
                           <h4 className="text-[10px] font-black uppercase tracking-widest text-purple-700 flex items-center gap-2">
                              <ShieldCheck className="size-4" /> Droits d'Accès & Visibilité des Modules
                           </h4>
                           <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                              Gérez précisément les permissions de modification et la visibilité des onglets pour cet utilisateur.
                           </p>

                           <div className="space-y-2.5 pt-3 border-t border-purple-200/60">
                              <Label className="text-[10px] font-black text-purple-900 uppercase tracking-wider">Permissions d'action</Label>
                              <div className="space-y-2 bg-white p-3.5 rounded-xl border border-purple-100 shadow-sm">
                                 {[
                                    { id: 'stock.view_all_stores', label: 'Voir l\'inventaire de toutes les boutiques', desc: 'Permet au livreur/agent de consulter les stocks de l\'ensemble des boutiques.' },
                                    { id: 'stock.adjust', label: 'Modifier les niveaux d\'inventaire', desc: 'Autorise la modification directe du stock des produits et variantes.' },
                                    { id: 'orders.edit', label: 'Modifier les détails de la commande', desc: 'Autoriser la modification des prix ou des adresses clients.' },
                                    { id: 'deliveries.view_finance', label: 'Accès au bilan financier des livraisons', desc: 'Afficher les fonds encaisseurs et reliquats de livraison.' },
                                 ].map(perm => {
                                    const isChecked = (formData.permissions || []).includes(perm.id);
                                    return (
                                       <div key={perm.id} className="flex items-center justify-between gap-4 py-1.5 border-b border-slate-50 last:border-0">
                                          <div>
                                             <p className="text-[11px] font-bold text-slate-800">{perm.label}</p>
                                             <p className="text-[9px] font-medium text-slate-400 mt-0.5">{perm.desc}</p>
                                          </div>
                                          <Switch
                                             checked={isChecked}
                                             onCheckedChange={(chk) => {
                                                setFormData(p => ({
                                                   ...p,
                                                   permissions: chk
                                                      ? [...(p.permissions || []), perm.id]
                                                      : (p.permissions || []).filter(id => id !== perm.id)
                                                }));
                                             }}
                                          />
                                       </div>
                                    );
                                 })}
                              </div>
                           </div>

                           <div className="space-y-2.5 pt-3 border-t border-purple-200/60">
                              <Label className="text-[10px] font-black text-purple-900 uppercase tracking-wider">Visibilité des modules du menu</Label>
                              <div className="grid grid-cols-2 gap-2">
                                 {[
                                    { id: 'orders', label: '📦 Commandes Assignées' },
                                    { id: 'inventory', label: '📊 Inventaire & Stocks' },
                                    { id: 'deliveries', label: '🚚 Bords de Livraison' },
                                    { id: 'transfers', label: '🔄 Transferts de Stock' },
                                    { id: 'returns', label: '🔁 Retours & Échanges' },
                                    { id: 'analytics', label: '📈 Métriques & KPIs' },
                                 ].map(mod => {
                                    const isVisible = (formData.module_visibility?.[mod.id] ?? true);
                                    return (
                                       <button
                                          key={mod.id}
                                          type="button"
                                          onClick={() => {
                                             setFormData(p => ({
                                                ...p,
                                                module_visibility: {
                                                   ...(p.module_visibility || {}),
                                                   [mod.id]: !isVisible
                                                }
                                             }));
                                          }}
                                          className={cn(
                                             "flex items-center justify-between px-3 py-2 rounded-xl text-[10px] font-bold border transition-all shadow-sm",
                                             isVisible ? "bg-purple-600 text-white border-purple-600" : "bg-white text-slate-400 border-slate-200 hover:border-purple-300"
                                          )}
                                       >
                                          <span className="truncate">{mod.label}</span>
                                          {isVisible ? <Check className="size-3 shrink-0 ml-1" /> : <X className="size-3 text-slate-300 shrink-0 ml-1" />}
                                       </button>
                                    );
                                 })}
                              </div>
                           </div>
                        </div>
                     )}

                     <div className="flex flex-col gap-2 p-3 mt-4 rounded-lg border bg-[#F8F9FC]" style={{ borderColor: C.border }}>
                        <div className="flex items-center justify-between">
                           <Label className="text-[11px] font-bold text-[#2D3436]">Compte Actif</Label>
                           <Switch checked={formData.is_active} onCheckedChange={(c) => setFormData(p => ({ ...p, is_active: c }))} />
                        </div>
                     </div>
                  </div>
               </div>
               <DialogFooter className="px-6 py-4 border-t flex gap-3 bg-[#F8F9FC]" style={{ borderColor: C.border }}>
                  <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="text-xs font-semibold text-[#636E72]">Annuler</Button>
                  <Button type="submit" disabled={isSubmitting} className="text-xs font-bold text-white rounded-lg" style={{ backgroundColor: C.primary }}>
                     {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                     {isEditing ? 'Enregistrer' : 'Créer'}
                  </Button>
               </DialogFooter>
            </form>
         </DialogContent>
      </Dialog>
   );
}

// ═══════════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════════
export default function EmployeesPage() {
   const { activeStore, adminSubView } = useAppStore();
   const storeId = activeStore?.id ?? '';
   const queryClient = useQueryClient();
   const [activeTab, setActiveTab] = useState(adminSubView || 'agents');
   const [formDialogOpen, setFormDialogOpen] = useState(false);
   const [editingEmployee, setEditingEmployee] = useState<any | null>(null);
   const [deactivateTarget, setDeactivateTarget] = useState<any | null>(null);
   const [newRoleModalOpen, setNewRoleModalOpen] = useState(false);
   const [startDate, setStartDate] = useState('');
   const [endDate, setEndDate] = useState('');

   React.useEffect(() => {
      if (!adminSubView) return;
      const MAP: Record<string, string> = {
         roles: 'roles', 'Rôles': 'roles',
         admins: 'admins', Administrateurs: 'admins',
         agents: 'agents', Agents: 'agents',
         marketers: 'marketers', Marketers: 'marketers',
         infra: 'infra', Infrastructure: 'infra', 'Infrastructure Core': 'infra',
      };
      const mapped = MAP[adminSubView];
      if (mapped && mapped !== activeTab) setActiveTab(mapped);
   }, [adminSubView]);

   const buildQueryStr = (basePath: string) => {
      const params = new URLSearchParams({ store_id: storeId });
      if (isValidIsoDate(startDate)) params.set('start_date', startDate + 'T00:00:00.000Z');
      if (isValidIsoDate(endDate)) params.set('end_date', endDate + 'T23:59:59.999Z');
      return `${basePath}?${params.toString()}`;
   };

   const employeesQuery = useQuery<ApiResponse<any[]>>({
      queryKey: ['employees', storeId, startDate, endDate],
      queryFn: () => apiFetch(buildQueryStr('/api/v1/users/')),
   });

   const rolesQuery = useQuery<ApiResponse<RolePermission[]>>({
      queryKey: ['employees', 'roles-matrix', storeId],
      queryFn: () => apiFetch(`/api/v1/users/roles-matrix?store_id=${storeId}`),
      enabled: !!storeId,
   });

   const infraQuery = useQuery<ApiResponse<InfrastructureStats>>({
      queryKey: ['employees', 'infra-stats', storeId, startDate, endDate],
      queryFn: () => apiFetch(buildQueryStr('/api/v1/users/infrastructure-stats')),
      enabled: true,
   });

   const marketersQuery = useQuery<ApiResponse<MarketerPerformance[]>>({
      queryKey: ['employees', 'marketers', storeId, startDate, endDate],
      queryFn: () => apiFetch(buildQueryStr('/api/v1/users/marketers')),
      enabled: !!storeId,
   });

   const auditQuery = useQuery<any>({
      queryKey: ['audit', 'recent', storeId, startDate, endDate],
      queryFn: () => {
         const params = new URLSearchParams({ store_id: storeId, pageSize: '30' });
         if (isValidIsoDate(startDate)) params.set('start_date', startDate + 'T00:00:00.000Z');
         if (isValidIsoDate(endDate)) params.set('end_date', endDate + 'T23:59:59.999Z');
         return apiFetch(`/api/v1/audit/?${params.toString()}`);
      },
   });

   const createMutation = useMutation({
      mutationFn: (data: Record<string, unknown>) =>
         apiFetch<any>('/api/v1/users/', { method: 'POST', body: JSON.stringify(data) }),
      onSuccess: () => { 
         queryClient.invalidateQueries({ queryKey: ['employees', storeId] }); 
         toast.success('Employé créé'); 
         setFormDialogOpen(false); 
      },
      onError: (err: any) => toast.error(err?.message || 'Erreur lors de la création'),
   });

   const updateMutation = useMutation({
      mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
         apiFetch<any>(`/api/v1/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
      onSuccess: () => {
         queryClient.invalidateQueries({ queryKey: ['employees', storeId] });
         toast.success('Employé mis à jour');
         setFormDialogOpen(false);
      },
      onError: (err: any) => toast.error(err?.message || 'Erreur lors de la mise à jour'),
   });

   const deleteMutation = useMutation({
      mutationFn: (id: string) =>
         apiFetch<any>(`/api/v1/users/${id}?hard=true`, { method: 'DELETE' }),
      onSuccess: () => {
         queryClient.invalidateQueries({ queryKey: ['employees', storeId] });
      },
      onError: (err: any) => toast.error(err?.message || 'Erreur lors de la suppression'),
   });

   const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
   const handleDelete = (emp: any) => setDeleteTarget(emp);
   const confirmDelete = () => {
      if (!deleteTarget) return;
      deleteMutation.mutate(deleteTarget.id, {
         onSuccess: () => {
            toast.success(`Employé ${deleteTarget.name} supprimé définitivement`);
            setDeleteTarget(null);
         }
      });
   };

   const employees = (Array.isArray(employeesQuery.data) ? employeesQuery.data : employeesQuery.data?.data) ?? [];
   const handleCreate = () => { setEditingEmployee(null); setFormDialogOpen(true); };
   const handleEdit = (emp: any) => { setEditingEmployee(emp); setFormDialogOpen(true); };
   const handleDeactivate = (emp: any) => setDeactivateTarget(emp);
   const confirmDeactivate = () => {
      if (!deactivateTarget) return;
      updateMutation.mutate(
         { id: deactivateTarget.id, data: { is_active: false } },
         { onSuccess: () => { toast.success(`Accès révoqué — ${deactivateTarget.name}`); setDeactivateTarget(null); } }
      );
   };

   const activeCount = employees.filter(e => e.is_active).length;

   return (
      <div className="space-y-5 pb-28 animate-in fade-in duration-700">

         {/* ── Header ── */}
         <div className="bg-white rounded-[32px] border px-6 sm:px-8 py-5 shadow-sm sticky top-0 z-30 flex flex-col sm:flex-row items-center justify-between gap-4" style={{ borderColor: C.border }}>
            <div className="flex items-center gap-4 w-full sm:w-auto">
               <div className="size-12 rounded-[18px] flex items-center justify-center shadow-lg shadow-indigo-100/50 shrink-0" style={{ backgroundColor: C.primary }}>
                  <Users className="size-6 text-white" />
               </div>
               <div>
                  <h1 className="text-lg font-black tracking-tighter text-[#2D3436] uppercase">Force de Travail</h1>
                  <div className="flex items-center gap-2 mt-0.5">
                     <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 flex items-center gap-1.5">
                        <div className="size-1.5 rounded-full bg-emerald-500 animate-pulse" /> Cluster Live
                     </span>
                     <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">{activeCount} Collaborateurs Actifs</span>
                  </div>
               </div>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
               <div className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 shrink-0">
                  <Calendar className="size-4 text-slate-400" />
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-transparent text-sm font-bold text-slate-600 outline-none w-[120px]" />
                  <span className="text-slate-300">-</span>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-transparent text-sm font-bold text-slate-600 outline-none w-[120px]" />
               </div>
               <button onClick={handleCreate} className="h-11 px-6 rounded-2xl flex items-center justify-center gap-2 bg-[#2D3436] text-white text-[11px] font-black shadow-xl shadow-slate-200 hover:scale-[1.02] active:scale-[0.98] transition-all uppercase tracking-widest shrink-0">
                  <Plus className="size-4" /> Nouvel employé
               </button>
            </div>
         </div>

         {/* ── Tab Navigation ── */}
         <div className="bg-white rounded-[20px] border p-1.5 shadow-sm flex gap-1 overflow-x-auto" style={{ borderColor: C.border }}>
            {TABS.map(tab => (
               <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={cn(
                     'flex items-center gap-2 px-4 py-2.5 rounded-[14px] text-xs font-bold whitespace-nowrap transition-all',
                     activeTab === tab.id
                        ? 'bg-[#4b7bec] text-white shadow-lg shadow-indigo-100'
                        : 'text-slate-400 hover:text-slate-700 hover:bg-slate-50'
                  )}>
                  <tab.icon className="size-3.5 shrink-0" />
                  <span className="hidden sm:inline">{tab.label}</span>
               </button>
            ))}
         </div>

         {/* ── Content ── */}
         <div className="relative">
            {activeTab === 'infra' && (
               <InfrastructureView
                  stats={(infraQuery.data as any)?.data || { totalEffectif: 0, onlineCount: 0, qualityIndex: 0, interactionDelay: 0, securityLevel: 'N/A', nodeId: '...' }}
                  logs={auditQuery.data?.data || []}
                  isLoading={infraQuery.isLoading || auditQuery.isLoading}
               />
            )}
            {activeTab === 'roles' && <RolesView roles={(Array.isArray(rolesQuery.data) ? rolesQuery.data : rolesQuery.data?.data) || []} isLoading={rolesQuery.isLoading} onRefresh={() => rolesQuery.refetch()} onNewRole={() => setNewRoleModalOpen(true)} />}
            {activeTab === 'admins' && <AdminsView employees={employees} isLoading={employeesQuery.isLoading} onEdit={handleEdit} onDeactivate={handleDeactivate} onCreate={handleCreate} totalStaff={(infraQuery.data as any)?.data?.totalEffectif} />}
            {activeTab === 'agents' && <AgentsView employees={employees} isLoading={employeesQuery.isLoading} onEdit={handleEdit} onDeactivate={handleDeactivate} onDelete={handleDelete} onCreate={handleCreate} totalStaff={(infraQuery.data as any)?.data?.totalEffectif} />}
            {activeTab === 'marketers' && <MarketersView marketers={(Array.isArray(marketersQuery.data) ? marketersQuery.data : marketersQuery.data?.data) || []} isLoading={marketersQuery.isLoading} onCreate={handleCreate} />}
            {activeTab === 'assignment-rules' && <AssignmentRulesView employees={employees} />}
         </div>

         {/* ── Employee Form Dialog ── */}
         <EmployeeFormDialog open={formDialogOpen} onOpenChange={setFormDialogOpen} editingEmployee={editingEmployee} storeId={storeId} createMutation={createMutation} updateMutation={updateMutation} />

         {/* ── New Role Modal ── */}
         <NewRoleModal open={newRoleModalOpen} onClose={() => setNewRoleModalOpen(false)} storeId={storeId} onSuccess={() => rolesQuery.refetch()} />

         {/* ── Deactivate Confirmation ── */}
         <AlertDialog open={!!deactivateTarget} onOpenChange={(o) => { if (!o) setDeactivateTarget(null); }}>
            <AlertDialogContent className="rounded-3xl border-slate-100">
               <AlertDialogHeader>
                  <AlertDialogTitle>Révoquer l'accès ?</AlertDialogTitle>
                  <AlertDialogDescription>
                     Le compte de <strong>{deactivateTarget?.name}</strong> sera désactivé. L'employé ne pourra plus se connecter.
                  </AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel className="rounded-xl">Annuler</AlertDialogCancel>
                  <AlertDialogAction onClick={confirmDeactivate} className="rounded-xl bg-red-500 hover:bg-red-600 text-white">
                     Révoquer
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>

         {/* ── Delete Confirmation ── */}
         <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
            <AlertDialogContent className="rounded-3xl border-slate-100">
               <AlertDialogHeader>
                  <AlertDialogTitle>Supprimer définitivement l'employé ?</AlertDialogTitle>
                  <AlertDialogDescription>
                     Le compte de <strong>{deleteTarget?.name}</strong> sera définitivement supprimé. Cette action est irréversible.
                  </AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel className="rounded-xl">Annuler</AlertDialogCancel>
                  <AlertDialogAction onClick={confirmDelete} className="rounded-xl bg-red-600 hover:bg-red-700 text-white">
                     Supprimer
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </div>
   );
}

// ═══════════════════════════════════════════════════════════════
// Salary Calculation Module
// ═══════════════════════════════════════════════════════════════
function SalaryCalculatorButton({ employee }: { employee: any }) {
   const [open, setOpen] = useState(false);
   
   return (
      <>
         <button 
            onClick={(e) => { e.stopPropagation(); setOpen(true); }}
            className="h-9 px-4 rounded-xl flex items-center gap-2 bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-widest border border-emerald-100 hover:bg-emerald-500 hover:text-white transition-all shadow-sm"
         >
            <Banknote className="size-3.5" /> Paie
         </button>
         <SalaryCalculatorDialog open={open} onOpenChange={setOpen} employee={employee} />
      </>
   );
}

const STATUS_COLORS: Record<string, string> = {
   NEW: '#a5b1c2', ASSIGNED: '#4b7bec', CALLED: '#f7b731',
   CONFIRMED: '#20bf6b', SHIPPED: '#0fb9b1', DELIVERED: '#26de81', RETURNED: '#eb4d4b',
};

function SalaryCalculatorDialog({ open, onOpenChange, employee }: { open: boolean; onOpenChange: (o: boolean) => void; employee: any }) {
   const { activeStore } = useAppStore();
   const storeId = activeStore?.id ?? '';
   const qc = useQueryClient();
   const [activeProfileTab, setActiveProfileTab] = useState<'salary' | 'orders' | 'audit'>('salary');
   const [bonus, setBonus] = useState(0);

   // Date filters state
   const [period, setPeriod] = useState<'this_month' | 'last_month' | 'today' | '7d' | '30d' | 'custom'>('this_month');
   const [startDate, setStartDate] = useState<string>('');
   const [endDate, setEndDate] = useState<string>('');
   const [dateBy, setDateBy] = useState<'created_at' | 'delivered_at'>('created_at');
   const [orderSearch, setOrderSearch] = useState<string>('');
   const [orderStatusFilter, setOrderStatusFilter] = useState<'ALL' | 'NORMAL_DELIVERED' | 'RECOVERED_DELIVERED' | 'MARKETPLACE' | 'RETURNED' | 'IN_TRANSIT'>('ALL');

   const payMutation = useMutation({
      mutationFn: () => apiFetch<{ success: boolean; total_paid: number; breakdown: { store_id: string; amount: number }[] }>(
         `/api/v1/users/${employee.id}/salary/pay`,
         { method: 'POST', body: JSON.stringify({ store_id: storeId, bonus }) }
      ),
      onSuccess: (res) => {
         qc.invalidateQueries({ queryKey: ['wallets'] });
         qc.invalidateQueries({ queryKey: ['transactions'] });
         const splitNote = res.breakdown.length > 1 ? ` (réparti sur ${res.breakdown.length} boutiques)` : '';
         toast.success(`Paie de ${formatPrice(res.total_paid)} versée pour ${employee?.name}${splitNote} ✓`);
         onOpenChange(false);
      },
      onError: (err: any) => toast.error(err.message || 'Erreur lors de la validation de la paie'),
   });

   const perfQuery = useQuery({
      queryKey: ['employee-performance', employee?.id, storeId, period, startDate, endDate, dateBy],
      queryFn: () => {
         if (!employee?.id) throw new Error("Employee ID missing");
         let url = `/api/v1/users/${employee.id}/performance?date_by=${dateBy}`;
         if (storeId) url += `&store_id=${storeId}`;

         const formatLocal = (d: Date) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
         };

         if (period === 'custom' && isValidIsoDate(startDate) && isValidIsoDate(endDate)) {
            url += `&start_date=${startDate}T00:00:00.000Z&end_date=${endDate}T23:59:59.999Z`;
         } else if (period === 'today') {
            const today = formatLocal(new Date());
            url += `&start_date=${today}T00:00:00.000Z&end_date=${today}T23:59:59.999Z`;
         } else if (period === 'this_month') {
            const now = new Date();
            const firstDay = formatLocal(new Date(now.getFullYear(), now.getMonth(), 1));
            const today = formatLocal(now);
            url += `&start_date=${firstDay}T00:00:00.000Z&end_date=${today}T23:59:59.999Z`;
         } else if (period === 'last_month') {
            const now = new Date();
            const firstDay = formatLocal(new Date(now.getFullYear(), now.getMonth() - 1, 1));
            const lastDay = formatLocal(new Date(now.getFullYear(), now.getMonth(), 0));
            url += `&start_date=${firstDay}T00:00:00.000Z&end_date=${lastDay}T23:59:59.999Z`;
         } else if (period === '7d') {
            url += `&period_days=7`;
         } else {
            url += `&period_days=30`;
         }

         return apiFetch<any>(url);
      },
      enabled: open && !!employee?.id,
   });

   const perf = perfQuery.data;
   const stats = perf?.stats ?? { confirmed_count: 0, delivered_count: 0, returned_count: 0, cancelled_count: 0, total_assigned: 0, confirmation_rate: 0 };
   const paymentType = employee?.payment_type ?? '';
   const paymentAmount = employee?.payment_amount ?? 0;

   const confirmed = stats.confirmed_count ?? 0;
   const delivered = stats.delivered_count ?? 0;
   const cancelled = stats.cancelled_count ?? 0;
   const returned = stats.returned_count ?? 0;
   const total_assigned = stats.total_assigned ?? 0;
   const storePickupCount = stats.store_pickup_delivered_count ?? 0;
   const recoveredStorePickupCount = stats.recovered_store_pickup_delivered_count ?? 0;
   const paymentStorePickup = stats.payment_store_pickup ?? employee?.payment_store_pickup ?? 100;
   const paymentRecoveredStorePickup = stats.payment_recovered_store_pickup ?? employee?.payment_recovered_store_pickup ?? 150;

   const computedSalary = stats.salary ?? (
     paymentType === 'MONTHLY_SALARY' ? paymentAmount : delivered * paymentAmount
   );
   const totalSalary = computedSalary + bonus;
   const maxBar = Math.max(...(perf?.daily_chart ?? [{ count: 1 }]).map((d: any) => d.count), 1);

   // Filtered orders for the orders tab
   const rawOrders: any[] = perf?.recent_orders ?? [];
   const filteredOrders = rawOrders.filter((o: any) => {
      const isRec = Boolean(o.is_abandoned_cart || o.recovered_at);
      const isMp = Boolean(o.is_marketplace_upsell || o.source === 'MARKETPLACE');
      if (orderStatusFilter === 'NORMAL_DELIVERED') {
         return o.status === 'DELIVERED' && !isRec && !isMp;
      }
      if (orderStatusFilter === 'RECOVERED_DELIVERED') {
         return o.status === 'DELIVERED' && isRec;
      }
      if (orderStatusFilter === 'MARKETPLACE') {
         return o.status === 'DELIVERED' && isMp;
      }
      if (orderStatusFilter === 'RETURNED') {
         return o.status === 'RETURNED';
      }
      if (orderStatusFilter === 'IN_TRANSIT') {
         return ['SHIPPED', 'CONFIRMED', 'ASSIGNED', 'IN_PROGRESS'].includes(o.status);
      }
      return true;
   }).filter((o: any) => {
      if (!orderSearch.trim()) return true;
      const q = orderSearch.toLowerCase();
      return (
         (o.order_number || '').toLowerCase().includes(q) ||
         (o.tracking_number || '').toLowerCase().includes(q) ||
         (o.customer_name || '').toLowerCase().includes(q) ||
         (o.customer_phone || '').toLowerCase().includes(q) ||
         (o.customer_wilaya || o.wilaya || '').toLowerCase().includes(q) ||
         (o.customer_commune || o.commune || '').toLowerCase().includes(q)
      );
   });

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent className="max-w-4xl w-[96vw] p-0 border-none bg-white rounded-[40px] overflow-hidden shadow-2xl flex flex-col max-h-[94vh]">
            {/* Header */}
            <div className="bg-slate-900 p-6 sm:p-8 text-white shrink-0">
               <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                  <div className="flex items-center gap-4 sm:gap-5">
                     <div className="size-12 sm:size-14 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
                        <Banknote className="size-6 sm:size-7" />
                     </div>
                     <div>
                        <DialogTitle className="text-lg sm:text-xl font-bold">{employee?.name}</DialogTitle>
                        <p className="text-emerald-100 text-xs font-medium mt-1">{ROLE_LABELS[employee?.role as UserRole] || employee?.role} · Rapport Performance & Suivi Transporteur</p>
                        {(employee?.created_at || perf?.user?.created_at) && (
                            <div className="flex items-center gap-1.5 text-xs text-slate-300 mt-2 font-medium bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700/60 w-fit">
                               <Calendar className="size-3.5 text-emerald-400" />
                               <span>A commencé le : <strong className="text-white font-bold">{new Date(employee?.created_at || perf?.user?.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}</strong></span>
                            </div>
                         )}
                     </div>
                  </div>
                  <div className="flex items-center gap-4">
                     <div className="flex flex-col">
                        <p className="text-xs font-medium text-slate-400">Total Livrées</p>
                        <p className="text-2xl font-bold text-emerald-400">{delivered}</p>
                     </div>
                     <div className="w-px h-10 bg-slate-700 hidden sm:block"></div>
                     <div className="flex flex-col">
                        <p className="text-xs font-medium text-slate-400">Salaire & Commissions</p>
                        <p className="text-2xl font-bold text-white">{formatPrice(computedSalary)}</p>
                     </div>
                  </div>
               </div>

               {/* Date Filter Toolbar */}
               <div className="mt-6 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-1.5 flex-wrap">
                     <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider flex items-center gap-1">
                        <Calendar className="size-3.5 text-emerald-400" /> Période :
                     </span>
                     {[
                        { id: 'this_month', label: 'Ce mois-ci' },
                        { id: 'last_month', label: 'Mois dernier' },
                        { id: '30d', label: '30 jours' },
                        { id: '7d', label: '7 jours' },
                        { id: 'today', label: "Aujourd'hui" },
                        { id: 'custom', label: '📅 Période' },
                     ].map(p => (
                        <button
                           key={p.id}
                           type="button"
                           onClick={() => setPeriod(p.id as any)}
                           className={cn(
                              "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all",
                              period === p.id ? "bg-emerald-500 text-white shadow-sm" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                           )}
                        >
                           {p.label}
                        </button>
                     ))}
                  </div>

                  {period === 'custom' && (
                     <div className="flex items-center gap-1.5">
                        <input
                           type="date"
                           value={startDate}
                           onChange={e => setStartDate(e.target.value)}
                           className="bg-slate-800 border border-slate-700 text-white text-[11px] px-2 py-1 rounded-lg font-bold"
                        />
                        <span className="text-slate-400 text-[10px]">à</span>
                        <input
                           type="date"
                           value={endDate}
                           onChange={e => setEndDate(e.target.value)}
                           className="bg-slate-800 border border-slate-700 text-white text-[11px] px-2 py-1 rounded-lg font-bold"
                        />
                     </div>
                  )}

                  <div className="flex items-center gap-1.5">
                     <span className="text-[10px] font-black uppercase text-slate-400">Filtrer par :</span>
                     <select
                        value={dateBy}
                        onChange={e => setDateBy(e.target.value as any)}
                        className="bg-slate-800 border border-slate-700 text-white text-[11px] px-2 py-1 rounded-lg font-bold cursor-pointer"
                     >
                        <option value="created_at">Date de création</option>
                        <option value="delivered_at">Date de livraison réelle</option>
                     </select>
                  </div>
               </div>

               {/* Tabs */}
               <div className="flex gap-2 mt-6 border-b border-slate-700">
                  {([['salary', 'Bulletin & Ventilation par Date', Banknote], ['orders', `Micro-détails Colis & Suivi (${rawOrders.length})`, Package], ['audit', 'Traçabilité Actions', Activity]] as const).map(([id, label, Icon]) => (
                     <button key={id} onClick={() => setActiveProfileTab(id)}
                        className={cn(
                           "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px",
                           activeProfileTab === id ? "border-emerald-500 text-white font-bold" : "border-transparent text-slate-400 hover:text-slate-200"
                        )}>
                        <Icon className="size-4" /><span>{label}</span>
                     </button>
                  ))}
               </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
               {perfQuery.isLoading ? (
                  <div className="flex items-center justify-center h-48">
                     <Loader2 className="size-8 animate-spin text-slate-200" />
                  </div>
               ) : (

               /* ── SALARY TAB ── */
               activeProfileTab === 'salary' ? (
                  <div className="p-6 sm:p-8 space-y-6">
                     {/* Daily chart */}
                     {(perf?.daily_chart ?? []).length > 0 && (
                        <div className="space-y-3">
                           <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Activité Livraisons (7 derniers jours)</p>
                           <div className="flex items-end gap-2 h-20">
                              {(perf?.daily_chart ?? []).map((d: any, i: number) => (
                                 <div key={i} className="flex-1 flex flex-col items-center gap-1">
                                    <div className="w-full rounded-t-lg bg-[#20bf6b]/20 relative" style={{ height: `${Math.max(8, (d.count / maxBar) * 64)}px` }}>
                                       <div className="absolute inset-x-0 bottom-0 rounded-t-lg bg-[#20bf6b]" style={{ height: `${Math.max(4, (d.count / maxBar) * 64)}px` }} />
                                    </div>
                                    <span className="text-[8px] font-black text-slate-400">{d.date}</span>
                                 </div>
                              ))}
                           </div>
                        </div>
                     )}

                     {/* Stats grid */}
                     <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                        {[
                           { label: 'Assignées', value: total_assigned, sub: '100% du flux', color: '#4b7bec', bg: 'bg-blue-50/50', border: 'border-blue-100', filterId: 'ALL' },
                           { label: 'Confirmées', value: confirmed, sub: `Taux : ${stats.confirmation_rate ?? (total_assigned > 0 ? Math.round((confirmed / total_assigned) * 100) : 0)}%`, color: '#20bf6b', bg: 'bg-emerald-50/50', border: 'border-emerald-100', filterId: 'CONFIRMED' },
                           { label: 'Livrées (Total)', value: delivered, sub: `Taux : ${stats.confirmed_delivered_rate ?? (confirmed > 0 ? Math.round((delivered / confirmed) * 100) : 0)}%`, color: '#10b981', bg: 'bg-emerald-50/50', border: 'border-emerald-100', filterId: 'DELIVERED' },
                           { label: '🟦 Normales Livrées', value: stats.normal_delivered_count ?? Math.max(0, delivered - (stats.recovered_delivered_count || 0)), sub: paymentType === 'MONTHLY_SALARY' ? 'Salaire fixe' : `Base : ${formatPrice((stats.normal_delivered_count ?? Math.max(0, delivered - (stats.recovered_delivered_count || 0))) * paymentAmount)}`, color: '#3b82f6', bg: 'bg-blue-50/50', border: 'border-blue-100', filterId: 'NORMAL_DELIVERED' },
                           { label: '🟩 Paniers Récupérés', value: stats.recovered_delivered_count || 0, sub: paymentType === 'MONTHLY_SALARY' ? 'Salaire fixe' : `+${formatPrice(stats.abandoned_bonus ?? ((stats.recovered_delivered_count || 0) * (stats.payment_recovered_cart || 150)))} (${stats.recovered_delivered_rate || 0}%)`, color: '#059669', bg: 'bg-emerald-50', border: 'border-emerald-200', filterId: 'RECOVERED_DELIVERED' },
                           { label: '🔴 Retours', value: returned, sub: `Taux : ${total_assigned > 0 ? Math.round((returned / total_assigned) * 100) : 0}%`, color: '#ef4444', bg: 'bg-rose-50/50', border: 'border-rose-100', filterId: 'RETURNED' },
                        ].map(s => (
                           <button
                              key={s.label}
                              type="button"
                              onClick={() => {
                                 setActiveProfileTab('orders');
                                 setOrderStatusFilter(s.filterId as any);
                              }}
                              className={cn(
                                 "rounded-2xl p-4 text-center border shadow-xs transition-all hover:scale-[1.03] hover:shadow-md cursor-pointer text-left w-full",
                                 s.bg, s.border
                              )}
                           >
                              <p className="text-[9px] font-black uppercase text-slate-500 tracking-wider mb-1 truncate text-center">{s.label}</p>
                              <p className="text-2xl font-black text-center" style={{ color: s.color }}>{s.value}</p>
                              <p className="text-[10px] font-bold text-slate-400 mt-1 truncate text-center">{s.sub}</p>
                              <p className="text-[8px] font-extrabold text-slate-400/80 uppercase tracking-wider text-center mt-1">Cliquer pour voir ↗</p>
                           </button>
                        ))}
                     </div>

                     {/* Salary breakdown */}
                     <div className="bg-slate-50 rounded-3xl p-6 space-y-3.5 border border-slate-100">
                        <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Détail des commissions & calcul de paie</p>

                        {paymentType === 'MONTHLY_SALARY' ? (
                           <div className="flex justify-between items-center text-xs font-bold text-slate-800 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                              <div className="space-y-0.5">
                                 <span className="flex items-center gap-2 font-bold text-slate-900">
                                    <span className="size-2 rounded-full bg-emerald-500"></span>
                                    Salaire fixe mensuel contractuel
                                 </span>
                                 <p className="text-[10px] text-slate-400 font-medium">Régime à salaire fixe intégral (aucune commission par commande déduite ou ajoutée)</p>
                              </div>
                              <span className="font-mono font-black text-base text-slate-900">{formatPrice(paymentAmount)}</span>
                           </div>
                        ) : (
                           <>
                              {/* Commandes normales livrées */}
                              <div className="flex justify-between items-center text-xs font-bold text-slate-700 bg-white p-3 rounded-2xl border border-slate-200">
                                 <span className="flex items-center gap-2">
                                    <span className="size-2 rounded-full bg-blue-500"></span>
                                    🟦 Commandes normales livrées
                                 </span>
                                 <span className="font-mono font-bold text-blue-900">
                                    {stats.normal_delivered_count ?? Math.max(0, delivered - (stats.recovered_delivered_count || 0))} × {formatPrice(paymentAmount)} = {formatPrice(stats.base_salary ?? (Math.max(0, delivered - (stats.recovered_delivered_count || 0)) * paymentAmount))}
                                 </span>
                              </div>

                              {/* Paniers abandonnés récupérés & livrés */}
                              <div className="flex justify-between items-center text-xs font-bold text-amber-800 bg-amber-50 p-3 rounded-2xl border border-amber-200/60">
                                 <span className="flex items-center gap-1.5 font-bold">
                                    <span className="size-2 rounded-full bg-amber-500 animate-pulse"></span>
                                    Paniers abandonnés récupérés & livrés
                                 </span>
                                 <span className="font-mono font-black text-amber-900">
                                    + {stats.recovered_delivered_count || 0} × {formatPrice(stats.payment_recovered_cart || 150)} = +{formatPrice(stats.abandoned_bonus ?? ((stats.recovered_delivered_count || 0) * (stats.payment_recovered_cart || 150)))}
                                 </span>
                              </div>

                              {/* Commission Marketplace (50 DA) */}
                              {((stats.marketplace_bonus || 0) > 0 || (stats.marketplace_delivered_count || 0) > 0) && (
                                 <div className="flex justify-between items-center text-xs font-bold text-pink-700 bg-pink-50 p-3 rounded-2xl border border-pink-200/60">
                                    <span className="flex items-center gap-1.5 font-bold">
                                       <span className="size-2 rounded-full bg-pink-500"></span>
                                       Commandes Marketplace livrées
                                    </span>
                                    <span className="font-mono font-black text-pink-900">
                                       + {stats.marketplace_delivered_count || 0} × {formatPrice(stats.payment_marketplace_upsell_only || 50)} = +{formatPrice(stats.marketplace_bonus ?? ((stats.marketplace_delivered_count || 0) * (stats.payment_marketplace_upsell_only || 50)))}
                                    </span>
                                 </div>
                              )}

                              {/* Bonus Upsell */}
                              {(stats.upsell_bonus || 0) > 0 && (
                                 <div className="flex justify-between items-center text-xs font-bold text-purple-700 bg-purple-50 p-3 rounded-2xl border border-purple-200/60">
                                    <span>Bonus Upsell / Produits ajoutés</span>
                                    <span className="font-mono font-black text-purple-900">+ {formatPrice(stats.upsell_bonus)}</span>
                                 </div>
                              )}

                              {/* Pénalité retours */}
                              {(stats.returned_penalty || 0) > 0 && (
                                 <div className="flex justify-between items-center text-xs font-bold text-rose-600 bg-rose-50 p-3 rounded-2xl border border-rose-200/60">
                                    <span>Pénalité retours ({returned} colis)</span>
                                    <span className="font-mono font-black text-rose-900">- {formatPrice(stats.returned_penalty)}</span>
                                 </div>
                              )}
                           </>
                        )}

                        <div className="flex justify-between items-center text-xs font-black text-[#20bf6b] pt-3 border-t border-slate-200">
                           <span>Total commissions calculées</span>
                           <span className="font-mono font-black text-base text-[#20bf6b]">= {formatPrice(computedSalary)}</span>
                        </div>
                        <div className="flex items-center gap-3">
                           <label className="text-[10px] font-black uppercase text-slate-400 whitespace-nowrap">Prime exceptionnelle (DA)</label>
                           <Input type="number" value={bonus} onChange={e => setBonus(Number(e.target.value))}
                              className="h-10 border-slate-200 bg-white font-black text-[#4b7bec] rounded-xl px-4 flex-1" placeholder="0" />
                        </div>
                        {bonus > 0 && (
                           <div className="flex justify-between items-center text-xs font-bold text-[#4b7bec]">
                              <span>Prime exceptionnelle</span>
                              <span className="font-mono font-black">+ {formatPrice(bonus)}</span>
                           </div>
                        )}
                        <div className="pt-4 border-t border-slate-200 flex items-end justify-between">
                           <div>
                              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Total Net à payer</p>
                              <p className="text-3xl font-black text-slate-900 font-mono">{formatPrice(totalSalary)}</p>
                           </div>
                           <div className="text-right">
                              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Taux confirmation</p>
                              <p className="text-2xl font-black text-emerald-500 font-mono">{stats.confirmation_rate}%</p>
                           </div>
                        </div>
                     </div>

                     {/* Daily Breakdown Table */}
                     {(perf?.daily_breakdown ?? []).length > 0 && (
                        <div className="bg-slate-50 rounded-3xl p-6 space-y-4 border border-slate-100">
                           <div className="flex items-center justify-between">
                              <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1.5">
                                 <Calendar className="size-3.5 text-emerald-500" />
                                 Ventilation des Livraisons par Date (Journalier)
                              </p>
                              <span className="text-[10px] font-bold text-slate-400 bg-white px-2 py-0.5 rounded-full border border-slate-200">
                                 {perf.daily_breakdown.length} jours d&apos;activité
                              </span>
                           </div>
                           <div className="overflow-x-auto">
                              <table className="w-full text-left text-xs border-collapse">
                                 <thead>
                                    <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-400">
                                       <th className="pb-2.5 font-bold">Date</th>
                                       <th className="pb-2.5 font-bold text-center">🟦 Normales</th>
                                       <th className="pb-2.5 font-bold text-center">🟩 Paniers Récup.</th>
                                       <th className="pb-2.5 font-bold text-center">🔴 Retours</th>
                                       <th className="pb-2.5 font-bold text-center">🚚 Total Livré</th>
                                       {paymentType !== 'MONTHLY_SALARY' && <th className="pb-2.5 font-bold text-right">💵 Gain du jour</th>}
                                    </tr>
                                 </thead>
                                 <tbody className="divide-y divide-slate-100 font-medium">
                                    {perf.daily_breakdown.map((row: any, idx: number) => (
                                       <tr key={idx} className="hover:bg-white/80 transition-colors">
                                          <td className="py-2.5 font-bold text-slate-800 flex items-center gap-1.5">
                                             <span className="size-1.5 rounded-full bg-slate-300"></span>
                                             {row.date_formatted || row.date}
                                          </td>
                                          <td className="py-2.5 text-center font-bold text-blue-600">
                                             {row.normal_delivered > 0 ? (
                                                <span className="bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">
                                                   {row.normal_delivered}
                                                </span>
                                             ) : '—'}
                                          </td>
                                          <td className="py-2.5 text-center font-bold text-emerald-600">
                                             {row.recovered_delivered > 0 ? (
                                                <span className="bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 font-black">
                                                   +{row.recovered_delivered}
                                                </span>
                                             ) : '—'}
                                          </td>
                                          <td className="py-2.5 text-center font-bold text-rose-500">
                                             {row.returned > 0 ? (
                                                <span className="bg-rose-50 px-2 py-0.5 rounded-md border border-rose-100">
                                                   {row.returned}
                                                </span>
                                             ) : '—'}
                                          </td>
                                          <td className="py-2.5 text-center font-black text-slate-800">
                                             {row.total_delivered > 0 ? (
                                                <span className="bg-slate-200/60 px-2.5 py-0.5 rounded-md text-slate-900">
                                                   {row.total_delivered}
                                                </span>
                                             ) : '0'}
                                          </td>
                                          {paymentType !== 'MONTHLY_SALARY' && (
                                             <td className="py-2.5 text-right font-black text-emerald-600 font-mono">
                                                {row.daily_earnings > 0 ? `+${formatPrice(row.daily_earnings)}` : (row.daily_earnings < 0 ? `-${formatPrice(Math.abs(row.daily_earnings))}` : '0 DA')}
                                             </td>
                                          )}
                                       </tr>
                                    ))}
                                 </tbody>
                              </table>
                           </div>
                        </div>
                     )}
                  </div>

               /* ── ORDERS TAB ── */
               ) : activeProfileTab === 'orders' ? (
                  <div className="p-4 sm:p-6 space-y-4">
                     {/* Search & Filter Toolbar */}
                     <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-200">
                        <div className="relative flex-1">
                           <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                           <input
                              type="text"
                              value={orderSearch}
                              onChange={e => setOrderSearch(e.target.value)}
                              placeholder="Rechercher par N° commande, bordereau Noest, client, tél, wilaya..."
                              className="w-full pl-9 pr-4 py-1.5 bg-white rounded-xl border border-slate-200 text-xs text-slate-800 font-medium placeholder:text-slate-400 focus:outline-none focus:border-emerald-500"
                           />
                        </div>
                        <div className="flex items-center gap-1.5 overflow-x-auto flex-wrap">
                           {[
                              { id: 'ALL', label: `Toutes (${rawOrders.length})` },
                              { id: 'NORMAL_DELIVERED', label: '🟦 Normales Livrées' },
                              { id: 'RECOVERED_DELIVERED', label: '🟩 Paniers Récup. Livrés' },
                              { id: 'RETURNED', label: '🔴 Retours' },
                              { id: 'IN_TRANSIT', label: '🟡 En Transit' },
                           ].map(tab => (
                              <button
                                 key={tab.id}
                                 type="button"
                                 onClick={() => setOrderStatusFilter(tab.id as any)}
                                 className={cn(
                                    "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap",
                                    orderStatusFilter === tab.id
                                       ? "bg-slate-900 text-white shadow-sm"
                                       : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                                 )}
                              >
                                 {tab.label}
                              </button>
                           ))}
                        </div>
                     </div>

                     {filteredOrders.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                           <div className="size-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                              <Package className="size-8 text-slate-300" />
                           </div>
                           <h3 className="text-sm font-semibold text-slate-700">Aucune commande trouvée</h3>
                           <p className="text-sm text-slate-500 mt-1">Aucune commande ne correspond aux filtres actuels.</p>
                        </div>
                     ) : (
                        <div className="space-y-3">
                           {filteredOrders.map((o: any) => (
                              <div key={o.id} className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm hover:border-slate-300 transition-all space-y-3">
                                 {/* Top line: IDs, Type badge, Status & Commission */}
                                 <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                                    <div className="flex items-center gap-2 flex-wrap">
                                       <span className="font-mono font-black text-slate-900 text-xs">
                                          #{o.order_number}
                                       </span>
                                       {o.tracking_number && (
                                          <span className="flex items-center gap-1 font-mono text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg border border-blue-200 font-bold">
                                             <Truck className="size-3 text-blue-600" />
                                             {o.tracking_number}
                                          </span>
                                       )}
                                       {o.is_abandoned_cart ? (
                                          <span className="text-[10px] font-black bg-amber-50 text-amber-800 px-2 py-0.5 rounded-md border border-amber-200 flex items-center gap-1">
                                             <span className="size-1.5 rounded-full bg-amber-500"></span>
                                             🟩 Panier Récupéré
                                          </span>
                                       ) : (
                                          <span className="text-[10px] font-black bg-blue-50 text-blue-800 px-2 py-0.5 rounded-md border border-blue-200">
                                             🟦 Commande Normale
                                          </span>
                                       )}
                                    </div>

                                    <div className="flex items-center gap-3">
                                       <span className="text-xs font-black text-slate-800 font-mono">
                                          {formatPrice(o.total)}
                                       </span>
                                       <span className="px-2.5 py-1 rounded-md text-xs font-bold" style={{ backgroundColor: (STATUS_COLORS[o.status] || '#a5b1c2') + '15', color: STATUS_COLORS[o.status] || '#a5b1c2' }}>
                                          {({
                                             NEW: 'Nouvelle', ASSIGNED: 'Assignée', CALLED: 'Appelée',
                                             IN_PROGRESS: 'En attente', RESCHEDULED: 'Reportée',
                                             CONFIRMED: 'Confirmée', SHIPPED: 'Expédiée', DELIVERED: 'Livrée',
                                             CANCELLED: 'Annulée', RETURNED: 'Retournée', ABANDONED: 'Abandonné'
                                          } as Record<string, string>)[o.status] || o.status}
                                       </span>
                                       {((o as any).is_marketplace_upsell || o.source === 'MARKETPLACE') ? (
                                          <span className="text-xs font-black font-mono px-2 py-0.5 rounded-lg border bg-pink-50 text-pink-700 border-pink-200">
                                             +50 DA
                                          </span>
                                       ) : (o.commission_amount !== 0 && (
                                          <span className={cn(
                                             "text-xs font-black font-mono px-2 py-0.5 rounded-lg border",
                                             o.commission_amount > 0 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200"
                                          )}>
                                             {o.commission_amount > 0 ? `+${formatPrice(o.commission_amount)}` : `-${formatPrice(Math.abs(o.commission_amount))}`}
                                          </span>
                                       ))}
                                    </div>
                                 </div>

                                 {/* Client details & Wilaya / Commune */}
                                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                    <div className="flex items-center gap-2">
                                       <span className="font-bold text-slate-900">{o.customer_name}</span>
                                       {o.customer_phone && (
                                          <a href={`tel:${o.customer_phone}`} className="text-slate-500 font-mono hover:text-emerald-600 transition-colors">
                                             ({o.customer_phone})
                                          </a>
                                       )}
                                    </div>
                                    <div className="text-slate-500 sm:text-right font-medium">
                                       📍 {o.customer_wilaya || o.wilaya || 'Wilaya non spécifiée'}{(o.customer_commune || o.commune) ? ` · ${o.customer_commune || o.commune}` : ''}
                                    </div>
                                 </div>

                                 {/* Transporteur Tracking Notes & Real Delivery Date */}
                                 {(o.carrier_tracking_note || o.delivered_at || o.created_at) && (
                                    <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-[11px] space-y-1">
                                       {o.delivered_at && o.status === 'DELIVERED' && (
                                          <p className="font-bold text-emerald-700 flex items-center gap-1.5">
                                             <span>🟢 Livré le :</span>
                                             <span className="font-mono">{new Date(o.delivered_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                                          </p>
                                       )}
                                       {o.carrier_tracking_note && (
                                          <p className="text-slate-600 font-medium">
                                             🚚 <strong className="text-slate-800">Suivi Transporteur :</strong> {o.carrier_tracking_note}
                                          </p>
                                       )}
                                    </div>
                                 )}
                              </div>
                           ))}
                        </div>
                     )}
                  </div>

               /* ── AUDIT TAB ── */
               ) : (
                  <div className="p-4 sm:p-6 space-y-6">
                     {/* Présence & Working Hours Summary Cards */}
                     <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Card 1: Last Login & Activity */}
                        <div className="bg-slate-900 text-white rounded-3xl p-5 shadow-sm relative overflow-hidden flex flex-col justify-between">
                           <div className="flex items-center justify-between mb-3">
                              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 flex items-center gap-1.5">
                                 <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                                 Dernière Connexion
                              </span>
                              <Clock className="size-4 text-slate-400" />
                           </div>
                           <div>
                              <p className="text-xs text-slate-400 font-medium">Horodatage de la connexion</p>
                              <p className="text-lg font-bold text-white mt-0.5">
                                 {perf?.user?.last_seen_at ? (() => {
                                    const dt = new Date(perf.user.last_seen_at);
                                    const diffMins = Math.floor((Date.now() - dt.getTime()) / 60000);
                                    if (diffMins <= 5) return "À l'instant (En ligne)";
                                    if (diffMins < 60) return `Il y a ${diffMins} min`;
                                    if (diffMins < 1440) return `Il y a ${Math.floor(diffMins / 60)}h (${dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})`;
                                    return dt.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
                                 })() : "— (Non disponible)"}
                              </p>
                           </div>
                           <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-300">
                              <span>État du compte</span>
                              <span className="font-semibold text-emerald-400">{employee?.is_active ? 'Compte Actif ✓' : 'Compte Inactif'}</span>
                           </div>
                        </div>

                        {/* Card 2: Heures de travail */}
                        <div className="bg-gradient-to-br from-emerald-600 to-teal-800 text-white rounded-3xl p-5 shadow-sm flex flex-col justify-between">
                           <div className="flex items-center justify-between mb-3">
                              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-100 flex items-center gap-1.5">
                                 <Calendar className="size-3.5" />
                                 Heures de Travail
                              </span>
                              <TrendingUp className="size-4 text-emerald-200" />
                           </div>
                           <div className="grid grid-cols-2 gap-3">
                              <div>
                                 <p className="text-[10px] font-medium text-emerald-100 uppercase">Aujourd'hui</p>
                                 <p className="text-2xl font-black text-white">{perf?.working_hours?.today_hours ?? 0}h</p>
                                 <p className="text-[10px] text-emerald-200 mt-0.5">{perf?.working_hours?.start_time || '—'} → {perf?.working_hours?.end_time || '—'}</p>
                              </div>
                              <div>
                                 <p className="text-[10px] font-medium text-emerald-100 uppercase">Moy. Journalière</p>
                                 <p className="text-2xl font-black text-white">{perf?.working_hours?.avg_daily_hours ?? 0}h/j</p>
                                 <p className="text-[10px] text-emerald-200 mt-0.5">{perf?.working_hours?.days_active ?? 0} jours d'activité</p>
                              </div>
                           </div>
                        </div>
                     </div>

                     {/* Graphe d'Évolution des Exécutions de Tâches */}
                     <div className="bg-slate-50 border border-slate-200/80 rounded-3xl p-5 sm:p-6 space-y-4">
                        <div className="flex items-center justify-between">
                           <div>
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Graphe d'Évolution</p>
                              <h4 className="text-sm font-bold text-slate-900 mt-0.5">Exécutions de tâches & actions au fil du temps</h4>
                           </div>
                           <span className="px-3 py-1 bg-emerald-100 text-emerald-800 text-xs font-bold rounded-full">
                              {perf?.task_evolution_chart?.reduce((acc: number, t: any) => acc + (t.tasks || 0), 0) ?? 0} tâches exécutées
                           </span>
                        </div>

                        {(() => {
                           const taskChart = perf?.task_evolution_chart ?? [];
                           const maxTask = Math.max(...taskChart.map((t: any) => t.tasks || 0), 1);
                           
                           return taskChart.length === 0 ? (
                              <p className="text-xs text-slate-400 italic text-center py-4">Aucune donnée d'exécution de tâche.</p>
                           ) : (
                              <div className="flex items-end gap-2 h-28 pt-4">
                                 {taskChart.map((t: any, idx: number) => {
                                    const heightPct = Math.max(10, Math.round(((t.tasks || 0) / maxTask) * 100));
                                    return (
                                       <div key={idx} className="flex-1 flex flex-col items-center gap-1 group relative">
                                          <div className="absolute -top-8 bg-slate-900 text-white text-[10px] font-bold px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10 shadow-lg">
                                             {t.tasks} action(s) le {t.date}
                                          </div>
                                          <div className="w-full bg-slate-200 rounded-t-xl overflow-hidden relative" style={{ height: '72px' }}>
                                             <div 
                                                className="absolute inset-x-0 bottom-0 bg-emerald-500 group-hover:bg-emerald-400 transition-all rounded-t-xl"
                                                style={{ height: `${heightPct}%` }}
                                             />
                                          </div>
                                          <span className="text-[9px] font-black text-slate-500">{t.date}</span>
                                          <span className="text-[8px] font-bold text-emerald-600">{t.tasks}</span>
                                       </div>
                                    );
                                 })}
                              </div>
                           );
                        })()}
                     </div>

                     {/* Audit Log Timeline */}
                     {(perf?.audit_logs ?? []).length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                           <div className="size-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                              <Activity className="size-8 text-slate-300" />
                           </div>
                           <h3 className="text-sm font-semibold text-slate-700">Aucun historique d'événement</h3>
                           <p className="text-sm text-slate-500 mt-1">L'historique des actions détaillées de cet employé est vide.</p>
                        </div>
                     ) : (
                        <div className="space-y-3">
                           <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Journal des Dernières Actions</p>
                           {(perf?.audit_logs ?? []).map((a: any) => (
                              <div key={a.id} className="flex items-start gap-4 p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                                 <div className="size-10 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                                    <Activity className="size-5 text-blue-500" />
                                 </div>
                                 <div className="flex-1 min-w-0 pt-0.5">
                                    <p className="text-sm text-slate-700 font-medium">
                                       {a.action === 'CREATE' ? 'Création' : a.action === 'UPDATE' ? 'Mise à jour' : a.action === 'DELETE' ? 'Suppression' : a.action} d'un enregistrement
                                    </p>
                                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                                       <span>{a.entity}</span>
                                       <span>•</span>
                                       <span className="font-mono text-slate-400">{a.entity_id?.slice(0, 8)}</span>
                                    </div>
                                 </div>
                                 <div className="text-xs text-slate-400 shrink-0 pt-1">
                                    {a.created_at ? new Date(a.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                                 </div>
                              </div>
                           ))}
                        </div>
                     )}
                   </div>
                )
               )}
            </div>


            {/* Footer */}
            <div className="p-4 sm:p-6 border-t border-slate-100 flex gap-3 shrink-0">
               <button onClick={() => onOpenChange(false)} className="flex-1 h-12 rounded-2xl border border-slate-100 text-[11px] font-black uppercase tracking-widest text-slate-400 hover:bg-slate-50 transition-all">Fermer</button>
               {activeProfileTab === 'salary' && (
                  <Button className="flex-[2] h-12 rounded-2xl bg-[#2D3436] hover:bg-black text-white text-[10px] font-black uppercase tracking-widest shadow-xl disabled:opacity-50"
                     disabled={payMutation.isPending || totalSalary <= 0}
                     onClick={() => payMutation.mutate()}>
                     {payMutation.isPending ? <Loader2 className="size-4 animate-spin mx-auto" /> : "Valider l'ordre de paiement"}
                  </Button>
               )}
            </div>
         </DialogContent>
      </Dialog>
   );
}
