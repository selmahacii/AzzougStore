'use client';

import { useState, useEffect, useRef } from 'react';
import { Globe, Check, ChevronDown } from 'lucide-react';
import { useTranslation } from '@/hooks/use-translation';
import { motion, AnimatePresence } from 'framer-motion';

interface FloatingLanguageSwitcherProps {
  primaryColor?: string;
}

export function FloatingLanguageSwitcher({ primaryColor = '#4b7bec' }: FloatingLanguageSwitcherProps) {
  const { locale, setLocale, dir } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const languages = [
    { code: 'fr', label: 'FR' },
    { code: 'en', label: 'EN' },
    { code: 'ar', label: 'AR' },
  ];

  const current = languages.find((l) => l.code === locale) || languages[0];

  return (
    <div ref={ref} className="fixed top-4 right-4 z-[9999] font-sans" dir={dir}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-full backdrop-blur-md bg-white/80 dark:bg-black/80 border border-slate-200/50 dark:border-white/10 shadow-lg text-slate-800 dark:text-white text-xs font-black uppercase tracking-wider transition-all hover:scale-105 active:scale-95"
      >
        <Globe className="size-3.5 opacity-70" />
        <span>{current.label}</span>
        <ChevronDown className="size-3 opacity-55" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 min-w-[130px] rounded-2xl border border-slate-200/50 dark:border-white/10 shadow-2xl overflow-hidden bg-white/95 dark:bg-black/95 backdrop-blur-md py-1.5"
          >
            {languages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => {
                  setLocale(lang.code);
                  setOpen(false);
                }}
                className="w-full text-left px-4 py-2 text-xs font-bold transition-colors flex items-center justify-between hover:bg-slate-100 dark:hover:bg-white/5 text-slate-800 dark:text-white"
                style={{ color: locale === lang.code ? primaryColor : undefined }}
              >
                <span>
                  {lang.code === 'ar' ? 'العربية (AR)' : lang.code === 'en' ? 'English (EN)' : 'Français (FR)'}
                </span>
                {locale === lang.code && <Check className="size-3.5" style={{ color: primaryColor }} />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
