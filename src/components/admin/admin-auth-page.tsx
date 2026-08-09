'use client';

import { useState, type FormEvent } from 'react';
import {
  Loader2, Lock, Eye, EyeOff, ArrowRight,
  Settings2, KeyRound, ShieldCheck,
  UserCircle2, UserPlus, LogIn, CheckCircle2, Phone, Mail, User
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppStore } from '@/store/app-store';
import { apiFetch } from '@/lib/api-client';
import { cn } from '@/lib/utils';

// ─── Customer Auth Section ───────────────────────────────────────
// ─── Customer Auth Section ───────────────────────────────────────
function CustomerAuthSection() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const setUser = useAppStore((s) => s.setUser);
  const setAppView = useAppStore((s) => s.setAppView);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!email.trim() || !password) { setError('Email et mot de passe requis'); return; }
    setLoading(true);
    try {
      const data = await apiFetch<any>('/api/v1/auth', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!data.success || !data.data) { setError(data.message ?? 'Identifiants incorrects'); return; }
      const u = data.data.user;
      setUser(u);
      toast.success(`Bienvenue, ${u.name} !`);
      
      // Automatic role-based redirection
      if (['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CONFIRMATEUR', 'LIVREUR', 'MARKETER', 'AGENT'].includes(u.role)) {
        setAppView('admin');
      } else {
        setAppView('storefront');
      }
    } catch (err: any) {
      setError(err.message || 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!name.trim() || !email.trim() || !password) { setError('Tous les champs obligatoires doivent être remplis'); return; }
    if (password.length < 8) { setError('Mot de passe trop court (min. 8 caractères)'); return; }
    setLoading(true);
    try {
      const data = await apiFetch<any>('/api/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password, phone: phone.trim() || undefined }),
      });
      if (!data.success || !data.data) { setError(data.message ?? 'Erreur lors de la création'); return; }
      const u = data.data.user;
      setUser(u);
      toast.success(`Compte créé avec succès ! Bienvenue, ${u.name} 🎉`);
      
      // Automatic role-based redirection
      if (['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CONFIRMATEUR', 'LIVREUR', 'MARKETER', 'AGENT'].includes(u.role)) {
        setAppView('admin');
      } else {
        setAppView('storefront');
      }
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la création du compte');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Mode toggle */}
      <div className="flex bg-slate-50 rounded-2xl p-1.5 gap-1">
        <button
          type="button"
          onClick={() => { setMode('login'); setError(''); }}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all",
            mode === 'login'
              ? "bg-white text-[#4b7bec] shadow-sm"
              : "text-slate-400 hover:text-slate-600"
          )}
        >
          <LogIn className="size-3.5" /> Se connecter
        </button>
        <button
          type="button"
          onClick={() => { setMode('register'); setError(''); }}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all",
            mode === 'register'
              ? "bg-white text-[#6C5CE7] shadow-sm"
              : "text-slate-400 hover:text-slate-600"
          )}
        >
          <UserPlus className="size-3.5" /> Créer un compte
        </button>
      </div>

      {error && (
        <div className="p-4 bg-orange-50 border border-orange-100 rounded-2xl text-sm font-bold text-orange-700 text-center">
          {error}
        </div>
      )}
      {success && (
        <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl text-sm font-bold text-emerald-700 text-center flex items-center justify-center gap-2">
          <CheckCircle2 className="size-4" />{success}
        </div>
      )}

      {mode === 'login' ? (
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 flex items-center gap-1.5">
              <Mail className="size-3" /> Email
            </Label>
            <Input
              type="email"
              placeholder="votre@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-13 bg-slate-50 border-transparent focus:border-[#4b7bec] focus:bg-white rounded-2xl px-5 font-semibold transition-all focus:ring-0 py-4"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Mot de passe</Label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-13 bg-slate-50 border-transparent focus:border-[#4b7bec] focus:bg-white rounded-2xl px-5 font-semibold transition-all focus:ring-0 pr-12 py-4"
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#4b7bec] transition-colors">
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          <Button type="submit" disabled={loading}
            className="w-full bg-[#4b7bec] hover:bg-[#3867d6] text-white font-black rounded-2xl shadow-lg shadow-[#4b7bec]/20 transition-all active:scale-[0.98] py-6">
            {loading ? <Loader2 className="size-5 animate-spin" /> : <span className="flex items-center gap-2">Connexion <ArrowRight className="size-4" /></span>}
          </Button>
        </form>
      ) : (
        <form onSubmit={handleRegister} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 flex items-center gap-1.5">
              <User className="size-3" /> Nom complet <span className="text-rose-400">*</span>
            </Label>
            <Input
              placeholder="Prénom Nom"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-13 bg-slate-50 border-transparent focus:border-[#6C5CE7] focus:bg-white rounded-2xl px-5 font-semibold transition-all focus:ring-0 py-4"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 flex items-center gap-1.5">
              <Mail className="size-3" /> Email <span className="text-rose-400">*</span>
            </Label>
            <Input
              type="email"
              placeholder="votre@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-13 bg-slate-50 border-transparent focus:border-[#6C5CE7] focus:bg-white rounded-2xl px-5 font-semibold transition-all focus:ring-0 py-4"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 flex items-center gap-1.5">
              <Phone className="size-3" /> Téléphone <span className="text-slate-300 font-medium normal-case">(optionnel)</span>
            </Label>
            <Input
              type="tel"
              placeholder="+213 0X XX XX XX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="h-13 bg-slate-50 border-transparent focus:border-[#6C5CE7] focus:bg-white rounded-2xl px-5 font-semibold transition-all focus:ring-0 py-4"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
              Mot de passe <span className="text-rose-400">*</span>
            </Label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder="Min. 8 caractères"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-13 bg-slate-50 border-transparent focus:border-[#6C5CE7] focus:bg-white rounded-2xl px-5 font-semibold transition-all focus:ring-0 pr-12 py-4"
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#6C5CE7] transition-colors">
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          <p className="text-[10px] text-slate-400 font-medium px-1">
            En créant un compte, vous acceptez nos conditions d'utilisation et notre politique de confidentialité.
          </p>
          <Button type="submit" disabled={loading}
            className="w-full bg-[#6C5CE7] hover:bg-[#5a4dd0] text-white font-black rounded-2xl shadow-lg shadow-[#6C5CE7]/20 transition-all active:scale-[0.98] py-6">
            {loading ? <Loader2 className="size-5 animate-spin" /> : <span className="flex items-center gap-2"><UserPlus className="size-4" /> Créer mon compte</span>}
          </Button>
        </form>
      )}
    </div>
  );
}

// ─── Main Auth Page ──────────────────────────────────────────────
export function AdminAuthPage() {
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

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-6 selection:bg-[#4b7bec] selection:text-white">
      <div className="w-full max-w-[460px] animate-in fade-in slide-in-from-bottom-4 duration-700">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-5 p-3 rounded-2xl bg-white shadow-sm border border-slate-100 min-h-[100px] min-w-[100px] relative overflow-hidden">
            <span className="absolute inset-0 flex items-center justify-center text-3xl font-black text-[#6C5CE7] select-none bg-slate-50">
              A
            </span>
            <img 
              src="/azzougshop_logo.png" 
              alt="AzzougShop Logo" 
              className="h-24 w-auto max-w-[200px] object-contain drop-shadow-sm select-none relative z-10 bg-white" 
              onError={(e) => {
                const target = e.currentTarget;
                if (target.src.includes('azzougshop_logo')) {
                  target.src = '/brand-icon-primary.png';
                } else if (target.src.includes('brand-icon-primary')) {
                  target.src = '/icon.png';
                } else {
                  target.style.display = 'none';
                }
              }}
            />
          </div>
          <p className="text-slate-400 font-medium tracking-tight text-sm">AzzougShop · Votre portail d'accès</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-[32px] p-8 shadow-sm border border-slate-100">
          <div className="mb-6">
            <h1 className="text-xl font-black text-slate-900 tracking-tight">Bienvenue sur AzzougShop</h1>
            <p className="text-xs text-slate-400 font-medium mt-1">Connectez-vous ou créez un compte pour continuer</p>
          </div>
          <CustomerAuthSection />
        </div>

        {/* Footer */}
        <div className="mt-8 text-center space-y-4">
          <button
            onClick={() => setAppView('storefront')}
            className="text-sm font-bold text-slate-400 hover:text-[#4b7bec] transition-colors flex items-center justify-center gap-2 mx-auto"
          >
            ← Revenir à la boutique publique
          </button>
          <div className="pt-6 flex items-center justify-center gap-6 opacity-30">
            <Settings2 className="size-4 text-slate-900" />
            <KeyRound className="size-4 text-slate-900" />
            <ShieldCheck className="size-4 text-slate-900" />
          </div>
        </div>
      </div>
    </div>
  );
}
