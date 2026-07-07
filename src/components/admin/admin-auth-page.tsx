'use client';

import { useState, type FormEvent } from 'react';
import { 
  Loader2, 
  Lock, 
  Eye, 
  EyeOff, 
  ArrowRight, 
  UserCircle2,
  Settings2,
  KeyRound,
  ShieldCheck
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppStore } from '@/store/app-store';
import { apiFetch } from '@/lib/api-client';
import { cn } from '@/lib/utils';

export function AdminAuthPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const setAppView = useAppStore((s) => s.setAppView);
  const setUser = useAppStore((s) => s.setUser);
  const logout = useAppStore((s) => s.logout);
  const user = useAppStore((s) => s.user);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  const isStaff = user && ['SUPER_ADMIN', 'MANAGER', 'CONFIRMATEUR'].includes(user.role);

  if (isAuthenticated && !isStaff) {
    return (
       <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-center">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-[32px] p-12 shadow-sm space-y-8 animate-in fade-in zoom-in duration-500">
             <div className="size-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
                <Lock className="size-10" />
             </div>
             <div className="space-y-4">
                <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Accès restreint</h1>
                <p className="text-slate-500 leading-relaxed font-medium">
                  Désolé <span className="text-slate-900 font-bold">{user?.name}</span>, votre compte n'est pas autorisé à accéder à cette zone.
                </p>
             </div>
             <div className="flex flex-col gap-3">
                <Button onClick={() => setAppView('storefront')} className="h-14 bg-[#4b7bec] hover:bg-[#3867d6] text-white font-bold rounded-2xl shadow-lg shadow-[#4b7bec]/20 transition-all">
                  Retourner à la boutique
                </Button>
                <button onClick={() => logout()} className="text-xs font-bold text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors py-2">
                  Changer de compte
                </button>
             </div>
          </div>
       </div>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('Veuillez remplir tous les champs');
      return;
    }

    setLoading(true);

    try {
      const data = await apiFetch<any>('/api/v1/auth', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (!data.success || !data.data) {
        setError(data.message ?? 'Identifiants incorrects');
        return;
      }

      const { user: loggedInUser } = data.data;
      
      if (['SUPER_ADMIN', 'MANAGER', 'CONFIRMATEUR'].includes(loggedInUser.role)) {
        setUser(loggedInUser);
        toast.success(`Content de vous revoir, ${loggedInUser.name}`);
        setAppView('admin');
      } else {
        setError("Cet accès est réservé uniquement au personnel.");
        logout();
      }
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue lors de la connexion.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-6 selection:bg-[#4b7bec] selection:text-white">
      
      <div className="w-full max-w-[440px] animate-in fade-in slide-in-from-bottom-4 duration-700">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center mb-6">
             <img 
               src="/azzougshop_logo.png" 
               alt="AzzougShop Logo" 
               className="h-40 w-auto drop-shadow-sm select-none"
             />
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-2">Espace Admin</h1>
          <p className="text-slate-500 font-medium tracking-tight">AzzougShop • Connectez-vous pour gérer votre boutique</p>
        </div>

        {/* Login Form */}
        <div className="bg-white rounded-[32px] p-10 shadow-sm border border-slate-200">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="p-4 bg-orange-50 border border-orange-100 rounded-2xl text-sm font-bold text-orange-700 text-center">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Email Professionnel</Label>
              <Input 
                type="email"
                placeholder="nom@azzougshop.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-14 bg-slate-50 border-transparent focus:border-[#4b7bec] focus:bg-white rounded-2xl px-5 text-slate-900 font-semibold transition-all shadow-inner focus:ring-0"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between ml-1">
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Mot de passe</Label>
                <button type="button" className="text-[11px] font-bold text-[#4b7bec] hover:underline transition-all">Oublié ?</button>
              </div>
              <div className="relative">
                <Input 
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-14 bg-slate-50 border-transparent focus:border-[#4b7bec] focus:bg-white rounded-2xl px-5 text-slate-900 font-semibold transition-all shadow-inner focus:ring-0 pr-12"
                />
                <button 
                  type="button" 
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 size-8 flex items-center justify-center text-slate-400 hover:text-[#4b7bec] transition-colors"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <Button 
              type="submit" 
              disabled={loading}
              className="w-full h-15 bg-[#4b7bec] hover:bg-[#3867d6] text-white font-bold text-base rounded-2xl shadow-lg shadow-[#4b7bec]/20 transition-all active:scale-[0.98] mt-2 py-7"
            >
              {loading ? <Loader2 className="size-6 animate-spin" /> : (
                <span className="flex items-center gap-2">
                  Se connecter <ArrowRight className="size-5" />
                </span>
              )}
            </Button>
          </form>
        </div>

        {/* Footer */}
        <div className="mt-12 text-center space-y-4">
           <button 
            onClick={() => setAppView('storefront')}
            className="text-sm font-bold text-slate-400 hover:text-[#4b7bec] transition-colors flex items-center justify-center gap-2 mx-auto"
           >
             ← Revenir à la boutique publique
           </button>
           
           <div className="pt-8 flex items-center justify-center gap-6 opacity-40">
              <Settings2 className="size-4 text-slate-900" />
              <KeyRound className="size-4 text-slate-900" />
              <ShieldCheck className="size-4 text-slate-900" />
           </div>
        </div>
      </div>
    </div>
  );
}
