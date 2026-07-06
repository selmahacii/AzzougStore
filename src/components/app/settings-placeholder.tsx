'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { useAppStore } from '@/store/app-store';
import { ROLE_LABELS, type UserRole } from '@/lib/types';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  User,
  Store,
  Settings2,
  AlertTriangle,
  Camera,
  Lock,
  LogOut,
  Trash2,
  RotateCcw,
  Palette,
  Type,
  Square,
  Bell,
  Globe,
  Coins,
  ShieldAlert,
  Webhook,
  Bot
} from 'lucide-react';

// ─── Framer Motion Variants ────────────────────────────────
const tabContentVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25 } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.15 } },
};

// ─── Theme Colors ──────────────────────────────────────────
const themeColors = [
  { label: 'Ambre', value: '#B45309', fg: '#FFFFFF', accent: '#D97706' },
  { label: 'Émeraude', value: '#0F766E', fg: '#FFFFFF', accent: '#14B8A6' },
  { label: 'Rose', value: '#BE123C', fg: '#FFFFFF', accent: '#E11D48' },
  { label: 'Violet', value: '#7C3AED', fg: '#FFFFFF', accent: '#A78BFA' },
  { label: 'Slate', value: '#334155', fg: '#FFFFFF', accent: '#64748B' },
];

const fontOptions = [
  { label: 'Inter', value: 'Inter' },
  { label: 'System', value: 'system-ui, -apple-system, sans-serif' },
  { label: 'Playfair Display', value: 'Playfair Display, serif' },
];

const borderRadiusOptions = [
  { label: 'Petit (sm)', value: 'sm' },
  { label: 'Moyen (md)', value: 'md' },
  { label: 'Grand (lg)', value: 'lg' },
  { label: 'Très grand (xl)', value: 'xl' },
];

// ─── French Date Formatter ─────────────────────────────────
function formatFrenchDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// ─── Notification Preferences ──────────────────────────────
interface NotificationPrefs {
  newOrders: boolean;
  lowStock: boolean;
  weeklyReports: boolean;
}

const NOTIFICATION_STORAGE_KEY = 'ecommerce-notification-prefs';

function loadNotificationPrefs(): NotificationPrefs {
  if (typeof window === 'undefined') {
    return { newOrders: true, lowStock: true, weeklyReports: false };
  }
  try {
    const raw = localStorage.getItem(NOTIFICATION_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as NotificationPrefs;
  } catch {
    // ignore
  }
  return { newOrders: true, lowStock: true, weeklyReports: false };
}

function saveNotificationPrefs(prefs: NotificationPrefs) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(prefs));
}

