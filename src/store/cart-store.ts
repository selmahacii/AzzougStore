import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartItem, Product } from '@/lib/types';
import { trackMetaEvent } from '@/lib/meta-pixel';
import { useAppStore } from '@/store/app-store';

interface CartState {
  items: CartItem[];
  isOpen: boolean;
  wishlistItems: string[];
  addItem: (product: Product, quantity?: number, variant?: string, customNotes?: string, customPrice?: number) => void;
  removeItem: (productId: string, variant?: string, customNotes?: string) => void;
  updateQuantity: (productId: string, quantity: number, variant?: string, customNotes?: string) => void;
  clearCart: () => void;
  toggleCart: () => void;
  openCart: () => void;
  closeCart: () => void;
  totalItems: () => number;
  totalPrice: () => number;
  getItemQuantity: (productId: string, variant?: string, customNotes?: string) => number;
  toggleWishlist: (productId: string) => void;
  isInWishlist: (productId: string) => boolean;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isOpen: false,
      wishlistItems: [],

      addItem: (product, quantity = 1, variant, customNotes, customPrice) => {
        const items = [...get().items];
        const key = `${product.id}-${variant || ''}-${customNotes || ''}`;
        const existingIdx = items.findIndex((item) =>
          `${item.product.id}-${item.selectedVariant || ''}-${item.customNotes || ''}` === key
        );

        if (existingIdx >= 0) {
          items[existingIdx] = {
            ...items[existingIdx],
            quantity: items[existingIdx].quantity + quantity,
            customPrice,
            image_url: product.main_image || undefined,
            sku: product.sku || undefined,
          };
        } else {
          items.push({ 
            product, 
            quantity, 
            selectedVariant: variant, 
            customNotes, 
            customPrice,
            image_url: product.main_image || undefined,
            sku: product.sku || undefined,
          });
        }

        // Meta Pixel + CAPI AddToCart (shared event_id — Meta deduplicates)
        try {
          const storeId = useAppStore.getState().activeStore?.id;
          trackMetaEvent('AddToCart', {
            content_ids: [product.id],
            content_name: product.name,
            content_type: 'product',
            contents: [{ id: product.id, quantity, item_price: customPrice ?? product.price }],
            value: (customPrice ?? product.price) * quantity,
            currency: 'DZD',
          }, { storeId });
        } catch { /* never break the cart */ }

        set({ items });
      },

      removeItem: (productId, variant, customNotes) => {
        set({
          items: get().items.filter((item) =>
            `${item.product.id}-${item.selectedVariant || ''}-${item.customNotes || ''}` !== `${productId}-${variant || ''}-${customNotes || ''}`
          ),
        });
      },

      updateQuantity: (productId, quantity, variant, customNotes) => {
        if (quantity <= 0) {
          get().removeItem(productId, variant, customNotes);
          return;
        }
        set({
          items: get().items.map((item) =>
            `${item.product.id}-${item.selectedVariant || ''}-${item.customNotes || ''}` === `${productId}-${variant || ''}-${customNotes || ''}`
              ? { ...item, quantity }
              : item
          ),
        });
      },

      clearCart: () => set({ items: [] }),
      toggleCart: () => set((s) => ({ isOpen: !s.isOpen })),
      openCart: () => set({ isOpen: true }),
      closeCart: () => set({ isOpen: false }),

      totalItems: () =>
        get().items.reduce((sum, item) => sum + item.quantity, 0),

      totalPrice: () =>
        get().items.reduce(
          (sum, item) => {
            if (!item?.product) return sum;
            if (item.customPrice !== undefined && item.customPrice !== null) {
              return sum + item.customPrice * item.quantity;
            }
            const modifier = item.selectedVariant && item.product.variants
              ? item.product.variants.find((v: any) => v.value === item.selectedVariant)?.priceModifier ?? 0
              : 0;
            return sum + (item.product.price + modifier) * item.quantity;
          },
          0
        ),

      getItemQuantity: (productId, variant, customNotes) => {
        const item = get().items.find((i) =>
          `${i.product.id}-${i.selectedVariant || ''}-${i.customNotes || ''}` === `${productId}-${variant || ''}-${customNotes || ''}`
        );
        return item?.quantity ?? 0;
      },

      toggleWishlist: (productId) => {
        const current = get().wishlistItems;
        if (current.includes(productId)) {
          set({ wishlistItems: current.filter((id) => id !== productId) });
        } else {
          set({ wishlistItems: [...current, productId] });
        }
      },

      isInWishlist: (productId) => {
        return get().wishlistItems.includes(productId);
      },
    }),
    {
      name: 'ecommerce-cart',
      partialize: (state) => ({ items: state.items, wishlistItems: state.wishlistItems }),
    }
  )
);
