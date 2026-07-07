'use client';

import { useState, type FormEvent } from 'react';
import {
  Loader2, Eye, EyeOff, X, ArrowLeft,
  ShoppingBag, User as UserIcon, Home, Chrome,
} from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';
import type { User } from '@/store/app-store';

interface LoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface LoginResponse {
  success: boolean;
  data?: { user: User };
  message?: string;
  retryAfter?: number;
}

type Tab = 'home' | 'orders' | 'profile';
type View = 'main' | 'login' | 'register';

// ─── Tab bar ──────────────────────────────────────────────────────────────────

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'home',    label: 'Accueil',    icon: <Home className="size-[18px]" /> },
  { key: 'orders',  label: 'Commandes',  icon: <ShoppingBag className="size-[18px]" /> },
  { key: 'profile', label: 'Profil',     icon: <UserIcon className="size-[18px]" /> },
];

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="flex border-b border-slate-100">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            'flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-bold uppercase tracking-widest transition-colors',
            active === tab.key
              ? 'text-slate-900 border-b-2 border-slate-900 -mb-px'
              : 'text-slate-400 hover:text-slate-600'
          )}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ─── Input ────────────────────────────────────────────────────────────────────

function Field({
  label, type = 'text', placeholder, value, onChange, suffix,
}: {
  label: string; type?: string; placeholder: string;
  value: string; onChange: (v: string) => void; suffix?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-slate-500">{label}</label>
      <div className="relative">
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-11 px-4 pr-10 text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400 focus:bg-white transition-colors placeholder:text-slate-300"
        />
        {suffix && <div className="absolute right-3 top-1/2 -translate-y-1/2">{suffix}</div>}
      </div>
    </div>
  );
}

// ─── Auth forms ───────────────────────────────────────────────────────────────

