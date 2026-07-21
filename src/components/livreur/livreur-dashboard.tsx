'use client';

import AgentDashboard from '@/components/agent/agent-dashboard';

/**
 * Delivery-agent (LIVREUR) dashboard.
 *
 * Previously a separate ~800-line component with a much narrower feature
 * set (no editing, no filters/tabs, no full order-management drawer) than
 * the confirmatrice's agent-dashboard.tsx. Per Selma's request, a livreur
 * now gets the SAME dashboard UI/workflow as a confirmatrice — same
 * Commandes/Logistique tabs, same order-editing drawer, same status
 * actions — with the differences a livreur's role actually warrants:
 *   - Orders are still scoped server-side to Order.livreur_id == his id
 *     (see app/api/v1/orders.py's list endpoint) — he only ever sees
 *     deliveries assigned to him (by region via the Assignment Rule
 *     Engine, or manually by a confirmatrice), never anyone else's.
 *   - No manual order creation, no carrier dispatch, no reassigning to
 *     another livreur, no editing carrier/tracking/delivery-fee — all
 *     gated both in agent-dashboard.tsx (by user.role) and enforced
 *     server-side (403) in orders.py, so there's no client-only lock.
 *   - Keeps his pre-existing advantage: full Produits + Inventaire admin
 *     access (purchase price, margin, stock adjustment) — richer than the
 *     confirmatrice's read-only stock view — see agent-dashboard.tsx's
 *     getModules(isLivreur) and the inventory-module render switch.
 */
export default function LivreurDashboard() {
  return <AgentDashboard />;
}
