'use client';

import { useState, type FormEvent } from 'react';
import { 
  Loader2, 
  Lock, 
  Eye, 
  EyeOff, 
  X, 
  ArrowRight, 
  ChevronRight, 
  Mail, 
  Chrome, 
  ShoppingBag,
  User as UserIcon,
  ShoppingBasket,
  LayoutGrid,
  ShieldCheck
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppStore } from '@/store/app-store';
import { useCartStore } from '@/store/cart-store';
import { cn } from '@/lib/utils';
import type { User } from '@/store/app-store';

interface LoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface LoginResponse {
  success: boolean;
  data?: {
    user: User;
  };
  message?: string;
  code?: string;
  retryAfter?: number;
}

export function LoginDialog({ open, onOpenChange }: LoginDialogProps) {
  const [view, setView] = useState<'main' | 'login' | 'register'>('main');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const setAppView = useAppStore((s) => s.setAppView);
  const setUser = useAppStore((s) => s.setUser);
  const activeStore = useAppStore((s) => s.activeStore);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('Required protocol missing.');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/v1/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data: LoginResponse = await response.json();

      if (!data.success || !data.data) {
        if (response.status === 429) {
          const retryMin = Math.ceil((data.retryAfter ?? 900) / 60);
          setError(`Rate limit reached. Sync in ${retryMin}m.`);
        } else {
          setError(data.message ?? 'Authentication rejected.');
        }
        return;
      }

      const { user } = data.data;
      setUser(user);
      toast.success('Sync Successful', { description: `Welcome back, ${user.name}.` });
      onOpenChange(false);

      if (user.role === 'SUPER_ADMIN' || user.role === 'MANAGER') {
        setAppView('admin');
      }
    } catch {
      setError('Communication loss. Retry suggested.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim() || !email.trim() || !password) {
      setError('Required protocol missing.');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        credentials: 'include',
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password, phone: phone.trim() }),
      });

      const data = await response.json();

      if (!data.success || !data.data) {
        setError(data.message ?? 'Registration rejected.');
        return;
      }

      const { user } = data.data;
      setUser(user);
      toast.success('Protocol Initiated', { description: `Welcome, ${user.name}.` });
      onOpenChange(false);
    } catch {
      setError('Communication loss. Retry suggested.');
    } finally {
      setLoading(false);
    }
  };

  const closeDrawer = () => {
     onOpenChange(false);
     setTimeout(() => setView('main'), 300);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[480px] p-0 bg-white border-l border-slate-200 flex flex-col h-full selection:bg-[#4b7bec] selection:text-white">
        <SheetHeader className="sr-only">
          <SheetTitle>Authentification Client</SheetTitle>
        </SheetHeader>
        
        {/* 1. Brand Header */}
        <div className="px-8 pt-10 pb-6 flex items-center justify-between border-b border-slate-50">
           <div className="flex items-center gap-3">
              <div className="size-12 rounded-xl bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
                 {activeStore?.logo_url || activeStore?.logo ? (
                   <img src={activeStore.logo_url || activeStore.logo!} alt={activeStore.name} className="size-full object-contain p-2" />
                 ) : (
                   <div className="size-full bg-indigo-50 flex items-center justify-center text-indigo-600 font-black text-xl">{activeStore?.name?.charAt(0)}</div>
                 )}
              </div>
              <div>
                <h2 className="text-xl font-black tracking-tight text-slate-900 leading-none">
                  {activeStore?.name || 'AzzougShop'}
                </h2>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300 mt-1">Boutique Officielle</p>
              </div>
           </div>
           <button onClick={closeDrawer} className="size-10 bg-slate-50 rounded-full flex items-center justify-center transition-colors hover:bg-slate-100">
              <X className="size-5 text-slate-400" />
           </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          
          {view === 'main' ? (
            <div className="p-8 space-y-10 animate-in fade-in slide-in-from-right-4 duration-500">
              
              {/* 2. Primary Actions */}
              <div className="space-y-6">
                 <h3 className="text-sm font-bold text-slate-400">Identifiez-vous pour continuer</h3>
                  <div className="space-y-3">
                    <Button 
                      onClick={() => setView('login')}
                      className="w-full h-14 bg-[#4b7bec] text-white font-bold text-sm hover:bg-[#3867d6] rounded-xl transition-all shadow-lg shadow-[#4b7bec]/10"
                    >
                       Se connecter
                    </Button>
                    <Button 
                      onClick={() => setView('register')}
                      variant="outline"
                      className="w-full h-14 border-2 border-slate-100 text-slate-900 font-bold text-sm hover:bg-slate-50 rounded-xl transition-all"
                    >
                       Créer un compte
                    </Button>
                    <Button 
                      variant="outline"
                      className="w-full h-14 border-2 border-slate-100 text-slate-900 font-bold text-sm hover:bg-slate-50 rounded-xl transition-all flex items-center justify-center gap-3"
                    >
                       <Chrome className="size-5 text-slate-400" /> Continuer avec Google
                    </Button>
                  </div>
                 <p className="text-xs text-slate-400 leading-relaxed font-medium">
                   En vous connectant, vous acceptez nos <span className="underline cursor-pointer text-[#4b7bec]">conditions d'utilisation</span>.
                 </p>
              </div>

              <div className="h-px bg-neutral-100 w-full" />

              <div className="space-y-6">
                <div className="pt-4">
                   <button className="flex items-center gap-2 group" onClick={() => toast.info("Besoin d'aide ?", { description: "Notre support est disponible via le chat en bas à droite." })}>
                      <span className="text-[12px] font-black tracking-[0.2em] border-b-2 border-black pb-1">CENTRE D'AIDE & FAQ</span>
                      <ChevronRight className="size-3 group-hover:translate-x-1 transition-transform" />
                   </button>
                </div>
              </div>

            </div>
          ) : (
            <div className="p-8 space-y-10 animate-in fade-in slide-in-from-left-4 duration-500">
               <div className="space-y-2">
                 <button onClick={() => setView('main')} className="text-xs font-bold text-[#4b7bec] flex items-center gap-2 mb-4 hover:underline">
                    <ChevronRight className="size-4 rotate-180" /> Retour
                 </button>
                 <h3 className="text-3xl font-bold text-slate-900 tracking-tight">{view === 'login' ? 'Connexion' : 'Nouvelle Identité'}</h3>
                 <p className="text-sm font-medium text-slate-400">{view === 'login' ? 'Heureux de vous revoir' : 'Rejoignez la communauté AzzougShop'}.</p>
               </div>

               {error && <div className="p-4 bg-orange-50 border border-orange-100 rounded-2xl text-sm font-bold text-orange-700 text-center animate-in fade-in zoom-in">{error}</div>}

               <form onSubmit={view === 'login' ? handleSubmit : handleRegister} className="space-y-6">
                 {view === 'register' && (
                    <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                       <Label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Nom complet</Label>
                       <Input 
                          placeholder="Ex: Selma Hacii"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="h-14 bg-slate-50 border-transparent focus:border-[#4b7bec] focus:bg-white rounded-2xl px-5 text-slate-900 font-semibold transition-all shadow-inner focus:ring-0"
                       />
                    </div>
                 )}
                 <div className="space-y-2">
                   <Label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Adresse Email</Label>
                   <Input 
                      placeholder="votre@email.fr"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-14 bg-slate-50 border-transparent focus:border-[#4b7bec] focus:bg-white rounded-2xl px-5 text-slate-900 font-semibold transition-all shadow-inner focus:ring-0"
                   />
                 </div>
                 {view === 'register' && (
                    <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                       <Label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Téléphone</Label>
                       <Input 
                          placeholder="05XXXXXXXX"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          className="h-14 bg-slate-50 border-transparent focus:border-[#4b7bec] focus:bg-white rounded-2xl px-5 text-slate-900 font-semibold transition-all shadow-inner focus:ring-0"
                       />
                    </div>
                 )}
                 <div className="space-y-2">
                   <Label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Mot de passe</Label>
                   <div className="relative">
                      <Input 
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-14 bg-slate-50 border-transparent focus:border-[#4b7bec] focus:bg-white rounded-2xl px-5 text-slate-900 font-semibold transition-all shadow-inner focus:ring-0 pr-12"
                      />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#4b7bec] transition-colors">
                         {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                   </div>
                 </div>

                 <Button 
                    type="submit"
                    disabled={loading}
                    className="w-full h-14 bg-[#4b7bec] hover:bg-[#3867d6] text-white font-bold text-sm rounded-xl shadow-lg shadow-[#4b7bec]/20 transition-all active:scale-[0.98]"
                 >
                    {loading ? <Loader2 className="size-6 animate-spin" /> : (view === 'login' ? 'Se connecter' : 'Créer mon compte')}
                 </Button>
               </form>
               <div className="text-center pt-4">
                  <button 
                    onClick={() => setView(view === 'login' ? 'register' : 'login')}
                    className="text-sm font-bold text-slate-400 hover:text-[#4b7bec] transition-colors"
                  >
                    {view === 'login' ? "Nouveau ici ? Créez un compte" : "Déjà inscrit ? Connectez-vous"}
                  </button>
               </div>
            </div>
          )}
        </div>

        {/* 4. Terminal Bottom Navigation */}
        <div className="h-20 bg-slate-50 border-t flex items-center justify-around px-4">
           <button className="flex flex-col items-center gap-1.5 group">
              <span className="text-[9px] font-black tracking-[0.2em] text-black">FOR YOU</span>
              <div className="h-1 w-8 bg-black scale-x-100" />
           </button>
           <button className="flex flex-col items-center gap-1.5 group text-neutral-400 hover:text-black transition-colors">
              <span className="text-[9px] font-black tracking-[0.2em]">ORDERS</span>
              <div className="h-1 w-8 bg-black scale-x-0 group-hover:scale-x-50 transition-transform" />
           </button>
           <button className="flex flex-col items-center gap-1.5 group text-neutral-400 hover:text-black transition-colors">
              <span className="text-[9px] font-black tracking-[0.2em]">PROFILE</span>
              <div className="h-1 w-8 bg-black scale-x-0 group-hover:scale-x-50 transition-transform" />
           </button>
        </div>

      </SheetContent>
    </Sheet>
  );
}
