// ─── Theme & Store ──────────────────────────────────────────
export interface ThemeConfig {
  primaryColor: string;
  primaryForeground?: string;
  accentColor: string;
  fontFamily?: string;
  borderRadius?: string;
  templateId?: string;
  darkMode?: boolean;
  bannerIsVideo?: boolean;
  footerTagline?: string | null;
  footerCopyright?: string | null;
  contact?: { phone?: string; email?: string; address?: string } | null;
  // Hero customization
  heroLayout?: 'full' | 'side';
  heroHeadline?: string | null;
  heroSubtitle?: string | null;
  heroCta?: string | null;
  heroFont?: 'bold' | 'normal' | 'light' | 'serif';
  // Dynamic hero elements (all optional — hidden if not set)
  heroTag?: string | null;
  heroStats?: Array<{ label: string; value: string }> | null;
  heroAttributes?: Array<{ label: string; val: string }> | null;
  // Trust bar below header nav (hidden if not configured)
  trustBar?: Array<{ label: string; sub: string; icon?: string }> | null;
  // Store identity
  storeTagline?: string | null;
  // Section labels (customizable per store)
  labelBestSellers?: string | null;
  labelBestSellersTag?: string | null;
  labelNewArrivals?: string | null;
  labelNewArrivalsTag?: string | null;
  // Help messages (configurable)
  helpMessages?: Record<string, string> | null;
  [key: string]: unknown;
}

export interface Store {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  description: string | null;
  /** FastAPI backend uses logo_url; Prisma/Next.js API uses logo */
  logo_url?: string | null;
  logo?: string | null;
  banner_url?: string | null;
  is_active: boolean;
  theme_config?: ThemeConfig;
  default_delivery_fee?: number;
  delivery_providers?: Record<string, any>; // JSON
  
  // Assignment logic
  assignment_active?: boolean;
  assignment_logic?: 'MANUAL' | 'ROUND_ROBIN' | 'LEAST_LOADED';

  // Relations
  users?: User[];
  owner_id: string;
  template_id: string;
  social_links: { facebook?: string; instagram?: string; tiktok?: string; twitter?: string };
  contact?: { phone?: string; email?: string; address?: string } | null;
  currency: string;
  language: string;
  timezone: string;
  _count?: {
    products: number;
    orders: number;
    employees: number;
  };
}

// ─── Products ───────────────────────────────────────────────
export interface ProductVariant {
  id?: string;
  name: string;      // e.g. "Couleur"
  value: string;     // e.g. "Rouge"
  sku?: string;      // Specific SKU for this variant
  stock?: number;    // Specific stock for this variant
  price?: number;    // Specific price (optional, overrides base)
  image?: string;    // Specific image for this variant
  color?: string;    // Hex code for color swatches
  priceModifier?: number; // Kept for backwards compatibility
}

export interface Product {
  id: string;
  store_id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  compare_price: number | null;
  cost_price: number | null;
  stock: number;
  reserved_stock: number;
  low_stock_threshold: number;
  images: string[];
  variants: ProductVariant[] | null;
  category: string | null;
  is_active: boolean;
  featured: boolean;
  
  // Industrial Fields
  sku: string;
  barcode?: string;
  external_id?: string;
  brand?: string;
  marketer_percentage?: number;
  shipping_model?: string;
  page_url?: string;
  is_pack: boolean;
  main_image?: string | null;
  tags?: string[];
  
  // Production & Logistics
  production_source?: 'imported' | 'local';
  prod_supplier_name?: string;
  prod_batch_qty?: number;
  prod_fabric_cost?: number;
  prod_accessories_cost?: number;
  prod_labor_cut_cost?: number;
  prod_labor_sew_cost?: number;
  prod_labor_finish_cost?: number;
  prod_packaging_cost?: number;
  prod_transport_cost?: number;
  prod_other_cost?: number;
  prod_notes?: string;
  allowed_carriers?: string[];

  created_at: string;
  updated_at: string;
  store?: Pick<Store, 'id' | 'name' | 'slug' | 'theme_config'>;
  review_count?: number;
  average_rating?: number;
}

