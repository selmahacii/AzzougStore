import { z } from 'zod/v4';

// ═══════════════════════════════════════════════════════════════
// Shared validation helpers for API routes
// ═══════════════════════════════════════════════════════════════

/**
 * Clamp pageSize to a safe range to prevent excessive DB queries
 */
export function clampPageSize(pageSize: number, max = 100, min = 1): number {
  return Math.max(min, Math.min(max, pageSize));
}

/**
 * Safely parse JSON strings with a fallback value.
 * Handles cases where the input might already be an object (Prisma native Json).
 */
export function safeJsonParse<T>(json: any, fallback: T): T {
  if (!json) return fallback;
  if (typeof json === 'object') return json as T;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Validate Algerian phone number format (0[5-7]XXXXXXXX)
 */
export function validatePhone(phone: string): boolean {
  return /^0[5-7]\d{8}$/.test(phone.replace(/\s/g, ''));
}

// ═══════════════════════════════════════════════════════════════
// Zod Schemas
// ═══════════════════════════════════════════════════════════════

/** Login schema — email + password */
export const loginSchema = z.object({
  email: z.email('Email invalide'),
  password: z.string().min(1, 'Mot de passe requis'),
}).strip();

export type LoginInput = z.infer<typeof loginSchema>;

/** Register schema — name + email + password + phone */
export const registerSchema = z.object({
  name: z.string().min(2, 'Le nom doit contenir au moins 2 caractères'),
  email: z.email('Email invalide'),
  password: z.string().min(6, 'Le mot de passe doit contenir au moins 6 caractères'),
  phone: z.string().refine(validatePhone, 'Numéro de téléphone invalide').optional(),
}).strip();

export type RegisterInput = z.infer<typeof registerSchema>;

/** Order item schema */
const orderItemSchema = z.object({
  product_id: z.string().min(1, 'product_id requis'),
  product_name: z.string().min(1, 'product_name requis'),
  quantity: z.number().int().min(1, 'La quantité doit être ≥ 1'),
  unit_price: z.number().min(0, 'Le prix doit être ≥ 0'),
  image: z.string().optional(),
  variant: z.string().optional(),
  category: z.string().optional(),
}).strip();

/** Create order schema */
export const createOrderSchema = z.object({
  store_id: z.string().min(1, 'store_id requis'),
  customer_name: z.string().min(2, 'Le nom doit contenir au moins 2 caractères').max(200),
  customer_phone: z.string().refine(validatePhone, 'Numéro de téléphone invalide (format: 05XXXXXXXX)'),
  customer_phone_2: z.string().optional(),
  customer_email: z.string().optional(),
  customer_address: z.string().optional(),
  customer_wilaya: z.string().optional(),
  customer_commune: z.string().optional(),
  delivery_type: z.enum(['HOME', 'OFFICE']).default('HOME'),
  wilaya_id: z.number().int().min(1).max(58).optional(),
  items: z.array(orderItemSchema).min(1, 'Au moins un article requis'),
  source: z.string().optional(),
  promo_code: z.string().optional(),
  notes: z.string().optional(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
}).strip();

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/** Status change schema */
export const statusChangeSchema = z.object({
  id: z.string().min(1, 'Order ID requis'),
  status: z.enum(['NEW', 'ASSIGNED', 'CALLED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED']),
  assigned_to: z.string().nullable().optional(),
  notes: z.string().optional(),
  call_result: z.enum(['ANSWERED', 'NOT_ANSWERED', 'BUSY', 'REFUSED', 'POSTPONED']).nullable().optional(),
  call_attempt_number: z.number().int().min(1).optional(),
  scheduled_callback_at: z.string().nullable().optional(),
  tracking_number: z.string().nullable().optional(),
  carrier_id: z.string().nullable().optional(),
}).strip();

export type StatusChangeInput = z.infer<typeof statusChangeSchema>;

/** Soft delete schema */
export const softDeleteSchema = z.object({
  id: z.string().min(1, 'Order ID requis'),
  is_deleted: z.literal(true),
}).strip();

export type SoftDeleteInput = z.infer<typeof softDeleteSchema>;

/** Delivery fee query schema */
export const deliveryFeeQuerySchema = z.object({
  wilaya_id: z.coerce.number().int().min(1, 'wilaya_id doit être entre 1 et 58').max(58, 'wilaya_id doit être entre 1 et 58'),
  type: z.enum(['HOME', 'OFFICE']).default('HOME'),
}).strip();

export type DeliveryFeeQuery = z.infer<typeof deliveryFeeQuerySchema>;

/** Create store schema */
export const createStoreSchema = z.object({
  name: z.string().min(2, 'Le nom doit contenir au moins 2 caractères').max(100),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Le slug doit être en minuscules alphanumérique avec tirets'),
  description: z.string().optional(),
  domain: z.string().optional(),
  owner_id: z.string().optional(),
  theme_config: z.record(z.string(), z.unknown()).optional(),
}).strip();

export type CreateStoreInput = z.infer<typeof createStoreSchema>;

/** Update store schema */
export const updateStoreSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  theme_config: z.record(z.string(), z.unknown()).optional(),
  owner_id: z.string().optional(),
}).strip();

