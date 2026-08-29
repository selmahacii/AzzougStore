'use client';

import { getOrderType, ORDER_TYPE_META } from '@/lib/order-type';
import { cn } from '@/lib/utils';
import type { Order } from '@/lib/types';

/**
 * Business-origin badge — always shown NEXT TO the status badge, never
 * instead of it. The origin never changes with the status (a recovered
 * cart stays 🟩 even once delivered; a normal order stays 🟦 forever).
 */
export function OrderTypeBadge({
  order,
  size = 'sm',
  short = false,
}: {
  order: Pick<Order, 'is_abandoned_cart' | 'status'> & { recovered_at?: string | null };
  size?: 'xs' | 'sm';
  short?: boolean;
}) {
  const type = getOrderType(order);
  const meta = ORDER_TYPE_META[type];
  const label = short ? meta.label.replace('Commande ', '').replace('Panier ', '') : meta.label;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border font-black uppercase tracking-wider shrink-0',
        size === 'xs' ? 'px-1.5 py-0.5 text-[8px]' : 'px-2 py-0.5 text-[9px]',
        meta.className,
      )}
      title={`Origine : ${meta.label} — ne change jamais avec le statut`}
    >
      {label}
    </span>
  );
}

/** Purple related-orders badge — coexists with the type badge, never replaces it. */
export function RelatedOrdersBadge({
  count,
  size = 'sm',
  onClick,
  expanded,
}: {
  count: number;
  size?: 'xs' | 'sm';
  onClick?: (e: React.MouseEvent) => void;
  expanded?: boolean;
}) {
  if (!count || count <= 0) return null;
  const Tag = onClick ? 'span' : 'span';
  return (
    <Tag
      {...(onClick ? { role: 'button', tabIndex: 0, onClick } : {})}
      className={cn(
        'inline-flex items-center gap-1 rounded border font-black uppercase tracking-wider shrink-0',
        'bg-purple-50 text-purple-700 border-purple-200',
        size === 'xs' ? 'px-1.5 py-0.5 text-[8px]' : 'px-2 py-0.5 text-[9px]',
        onClick && 'cursor-pointer hover:bg-purple-100 transition-colors',
      )}
      title={onClick ? (expanded ? 'Masquer les commandes liées' : 'Voir les commandes liées') : `${count} commande(s) liée(s)`}
    >
      Doublons ({count}){onClick ? (expanded ? ' ▲' : ' ▼') : ''}
    </Tag>
  );
}