function LoginForm({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const setUser = useAppStore((s) => s.setUser);
  const setAppView = useAppStore((s) => s.setAppView);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) { setError('Remplissez tous les champs.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/v1/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data: LoginResponse = await res.json();
      if (!data.success || !data.data) {
        if (res.status === 429) {
          const min = Math.ceil((data.retryAfter ?? 900) / 60);
          setError(`Trop de tentatives. Réessayez dans ${min} min.`);
        } else {
          setError(data.message ?? 'Email ou mot de passe incorrect.');
        }
        return;
      }
      const { user } = data.data;
      setUser(user);
      toast.success(`Bienvenue, ${user.name} !`);
      onClose();
      if (['SUPER_ADMIN', 'MANAGER', 'CONFIRMATEUR', 'LIVREUR'].includes(user.role)) setAppView('admin');
    } catch {
      setError('Erreur réseau. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="size-8 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors">
          <ArrowLeft className="size-4 text-slate-400" />
        </button>
        <div>
          <h3 className="text-base font-bold text-slate-900">Se connecter</h3>
          <p className="text-xs text-slate-400">Bon retour parmi nous</p>
        </div>
      </div>

      {error && (
        <p className="px-3 py-2.5 bg-red-50 border border-red-100 rounded-lg text-xs font-medium text-red-600">{error}</p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Adresse e-mail" type="email" placeholder="votre@email.com" value={email} onChange={setEmail} />
        <Field
          label="Mot de passe" type={showPw ? 'text' : 'password'} placeholder="••••••••"
          value={password} onChange={setPassword}
          suffix={
            <button type="button" onClick={() => setShowPw(!showPw)} className="text-slate-400 hover:text-slate-600 transition-colors">
              {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          }
        />
        <button
          type="submit" disabled={loading}
          className="w-full h-11 rounded-lg bg-slate-900 text-white text-sm font-bold hover:bg-slate-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : 'Se connecter'}
        </button>
      </form>
    </div>
  );
}

function RegisterForm({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const setUser = useAppStore((s) => s.setUser);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim() || !email.trim() || !password) { setError('Remplissez tous les champs obligatoires.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'include',
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password, phone: phone.trim() }),
      });
      const data = await res.json();
      if (!data.success || !data.data) { setError(data.message ?? 'Inscription impossible. Réessayez.'); return; }
      const { user } = data.data;
      setUser(user);
      toast.success(`Compte créé ! Bienvenue, ${user.name}.`);
      onClose();
    } catch {
      setError('Erreur réseau. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="size-8 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors">
          <ArrowLeft className="size-4 text-slate-400" />
        </button>
        <div>
          <h3 className="text-base font-bold text-slate-900">Créer un compte</h3>
          <p className="text-xs text-slate-400">C'est rapide et gratuit</p>
        </div>
      </div>

      {error && (
        <p className="px-3 py-2.5 bg-red-50 border border-red-100 rounded-lg text-xs font-medium text-red-600">{error}</p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Nom complet *" placeholder="Selma Hacii" value={name} onChange={setName} />
        <Field label="Adresse e-mail *" type="email" placeholder="votre@email.com" value={email} onChange={setEmail} />
        <Field label="Téléphone" placeholder="05XXXXXXXX" value={phone} onChange={setPhone} />
        <Field
          label="Mot de passe *" type={showPw ? 'text' : 'password'} placeholder="Min. 8 caractères"
          value={password} onChange={setPassword}
          suffix={
            <button type="button" onClick={() => setShowPw(!showPw)} className="text-slate-400 hover:text-slate-600 transition-colors">
              {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          }
        />
        <button
          type="submit" disabled={loading}
          className="w-full h-11 rounded-lg bg-slate-900 text-white text-sm font-bold hover:bg-slate-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : 'Créer mon compte'}
        </button>
      </form>
    </div>
  );
}

// ─── Tab screens ──────────────────────────────────────────────────────────────

function HomeTab({ setView }: { setView: (v: View) => void }) {
  const activeStore = useAppStore((s) => s.activeStore);
  const primary = (activeStore?.theme_config?.primaryColor as string) || '#0f172a';

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-3">
        <button
          onClick={() => setView('login')}
          className="w-full h-11 rounded-lg text-white text-sm font-bold transition-colors hover:opacity-90 active:scale-[0.99]"
          style={{ backgroundColor: primary }}
        >
          Se connecter
        </button>
        <button
          onClick={() => setView('register')}
          className="w-full h-11 rounded-lg border border-slate-200 text-slate-900 text-sm font-bold hover:bg-slate-50 transition-colors"
        >
          Créer un compte
        </button>
        <button className="w-full h-11 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors flex items-center justify-center gap-2.5">
          <Chrome className="size-4 text-slate-400" />
          Continuer avec Google
        </button>
      </div>

      <p className="text-xs text-slate-400 leading-relaxed">
        En vous connectant, vous acceptez nos{' '}
        <span className="underline cursor-pointer text-slate-600">conditions d'utilisation</span>.
      </p>

      <div className="pt-2 border-t border-slate-100">
        <button
          onClick={() => toast.info("Besoin d'aide ?", { description: 'Contactez notre support via le chat.' })}
          className="text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors underline underline-offset-2"
        >
          Centre d'aide & FAQ
        </button>
      </div>
    </div>
  );
}

function OrdersTab() {
  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[260px] text-center gap-3">
      <ShoppingBag className="size-8 text-slate-200" />
      <p className="text-sm font-semibold text-slate-400">Connectez-vous pour voir vos commandes</p>
    </div>
  );
}

function ProfileTab() {
  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[260px] text-center gap-3">
      <UserIcon className="size-8 text-slate-200" />
      <p className="text-sm font-semibold text-slate-400">Connectez-vous pour accéder à votre profil</p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LoginDialog({ open, onOpenChange }: LoginDialogProps) {
  const [tab, setTab] = useState<Tab>('home');
  const [view, setView] = useState<View>('main');
  const activeStore = useAppStore((s) => s.activeStore);

  const close = () => {
    onOpenChange(false);
    setTimeout(() => { setView('main'); setTab('home'); }, 300);
  };

  const isFormView = view === 'login' || view === 'register';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[400px] p-0 border-l border-slate-100 flex flex-col">
        <SheetHeader className="sr-only">
          <SheetTitle>Mon compte</SheetTitle>
        </SheetHeader>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden shrink-0">
              {activeStore?.logo_url || activeStore?.logo ? (
                <img src={activeStore.logo_url || activeStore.logo!} alt={activeStore.name} className="size-full object-contain p-1" />
              ) : (
                <span className="text-sm font-black text-slate-600">{activeStore?.name?.charAt(0)}</span>
              )}
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900 leading-none">{activeStore?.name || 'Boutique'}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Boutique Officielle</p>
            </div>
          </div>
          <button onClick={close} className="size-8 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors">
            <X className="size-4 text-slate-400" />
          </button>
        </div>

        {/* Tab bar — hidden when in form view */}
        {!isFormView && (
          <TabBar active={tab} onChange={(t) => { setTab(t); setView('main'); }} />
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isFormView ? (
            view === 'login'
              ? <LoginForm onBack={() => setView('main')} onClose={close} />
              : <RegisterForm onBack={() => setView('main')} onClose={close} />
          ) : (
            <>
              {tab === 'home'    && <HomeTab setView={setView} />}
              {tab === 'orders'  && <OrdersTab />}
              {tab === 'profile' && <ProfileTab />}
            </>
          )}
        </div>

      </SheetContent>
    </Sheet>
  );
}