export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;

/** Store soft-delete schema */
export const storeSoftDeleteSchema = z.object({
  id: z.string().min(1),
  is_deleted: z.literal(true),
}).strip();

/** Create employee schema */
export const createEmployeeSchema = z.object({
  name: z.string().min(2, 'Le nom doit contenir au moins 2 caractères').max(100),
  email: z.email('Email invalide'),
  password: z.string().min(6, 'Le mot de passe doit contenir au moins 6 caractères'),
  phone: z.string().optional(),
  role: z.enum(['SUPER_ADMIN', 'MANAGER', 'CONFIRMATEUR']).default('CONFIRMATEUR'),
  employee_store_id: z.string().min(1, 'employee_store_id est requis'),
  daily_target: z.number().int().min(0).optional(),
}).strip();

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

/** Create product schema */
export const createProductSchema = z.object({
  store_id: z.string().min(1, 'store_id requis'),
  name: z.string().min(2, 'Le nom doit contenir au moins 2 caractères').max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Le slug doit être en minuscules alphanumérique avec tirets'),
  description: z.string().optional(),
  price: z.number().min(0, 'Le prix doit être ≥ 0'),
  compare_price: z.number().min(0).optional(),
  cost_price: z.number().min(0).optional(),
  stock: z.number().int().min(0, 'Le stock doit être ≥ 0').default(0),
  low_stock_threshold: z.number().int().min(0).default(5),
  images: z.array(z.string()).optional(),
  variants: z.array(z.record(z.string(), z.unknown())).optional(),
  category: z.string().optional(),
  featured: z.boolean().optional(),
  is_active: z.boolean().optional(),
}).strip();

export type CreateProductInput = z.infer<typeof createProductSchema>;

/** Create promotion schema */
export const createPromotionSchema = z.object({
  store_id: z.string().min(1, 'store_id requis'),
  code: z.string().min(3, 'Le code doit contenir au moins 3 caractères').max(20),
  type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING']),
  value: z.number().min(0),
  min_order_amount: z.number().min(0).optional(),
  max_uses: z.number().int().min(1).nullable().optional(),
  starts_at: z.string().optional(),
  ends_at: z.string().optional(),
  description: z.string().optional(),
  applicable_categories: z.string().optional(),
  first_purchase_only: z.boolean().optional(),
  is_flash_sale: z.boolean().optional(),
  flash_sale_ends_at: z.string().optional(),
}).strip();

export type CreatePromotionInput = z.infer<typeof createPromotionSchema>;

/** Create stock movement schema */
export const createStockMovementSchema = z.object({
  product_id: z.string().min(1, 'product_id requis'),
  type: z.enum(['MANUAL_ADJUSTMENT', 'RESTOCK']),
  quantity: z.number().int(),
  reason: z.string().optional(),
  store_id: z.string().min(1, 'store_id requis'),
}).strip();

export type CreateStockMovementInput = z.infer<typeof createStockMovementSchema>;

/** Create review schema */
export const createReviewSchema = z.object({
  product_id: z.string().min(1, 'product_id requis'),
  store_id: z.string().min(1, 'store_id requis'),
  customer_name: z.string().min(2, 'Le nom doit contenir au moins 2 caractères').max(100),
  rating: z.number().int().min(1, 'La note doit être ≥ 1').max(5, 'La note doit être ≤ 5'),
  title: z.string().max(100).optional(),
  comment: z.string().min(10, 'Le commentaire doit contenir au moins 10 caractères').max(1000),
}).strip();

export type CreateReviewInput = z.infer<typeof createReviewSchema>;

/** Sanitize data for AI/external use — strip sensitive fields */
export function sanitizeForAI(data: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['password_hash', 'password', 'token', 'credit_card', 'cvv', 'phone', 'address', 'customer_phone', 'customer_phone_2', 'customer_address'];
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (sensitiveKeys.includes(key)) continue;
    // Strip phone-like values and address-like values from nested objects
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeForAI(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
