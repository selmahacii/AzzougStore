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
   Bell,
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
import type { EmployeeStats, ApiResponse, UserRole, Product, MarketerPerformance } from '@/lib/types';
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
   { id: 'team', label: '👥 Équipe & Collaborateurs', icon: Users },
   { id: 'assignment-rules', label: "🎯 Règles d&apos;Assignation", icon: Target },
   { id: 'roles', label: '🛡️ Matrice des Rôles', icon: Shield },
   { id: 'infra', label: '⚡ Infrastructure Live', icon: RadioTower },
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
interface RoleMember {
    id: string;
    name: string;
    email: string;
    role: string;
    is_active: boolean;
    avatar?: string | null;
}

interface RolePermission {
    code: string;
    name: string;
    description: string;
    color: string;
    count: number;
    permissions: string[];
    members?: RoleMember[];
    is_system?: boolean;
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

function EditRolePermissionsModal({
   role,
   open,
   onClose,
   onSuccess
}: {
   role: RolePermission | null;
   open: boolean;
   onClose: () => void;
   onSuccess: () => void;
}) {
   const [selectedPerms, setSelectedPerms] = useState<string[]>([]);
   const [applyToUsers, setApplyToUsers] = useState(true);
   const [saving, setSaving] = useState(false);

   React.useEffect(() => {
      if (role) {
         setSelectedPerms(role.permissions || []);
         setApplyToUsers(true);
      }
   }, [role, open]);

   if (!role) return null;

   const togglePerm = (p: string) => setSelectedPerms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
   const toggleGroup = (perms: string[]) => {
      const allSelected = perms.every(p => selectedPerms.includes(p));
      if (allSelected) setSelectedPerms(prev => prev.filter(p => !perms.includes(p)));
      else setSelectedPerms(prev => [...new Set([...prev, ...perms])]);
   };

   const handleSave = async () => {
      setSaving(true);
      try {
         await apiFetch(`/api/v1/users/roles/${role.code}/permissions`, {
            method: 'PUT',
            body: JSON.stringify({ permissions: selectedPerms, apply_to_users: applyToUsers }),
         });
         toast.success(`Permissions du rôle « ${role.name} » mises à jour`);
         onSuccess();
         onClose();
      } catch (err: any) {
         toast.error(err?.message || 'Erreur lors de la mise à jour des permissions');
      } finally {
         setSaving(false);
      }
   };

   return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
         <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto rounded-[2rem] p-0 gap-0 border-0 shadow-2xl">
            <DialogHeader className="px-8 py-6 border-b border-slate-100 bg-white sticky top-0 z-10">
               <div className="flex items-center gap-4">
                  <div className="size-12 rounded-2xl flex items-center justify-center font-bold text-white shadow-sm" style={{ backgroundColor: role.color }}>
                     <Shield className="size-6" />
                  </div>
                  <div>
                     <DialogTitle className="text-xl font-black text-slate-900">Permissions : {role.name}</DialogTitle>
                     <DialogDescription className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                        {role.count} collaborateur{role.count > 1 ? 's' : ''} concerné{role.count > 1 ? 's' : ''} · Contrôle d'accès RBAC
                     </DialogDescription>
                  </div>
               </div>
            </DialogHeader>

            <div className="p-8 space-y-6 bg-[#F8FAFC]">
               <div className="bg-white rounded-2xl p-4 border border-slate-100 flex items-center justify-between">
                  <div className="space-y-0.5">
                     <p className="text-xs font-black text-slate-900">Propagation automatique</p>
                     <p className="text-[11px] text-slate-400">Appliquer immédiatement ces droits aux comptes des employés de ce rôle</p>
                  </div>
                  <input 
                     type="checkbox" 
                     checked={applyToUsers} 
                     onChange={e => setApplyToUsers(e.target.checked)}
                     className="size-5 accent-[#4b7bec] rounded cursor-pointer"
                  />
               </div>

               <div className="space-y-4">
                  <div className="flex items-center justify-between">
                     <h4 className="text-xs font-black uppercase text-slate-400 tracking-widest">Matrice des permissions</h4>
                     <span className="text-xs font-bold text-[#4b7bec] bg-indigo-50 px-3 py-1 rounded-xl">{selectedPerms.length} actives</span>
                  </div>

                  {ALL_PERMISSIONS.map(({ group, perms }) => {
                     const allSelected = perms.every(p => selectedPerms.includes(p));
                     const someSelected = perms.some(p => selectedPerms.includes(p));
                     return (
                        <div key={group} className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-2xs">
                           <button type="button" onClick={() => toggleGroup(perms)}
                              className="w-full flex items-center justify-between px-5 py-3 bg-slate-50/80 hover:bg-slate-100/80 transition-all">
                              <span className="text-xs font-black text-slate-700">{group}</span>
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
                                    <span className="truncate font-mono text-[10px]">{p.split('.')[1] || p}</span>
                                 </label>
                              ))}
                           </div>
                        </div>
                     );
                  })}
               </div>
            </div>

            <div className="px-8 py-5 border-t border-slate-100 bg-white flex items-center justify-end gap-3 sticky bottom-0">
               <button onClick={onClose} className="h-12 px-6 rounded-2xl font-black text-[11px] uppercase tracking-widest text-slate-400 hover:bg-slate-50 transition-all">Annuler</button>
               <button onClick={handleSave} disabled={saving}
                  className="h-12 px-8 rounded-2xl bg-[#4b7bec] hover:bg-[#3867d6] text-white font-black text-[11px] uppercase tracking-widest shadow-lg shadow-indigo-200 transition-all disabled:opacity-50">
                  {saving ? <Loader2 className="size-4 animate-spin" /> : `Enregistrer les modifications`}
               </button>
            </div>
         </DialogContent>
      </Dialog>
   );
}

