'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Phone, User, Mail, Send, ChevronDown } from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';

const SESSION_KEY = 'azzougshop_visitor_captured';
const DELAY_MS = 4000; // show after 4 seconds

const SOURCES = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'google', label: 'Google' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'friend', label: 'Ami / Famille' },
  { value: 'direct', label: 'Autre' },
];

function getSessionId(): string {
  const key = 'azzougshop_sid';
  let sid = sessionStorage.getItem(key);
  if (!sid) {
    sid = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(key, sid);
  }
  return sid;
}

export function VisitorCapture() {
  const activeStore = useAppStore((s) => s.activeStore);
  const [visible, setVisible] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', source: '' });
  const [error, setError] = useState('');

  const tpl = (activeStore?.template_id ?? activeStore?.theme_config?.templateId ?? 'clean').toLowerCase();
  const primary = activeStore?.theme_config?.primaryColor ?? '#4b7bec';
  const isAthletic = tpl === 'athletic';
  const isLuxe = tpl === 'luxe';
  const isDark = isAthletic || isLuxe;

  useEffect(() => {
    if (!activeStore) return;
    // Don't show if already captured this session
    const captured = sessionStorage.getItem(`${SESSION_KEY}_${activeStore.id}`);
    if (captured) return;

    const timer = setTimeout(() => setVisible(true), DELAY_MS);
    return () => clearTimeout(timer);
  }, [activeStore]);

  const dismiss = () => {
    setVisible(false);
    // Mark dismissed so it doesn't re-appear this session
    if (activeStore) {
      sessionStorage.setItem(`${SESSION_KEY}_${activeStore.id}`, 'dismissed');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.phone.trim()) { setError('Le numéro de téléphone est requis'); return; }
    if (!activeStore) return;

    setLoading(true);
    setError('');
    try {
      await fetch('/api/v1/marketing/visitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'include',
        body: JSON.stringify({
          store_id: activeStore.id,
          name: form.name || null,
          phone: form.phone,
          email: form.email || null,
          source: form.source || null,
          page: window.location.pathname,
          session_id: getSessionId(),
        }),
      });
      sessionStorage.setItem(`${SESSION_KEY}_${activeStore.id}`, 'submitted');
      setSubmitted(true);
      setTimeout(() => setVisible(false), 2500);
    } catch {
      setError('Une erreur est survenue. Réessayez.');
    } finally {
      setLoading(false);
    }
  };

  // ── Style tokens per template ──────────────────────────────
  const bg = isAthletic ? '#0D0D0D' : isLuxe ? '#0C0F1A' : '#FFFFFF';
  const bgField = isDark ? 'rgba(255,255,255,0.06)' : '#F8F9FC';
  const border = isDark ? 'rgba(255,255,255,0.1)' : '#E5E7EB';
  const textMain = isDark ? '#FFFFFF' : '#111827';
  const textSub = isDark ? 'rgba(255,255,255,0.4)' : '#6B7280';
  const inputText = isDark ? '#FFFFFF' : '#111827';
  const inputPlaceholder = isDark ? 'placeholder:text-white/30' : 'placeholder:text-gray-400';

  return (
    <AnimatePresence>
      {visible && (
        <>
          {/* Card */}
          <motion.div
            initial={{ opacity: 0, y: 60, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 z-[999] sm:w-[320px] rounded-2xl shadow-2xl overflow-hidden"
            style={{ backgroundColor: bg, border: `1px solid ${border}` }}
          >
            {/* Accent stripe */}
            <div className="h-1 w-full" style={{ backgroundColor: primary }} />

            {/* Close */}
            <button
              onClick={dismiss}
              className="absolute top-4 right-4 size-7 rounded-full flex items-center justify-center transition-colors"
              style={{ color: textSub, backgroundColor: bgField }}
            >
              <X className="size-3.5" />
            </button>

            <div className="p-6">
              {submitted ? (
                /* ── Success state ── */
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col items-center text-center py-4 gap-3"
                >
                  <div className="size-14 rounded-full flex items-center justify-center text-2xl mb-1"
                    style={{ backgroundColor: `${primary}20` }}>
                    🎉
                  </div>
                  <p className="text-base font-black uppercase tracking-tight" style={{ color: textMain }}>
                    Merci !
                  </p>
                  <p className="text-sm font-medium" style={{ color: textSub }}>
                    Nous vous contacterons bientôt avec nos meilleures offres.
                  </p>
                </motion.div>
              ) : (
                /* ── Form ── */
                <>
                  <div className="mb-5">
                    <p className="text-[10px] font-black uppercase tracking-[0.4em] mb-1" style={{ color: primary }}>
                      {activeStore?.name}
                    </p>
                    <h3 className={`text-lg font-black uppercase tracking-tight leading-tight ${isLuxe ? 'font-thin tracking-[0.05em]' : ''}`}
                      style={{ color: textMain }}>
                      Restez informé(e)
                    </h3>
                    <p className="text-[12px] font-medium mt-1 leading-relaxed" style={{ color: textSub }}>
                      Recevez nos offres exclusives et nouveautés en avant-première.
                    </p>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-3">
                    {/* Name */}
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5" style={{ color: textSub }} />
                      <input
                        type="text"
                        placeholder="Votre prénom"
                        value={form.name}
                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        className={`w-full h-11 pl-9 pr-4 rounded-xl text-sm font-medium outline-none transition-all ${inputPlaceholder}`}
                        style={{ backgroundColor: bgField, border: `1px solid ${border}`, color: inputText }}
                      />
                    </div>

                    {/* Phone */}
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5" style={{ color: textSub }} />
                      <input
                        type="tel"
                        placeholder="Numéro de téléphone *"
                        value={form.phone}
                        onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                        required
                        className={`w-full h-11 pl-9 pr-4 rounded-xl text-sm font-medium outline-none transition-all ${inputPlaceholder}`}
                        style={{ backgroundColor: bgField, border: `1px solid ${error ? '#EF4444' : border}`, color: inputText }}
                      />
                    </div>

                    {/* Source */}
                    <div className="relative">
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 size-3.5 pointer-events-none" style={{ color: textSub }} />
                      <select
                        value={form.source}
                        onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                        className="w-full h-11 pl-4 pr-9 rounded-xl text-sm font-medium outline-none appearance-none transition-all"
                        style={{ backgroundColor: bgField, border: `1px solid ${border}`, color: form.source ? inputText : textSub }}
                      >
                        <option value="">Comment vous avez découvert la boutique ?</option>
                        {SOURCES.map(s => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    </div>

                    {error && (
                      <p className="text-[11px] text-red-500 font-medium">{error}</p>
                    )}

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full h-11 rounded-xl text-[11px] font-black uppercase tracking-[0.3em] flex items-center justify-center gap-2 transition-all"
                      style={{ backgroundColor: primary, color: isAthletic ? '#000' : '#fff', opacity: loading ? 0.7 : 1 }}
                    >
                      {loading ? (
                        <div className="size-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                      ) : (
                        <><Send className="size-3.5" /> Recevoir les offres</>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={dismiss}
                      className="w-full text-center text-[10px] font-medium transition-colors"
                      style={{ color: textSub }}
                    >
                      Non merci, continuer sans
                    </button>
                  </form>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
