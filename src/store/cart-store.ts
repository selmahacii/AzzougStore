import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartItem, Product } from '@/lib/types';

interface CartState {
  items: CartItem[];
  isOpen: boolean;
  wishlistItems: string[];
  addItem: (product: Product, quantity?: number, variant?: string) => void;
  removeItem: (productId: string, variant?: string) => void;
  updateQuantity: (productId: string, quantity: number, variant?: string) => void;
  clearCart: () => void;
  toggleCart: () => void;
  openCart: () => void;
  closeCart: () => void;
  totalItems: () => number;
  totalPrice: () => number;
  getItemQuantity: (productId: string, variant?: string) => number;
  toggleWishlist: (productId: string) => void;
  isInWishlist: (productId: string) => boolean;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isOpen: false,
      wishlistItems: [],

      addItem: (product, quantity = 1, variant) => {
        const items = [...get().items];
        const key = variant
          ? `${product.id}-${variant}`
          : product.id;
        const existingIdx = items.findIndex((item) =>
          variant
            ? `${item.product.id}-${item.selectedVariant}` === key
            : item.product.id === product.id && !item.selectedVariant
        );

        if (existingIdx >= 0) {
          items[existingIdx] = {
            ...items[existingIdx],
            quantity: items[existingIdx].quantity + quantity,
          };
        } else {
          items.push({ product, quantity, selectedVariant: variant });
        }

        set({ items });
      },

      removeItem: (productId, variant) => {
        set({
          items: get().items.filter((item) =>
            variant
              ? !(item.product.id === productId && item.selectedVariant === variant)
              : item.product.id !== productId
          ),
        });
      },

      updateQuantity: (productId, quantity, variant) => {
        if (quantity <= 0) {
          get().removeItem(productId, variant);
          return;
        }
        set({
          items: get().items.map((item) =>
            variant
              ? item.product.id === productId && item.selectedVariant === variant
                ? { ...item, quantity }
                : item
              : item.product.id === productId
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
            const modifier = item.selectedVariant
              ? item.product.variants?.find(v => v.value === item.selectedVariant)?.priceModifier ?? 0
              : 0;
            return sum + (item.product.price + modifier) * item.quantity;
          },
          0
        ),

      getItemQuantity: (productId, variant) => {
        const item = get().items.find((i) =>
          variant
            ? i.product.id === productId && i.selectedVariant === variant
            : i.product.id === productId && !i.selectedVariant
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
