'use client';

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquarePlus, ChevronDown, Star, PenSquare, ShieldCheck, X } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useAppStore } from '@/store/app-store';
import { toast } from 'sonner';
import type { Review } from '@/lib/types';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface ProductReviewsProps { productId: string; }

interface ReviewsResponse {
  reviews: Review[];
  total: number;
  average_rating: number;
  rating_distribution: Record<number, number>;
  totalPages: number;
  page: number;
  pageSize: number;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function StarRow({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'lg' ? 'size-5' : size === 'md' ? 'size-4' : 'size-3.5';
  return (
    <div className="flex gap-0.5">
      {[1,2,3,4,5].map((s) => (
        <Star key={s} className={cn(sz, s <= rating ? 'fill-amber-400 text-amber-400' : 'fill-neutral-200 text-neutral-200')} />
      ))}
    </div>
  );
}

export function ProductReviews({ productId }: ProductReviewsProps) {
  const activeStore = useAppStore((s) => s.activeStore);
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const pageSize = 5;

  const { data, isLoading } = useQuery<ReviewsResponse>({
    queryKey: ['reviews', productId, page],
    queryFn: async () => {
      const res = await fetch(`/api/v1/reviews?product_id=${productId}&page=${page}&pageSize=${pageSize}&sort_by=created_at&sort_dir=desc`);
      if (!res.ok) throw new Error('Failed to fetch reviews');
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      return json;
    },
    enabled: !!productId,
  });

  const { reviews = [], total = 0, average_rating = 0, rating_distribution = {}, totalPages = 0 } = data ?? {};
  const primary = 'var(--store-primary, #4b7bec)';

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-10">
        <div>
          <h2 className="text-xl font-bold text-neutral-900">Avis clients</h2>
          {total > 0 && (
            <p className="text-sm text-neutral-500 mt-1">
              {total} avis · Note moyenne{' '}
              <span className="font-bold text-neutral-800">{average_rating.toFixed(1)}/5</span>
            </p>
          )}
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-neutral-200 text-sm font-semibold text-neutral-700 hover:border-neutral-900 hover:bg-neutral-900 hover:text-white transition-all"
        >
          <PenSquare className="size-4" /> Laisser un avis
        </button>
      </div>

      {/* Write review modal */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
            onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="bg-white rounded-2xl p-8 w-full max-w-lg shadow-2xl relative"
            >
              <button onClick={() => setShowForm(false)} className="absolute top-4 right-4 size-8 flex items-center justify-center rounded-full hover:bg-neutral-100 text-neutral-400">
                <X className="size-4" />
              </button>
              <WriteReviewForm
                productId={productId}
                storeId={activeStore?.id ?? ''}
                onSuccess={() => {
                  setShowForm(false);
                  queryClient.invalidateQueries({ queryKey: ['reviews', productId] });
                  toast.success('Votre avis a été publié, merci !');
                }}
                onCancel={() => setShowForm(false)}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">

        {/* Rating summary */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-neutral-50 rounded-2xl p-6 text-center space-y-3">
            <p className="text-6xl font-black text-neutral-900">
              {average_rating > 0 ? average_rating.toFixed(1) : '—'}
            </p>
            <StarRow rating={Math.round(average_rating)} size="lg" />
            <p className="text-sm text-neutral-500">{total} avis clients</p>
          </div>

          {/* Distribution */}
          <div className="space-y-2.5">
            {[5,4,3,2,1].map((star) => {
              const count = rating_distribution[star] ?? 0;
              const pct = total > 0 ? (count / total) * 100 : 0;
              return (
                <div key={star} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-neutral-600 w-4 text-right">{star}</span>
                  <Star className="size-3 fill-amber-400 text-amber-400 shrink-0" />
                  <div className="flex-1 h-2 bg-neutral-100 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8, delay: 0.1 * (5 - star) }}
                      className="h-full rounded-full bg-amber-400"
                    />
                  </div>
                  <span className="text-xs text-neutral-400 w-6 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Reviews list */}
        <div className="lg:col-span-8">
          {isLoading ? (
            <div className="space-y-6">
              {[1,2,3].map((i) => (
                <div key={i} className="space-y-3 p-4 rounded-2xl border border-neutral-100">
                  <div className="flex justify-between">
                    <Skeleton className="h-5 w-32 rounded-lg bg-neutral-100" />
                    <Skeleton className="h-4 w-24 rounded-lg bg-neutral-100" />
                  </div>
                  <Skeleton className="h-4 w-24 rounded-lg bg-neutral-100" />
                  <Skeleton className="h-16 w-full rounded-lg bg-neutral-100" />
                </div>
              ))}
            </div>
          ) : reviews.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4 border-2 border-dashed border-neutral-200 rounded-2xl">
              <MessageSquarePlus className="size-10 text-neutral-300" />
              <div className="text-center">
                <p className="text-sm font-semibold text-neutral-600">Aucun avis pour l'instant</p>
                <p className="text-xs text-neutral-400 mt-1">Soyez le premier à partager votre expérience !</p>
              </div>
              <button
                onClick={() => setShowForm(true)}
                className="mt-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all"
                style={{ backgroundColor: primary }}
              >
                Écrire un avis
              </button>
            </div>
          ) : (
            <div className="space-y-0 divide-y divide-neutral-100">
              <AnimatePresence>
                {reviews.map((review, idx) => (
                  <motion.div
                    key={review.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="py-6"
                  >
                    <ReviewCard review={review} />
                  </motion.div>
                ))}
              </AnimatePresence>

              {totalPages > 1 && page < totalPages && (
                <div className="pt-8 flex justify-center">
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    className="flex items-center gap-2 px-6 py-3 rounded-xl border border-neutral-200 text-sm font-semibold text-neutral-600 hover:border-neutral-400 transition-colors"
                  >
                    Voir plus d'avis <ChevronDown className="size-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewCard({ review }: { review: Review }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-full bg-neutral-900 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {review.customer_name.substring(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold text-neutral-900">{review.customer_name}</p>
            {review.is_verified && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600">
                <ShieldCheck className="size-3" /> Achat vérifié
              </span>
            )}
          </div>
        </div>
        <span className="text-xs text-neutral-400 shrink-0">{formatDate(review.created_at)}</span>
      </div>

      <StarRow rating={review.rating} size="sm" />

      {review.title && (
        <p className="text-sm font-semibold text-neutral-800">{review.title}</p>
      )}
      <p className="text-sm text-neutral-600 leading-relaxed">{review.comment}</p>
    </div>
  );
}

function WriteReviewForm({ productId, storeId, onSuccess, onCancel }: {
  productId: string; storeId: string; onSuccess: () => void; onCancel: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [customerName, setCustomerName] = useState('');
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const primary = 'var(--store-primary, #4b7bec)';

  const validate = useCallback(() => {
    const e: Record<string, string> = {};
    if (rating < 1) e.rating = 'Veuillez donner une note';
    if (!customerName.trim() || customerName.trim().length < 2) e.customerName = 'Nom requis (min 2 caractères)';
    if (!comment.trim() || comment.trim().length < 10) e.comment = 'Avis requis (min 10 caractères)';
    setErrors(e);
    return Object.keys(e).length === 0;
  }, [rating, customerName, comment]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, store_id: storeId, customer_name: customerName.trim(), rating, title: title.trim() || null, comment: comment.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) { setErrors({ general: json.message ?? 'Erreur lors de la publication' }); return; }
      onSuccess();
    } catch { setErrors({ general: 'Erreur de connexion. Veuillez réessayer.' }); }
    finally { setSubmitting(false); }
  }, [productId, storeId, customerName, rating, title, comment, validate, onSuccess]);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-neutral-900">Votre avis</h2>
        <p className="text-sm text-neutral-500 mt-1">Partagez votre expérience avec ce produit</p>
      </div>

      {/* Star picker */}
      <div className="space-y-2">
        <Label className="text-sm font-medium text-neutral-700">Note <span className="text-red-500">*</span></Label>
        <div className="flex gap-1.5">
          {[1,2,3,4,5].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setRating(s)}
              onMouseEnter={() => setHover(s)}
              onMouseLeave={() => setHover(0)}
              className="transition-transform hover:scale-110"
            >
              <Star className={cn('size-8 transition-colors', s <= (hover || rating) ? 'fill-amber-400 text-amber-400' : 'fill-neutral-200 text-neutral-200')} />
            </button>
          ))}
        </div>
        {errors.rating && <p className="text-xs text-red-500">{errors.rating}</p>}
      </div>

      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="rname" className="text-sm font-medium text-neutral-700">Votre nom <span className="text-red-500">*</span></Label>
        <Input id="rname" placeholder="Ex: Mohamed B." value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={errors.customerName ? 'border-red-300' : ''} />
        {errors.customerName && <p className="text-xs text-red-500">{errors.customerName}</p>}
      </div>

      {/* Title */}
      <div className="space-y-2">
        <Label htmlFor="rtitle" className="text-sm font-medium text-neutral-700">Titre <span className="text-xs text-neutral-400 font-normal">(optionnel)</span></Label>
        <Input id="rtitle" placeholder="Résumé en quelques mots..." value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      {/* Comment */}
      <div className="space-y-2">
        <Label htmlFor="rcomment" className="text-sm font-medium text-neutral-700">Votre avis <span className="text-red-500">*</span></Label>
        <Textarea id="rcomment" placeholder="Partagez votre expérience avec ce produit..." value={comment} onChange={(e) => setComment(e.target.value)} rows={4} className={cn('resize-none', errors.comment ? 'border-red-300' : '')} />
        <div className="flex justify-between">
          {errors.comment ? <p className="text-xs text-red-500">{errors.comment}</p> : <span />}
          <span className="text-xs text-neutral-400">{comment.length}/1000</span>
        </div>
      </div>

      {errors.general && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{errors.general}</p>}

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onCancel} className="px-5 py-3 rounded-xl text-sm font-semibold text-neutral-500 hover:text-neutral-800 transition-colors border border-neutral-200 hover:border-neutral-400">
          Annuler
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-60 transition-all hover:brightness-110"
          style={{ backgroundColor: primary }}
        >
          {submitting ? 'Publication...' : 'Publier mon avis'}
        </button>
      </div>
    </form>
  );
}