function RolesView({ roles, isLoading, onRefresh, onNewRole }: { roles: RolePermission[]; isLoading: boolean; onRefresh: () => void; onNewRole: () => void }) {
   const [exploredRole, setExploredRole] = useState<RolePermission | null>(null);
   const [editingRole, setEditingRole] = useState<RolePermission | null>(null);

   if (isLoading) return <div className="p-10 flex justify-center"><Loader2 className="size-8 animate-spin text-slate-300" /></div>;
   if (!Array.isArray(roles)) return <div className="p-10 flex justify-center"><Loader2 className="size-8 animate-spin text-slate-300" /></div>;

   return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
         {/* Header */}
         <div className="bg-white rounded-3xl border px-8 py-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4" style={{ borderColor: C.border }}>
            <div className="flex items-center gap-4">
               <div className="size-12 rounded-2xl flex items-center justify-center shadow-inner shrink-0" style={{ backgroundColor: C.primaryBg }}>
                  <Shield className="size-6" style={{ color: C.primary }} />
               </div>
               <div>
                  <h2 className="text-xl font-black text-slate-900">Hiérarchie des rôles & RBAC</h2>
                  <p className="text-xs font-medium text-slate-400 mt-0.5">Structure dynamique des permissions et contrôle d'accès en temps réel</p>
               </div>
            </div>
            <div className="flex items-center gap-3">
               <button onClick={onRefresh} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold border hover:bg-[#F8F9FC] transition-all text-slate-600" style={{ borderColor: C.border }}>
                  <RefreshCw className="size-3.5" /> Rafraîchir
               </button>
               <Button onClick={onNewRole} className="h-10 px-5 rounded-xl text-xs font-bold bg-[#4b7bec] hover:bg-[#3867d6] text-white shadow-md shadow-indigo-100 transition-all flex items-center border-none">
                  <Plus className="mr-1.5 size-3.5 text-white" /> Nouveau rôle
               </Button>
            </div>
         </div>

         {/* Grid Distribution */}
         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {roles.map((r, i) => (
               <div key={i} className="bg-white rounded-3xl border p-6 group hover:shadow-md transition-all flex flex-col justify-between" style={{ borderColor: C.border }}>
                  <div>
                     <div className="flex items-center justify-between mb-4">
                        <div className="size-10 rounded-xl flex items-center justify-center font-black text-white shadow-sm" style={{ backgroundColor: r.color }}>
                           {r.count}
                        </div>
                        <Badge variant="outline" className="text-[10px] font-bold" style={{ color: r.color, borderColor: r.color + '30', backgroundColor: r.color + '10' }}>
                           {r.is_system ? 'Système' : 'Personnalisé'}
                        </Badge>
                     </div>
                     <h3 className="text-sm font-black text-slate-900">{r.name}</h3>
                     <p className="text-xs font-medium text-slate-400 mt-1.5 leading-relaxed min-h-[36px]">{r.description}</p>
                  </div>

                  <div className="mt-5 pt-4 border-t flex items-center justify-between gap-2" style={{ borderColor: C.border }}>
                     <span className="text-[11px] font-bold text-slate-500">{r.permissions.length} permissions</span>
                     <div className="flex items-center gap-1.5">
                        <button 
                           onClick={() => setEditingRole(r)}
                           className="h-8 px-2.5 rounded-lg flex items-center gap-1.5 hover:bg-indigo-50 text-[#4b7bec] text-[11px] font-bold transition-colors">
                           <Settings2 className="size-3.5" /> Modifier
                        </button>
                        <button 
                           onClick={() => setExploredRole(r)}
                           className="size-8 rounded-lg flex items-center justify-center hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors">
                           <Eye className="size-3.5" />
                        </button>
                     </div>
                  </div>
               </div>
            ))}
         </div>

         {/* Detailed Table */}
         <div className="bg-white rounded-3xl border shadow-sm overflow-hidden" style={{ borderColor: C.border }}>
            <div className="overflow-x-auto">
               <table className="w-full text-left">
                  <thead>
                     <tr className="border-b" style={{ borderColor: C.border, backgroundColor: '#FAFBFD' }}>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500">Définition du rôle</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500">Matrice de permissions</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 text-right">Contrôle</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: C.border }}>
                     {roles.map((role) => (
                        <tr key={role.code || role.name} className="hover:bg-[#FAFBFD]/50 transition-colors group">
                           <td className="px-6 py-5 align-top min-w-[200px]">
                              <div className="flex flex-col">
                                 <div className="flex items-center gap-2">
                                    <div className="size-3 rounded-full shrink-0" style={{ backgroundColor: role.color }} />
                                    <span className="text-sm font-black text-slate-900 group-hover:text-[#4b7bec] transition-colors">{role.name}</span>
                                 </div>
                                 <span className="text-xs font-medium text-slate-400 mt-1">{role.description}</span>
                                 <span className="text-[10px] font-bold text-emerald-600 mt-1.5">{role.count} collaborateur{role.count > 1 ? 's' : ''}</span>
                              </div>
                           </td>
                           <td className="px-6 py-5">
                              <div className="flex flex-wrap gap-1.5 max-w-xl">
                                 {role.permissions.slice(0, 12).map((perm) => (
                                    <span key={perm} className="px-2.5 py-1 text-[10px] font-mono font-bold text-slate-600 bg-slate-50 border border-slate-100 rounded-md">
                                       {perm}
                                    </span>
                                 ))}
                                 {role.permissions.length > 12 && (
                                    <span className="px-2 py-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 rounded-md">
                                       +{role.permissions.length - 12} autres
                                    </span>
                                 )}
                              </div>
                           </td>
                           <td className="px-6 py-5 text-right align-top shrink-0">
                              <div className="flex items-center justify-end gap-2">
                                 <button 
                                    onClick={() => setEditingRole(role)} 
                                    className="h-9 px-3.5 rounded-xl flex items-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 text-xs font-bold text-[#4b7bec] transition-all">
                                    <Settings2 className="size-3.5" /> Permissions
                                 </button>
                                 <button 
                                    onClick={() => setExploredRole(role)} 
                                    className="h-9 px-3.5 rounded-xl flex items-center gap-1.5 border hover:bg-slate-50 text-xs font-bold text-slate-600 transition-all shadow-2xs" 
                                    style={{ borderColor: C.border }}>
                                    <Eye className="size-3.5" /> Membres
                                 </button>
                              </div>
                           </td>
                        </tr>
                     ))}
                  </tbody>
               </table>
            </div>
         </div>

         {/* ── Dialog Explorer / Membres du Rôle ── */}
         <Dialog open={!!exploredRole} onOpenChange={(o) => { if (!o) setExploredRole(null); }}>
            <DialogContent className="max-w-xl rounded-[2rem] p-0 gap-0 border-0 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
               {exploredRole && (
                  <>
                     <DialogHeader className="px-8 py-6 border-b border-slate-100 bg-white shrink-0">
                        <div className="flex items-center justify-between">
                           <div className="flex items-center gap-4">
                              <div className="size-12 rounded-xl flex items-center justify-center font-black text-white shadow-sm" style={{ backgroundColor: exploredRole.color }}>
                                 {exploredRole.count}
                              </div>
                              <div>
                                 <DialogTitle className="text-lg font-black text-slate-900">{exploredRole.name}</DialogTitle>
                                 <DialogDescription className="text-xs font-medium text-slate-400 mt-0.5">{exploredRole.description}</DialogDescription>
                              </div>
                           </div>
                           <button 
                              onClick={() => { const r = exploredRole; setExploredRole(null); setEditingRole(r); }}
                              className="h-9 px-3.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-[#4b7bec] text-xs font-bold flex items-center gap-1.5 transition-colors">
                              <Settings2 className="size-3.5" /> Éditer
                           </button>
                        </div>
                     </DialogHeader>

                     <div className="p-8 space-y-6 overflow-y-auto custom-scrollbar flex-1 bg-[#F8FAFC]">
                        {/* Membres assignés */}
                        <div className="space-y-3">
                           <div className="flex items-center justify-between">
                              <h4 className="text-xs font-black uppercase text-slate-400 tracking-widest">Collaborateurs ({exploredRole.members?.length || exploredRole.count})</h4>
                           </div>
                           {exploredRole.members && exploredRole.members.length > 0 ? (
                              <div className="space-y-2">
                                 {exploredRole.members.map((m) => (
                                    <div key={m.id} className="bg-white p-3.5 rounded-2xl border border-slate-100 flex items-center justify-between gap-3 shadow-2xs">
                                       <div className="flex items-center gap-3">
                                          <div className="size-9 rounded-xl bg-slate-900 text-white text-xs font-black flex items-center justify-center shrink-0">
                                             {m.name.charAt(0).toUpperCase()}
                                          </div>
                                          <div>
                                             <p className="text-xs font-black text-slate-900">{m.name}</p>
                                             <p className="text-[10px] text-slate-400">{m.email}</p>
                                          </div>
                                       </div>
                                       <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-100">
                                          {m.is_active ? 'Compte Actif' : 'Inactif'}
                                       </span>
                                    </div>
                                 ))}
                              </div>
                           ) : (
                              <div className="bg-white p-6 rounded-2xl border border-slate-100 text-center text-xs text-slate-400 font-bold">
                                 Aucun collaborateur n'est actuellement assigné à ce rôle
                              </div>
                           )}
                        </div>

                        {/* Permissions list */}
                        <div className="space-y-3">
                           <h4 className="text-xs font-black uppercase text-slate-400 tracking-widest">Permissions actives ({exploredRole.permissions.length})</h4>
                           <div className="flex flex-wrap gap-1.5">
                              {exploredRole.permissions.map((perm) => (
                                 <span key={perm} className="px-2.5 py-1 text-[10px] font-mono font-bold text-slate-700 bg-white border border-slate-200 rounded-lg shadow-2xs">
                                    {perm}
                                 </span>
                              ))}
                           </div>
                        </div>
                     </div>
                  </>
               )}
            </DialogContent>
         </Dialog>

         {/* ── Dialog Édition des Permissions du Rôle ── */}
         <EditRolePermissionsModal
            role={editingRole}
            open={!!editingRole}
            onClose={() => setEditingRole(null)}
            onSuccess={onRefresh}
         />
      </div>
   );
}
// ═══════════════════════════════════════════════════════════════
// Human Infrastructure // Core View
// ═══════════════════════════════════════════════════════════════
interface TeamActivityPoint {
    date: string;
    actions: number;
    orders: number;
    confirmed: number;
    delivered: number;
}

