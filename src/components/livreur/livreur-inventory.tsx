'use client';

import { SimpleStockList } from '@/components/shared/inventory-views';

/**
 * Read-only, delivery-agent-facing product/stock view.
 * Livreurs don't manage pricing, suppliers, purchases or warehouses — they
 * only need to check what's currently in stock.
 */
export default function LivreurInventory() {
  return (
    <div className="max-w-3xl mx-auto p-4">
      <SimpleStockList />
    </div>
  );
}
