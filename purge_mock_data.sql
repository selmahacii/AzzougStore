-- ============================================================
-- PURGE MOCK DATA — AzzougShop
-- Supprime TOUTES les données mockées/seedées
-- Garde uniquement le compte admin principal
-- NE SUPPRIME PAS les tables (structure intacte)
-- ============================================================

BEGIN;

-- 1. Désactiver les contraintes FK temporairement
SET session_replication_role = 'replica';

-- 2. Vider toutes les tables de données (ordre cascade)
TRUNCATE TABLE
  audit_logs,
  noest_tracking_events,
  marketing_logs,
  marketing_automations,
  marketing_channels,
  message_templates,
  store_visitors,
  wallets,
  financial_transactions,
  expenses,
  purchase_items,
  purchases,
  return_items,
  returns,
  pos_sale_items,
  pos_sales,
  pos_sessions,
  stock_movements,
  order_events,
  order_items,
  orders,
  reviews,
  promotions,
  product_delivery_partners,
  delivery_fee_grids,
  partner_webhooks,
  partner_api_keys,
  delivery_partners,
  wilaya_delivery_fees,
  customers,
  order_statuses,
  warehouses,
  suppliers,
  products,
  stores,
  users
RESTART IDENTITY CASCADE;

-- 3. Réactiver les contraintes FK
SET session_replication_role = 'origin';

-- 4. Recréer uniquement le compte SUPER_ADMIN
-- Mot de passe hashé pour "admin123" (bcrypt, 12 rounds)
INSERT INTO users (
  id, email, name, hashed_password, role,
  is_active, daily_target, avatar, phone,
  employee_store_id, assigned_store_scope,
  assigned_store_ids, assigned_product_ids,
  payment_type, payment_amount,
  created_at, updated_at
) VALUES (
  'usr_admin_azzougshop_001',
  'admin@azzougshop.com',
  'Admin AzzougShop',
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TiGZLqkBF7XQ9VQKGqKAyMPyJlHO',
  'SUPER_ADMIN',
  true, 0, NULL, NULL,
  NULL, 'ALL', '[]', '[]',
  NULL, NULL,
  NOW(), NOW()
);

COMMIT;

-- 5. Vérification
SELECT 'PURGE TERMINÉE' as status;
SELECT 'users' as table_name, count(*) as remaining FROM users
UNION ALL SELECT 'stores', count(*) FROM stores
UNION ALL SELECT 'products', count(*) FROM products
UNION ALL SELECT 'orders', count(*) FROM orders
UNION ALL SELECT 'customers', count(*) FROM customers
UNION ALL SELECT 'reviews', count(*) FROM reviews;