interface TopAgentStat {
    id: string;
    name: string;
    role: string;
    avatar?: string | null;
    confirmed_count: number;
    delivered_count: number;
    total_actions: number;
}

interface InfrastructureStats {
    totalEffectif: number;
    onlineCount: number;
    qualityIndex: number | null;
    interactionDelay: number | null;
    nodeId: string;
    activity_chart?: TeamActivityPoint[];
    top_agents?: TopAgentStat[];
    total_actions_period?: number;
    securityLevel?: string;
}

function InfrastructureView({ stats, logs, isLoading }: { stats: InfrastructureStats; logs: any[]; isLoading: boolean }) {
   if (isLoading) return <div className="p-10 flex justify-center"><Loader2 className="size-8 animate-spin text-slate-300" /></div>;

   const chart = stats.activity_chart || [];
   const maxActions = Math.max(1, ...chart.map(p => p.actions));
   const totalPeriodActions = stats.total_actions_period ?? chart.reduce((acc, p) => acc + p.actions, 0);
   const avgActionsPerDay = chart.length > 0 ? Math.round(totalPeriodActions / chart.length) : 0;
   const topAgents = stats.top_agents || [];

   return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-3 duration-700">
         {/* Human Core Header */}
         <div className="bg-white rounded-[40px] p-8 sm:p-10 border shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden" style={{ borderColor: C.border }}>
            <div className="absolute -top-20 -right-20 size-80 bg-indigo-50/50 rounded-full blur-[80px]" />
            <div className="absolute top-10 right-10 opacity-[0.03] text-indigo-600"><RadioTower className="size-48" /></div>
            
            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
               <div className="flex-1 space-y-4">
                  <div className="flex items-center gap-3">
                     <span className="px-3.5 py-1 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100/50 text-[11px] font-bold flex items-center gap-2">
                        <div className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]" />
                        Infrastructure Live
                     </span>
                     <span className="text-[11px] font-medium text-slate-400 tracking-tight">Cluster : {stats.nodeId || 'DZ-AL-CORE-1'}</span>
                  </div>
                  <div className="space-y-1.5">
                     <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
                        Votre infrastructure <span className="text-[#4b7bec]">humaine</span>
                     </h2>
                     <p className="text-sm font-medium text-slate-500 max-w-lg leading-relaxed">
                        Suivez l'activité des équipes, les volumes d'actions et la confirmation en temps réel synchronisés avec le backend.
                     </p>
                  </div>
               </div>
               
               <div className="flex flex-wrap gap-3.5">
                  <div className="bg-[#F8F9FC] rounded-[24px] p-5 min-w-[150px] border border-slate-100 shadow-xs">
                     <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Effectif total</p>
                     <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-black text-slate-900 tracking-tight">{stats.totalEffectif}</span>
                        <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">{stats.onlineCount} en ligne</span>
                     </div>
                  </div>
                  <div className="bg-indigo-50/50 rounded-[24px] p-5 min-w-[150px] border border-indigo-100/60 shadow-xs">
                     <p className="text-[10px] font-black text-indigo-500 uppercase tracking-wider mb-1.5">Confirmation Équipe</p>
                     <div className="flex items-baseline gap-1.5">
                        <span className="text-3xl font-black text-indigo-600 tracking-tight">{stats.qualityIndex ?? 0}%</span>
                        <span className="text-[10px] font-bold text-indigo-400">moyen</span>
                     </div>
                  </div>
                  <div className="bg-emerald-50/50 rounded-[24px] p-5 min-w-[150px] border border-emerald-100/60 shadow-xs">
                     <p className="text-[10px] font-black text-emerald-600 uppercase tracking-wider mb-1.5">Actions Période</p>
                     <div className="flex items-baseline gap-1.5">
                        <span className="text-3xl font-black text-emerald-700 tracking-tight">{totalPeriodActions}</span>
                        <span className="text-[10px] font-bold text-emerald-500">opérations</span>
                     </div>
                  </div>
               </div>
            </div>
         </div>
         
         <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
            <div className="xl:col-span-2 space-y-8">
               {/* ── Visualiseur d'Activité Dynamique ── */}
               <div className="bg-white rounded-[40px] p-8 sm:p-10 border shadow-sm space-y-6" style={{ borderColor: C.border }}>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                     <div className="flex items-center gap-4">
                        <div className="size-11 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 shadow-sm">
                           <Activity className="size-5" />
                        </div>
                        <div>
                           <h3 className="text-lg font-black text-slate-900 leading-none">Activité des équipes</h3>
                           <p className="text-xs font-medium text-slate-400 mt-1">Évolution des actions, flux de travail et commandes traitées</p>
                        </div>
                     </div>
                     <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100 text-xs font-bold text-slate-600">
                        <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span>Moyenne : <strong className="text-slate-900 font-mono">{avgActionsPerDay}</strong> actions/j</span>
                     </div>
                  </div>
                  
                  {/* Graphique à barres interactif */}
                  <div className="bg-[#FAFBFD] rounded-[28px] p-6 border border-slate-100">
                     {chart.length > 0 ? (
                        <div className="space-y-4">
                           <div className="h-56 flex items-end gap-2 sm:gap-3.5 pt-6 pb-2 overflow-x-auto custom-scrollbar">
                              {chart.map((point, idx) => {
                                 const heightPct = Math.max(8, Math.round((point.actions / maxActions) * 100));
                                 const hasActivity = point.actions > 0;
                                 return (
                                    <div key={idx} className="flex-1 min-w-[38px] max-w-[64px] flex flex-col items-center gap-2 group h-full justify-end">
                                       {/* Tooltip on hover */}
                                       <div className="opacity-0 group-hover:opacity-100 transition-all pointer-events-none mb-1 bg-slate-900 text-white text-[10px] font-bold px-2 py-1 rounded-lg shadow-lg whitespace-nowrap z-20">
                                          <p className="text-emerald-400 font-black">{point.date} : {point.actions} action(s)</p>
                                          <p className="text-slate-300 text-[9px]">{point.orders} cmd · {point.confirmed} conf · {point.delivered} liv</p>
                                       </div>

                                       <span className="text-[10px] font-mono font-bold text-slate-500 group-hover:text-indigo-600 transition-colors">
                                          {point.actions}
                                       </span>

                                       <div className="w-full bg-slate-100 rounded-2xl h-full max-h-[140px] flex items-end p-1 relative overflow-hidden">
                                          <div 
                                             className={cn(
                                                "w-full rounded-xl transition-all duration-500",
                                                hasActivity ? "bg-gradient-to-t from-indigo-600 to-[#4b7bec] shadow-sm group-hover:brightness-110" : "bg-slate-200/60"
                                             )}
                                             style={{ height: `${heightPct}%` }}
                                          />
                                       </div>

                                       <span className="text-[10px] font-bold text-slate-400 group-hover:text-slate-700 transition-colors whitespace-nowrap">
                                          {point.date}
                                       </span>
                                    </div>
                                 );
                              })}
                           </div>
                           <div className="flex items-center justify-between text-[11px] font-medium text-slate-400 pt-3 border-t border-slate-100 px-2">
                              <span className="flex items-center gap-2">
                                 <span className="size-2.5 rounded-md bg-indigo-600" />
                                 <span>Volume total d'actions & changements d'états</span>
                              </span>
                              <span>Période active ({chart.length} jours)</span>
                           </div>
                        </div>
                     ) : (
                        <div className="h-48 flex flex-col items-center justify-center text-slate-400 space-y-2">
                           <Activity className="size-8 text-slate-300" />
                           <p className="text-xs font-bold">Aucune activité enregistrée sur cette période</p>
                        </div>
                     )}
                  </div>

                  {/* ── Top Collaborateurs Actifs ── */}
                  {topAgents.length > 0 && (
                     <div className="pt-2 space-y-3">
                        <div className="flex items-center justify-between">
                           <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">Top Collaborateurs Actifs</h4>
                           <span className="text-[10px] text-slate-400 font-bold">{topAgents.length} membres classés</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                           {topAgents.slice(0, 4).map((agent, i) => (
                              <div key={agent.id} className="bg-[#FAFBFD] p-3.5 rounded-2xl border border-slate-100 flex items-center justify-between gap-3 shadow-2xs hover:border-indigo-100 transition-all">
                                 <div className="flex items-center gap-3 min-w-0">
                                    <div className="size-9 rounded-xl bg-slate-900 text-white text-xs font-black flex items-center justify-center shrink-0">
                                       #{i + 1}
                                    </div>
                                    <div className="min-w-0">
                                       <p className="text-xs font-black text-slate-900 truncate">{agent.name}</p>
                                       <p className="text-[10px] text-slate-400 font-medium">{ROLE_LABELS[agent.role as UserRole] || agent.role}</p>
                                    </div>
                                 </div>
                                 <div className="flex items-center gap-1.5 shrink-0 text-[10px] font-black">
                                    <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200/80">
                                       +{agent.total_actions} actions
                                    </span>
                                 </div>
                              </div>
                           ))}
                        </div>
                     </div>
                  )}
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-white rounded-[32px] border p-7 shadow-sm flex items-center gap-5 hover:border-indigo-100 transition-all group" style={{ borderColor: C.border }}>
                     <div className="size-14 rounded-2xl bg-orange-50 flex items-center justify-center text-orange-500 group-hover:bg-orange-100 transition-colors shrink-0"><Zap className="size-6" /></div>
                     <div>
                        <p className="text-xs font-bold text-slate-400 mb-1">Délai d'interaction</p>
                        <p className="text-2xl font-black text-slate-900 tracking-tight">{stats.interactionDelay ?? 12} min <span className="text-[10px] font-medium text-slate-400">moy.</span></p>
                        <p className="text-[10px] text-slate-400 mt-0.5">Temps moyen de prise en charge d'une commande</p>
                     </div>
                  </div>
                  <div className="bg-amber-50/50 rounded-[32px] border border-amber-200/60 p-6 flex items-center justify-between gap-4 shadow-2xs">
                     <div className="flex items-center gap-4">
                        <div className="size-12 rounded-2xl bg-amber-100 flex items-center justify-center text-amber-600 shrink-0">
                           <Activity className="size-6" />
                        </div>
                        <div>
                           <h4 className="text-xs font-black text-amber-900 uppercase tracking-tight">Vigilance SLA (2h)</h4>
                           <p className="text-[11px] font-medium text-amber-700/80 mt-0.5">Alerte automatique si commande non traitée dans les 120 min.</p>
                        </div>
                     </div>
                     <div className="px-3.5 py-1.5 bg-amber-100 rounded-xl text-amber-800 text-[10px] font-black uppercase tracking-wider shrink-0">Actif</div>
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