// ─── Reviews ───────────────────────────────────────────
export interface Review {
  id: string;
  product_id: string;
  customer_name: string;
  rating: number;
  title: string | null;
  image: string | null;
  color?: string; // Hex code for color variants
  comment: string;
  is_verified: boolean;
  is_approved: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Orders ─────────────────────────────────────────────────
export type OrderStatus =
  | 'NEW'
  | 'ASSIGNED'
  | 'CALLED'
  | 'IN_PROGRESS'
  | 'RESCHEDULED'
  | 'CONFIRMED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'RETURNED'
  | 'CANCELLED'
  | 'ABANDONED'
  | 'RECOVERED_CART'
  | 'DUPLICATE';

export interface OrderItem {
  id?: string;
  product_id: string;
  product_name: string;
  sku?: string;
  quantity: number;
  unit_price: number;
  image_url?: string;
  variant_details?: any;
}

export interface Order {
  id: string;
  store_id: string;
  order_number: string;
  store_sequence_number?: number | null; // Admin/agent display: "Commande N°X"
  customer_name: string;
  customer_phone: string;
  customer_phone2?: string | null;
  customer_email: string | null;
  customer_address: string | null;
  customer_wilaya: string | null;
  customer_commune: string | null;
  items: OrderItem[];
  total: number;
  subtotal?: number;
  status: OrderStatus;
  assigned_to: string | null;
  tracking_number: string | null;
  carrier_id: string | null;
  delivery_fee: number;
  delivery_type?: string | null;
  notes: string | null;
  source: string | null;
  customer_id: string | null;
  customer_tier: string | null;
  promo_code: string | null;
  discount: number;
  created_at: string;
  updated_at: string;
  returned_at?: string | null;
  is_duplicate?: boolean;
  is_pack?: boolean;
  is_upsell?: boolean;
  is_abandoned_cart?: boolean;
  abandoned_cart_recovery_fee?: number;
  
  // Confirmation Workflow
  confirmation_start_time?: string;
  nrp_count?: number;
  next_callback_time?: string;

  store?: Pick<Store, 'id' | 'name' | 'slug'>;
  assignee?: Pick<User, 'id' | 'name' | 'avatar'> | null;
  customer?: Pick<Customer, 'id' | 'name' | 'phone' | 'tier'> | null;
  carrier?: { id: string; name: string; code: string | null; logo_url: string | null; fee_home: number; fee_relay: number } | null;
  events?: OrderEvent[];
  
  // Duplicate merge details
  parent_order_id?: string | null;
  merged_by?: string | null;
  merged_at?: string | null;
  status_before_merge?: string | null;
  child_orders?: Order[];
}

// ─── Order Events ───────────────────────────────────────────
export type CallResult = 'ANSWERED' | 'NOT_ANSWERED' | 'BUSY' | 'REFUSED' | 'POSTPONED';

export interface OrderEvent {
  id: string;
  order_id: string;
  actor_id: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  note: string | null;
  call_result: CallResult | null;
  call_attempt: number;
  scheduled_callback_at: string | null;
  created_at: string;
  actor?: Pick<User, 'id' | 'name' | 'avatar'>;
}

// ─── Users & Roles ──────────────────────────────────────────
export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'CONFIRMATEUR' | 'MARKETER' | 'CUSTOMER';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatar: string | null;
  phone: string | null;
  is_active: boolean;
  employee_store_id: string | null;
  daily_target: number;
  created_at: string;
  employee_store?: Pick<Store, 'id' | 'name' | 'slug'> | null;
}

// ─── Employee Stats ─────────────────────────────────────────
export interface EmployeeStats {
  user_id: string;
  user_name: string;
  user_avatar: string | null;
  role: UserRole;
  assigned_today: number;
  assigned_week: number;
  assigned_month: number;
  confirmed: number;
  not_answered: number;
  refused: number;
  postponed: number;
  avg_call_attempts: number;
  performance_score: number;
  // Call attempt metrics (from OrderEvent)
  total_call_attempts: number;
  answered_count: number;
  not_answered_count: number;
  refused_count: number;
  postponed_count: number;
  // Average response time (minutes)
  avg_assign_to_call_time: number | null;
  // Callback rate
  callback_rate: number;
  scheduled_callbacks: number;
  completed_callbacks: number;
  // Today's progress
  today_confirmed: number;
  today_returned: number;
  today_target_progress: number;
}

// ─── Customers ─────────────────────────────────────────
export type CustomerTier = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM' | 'DIAMOND';

export type CustomerSource = 'MANUAL' | 'INVITED' | 'ACCOUNT' | 'ORDER';

