import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const C = {
   primary: '#6C5CE7', primaryBg: '#F0EDFF',
   success: '#00B894', successBg: '#E6FFF8',
   danger: '#E17055', dangerBg: '#FFEDE9',
   warning: '#FDCB6E', warningBg: '#FFF8E6',
   info: '#0984E3', infoBg: '#E8F4FE',
   text: '#2D3436', textLight: '#636E72', textDim: '#B2BEC3', border: '#E9ECF0', bg: '#F8F9FC',
};

export const getProductVariantItems = (product: any, returnsByVariant: Record<string, any> = {}) => {
   if (!product || !product.variants || product.variants.length === 0) return [];
   const items: Array<{ variantStr: string; stock: number; reserved: number; returned: number }> = [];
   const productReturns = returnsByVariant[product?.id] || {};

   product.variants.forEach((v: any) => {
     let vars = v;
     if (typeof vars === 'string') {
       try { vars = JSON.parse(vars); } catch { return; }
     }
     if (vars.sub_variants && vars.sub_variants.length > 0) {
       vars.sub_variants.forEach((sv: any) => {
         const variantStr = `${vars.name}: ${vars.value}, ${sv.name || 'Taille'}: ${sv.value}`;
         items.push({
           variantStr,
           stock: sv.stock || 0,
           reserved: sv.reserved || 0,
           returned: productReturns[variantStr] || 0,
         });
       });
     } else {
       const variantStr = `${vars.name}: ${vars.value}`;
       items.push({
         variantStr,
         stock: vars.stock || 0,
         reserved: vars.reserved || 0,
         returned: productReturns[variantStr] || 0,
       });
     }
   });
   return items;
};