// ═══════════════════════════════════════════════════════════════
// Unified Team & Staff Management Sub-View
// ═══════════════════════════════════════════════════════════════
function UnifiedTeamView({
   employees,
   marketers,
   isLoading,
   onCreate,
   onEdit,
   onDeactivate,
   onDelete,
   onOpenSalary,
   storeId,
}: {
   employees: any[];
   marketers: MarketerPerformance[];
   isLoading: boolean;
   onCreate: () => void;
   onEdit: (emp: any) => void;
   onDeactivate: (emp: any) => void;
   onDelete: (emp: any) => void;
   onOpenSalary: (emp: any) => void;
   storeId: string;
}) {
   const [search, setSearch] = useState('');
   const [roleFilter, setRoleFilter] = useState<string>('ALL');
   const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
   const [page, setPage] = useState(1);
   const pageSize = 15;

   // Single bulk query for agents performance summary
   const perfQuery = useQuery({
      queryKey: ['employees', 'performance-summary', storeId],
      queryFn: () => apiFetch(`/api/v1/users/performance-summary?store_id=${storeId}`),
      enabled: !!storeId,
   });

   const perfData = (perfQuery.data as any)?.data ?? perfQuery.data ?? [];
   const perfByAgent = Array.isArray(perfData)
      ? Object.fromEntries(perfData.map((p: any) => [p.user_id, p]))
      : {};

   const marketersByEmail = Array.isArray(marketers)
      ? Object.fromEntries(marketers.map((m: any) => [m.email?.toLowerCase(), m]))
      : {};

   // Role Counts
   const totalStaff = employees.length;
   const activeStaff = employees.filter(e => e.is_active).length;
   const confirmateursCount = employees.filter(e => e.role === 'CONFIRMATEUR').length;
   const livreursCount = employees.filter(e => e.role === 'LIVREUR').length;
   const marketersCount = employees.filter(e => e.role === 'MARKETER').length;
   const adminsCount = employees.filter(e => ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(e.role)).length;

   // Filter Logic
   const filtered = employees.filter(emp => {
      // Role filter
      if (roleFilter === 'CONFIRMATEUR' && emp.role !== 'CONFIRMATEUR') return false;
      if (roleFilter === 'LIVREUR' && emp.role !== 'LIVREUR') return false;
      if (roleFilter === 'MARKETER' && emp.role !== 'MARKETER') return false;
      if (roleFilter === 'ADMINS' && !['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(emp.role)) return false;

      // Status filter
      if (statusFilter === 'ACTIVE' && !emp.is_active) return false;
      if (statusFilter === 'INACTIVE' && emp.is_active) return false;

      // Search query
      if (search.trim()) {
         const q = search.toLowerCase().trim();
         const matchName = (emp.name || '').toLowerCase().includes(q);
         const matchEmail = (emp.email || '').toLowerCase().includes(q);
         const matchPhone = (emp.phone || '').toLowerCase().includes(q);
         const matchId = (emp.id || '').toLowerCase().includes(q);
         const matchCode = (emp.tracking_code || emp.promo_code || '').toLowerCase().includes(q);
         if (!matchName && !matchEmail && !matchPhone && !matchId && !matchCode) return false;
      }

      return true;
   });

   const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
   const pageSafe = Math.min(page, totalPages);
   const paginatedEmployees = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

   return (
      <div className="space-y-6 animate-in fade-in duration-500">
         {/* ── Top Metric Cards Grid ── */}
         <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5 sm:gap-4">
            <div className="bg-white rounded-[24px] border border-slate-100 p-4 sm:p-5 shadow-xs space-y-1.5">
               <div className="flex items-center justify-between">
                  <span className="size-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-base">👥</span>
                  <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">GLOBAL</span>
               </div>
               <div>
                  <p className="text-xl sm:text-2xl font-black text-slate-800 tabular-nums">{totalStaff}</p>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Total Équipe</p>
               </div>
            </div>

            <div className="bg-white rounded-[24px] border border-slate-100 p-4 sm:p-5 shadow-xs space-y-1.5">
               <div className="flex items-center justify-between">
                  <span className="size-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-base">🟢</span>
                  <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">{totalStaff > 0 ? Math.round((activeStaff / totalStaff) * 100) : 0}%</span>
               </div>
               <div>
                  <p className="text-xl sm:text-2xl font-black text-emerald-600 tabular-nums">{activeStaff}</p>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Comptes Actifs</p>
               </div>
            </div>

            <div className="bg-white rounded-[24px] border border-slate-100 p-4 sm:p-5 shadow-xs space-y-1.5">
               <div className="flex items-center justify-between">
                  <span className="size-8 rounded-xl bg-indigo-50 text-[#4b7bec] flex items-center justify-center text-base">📞</span>
                  <span className="text-[9px] font-black text-[#4b7bec] bg-indigo-50 px-2 py-0.5 rounded-full">VENTE</span>
               </div>
               <div>
                  <p className="text-xl sm:text-2xl font-black text-slate-800 tabular-nums">{confirmateursCount}</p>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Confirmatrices</p>
               </div>
            </div>

            <div className="bg-white rounded-[24px] border border-slate-100 p-4 sm:p-5 shadow-xs space-y-1.5">
               <div className="flex items-center justify-between">
                  <span className="size-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center text-base">🚚</span>
                  <span className="text-[9px] font-black text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">TERRAIN</span>
               </div>
               <div>
                  <p className="text-xl sm:text-2xl font-black text-slate-800 tabular-nums">{livreursCount}</p>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Livreurs Interne</p>
               </div>
            </div>

            <div className="bg-white rounded-[24px] border border-slate-100 p-4 sm:p-5 shadow-xs space-y-1.5">
               <div className="flex items-center justify-between">
                  <span className="size-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center text-base">📣</span>
                  <span className="text-[9px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">TRAFIC</span>
               </div>
               <div>
                  <p className="text-xl sm:text-2xl font-black text-slate-800 tabular-nums">{marketersCount}</p>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Marketers / Affiliés</p>
               </div>
            </div>

            <div className="bg-white rounded-[24px] border border-slate-100 p-4 sm:p-5 shadow-xs space-y-1.5">
               <div className="flex items-center justify-between">
                  <span className="size-8 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center text-base">🛡️</span>
                  <span className="text-[9px] font-black text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full">SYSTÈME</span>
               </div>
               <div>
                  <p className="text-xl sm:text-2xl font-black text-slate-800 tabular-nums">{adminsCount}</p>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Admins & Direction</p>
               </div>
            </div>
         </div>

         {/* ── Search, Filters & Action Bar ── */}
         <div className="bg-white rounded-[32px] border border-slate-100 p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
               {/* Search Input */}
               <div className="relative flex-1 max-w-lg">
                  <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <input
                     value={search}
                     onChange={e => { setSearch(e.target.value); setPage(1); }}
                     placeholder="Rechercher par nom, email, téléphone, code promo..."
                     className="w-full h-11 pl-11 pr-4 bg-slate-50 border border-slate-200/80 rounded-2xl text-xs font-bold text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#4b7bec]/20 focus:border-[#4b7bec]"
                  />
               </div>

               {/* Right Actions */}
               <div className="flex items-center gap-3 flex-wrap">
                  {/* Status Toggle */}
                  <div className="flex items-center bg-slate-50 p-1 rounded-xl border border-slate-200/80 text-[11px] font-black">
                     <button
                        onClick={() => { setStatusFilter('ALL'); setPage(1); }}
                        className={cn("px-3 py-1.5 rounded-lg transition-all", statusFilter === 'ALL' ? "bg-white text-slate-800 shadow-xs" : "text-slate-400 hover:text-slate-600")}
                     >
                        Tous
                     </button>
                     <button
                        onClick={() => { setStatusFilter('ACTIVE'); setPage(1); }}
                        className={cn("px-3 py-1.5 rounded-lg transition-all", statusFilter === 'ACTIVE' ? "bg-emerald-50 text-emerald-700 shadow-xs font-black" : "text-slate-400 hover:text-slate-600")}
                     >
                        🟢 Actifs
                     </button>
                     <button
                        onClick={() => { setStatusFilter('INACTIVE'); setPage(1); }}
                        className={cn("px-3 py-1.5 rounded-lg transition-all", statusFilter === 'INACTIVE' ? "bg-rose-50 text-rose-700 shadow-xs font-black" : "text-slate-400 hover:text-slate-600")}
                     >
                        ⚪ Inactifs
                     </button>
                  </div>

                  <button
                     onClick={onCreate}
                     className="h-11 px-5 rounded-2xl bg-[#4b7bec] hover:bg-[#3867d6] text-white text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-md shadow-blue-500/20 transition-all shrink-0"
                  >
                     <Plus className="size-4" />
                     <span>Nouvel Employé</span>
                  </button>
               </div>
            </div>

            {/* Quick Role Tabs */}
            <div className="flex items-center gap-2 overflow-x-auto pt-2 border-t border-slate-100 custom-scrollbar pb-1">
               <button
                  onClick={() => { setRoleFilter('ALL'); setPage(1); }}
                  className={cn(
                     "px-3.5 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all shrink-0 flex items-center gap-1.5",
                     roleFilter === 'ALL' ? "bg-slate-900 text-white shadow-xs" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  )}
               >
                  <span>Tous</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/20">{totalStaff}</span>
               </button>

               <button
                  onClick={() => { setRoleFilter('CONFIRMATEUR'); setPage(1); }}
                  className={cn(
                     "px-3.5 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all shrink-0 flex items-center gap-1.5",
                     roleFilter === 'CONFIRMATEUR' ? "bg-[#4b7bec] text-white shadow-xs" : "bg-blue-50 text-[#4b7bec] hover:bg-blue-100/80"
                  )}
               >
                  <span>📞 Confirmatrices</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/30">{confirmateursCount}</span>
               </button>

               <button
                  onClick={() => { setRoleFilter('LIVREUR'); setPage(1); }}
                  className={cn(
                     "px-3.5 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all shrink-0 flex items-center gap-1.5",
                     roleFilter === 'LIVREUR' ? "bg-purple-600 text-white shadow-xs" : "bg-purple-50 text-purple-700 hover:bg-purple-100/80"
                  )}
               >
                  <span>🚚 Livreurs</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/30">{livreursCount}</span>
               </button>

               <button
                  onClick={() => { setRoleFilter('MARKETER'); setPage(1); }}
                  className={cn(
                     "px-3.5 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all shrink-0 flex items-center gap-1.5",
                     roleFilter === 'MARKETER' ? "bg-amber-600 text-white shadow-xs" : "bg-amber-50 text-amber-700 hover:bg-amber-100/80"
                  )}
               >
                  <span>📣 Marketers & Affiliés</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/30">{marketersCount}</span>
               </button>

               <button
                  onClick={() => { setRoleFilter('ADMINS'); setPage(1); }}
                  className={cn(
                     "px-3.5 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all shrink-0 flex items-center gap-1.5",
                     roleFilter === 'ADMINS' ? "bg-slate-700 text-white shadow-xs" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  )}
               >
                  <span>🛡️ Admins & Managers</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/30">{adminsCount}</span>
               </button>
            </div>
         </div>

         {/* ── Unified Employee Table ── */}
         <div className="bg-white rounded-[32px] border border-slate-100 overflow-hidden shadow-sm">
            {isLoading ? (
               <div className="p-12 text-center space-y-4">
                  <Loader2 className="size-8 mx-auto animate-spin text-[#4b7bec]" />
                  <p className="text-xs font-bold text-slate-400">Chargement des collaborateurs...</p>
               </div>
            ) : paginatedEmployees.length === 0 ? (
               <div className="p-16 text-center space-y-3">
                  <div className="size-16 rounded-3xl bg-slate-50 flex items-center justify-center text-2xl mx-auto text-slate-300">
                     👥
                  </div>
                  <h3 className="text-sm font-black text-slate-700 uppercase">Aucun collaborateur trouvé</h3>
                  <p className="text-xs text-slate-400 font-medium">Modifiez vos filtres ou ajoutez un nouveau membre d'équipe.</p>
               </div>
            ) : (
               <div className="overflow-x-auto">
                  <table className="w-full text-left min-w-[1050px]">
                     <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/80">
                           <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Collaborateur</th>
                           <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Contact & Téléphone</th>
                           <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Rôle & Affectation</th>
                           <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Performance / Ventes</th>
                           <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Rémunération</th>
                           <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Statut</th>
                           <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Actions</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-100">
                        {paginatedEmployees.map((emp) => {
                           const isAdm = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(emp.role);
                           const isConf = emp.role === 'CONFIRMATEUR';
                           const isLiv = emp.role === 'LIVREUR';
                           const isMkt = emp.role === 'MARKETER';

                           // Performance Stats
                           const stats = perfByAgent[emp.id] ?? {};
                           const totalAssigned = stats.total_assigned ?? 0;
                           const confirmed = stats.confirmed_count ?? 0;
                           const delivered = stats.delivered_count ?? 0;
                           const confRate = stats.confirmation_rate ?? (totalAssigned > 0 ? Math.round((confirmed / totalAssigned) * 100) : null);

                           // Marketer Stats if applicable
                           const mktStats = marketersByEmail[emp.email?.toLowerCase()] ?? {};

                           // Salary Info
                           const paymentType = emp.payment_type ?? '';
                           const paymentAmount = emp.payment_amount ?? 0;
                           const computedSalary = stats.salary ?? (paymentType === 'MONTHLY_SALARY' ? paymentAmount : delivered * paymentAmount);

                           // Role Color Styling
                           const roleBadgeStyles: Record<string, string> = {
                              SUPER_ADMIN: 'bg-slate-900 text-white border-slate-800',
                              ADMIN: 'bg-indigo-900 text-white border-indigo-800',
                              MANAGER: 'bg-amber-100 text-amber-900 border-amber-200',
                              CONFIRMATEUR: 'bg-blue-50 text-[#4b7bec] border-blue-200',
                              LIVREUR: 'bg-purple-50 text-purple-700 border-purple-200',
                              MARKETER: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                           };

                           return (
                              <tr key={emp.id} className="hover:bg-slate-50/70 transition-colors group">
                                 {/* 1. Identity */}
                                 <td className="px-6 py-4">
                                    <div className="flex items-center gap-3.5">
                                       <div className={cn(
                                          "size-10 rounded-2xl flex items-center justify-center text-sm font-black text-white shadow-xs relative",
                                          isAdm ? "bg-slate-800" : isConf ? "bg-[#4b7bec]" : isLiv ? "bg-purple-600" : isMkt ? "bg-emerald-600" : "bg-slate-600"
                                       )}>
                                          {(emp.name || 'U').charAt(0).toUpperCase()}
                                          {emp.is_active && (
                                             <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 border-2 border-white" />
                                          )}
                                       </div>
                                       <div>
                                          <span className="text-sm font-black text-slate-900 block group-hover:text-[#4b7bec] transition-colors">
                                             {emp.name}
                                          </span>
                                          <span className="text-[10px] font-mono font-bold text-slate-400">
                                             ID: {emp.id.slice(0, 8)}
                                          </span>
                                       </div>
                                    </div>
                                 </td>

                                 {/* 2. Contact */}
                                 <td className="px-6 py-4">
                                    <div className="space-y-1 text-xs">
                                       <div className="flex items-center gap-1.5 text-slate-600 font-medium">
                                          <Mail className="size-3 text-slate-400 shrink-0" />
                                          <span className="truncate max-w-[160px]">{emp.email}</span>
                                       </div>
                                       <div className="flex items-center gap-1.5 text-slate-700 font-bold font-mono">
                                          <Phone className="size-3 text-slate-400 shrink-0" />
                                          <span>{emp.phone || 'Non renseigné'}</span>
                                       </div>
                                    </div>
                                 </td>

                                 {/* 3. Role & Assignment */}
                                 <td className="px-6 py-4">
                                    <div className="space-y-1">
                                       <span className={cn(
                                          "inline-block px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider border",
                                          roleBadgeStyles[emp.role] || 'bg-slate-100 text-slate-700 border-slate-200'
                                       )}>
                                          {ROLE_LABELS[emp.role as UserRole] || emp.role}
                                       </span>
                                       {emp.assigned_wilayas && emp.assigned_wilayas.length > 0 && (
                                          <p className="text-[10px] text-slate-400 font-medium truncate max-w-[180px]">
                                             📍 {emp.assigned_wilayas.join(', ')}
                                          </p>
                                       )}
                                       {(emp.tracking_code || emp.promo_code) && (
                                          <p className="text-[10px] text-emerald-600 font-mono font-bold">
                                             🎟️ {emp.tracking_code || emp.promo_code}
                                          </p>
                                       )}
                                    </div>
                                 </td>

                                 {/* 4. Performance */}
                                 <td className="px-6 py-4 text-center">
                                    {isConf ? (
                                       <div className="flex flex-col items-center gap-0.5">
                                          <div className="flex items-center gap-1 font-mono">
                                             <span className="text-xs font-black text-slate-900">{confRate != null ? `${confRate}%` : '—'}</span>
                                             <span className="text-[10px] text-slate-400">conf.</span>
                                          </div>
                                          <span className="text-[10px] text-slate-500 font-medium">{confirmed}/{totalAssigned} cmd</span>
                                       </div>
                                    ) : isLiv ? (
                                       <div className="flex flex-col items-center gap-0.5 font-mono">
                                          <span className="text-xs font-black text-purple-700">{delivered} livrés</span>
                                          <span className="text-[10px] text-slate-400 font-medium">livraison directe</span>
                                       </div>
                                    ) : isMkt ? (
                                       <div className="flex flex-col items-center gap-0.5 font-mono">
                                          <span className="text-xs font-black text-emerald-600">{mktStats.delivered_orders || 0} ventes</span>
                                          <span className="text-[10px] text-slate-400 font-medium">{formatPrice(mktStats.revenue || 0)}</span>
                                       </div>
                                    ) : (
                                       <span className="text-[11px] font-bold text-slate-400">Accès Système</span>
                                    )}
                                 </td>

                                 {/* 5. Salary & Payout */}
                                 <td className="px-6 py-4 text-center">
                                    <div className="flex flex-col items-center gap-1">
                                       <span className="text-xs font-black text-slate-900 font-mono">
                                          {paymentType === 'MONTHLY_SALARY'
                                             ? `${Number(paymentAmount).toLocaleString()} DA`
                                             : paymentType === 'PER_DELIVERED_ORDER'
                                             ? `${Number(computedSalary).toLocaleString()} DA`
                                             : '—'}
                                       </span>
                                       <span className="text-[9px] text-slate-400 uppercase font-bold">
                                          {paymentType === 'MONTHLY_SALARY' ? 'Fixe mensuel' : paymentType === 'PER_DELIVERED_ORDER' ? 'Commissions' : 'Non configuré'}
                                       </span>
                                       {emp.payday && (
                                          <button
                                             onClick={() => onOpenSalary(emp)}
                                             className="text-[9px] font-bold text-[#4b7bec] hover:underline flex items-center gap-0.5"
                                          >
                                             <Banknote className="size-2.5" /> Fiche Paie (le {emp.payday})
                                          </button>
                                       )}
                                    </div>
                                 </td>

                                 {/* 6. Status */}
                                 <td className="px-6 py-4 text-center">
                                    <button
                                       onClick={() => onDeactivate(emp)}
                                       className={cn(
                                          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black transition-all",
                                          emp.is_active ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-500 border border-slate-200"
                                       )}
                                    >
                                       <span className={cn("size-1.5 rounded-full", emp.is_active ? "bg-emerald-500" : "bg-slate-400")} />
                                       <span>{emp.is_active ? 'Actif' : 'Inactif'}</span>
                                    </button>
                                 </td>

                                 {/* 7. Actions */}
                                 <td className="px-6 py-4 text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                       <button
                                          onClick={() => onOpenSalary(emp)}
                                          className="size-8 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-600 flex items-center justify-center transition-all border border-slate-200/60"
                                          title="Bulletin & Calculateur de Salaire"
                                       >
                                          <Banknote className="size-3.5" />
                                       </button>
                                       <button
                                          onClick={() => onEdit(emp)}
                                          className="size-8 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-[#4b7bec] flex items-center justify-center transition-all border border-slate-200/60"
                                          title="Modifier l'employé"
                                       >
                                          <Pencil className="size-3.5" />
                                       </button>
                                       <button
                                          onClick={() => onDelete(emp)}
                                          className="size-8 rounded-xl bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 flex items-center justify-center transition-all border border-slate-200/60"
                                          title="Supprimer définitivement"
                                       >
                                          <Trash className="size-3.5" />
                                       </button>
                                    </div>
                                 </td>
                              </tr>
                           );
                        })}
                     </tbody>
                  </table>
               </div>
            )}

            {/* Pagination */}
            <TablePagination
               total={filtered.length}
               page={pageSafe}
               totalPages={totalPages}
               onPageChange={setPage}
            />
         </div>
      </div>
   );
}


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
      payday: '' as number | '',
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
            payday: editingEmployee.payday ?? '',
            assigned_store_scope: editingEmployee.assigned_store_ids?.length > 0 ? 'SPECIFIC' : (editingEmployee.assigned_store_id ? 'SPECIFIC' : 'ALL'),
            assigned_store_ids: editingEmployee.assigned_store_ids || (editingEmployee.assigned_store_id ? [editingEmployee.assigned_store_id] : []),
            assigned_product_ids: editingEmployee.assigned_product_ids || [],
            permissions: editingEmployee.permissions || [],
            module_visibility: editingEmployee.module_visibility || { orders: true, inventory: true, deliveries: true, transfers: true, returns: true, analytics: true, products: true, customers: true, finances: true, promotions: true },
         });
      } else if (open) {
         setFormData({ name: '', email: '', password: '', phone: '', role: '', daily_target: 10, is_active: true, payment_type: '', payment_amount: '', payment_recovered_cart: '', payment_lost_cart: '', payment_upsell: '', payment_marketplace_upsell_only: '', payment_store_pickup: 100, payment_recovered_store_pickup: 150, payday: '', assigned_store_scope: 'ALL', assigned_store_ids: [], assigned_product_ids: [], permissions: [], module_visibility: { orders: true, inventory: true, deliveries: true, transfers: true, returns: true, analytics: true, products: true, customers: true, finances: true, promotions: true } });
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
         payday: formData.payday ? Number(formData.payday) : null,
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

                        {/* Jour de Décaissement Mensuel (Date de paie) */}
                        <div className="space-y-1.5 border-t border-emerald-100/50 pt-3 mt-3">
                           <Label className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5">
                              <Calendar className="size-3.5 text-emerald-600" />
                              <span>Jour de décaissement mensuel (Date de paie)</span>
                           </Label>
                           <Select
                              value={formData.payday ? String(formData.payday) : 'NONE'}
                              onValueChange={(val) => setFormData(p => ({ ...p, payday: val === 'NONE' ? '' : Number(val) }))}
                           >
                              <SelectTrigger className="h-10 border-emerald-100 rounded-lg bg-white">
                                 <SelectValue placeholder="Choisir le jour du mois..." />
                              </SelectTrigger>
                              <SelectContent className="bg-white border-[#E9ECF0] rounded-xl max-h-56">
                                 <SelectItem value="NONE">Non configuré</SelectItem>
                                 {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                                    <SelectItem key={day} value={String(day)}>
                                       Le {day} de chaque mois {day === 28 ? '(Recommandé)' : day === 1 ? '(1er du mois)' : ''}
                                    </SelectItem>
                                 ))}
                              </SelectContent>
                           </Select>
                           <p className="text-[10px] text-slate-500 font-medium">
                              Un rappel automatique s'affichera chaque mois pour l'administrateur à cette date pour procéder au décaissement du salaire.
                           </p>
                        </div>

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
   const [activeTab, setActiveTab] = useState(adminSubView || 'team');
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
      enabled: true,
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

   const now = new Date();
   const currentDay = now.getDate();
   const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
   const currentMonthLabel = now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

   const markPaidMutation = useMutation({
      mutationFn: ({ userId, month }: { userId: string; month?: string }) =>
         apiFetch(`/api/v1/users/${userId}/salary/mark-paid`, {
            method: 'POST',
            body: JSON.stringify({ month: month || currentMonthStr })
         }),
      onSuccess: (res: any) => {
         queryClient.invalidateQueries({ queryKey: ['employees'] });
         toast.success(res?.message || 'Salaire marqué comme décaissé ✓');
      },
      onError: (err: any) => toast.error(err?.message || 'Erreur lors de la mise à jour'),
   });

   const duePayouts = React.useMemo(() => {
      return employees.filter((emp: any) => {
         if (!emp.is_active || !emp.payday) return false;
         const isPaidThisMonth = emp.last_salary_paid_month === currentMonthStr;
         if (isPaidThisMonth) return false;
         return currentDay >= emp.payday;
      });
   }, [employees, currentDay, currentMonthStr]);

   const [calculatorEmployee, setCalculatorEmployee] = useState<any | null>(null);

   return (
      <div className="space-y-5 pb-28 animate-in fade-in duration-700">
         {/* ── Dialog Paie rapide depuis rappel ── */}
         {calculatorEmployee && (
            <SalaryCalculatorDialog 
               open={!!calculatorEmployee} 
               onOpenChange={(o) => { if (!o) setCalculatorEmployee(null); }} 
               employee={calculatorEmployee} 
            />
         )}

         {/* ── 🔔 BANDEAU DE RAPPEL DE DÉCAISSEMENT MENSUEL ── */}
         {duePayouts.length > 0 && (
            <div className="bg-gradient-to-r from-amber-500/10 via-amber-50/90 to-emerald-50/90 border border-amber-200 rounded-[28px] p-5 sm:p-6 shadow-sm space-y-4">
               <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3.5">
                     <div className="size-11 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-lg shadow-amber-500/30 shrink-0">
                        <Bell className="size-5 animate-bounce" />
                     </div>
                     <div>
                        <div className="flex items-center gap-2">
                           <span className="text-[10px] font-black uppercase tracking-wider text-amber-800 bg-amber-200/80 px-2.5 py-0.5 rounded-full border border-amber-300">
                              Rappels Décaissements de Salaires
                           </span>
                           <span className="text-xs font-bold text-slate-500 capitalize">
                              {currentMonthLabel}
                           </span>
                        </div>
                        <h3 className="text-sm sm:text-base font-black text-slate-900 mt-1">
                           {duePayouts.length} collaborateur{duePayouts.length > 1 ? 's' : ''} à décaisser ce mois-ci
                        </h3>
                     </div>
                  </div>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
                  {duePayouts.map((emp: any) => {
                     const isToday = currentDay === emp.payday;
                     return (
                        <div key={emp.id} className="bg-white rounded-2xl p-4 border border-amber-200/80 shadow-xs flex flex-col justify-between space-y-3 hover:border-amber-300 transition-all">
                           <div className="flex items-start justify-between gap-2">
                              <div>
                                 <p className="font-black text-slate-900 text-sm">{emp.name}</p>
                                 <p className="text-[11px] text-slate-400 font-medium">
                                    {ROLE_LABELS[emp.role as UserRole] || emp.role} · {emp.payment_type === 'MONTHLY_SALARY' ? `${formatPrice(emp.payment_amount || 0)} (Fixe)` : 'Commissions par colis'}
                                 </p>
                              </div>
                              <span className={cn(
                                 "px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider whitespace-nowrap",
                                 isToday ? "bg-emerald-100 text-emerald-800 border border-emerald-200" : "bg-amber-100 text-amber-800 border border-amber-200"
                              )}>
                                 {isToday ? `Aujourd'hui (le ${emp.payday})` : `Dû le ${emp.payday}`}
                              </span>
                           </div>

                           <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                              <button
                                 type="button"
                                 onClick={() => markPaidMutation.mutate({ userId: emp.id })}
                                 disabled={markPaidMutation.isPending}
                                 className="flex-1 h-8 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-black tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                              >
                                 <Check className="size-3.5" />
                                 <span>C'est Décaissé ✓</span>
                              </button>
                              <button
                                 type="button"
                                 onClick={() => setCalculatorEmployee(emp)}
                                 className="h-8 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold transition-all flex items-center gap-1"
                                 title="Ouvrir le bulletin de paie détaillé"
                              >
                                 <Banknote className="size-3.5" />
                                 <span className="hidden sm:inline">Détail</span>
                              </button>
                           </div>
                        </div>
                     );
                  })}
               </div>
            </div>
         )}

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
            {(activeTab === 'team' || activeTab === 'agents' || activeTab === 'admins' || activeTab === 'marketers') && (
               <UnifiedTeamView
                  employees={employees}
                  marketers={marketersQuery.data?.data || (Array.isArray(marketersQuery.data) ? marketersQuery.data : [])}
                  isLoading={employeesQuery.isLoading}
                  onCreate={handleCreate}
                  onEdit={handleEdit}
                  onDeactivate={handleDeactivate}
                  onDelete={handleDelete}
                  onOpenSalary={(emp) => setCalculatorEmployee(emp)}
                  storeId={storeId}
               />
            )}
            {activeTab === 'infra' && (
               <InfrastructureView
                  stats={
                     ((infraQuery.data as any)?.totalEffectif !== undefined
                        ? (infraQuery.data as any)
                        : (infraQuery.data as any)?.data) || {
                        totalEffectif: employees.length,
                        onlineCount: Math.min(employees.length, 1),
                        qualityIndex: 0,
                        interactionDelay: 12,
                        nodeId: 'DZ-AL-CORE-1',
                        activity_chart: [],
                        top_agents: [],
                        total_actions_period: 0
                     }
                  }
                  logs={
                     Array.isArray(auditQuery.data)
                        ? auditQuery.data
                        : auditQuery.data?.items || auditQuery.data?.data || []
                  }
                  isLoading={infraQuery.isLoading && employeesQuery.isLoading}
               />
            )}
            {activeTab === 'roles' && <RolesView roles={(Array.isArray(rolesQuery.data) ? rolesQuery.data : rolesQuery.data?.data) || []} isLoading={rolesQuery.isLoading} onRefresh={() => rolesQuery.refetch()} onNewRole={() => setNewRoleModalOpen(true)} />}
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

   const normalDeliveredCalc = stats.normal_delivered_count ?? Math.max(0, delivered - (stats.recovered_delivered_count || 0));
   const normalSalaryCalc = paymentType === 'MONTHLY_SALARY' ? paymentAmount : normalDeliveredCalc * paymentAmount;
   const recoveredBonusCalc = paymentType === 'MONTHLY_SALARY' ? 0 : (stats.recovered_delivered_count || 0) * (stats.payment_recovered_cart || 150);
   const marketplaceBonusCalc = paymentType === 'MONTHLY_SALARY' ? 0 : (stats.marketplace_delivered_count || 0) * (stats.payment_marketplace_upsell_only || 50);
   const upsellBonusCalc = paymentType === 'MONTHLY_SALARY' ? 0 : (stats.upsell_bonus || 0);
   const returnedPenaltyCalc = paymentType === 'MONTHLY_SALARY' ? 0 : (stats.returned_penalty || 0);

   const computedSalary = paymentType === 'MONTHLY_SALARY' 
     ? paymentAmount 
     : Math.max(0, normalSalaryCalc + recoveredBonusCalc + marketplaceBonusCalc + upsellBonusCalc - returnedPenaltyCalc);
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
                                    {normalDeliveredCalc} × {formatPrice(paymentAmount)} = {formatPrice(normalSalaryCalc)}
                                 </span>
                              </div>

                              {/* Paniers abandonnés récupérés & livrés */}
                              <div className="flex justify-between items-center text-xs font-bold text-amber-800 bg-amber-50 p-3 rounded-2xl border border-amber-200/60">
                                 <span className="flex items-center gap-1.5 font-bold">
                                    <span className="size-2 rounded-full bg-amber-500 animate-pulse"></span>
                                    Paniers abandonnés récupérés & livrés
                                 </span>
                                 <span className="font-mono font-black text-amber-900">
                                    + {stats.recovered_delivered_count || 0} × {formatPrice(stats.payment_recovered_cart || 150)} = +{formatPrice(recoveredBonusCalc)}
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
                                       + {stats.marketplace_delivered_count || 0} × {formatPrice(stats.payment_marketplace_upsell_only || 50)} = +{formatPrice(marketplaceBonusCalc)}
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