export interface Customer {
  id: string;
  store_id: string;
  phone: string;
  secondary_phone?: string | null;
  name: string;
  email: string | null;
  wilaya: string | null;
  address: string | null;
  note?: string | null;
  tier: CustomerTier;
  source?: CustomerSource | null;
  tags?: string[];
  rfm_score?: string | null;
  total_orders: number;
  total_returned?: number;
  total_spent: number;
  is_blacklisted: boolean;
  is_guest: boolean;
  blacklist_note: string | null;
  last_order_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Promotions ─────────────────────────────────────────
export type PromotionType = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING';

export interface Promotion {
  id: string;
  store_id: string;
  code: string;
  type: PromotionType;
  value: number;
  min_order_amount: number;
  max_uses: number | null;
  used_count: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  description: string | null;
  applicable_categories: string;
  first_purchase_only: boolean;
  flash_sale: boolean;
  flash_sale_ends_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Partners ───────────────────────────────────────────────
export interface PartnerApiKey {
  id: string;
  store_id: string;
  name: string;
  key_preview: string;
  last_rotated_at: string;
  is_active: boolean;
}

export interface WebhookConfig {
  id: string;
  store_id: string;
  url: string;
  is_active: boolean;
  events: string[];
}

// ─── Audit ──────────────────────────────────────────────────
export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'STATUS_CHANGE' | 'LOGIN';

export interface AuditLog {
  id: string;
  actor_id: string;
  store_id: string | null;
  entity: string;
  entity_id: string;
  action: AuditAction;
  diff: Record<string, { from: unknown; to: unknown }> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  actor?: Pick<User, 'id' | 'name' | 'avatar'>;
}

// ─── Analytics ──────────────────────────────────────────────
export interface FunnelRate {
  assignRate: number;   // NEW → ASSIGNED
  callRate: number;     // ASSIGNED → CALLED
  confirmRate: number;  // CALLED → CONFIRMED
  deliverRate: number;  // CONFIRMED → DELIVERED
  returnRate: number;   // NEW: For consistency
}

export interface KpiData {
  totalRevenue: number;
  orderRevenue: number;
  posRevenue: number;
  netRevenue: number;
  totalProfit: number;
  revenueChange: number;
  ordersToday: number;
  ordersChange: number;
  conversionRate: number;
  returnRate: number;
  avgOrderValue: number;
  totalOrders: number;
  confirmedOrders: number;
  totalProducts: number;
  totalEmployees: number;
  pendingOrders: number;
  deliveredOrders: number;
  returnedOrders: number;
  funnelRate: FunnelRate;
  // Customer Metrics
  buyersCount: number;
  acquisitionRate: number;
  retentionRate: number;
  profitPerOrder: number;
  roi: number;
  avgCustomerValue: number;
  profitPerCustomer: number;
  // Logistics
  shippingFeeGap: number;
  shippingFeeGapPerDelivered: number;
  // Performance
  confirmationPerformance: number;
  deliveryPerformance: number;
  // Expert Metrics
  roas: number;
  cac: number;
  ltv: number;
  // Optional / computed on frontend
  churnRate?: number;
  arpu?: number;
  inventoryTurnover?: number;
  totalDiscounts?: number;
  upsellRevenue?: number;
  abandonedCartRevenue?: number;
}

export interface UserMetadata {
  last_login_ip: string;
  device_type: string;
  call_success_rate: number;
  avg_handling_time: number;   // seconds
}

export interface ProductMetadata {
  sku: string;               // Format: BRAND-CAT-VAR-UUID
  supplier_id: string;
  lead_time: number;          // Days to restock
  weight: number;            // For shipping calculation
}

export interface CustomerMetadata {
  tier: CustomerTier;
  rfm_score: string;          // Recency, Frequency, Monetary (e.g. 555 for Gold)
  total_tickets: number;      // Support tickets
  tags: string[];            // e.g. ["VIP", "Frequent Returner"]
}

// ─── Store Detail Stats ───────────────────────────────────────
export interface StoreDetailStats {
  store_id: string;
  store_name: string;
  total_revenue: number;
  net_revenue: number;
  revenue_change: number;
  total_orders: number;
  orders_today: number;
  conversion_rate: number;
  return_rate: number;
  avg_order_value: number;
  total_products: number;
  total_employees: number;
  pending_orders: number;
  delivered_orders: number;
  returned_orders: number;
}

export interface RevenueDataPoint {
  date: string;
  revenue: number;
  orders: number;
  /** Backend returns camelCase */
  orderRevenue: number;
  posRevenue: number;
  orderCount: number;
  posCount: number;
  /** Snake_case aliases for backwards compatibility */
  order_revenue?: number;
  pos_revenue?: number;
  order_count?: number;
  pos_count?: number;
}

export interface TopItem {
  id: string;
  name: string;
  value: number;
  secondary_value?: number;
  count?: number;
}

export interface StoreRevenue {
  storeId: string;
  storeName: string;
  totalRevenue: number;
  ordersCount: number;
  change: number;
}

export interface CategoryRevenue {
  category: string;
  revenue: number;
  orders: number;
}

export interface WilayaRevenue {
  wilaya: string;
  revenue: number;
  orders: number;
}

// ─── Customer Analytics ──────────────────────────────────────
export interface CustomerAnalytics {
  totalCustomers: number;
  newThisMonth: number;
  tierDistribution: { tier: string; count: number; revenue: number }[];
  topCustomers: {
    id: string;
    name: string;
    phone: string;
    tier: string;
    totalSpent: number;
    totalOrders: number;
  }[];
}

// ─── Stock Movement ────────────────────────────────────────
export type StockMovementType = 'ORDER_DECREMENT' | 'ORDER_INCREMENT' | 'RETURN_INCREMENT' | 'ADJUSTMENT' | 'RESTOCK';

export interface StockMovement {
  id: string;
  product_id: string;
  type: StockMovementType;
  quantity: number;
  reason: string | null;
  actor_id: string | null;
  order_id: string | null;
  created_at: string;
  product?: Pick<Product, 'id' | 'name' | 'slug'>;
  actor?: Pick<User, 'id' | 'name' | 'avatar'> | null;
}

// ─── Delivery Fees by Wilaya ──────────────────────────────
export { WILAYAS, getDeliveryFeeSync as getDeliveryFee, DEFAULT_DELIVERY_FEE } from './wilaya-data';

// ─── Call Result Labels ───────────────────────────────────
export const CALL_RESULT_LABELS: Record<string, string> = {
  ANSWERED: 'Répondu',
  NOT_ANSWERED: 'Injoignable',
  BUSY: 'Occupé',
  REFUSED: 'Refusé',
  POSTPONED: 'Reporté',
};

export const CALL_RESULT_COLORS: Record<string, string> = {
  ANSWERED: 'bg-emerald-100 text-emerald-800',
  NOT_ANSWERED: 'bg-rose-100 text-rose-800',
  BUSY: 'bg-amber-100 text-amber-800',
  REFUSED: 'bg-red-100 text-red-800',
  POSTPONED: 'bg-sky-100 text-sky-800',
};

// ─── Cart ───────────────────────────────────────────────────
export interface CartItem {
  product: Product;
  quantity: number;
  selectedVariant?: string;
  customNotes?: string;
  customPrice?: number;
  image_url?: string;
  sku?: string;
}



// ─── Navigation ─────────────────────────────────────────────
export type AppView = 'storefront' | 'admin';
export type StorefrontView = 'home' | 'shop' | 'product' | 'cart' | 'checkout' | 'order-tracking' | 'wishlist';
export type AdminView = 'overview' | 'orders' | 'employees' | 'analytics' | 'audit' | 'products' | 'stores' | 'stores_menu' | 'promotions' | 'customers' | 'settings' | 'pos' | 'scanner' | 'inventory' | 'expenses' | 'finances' | 'users_management' | 'clients_management' | 'partners' | 'sendpilot' | 'delivery' | 'delivery_partners' | 'visitors' | 'landing_pages' | 'cost_calculator' | 'meta_ads' | 'upsell' | 'purchase_vouchers';

// ─── API Response ───────────────────────────────────────────
export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  message?: string;
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─── Order Pipeline Labels ──────────────────────────────────
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  NEW: 'Nouvelle',
  ASSIGNED: 'Assignée',
  CALLED: 'Appelée',
  IN_PROGRESS: 'En cours',
  RESCHEDULED: 'Reportée',
  CONFIRMED: 'Confirmée',
  SHIPPED: 'Expédiée',
  DELIVERED: 'Livrée',
  RETURNED: 'Retournée',
  CANCELLED: 'Annulée',
  ABANDONED: 'Panier Abandonné',
  RECOVERED_CART: 'Panier Récupéré',
  DUPLICATE: 'Doublon',
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  NEW: 'bg-slate-100 text-slate-800',
  ASSIGNED: 'bg-amber-100 text-amber-800',
  CALLED: 'bg-sky-100 text-sky-800',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  RESCHEDULED: 'bg-violet-100 text-violet-800',
  CONFIRMED: 'bg-emerald-100 text-emerald-800',
  SHIPPED: 'bg-indigo-100 text-indigo-800',
  DELIVERED: 'bg-green-100 text-green-800',
  RETURNED: 'bg-rose-100 text-rose-800',
  CANCELLED: 'bg-red-100 text-red-800',
  ABANDONED: 'bg-purple-100 text-purple-800 border border-purple-200/50',
  RECOVERED_CART: 'bg-teal-100 text-teal-800 border border-teal-200/30',
  DUPLICATE: 'bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-150',
};

export const ORDER_STATUS_DOT: Record<OrderStatus, string> = {
  NEW: 'bg-slate-500',
  ASSIGNED: 'bg-amber-500',
  CALLED: 'bg-sky-500',
  IN_PROGRESS: 'bg-amber-500',
  RESCHEDULED: 'bg-violet-500',
  CONFIRMED: 'bg-emerald-500',
  SHIPPED: 'bg-indigo-500',
  DELIVERED: 'bg-green-500',
  RETURNED: 'bg-rose-500',
  CANCELLED: 'bg-red-500',
  ABANDONED: 'bg-purple-500',
  RECOVERED_CART: 'bg-teal-500',
  DUPLICATE: 'bg-fuchsia-500',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Administrateur',
  MANAGER: 'Manager',
  CONFIRMATEUR: 'Confirmateur',
  MARKETER: 'Marketer',
  CUSTOMER: 'Client',
};

export const CUSTOMER_TIER_LABELS: Record<CustomerTier, string> = {
  BRONZE: 'Bronze',
  SILVER: 'Argent',
  GOLD: 'Or',
  PLATINUM: 'Platine',
  DIAMOND: 'Diamant',
};

export const CUSTOMER_TIER_THRESHOLDS: Record<CustomerTier, number> = {
  BRONZE: 0,
  SILVER: 20000,
  GOLD: 50000,
  PLATINUM: 100000,
  DIAMOND: 200000,
};

export const PROMOTION_TYPE_LABELS: Record<PromotionType, string> = {
  PERCENTAGE: 'Pourcentage',
  FIXED_AMOUNT: 'Montant fixe',
  FREE_SHIPPING: 'Livraison gratuite',
};

// Valid status transitions (state machine for order pipeline)
export const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  NEW:         ['ASSIGNED', 'RETURNED', 'CANCELLED', 'ABANDONED', 'IN_PROGRESS', 'CONFIRMED', 'RECOVERED_CART'],
  ASSIGNED:    ['CALLED', 'RETURNED', 'CANCELLED', 'ABANDONED', 'IN_PROGRESS', 'CONFIRMED', 'RESCHEDULED', 'RECOVERED_CART'],
  CALLED:      ['CONFIRMED', 'NEW', 'RETURNED', 'CANCELLED', 'ABANDONED', 'IN_PROGRESS', 'RESCHEDULED', 'RECOVERED_CART'],
  IN_PROGRESS: ['CONFIRMED', 'CANCELLED', 'RESCHEDULED', 'IN_PROGRESS', 'RECOVERED_CART'],
  RESCHEDULED: ['CONFIRMED', 'CANCELLED', 'IN_PROGRESS', 'RESCHEDULED', 'RECOVERED_CART'],
  CONFIRMED:   ['SHIPPED', 'RETURNED', 'CANCELLED', 'IN_PROGRESS', 'RESCHEDULED'],
  RECOVERED_CART: ['SHIPPED', 'RETURNED', 'CANCELLED', 'IN_PROGRESS', 'RESCHEDULED'],
  SHIPPED:     ['DELIVERED', 'RETURNED', 'CANCELLED'],
  DELIVERED:   ['RETURNED'],
  RETURNED:    [],
  CANCELLED:   ['IN_PROGRESS', 'RECOVERED_CART'],
  ABANDONED:   ['CONFIRMED', 'CANCELLED', 'IN_PROGRESS', 'RESCHEDULED', 'RECOVERED_CART'],
  DUPLICATE:   [],
};