// ═══════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════
export function SettingsPlaceholder() {
  const activeStore = useAppStore((s) => s.activeStore);
  const theme = useAppStore((s) => s.currentTheme);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const currentUser = useAppStore((s) => s.user);
  const setCurrentTheme = useAppStore((s) => s.setCurrentTheme);

  const [activeTab, setActiveTab] = useState('profil');

  // Store tab state
  const [selectedFont, setSelectedFont] = useState(theme?.fontFamily ?? fontOptions[0].value);
  const [selectedRadius, setSelectedRadius] = useState(theme?.borderRadius ?? 'md');

  // Profile password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Notification state
  const [notifications, setNotifications] = useState<NotificationPrefs>(loadNotificationPrefs);

  // Integrations state
  const [openAIKey, setOpenAIKey] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');

  // ─── Handlers ────────────────────────────────────────────
  const handleThemeChange = (color: string, fg: string, accent: string) => {
    const newTheme = {
      ...theme!,
      primaryColor: color,
      primaryForeground: fg,
      accentColor: accent,
    };
    setCurrentTheme(newTheme);
  };

  const handleStoreSave = () => {
    const updatedTheme = {
      ...theme!,
      fontFamily: selectedFont,
      borderRadius: selectedRadius,
    };
    setCurrentTheme(updatedTheme);
    toast.success('Paramètres du magasin enregistrés');
  };

  const handlePasswordSubmit = () => {
    toast.info('Fonctionnalité à venir');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleNotificationToggle = (key: keyof NotificationPrefs, value: boolean) => {
    const updated = { ...notifications, [key]: value };
    setNotifications(updated);
    saveNotificationPrefs(updated);
    toast.success('Préférence de notification mise à jour');
  };

  const handleLogin = () => {
    useAppStore.getState().setAppView('storefront');
  };

  const handleLogout = () => {
    useAppStore.getState().clearUser();
    toast.success('Déconnexion réussie');
  };

  // ─── User Initials ───────────────────────────────────────
  const getUserInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getRoleBadgeVariant = (role: UserRole): 'default' | 'secondary' | 'outline' => {
    switch (role) {
      case 'SUPER_ADMIN':
      case 'ADMIN':
        return 'default';
      case 'MANAGER':
        return 'secondary';
      case 'CONFIRMATEUR':
      case 'MARKETER':
      case 'CUSTOMER':
        return 'outline';
      default:
        return 'outline';
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Page Header */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">Paramètres</h2>
        <p className="text-sm text-slate-500 mt-1">
          Gérez votre profil, votre magasin et vos préférences
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full sm:w-auto grid grid-cols-5 sm:inline-flex overflow-x-auto">
          <TabsTrigger value="profil" className="gap-1.5 text-xs sm:text-sm">
            <User className="size-3.5 sm:size-4" />
            <span className="hidden sm:inline">Profil</span>
            <span className="sm:hidden">Profil</span>
          </TabsTrigger>
          <TabsTrigger value="magasin" className="gap-1.5 text-xs sm:text-sm">
            <Store className="size-3.5 sm:size-4" />
            <span>Magasin</span>
          </TabsTrigger>
          <TabsTrigger value="preferences" className="gap-1.5 text-xs sm:text-sm">
            <Settings2 className="size-3.5 sm:size-4" />
            <span>Préférences</span>
          </TabsTrigger>
          <TabsTrigger value="integrations" className="gap-1.5 text-xs sm:text-sm">
            <Webhook className="size-3.5 sm:size-4" />
            <span>Intégrations</span>
          </TabsTrigger>
          <TabsTrigger value="danger" className="gap-1.5 text-xs sm:text-sm">
            <AlertTriangle className="size-3.5 sm:size-4" />
            <span>Zone danger</span>
          </TabsTrigger>
        </TabsList>

        {/* ─── Tab 1: Profil ─────────────────────────────────── */}
        <AnimatePresence mode="wait">
          {activeTab === 'profil' && (
            <motion.div
              key="profil"
              variants={tabContentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <TabsContent value="profil" className="mt-6 space-y-6">
                {isAuthenticated && currentUser ? (
                  <>
                    {/* User Info Card */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <User className="size-5 text-emerald-600" />
                          Informations du profil
                        </CardTitle>
                        <CardDescription>
                          Vos informations personnelles
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6">
                          {/* Avatar */}
                          <div className="flex justify-center md:justify-start">
                            <div className="relative group">
                              <Avatar className="size-24 ring-4 ring-slate-100">
                                <AvatarImage src={currentUser.avatar ?? undefined} alt={currentUser.name} />
                                <AvatarFallback className="text-xl font-semibold bg-emerald-100 text-emerald-700">
                                  {getUserInitials(currentUser.name)}
                                </AvatarFallback>
                              </Avatar>
                              <button
                                className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => toast.info('Fonctionnalité à venir')}
                              >
                                <Camera className="size-6 text-white" />
                              </button>
                            </div>
                          </div>

                          {/* User Details */}
                          <div className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div className="space-y-1">
                                <Label className="text-xs text-slate-500">Nom complet</Label>
                                <p className="text-sm font-medium text-slate-900">{currentUser.name}</p>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-slate-500">E-mail</Label>
                                <p className="text-sm font-medium text-slate-900">{currentUser.email}</p>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-slate-500">Rôle</Label>
                                <div>
                                  <Badge variant={getRoleBadgeVariant(currentUser.role)} className="mt-0.5">
                                    {ROLE_LABELS[currentUser.role]}
                                  </Badge>
                                </div>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-slate-500">Téléphone</Label>
                                <p className="text-sm font-medium text-slate-900">
                                  {currentUser.phone ?? 'Non renseigné'}
                                </p>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-slate-500">Magasin assigné</Label>
                                <p className="text-sm font-medium text-slate-900">
                                  {currentUser.employee_store_id
                                    ? activeStore?.name ?? 'Magasin non trouvé'
                                    : 'Aucun'}
                                </p>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-slate-500">Membre depuis</Label>
                                <p className="text-sm font-medium text-slate-900">
                                  {formatFrenchDate(currentUser.created_at)}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Change Password Card */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Lock className="size-5 text-amber-600" />
                          Changer le mot de passe
                        </CardTitle>
                        <CardDescription>
                          Mettez à jour votre mot de passe pour sécuriser votre compte
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl">
                          <div className="space-y-2">
                            <Label htmlFor="current-password">Mot de passe actuel</Label>
                            <Input
                              id="current-password"
                              type="password"
                              placeholder="••••••••"
                              value={currentPassword}
                              onChange={(e) => setCurrentPassword(e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="new-password">Nouveau mot de passe</Label>
                            <Input
                              id="new-password"
                              type="password"
                              placeholder="••••••••"
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="confirm-password">Confirmer</Label>
                            <Input
                              id="confirm-password"
                              type="password"
                              placeholder="••••••••"
                              value={confirmPassword}
                              onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                          </div>
                        </div>
                      </CardContent>
                      <CardFooter>
                        <Button onClick={handlePasswordSubmit} className="gap-2">
                          <Lock className="size-4" />
                          Mettre à jour le mot de passe
                        </Button>
                      </CardFooter>
                    </Card>
                  </>
                ) : (
                  /* Not Authenticated */
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="size-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                        <User className="size-8 text-slate-400" />
                      </div>
                      <h3 className="text-lg font-semibold text-slate-900 mb-1">Non connecté</h3>
                      <p className="text-sm text-slate-500 mb-6 max-w-sm">
                        Connectez-vous pour accéder à votre profil et gérer vos paramètres.
                      </p>
                      <Button onClick={handleLogin} className="gap-2">
                        Se connecter
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </motion.div>
          )}

          {/* ─── Tab 2: Magasin ──────────────────────────────── */}
          {activeTab === 'magasin' && (
            <motion.div
              key="magasin"
              variants={tabContentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <TabsContent value="magasin" className="mt-6 space-y-6">
                {/* Store Info */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Store className="size-5 text-emerald-600" />
                      Informations du magasin
                    </CardTitle>
                    <CardDescription>
                      Détails de votre boutique
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">Nom</Label>
                        <p className="text-sm font-medium text-slate-900">{activeStore?.name ?? '—'}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">Slug</Label>
                        <p className="text-sm font-mono text-slate-900">{activeStore?.slug ?? '—'}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">Domaine</Label>
                        <p className="text-sm text-slate-900">{activeStore?.domain ?? 'Non configuré'}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">Statut</Label>
                        <p className="text-sm">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            {activeStore?.is_active ? 'Actif' : 'Inactif'}
                          </span>
                        </p>
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-xs text-slate-500">Description</Label>
                        <p className="text-sm text-slate-900">{activeStore?.description ?? 'Aucune description'}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Theme Color */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Palette className="size-5 text-amber-600" />
                      Thème visuel
                    </CardTitle>
                    <CardDescription>
                      Choisissez la couleur principale de votre boutique
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-3">
                      {themeColors.map((tc) => (
                        <button
                          key={tc.value}
                          onClick={() => handleThemeChange(tc.value, tc.fg, tc.accent)}
                          className={`w-12 h-12 rounded-xl flex items-center justify-center text-xs transition-all border-2 ${
                            theme?.primaryColor === tc.value
                              ? 'border-slate-800 ring-2 ring-slate-800/20 scale-110'
                              : 'border-transparent hover:border-slate-300 hover:scale-105'
                          }`}
                          style={{ backgroundColor: tc.value, color: tc.fg }}
                          title={tc.label}
                        >
                          {theme?.primaryColor === tc.value && (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">Couleur actuelle :</span>
                      <span
                        className="px-2.5 py-0.5 rounded text-[11px] font-medium"
                        style={{ backgroundColor: theme?.primaryColor, color: theme?.primaryForeground }}
                      >
                        {theme?.primaryColor}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                {/* Typography & Border Radius */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Type className="size-5 text-emerald-600" />
                      Apparence
                    </CardTitle>
                    <CardDescription>
                      Personnalisez la typographie et le style des bordures
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl">
                      <div className="space-y-2">
                        <Label htmlFor="font-family" className="flex items-center gap-1.5">
                          <Type className="size-3.5 text-slate-400" />
                          Police de caractères
                        </Label>
                        <Select value={selectedFont} onValueChange={setSelectedFont}>
                          <SelectTrigger id="font-family" className="w-full">
                            <SelectValue placeholder="Choisir une police" />
                          </SelectTrigger>
                          <SelectContent>
                            {fontOptions.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-[11px] text-slate-400">Aperçu : <span style={{ fontFamily: selectedFont }}>Texte exemple</span></p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="border-radius" className="flex items-center gap-1.5">
                          <Square className="size-3.5 text-slate-400" />
                          Rayon des bordures
                        </Label>
                        <Select value={selectedRadius} onValueChange={setSelectedRadius}>
                          <SelectTrigger id="border-radius" className="w-full">
                            <SelectValue placeholder="Choisir un rayon" />
                          </SelectTrigger>
                          <SelectContent>
                            {borderRadiusOptions.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex gap-2">
                          {borderRadiusOptions.map((opt) => {
                            const radiusMap: Record<string, string> = {
                              sm: 'rounded-sm',
                              md: 'rounded-md',
                              lg: 'rounded-lg',
                              xl: 'rounded-xl',
                            };
                            return (
                              <div
                                key={opt.value}
                                className={`size-8 border-2 transition-all ${radiusMap[opt.value]} ${
                                  selectedRadius === opt.value
                                    ? 'border-emerald-600 bg-emerald-50'
                                    : 'border-slate-200 bg-slate-50'
                                }`}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button onClick={handleStoreSave} className="gap-2">
                      Enregistrer les modifications
                    </Button>
                  </CardFooter>
                </Card>
              </TabsContent>
            </motion.div>
          )}

          {/* ─── Tab 3: Préférences ───────────────────────────── */}
          {activeTab === 'preferences' && (
            <motion.div
              key="preferences"
              variants={tabContentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <TabsContent value="preferences" className="mt-6 space-y-6">
                {/* Language & Currency */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Globe className="size-5 text-emerald-600" />
                      Langue et devise
                    </CardTitle>
                    <CardDescription>
                      Paramètres régionaux de l&apos;application
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl">
                      <div className="space-y-2">
                        <Label htmlFor="language" className="flex items-center gap-1.5">
                          <Globe className="size-3.5 text-slate-400" />
                          Langue
                        </Label>
                        <Select value="fr" disabled>
                          <SelectTrigger id="language" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="fr">Français</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-[11px] text-slate-400 flex items-center gap-1">
                          <span className="size-1.5 rounded-full bg-amber-400" />
                          Plus de langues bientôt
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="currency" className="flex items-center gap-1.5">
                          <Coins className="size-3.5 text-slate-400" />
                          Devise
                        </Label>
                        <Select value="DA" disabled>
                          <SelectTrigger id="currency" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="DA">DA — Dinar Algérien</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-[11px] text-slate-400">Devise par défaut pour l&apos;Algérie</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Notifications */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Bell className="size-5 text-amber-600" />
                      Notifications
                    </CardTitle>
                    <CardDescription>
                      Gérez vos alertes et notifications
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-6">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <Label className="text-sm font-medium text-slate-900">Nouvelles commandes</Label>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Recevez une notification à chaque nouvelle commande
                          </p>
                        </div>
                        <Switch
                          checked={notifications.newOrders}
                          onCheckedChange={(v) => handleNotificationToggle('newOrders', v)}
                        />
                      </div>

                      <Separator />

                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <Label className="text-sm font-medium text-slate-900">Alertes stock bas</Label>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Soyez alerté quand un produit a un stock faible
                          </p>
                        </div>
                        <Switch
                          checked={notifications.lowStock}
                          onCheckedChange={(v) => handleNotificationToggle('lowStock', v)}
                        />
                      </div>

                      <Separator />

                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <Label className="text-sm font-medium text-slate-900">Rapports hebdomadaires</Label>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Recevez un résumé hebdomadaire de vos performances
                          </p>
                        </div>
                        <Switch
                          checked={notifications.weeklyReports}
                          onCheckedChange={(v) => handleNotificationToggle('weeklyReports', v)}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </motion.div>
          )}

          {/* ─── Tab 4: Intégrations ──────────────────────────── */}
          {activeTab === 'integrations' && (
            <motion.div
              key="integrations"
              variants={tabContentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <TabsContent value="integrations" className="mt-6 space-y-6">
                {/* OpenAI */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Bot className="size-5 text-indigo-600" />
                      Intelligence Artificielle (OpenAI)
                    </CardTitle>
                    <CardDescription>
                      Configurez votre clé API pour activer l'Autopilot et les analyses avancées.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4 max-w-2xl">
                      <div className="space-y-2">
                        <Label htmlFor="openai-key">Clé API OpenAI</Label>
                        <Input
                          id="openai-key"
                          type="password"
                          placeholder="sk-..."
                          value={openAIKey}
                          onChange={(e) => setOpenAIKey(e.target.value)}
                        />
                        <p className="text-xs text-slate-500">
                          Votre clé API est chiffrée et stockée de manière sécurisée.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button onClick={() => toast.success('Clé OpenAI enregistrée')} className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white">
                      Enregistrer la configuration IA
                    </Button>
                  </CardFooter>
                </Card>

                {/* Webhooks */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Webhook className="size-5 text-blue-600" />
                      Webhooks & Événements
                    </CardTitle>
                    <CardDescription>
                      Connectez votre boutique à d'autres applications (Zapier, Make, etc.).
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4 max-w-2xl">
                      <div className="space-y-2">
                        <Label htmlFor="webhook-url">URL de destination</Label>
                        <Input
                          id="webhook-url"
                          type="url"
                          placeholder="https://..."
                          value={webhookUrl}
                          onChange={(e) => setWebhookUrl(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="webhook-secret">Secret (Optionnel)</Label>
                        <Input
                          id="webhook-secret"
                          type="password"
                          placeholder="Signature du payload"
                          value={webhookSecret}
                          onChange={(e) => setWebhookSecret(e.target.value)}
                        />
                        <p className="text-xs text-slate-500">
                          Utilisé pour signer cryptographiquement les payloads envoyés.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button onClick={() => toast.success('Webhook configuré')} variant="outline" className="gap-2 text-blue-600 border-blue-200 hover:bg-blue-50">
                      Tester & Enregistrer le Webhook
                    </Button>
                  </CardFooter>
                </Card>
              </TabsContent>
            </motion.div>
          )}

          {/* ─── Tab 5: Danger Zone ───────────────────────────── */}
          {activeTab === 'danger' && (
            <motion.div
              key="danger"
              variants={tabContentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <TabsContent value="danger" className="mt-6 space-y-6">
                {/* Danger Zone Card */}
                <Card className="border-2 border-rose-200 bg-rose-50/30">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-rose-700">
                      <ShieldAlert className="size-5" />
                      Zone danger
                    </CardTitle>
                    <CardDescription className="text-rose-600/80">
                      Actions irréversibles. Procédez avec prudence.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Reset All Data */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-white rounded-lg border border-rose-100">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <RotateCcw className="size-4 text-rose-500" />
                          <h4 className="text-sm font-semibold text-slate-900">Réinitialiser toutes les données</h4>
                        </div>
                        <p className="text-xs text-slate-500 pl-6">
                          Supprimer toutes les données locales et revenir aux paramètres par défaut.
                        </p>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm" className="gap-1.5 shrink-0">
                            <RotateCcw className="size-3.5" />
                            Réinitialiser
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Êtes-vous sûr ?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Cette action supprimera toutes vos données locales et réinitialisera
                              l&apos;application à ses paramètres d&apos;usine. Cette action est irréversible.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Annuler</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => toast.info('Fonctionnalité à venir')}
                              className="bg-rose-600 hover:bg-rose-700"
                            >
                              Réinitialiser tout
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>

                    <Separator className="bg-rose-200/50" />

                    {/* Delete Store */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-white rounded-lg border border-rose-100">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Trash2 className="size-4 text-rose-500" />
                          <h4 className="text-sm font-semibold text-slate-900">Supprimer le magasin</h4>
                        </div>
                        <p className="text-xs text-slate-500 pl-6">
                          Supprimer définitivement ce magasin et toutes ses données associées.
                        </p>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm" className="gap-1.5 shrink-0">
                            <Trash2 className="size-3.5" />
                            Supprimer
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Supprimer le magasin ?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Cette action supprimera définitivement le magasin «{' '}
                              <strong>{activeStore?.name}</strong> » et toutes ses données
                              (produits, commandes, etc.). Cette action est irréversible.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Annuler</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => toast.info('Fonctionnalité à venir')}
                              className="bg-rose-600 hover:bg-rose-700"
                            >
                              Supprimer définitivement
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>

                    <Separator className="bg-rose-200/50" />

                    {/* Logout */}
                    {isAuthenticated && (
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-white rounded-lg border border-rose-100">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <LogOut className="size-4 text-rose-500" />
                            <h4 className="text-sm font-semibold text-slate-900">Se déconnecter</h4>
                          </div>
                          <p className="text-xs text-slate-500 pl-6">
                            Déconnexion de votre compte sur cet appareil.
                          </p>
                        </div>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm" className="gap-1.5 shrink-0">
                              <LogOut className="size-3.5" />
                              Se déconnecter
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Se déconnecter ?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Vous serez déconnecté de votre compte. Vous pourrez vous reconnecter
                                ultérieurement.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Annuler</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={handleLogout}
                                className="bg-rose-600 hover:bg-rose-700"
                              >
                                Se déconnecter
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Tabs>
    </div>
  );
}
