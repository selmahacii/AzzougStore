import { useEffect, useState, useRef } from 'react';
import { useAppStore } from '@/store/app-store';
import { apiFetch } from '@/lib/api-client';
import { toast } from 'sonner';

// Admin components
import AdminSidebar from '@/components/admin/admin-sidebar';
import SuperAdminSidebar from '@/components/admin/super-admin-sidebar';
import AdminHeader from '@/components/admin/admin-header';
import AgentDashboard from '@/components/agent/agent-dashboard';
import LivreurDashboard from '@/components/livreur/livreur-dashboard';

import SuperAdminViewRegistry from '@/components/admin/super-admin-view-registry';

export function AdminApp() {
   const { sidebarCollapsed, setSidebarCollapsed, user: currentUser, activeStore, setAdminView, setQuickAdjustProduct } = useAppStore();
   const [isMobile, setIsMobile] = useState(false);
   const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
   const isAgent = currentUser?.role === 'CONFIRMATEUR';
   // LivreurDashboard existed fully built (deliveries/products/inventory
   // sections, its own mobile-first header+nav) but was never imported or
   // routed to anywhere — a livreur fell through to the generic AdminSidebar
   // branch below, seeing the full admin nav (Employees/Analytics/Finances/
   // ...) instead of their own scoped interface.
   const isLivreur = currentUser?.role === 'LIVREUR';
   const notifiedIdsRef = useRef<Set<string>>(new Set());

   useEffect(() => {
      if (!activeStore?.id || isAgent || isLivreur) return;

      // Clear notified list when store changes
      notifiedIdsRef.current.clear();

      const checkLowStock = async () => {
         try {
            const res = await apiFetch<any>(`/api/v1/products?store_id=${activeStore.id}&low_stock=true&pageSize=30`);
            const items = res?.data || res || [];

            items.forEach((p: any) => {
               // Check if product itself is out of stock (stock === 0)
               if (p.stock === 0) {
                  const key = `prod-${p.id}`;
                  if (!notifiedIdsRef.current.has(key)) {
                     notifiedIdsRef.current.add(key);
                     triggerOutOfStockToast(p, null);
                  }
               }

               // Check if any variants are out of stock (stock === 0)
               let vars = p.variants || [];
               if (typeof vars === 'string') {
                  try { vars = JSON.parse(vars); } catch { vars = []; }
               }
               if (Array.isArray(vars)) {
                  vars.forEach((v: any) => {
                     let actualV = v;
                     if (typeof actualV === 'string') {
                        try { actualV = JSON.parse(actualV); } catch { return; }
                     }
                     if (actualV.sub_variants && actualV.sub_variants.length > 0) {
                        actualV.sub_variants.forEach((sv: any) => {
                           if (sv.stock === 0) {
                              const key = `sv-${p.id}-${actualV.value}-${sv.value}`;
                              if (!notifiedIdsRef.current.has(key)) {
                                 notifiedIdsRef.current.add(key);
                                 triggerOutOfStockToast(p, `${actualV.name}: ${actualV.value}, ${sv.name || 'Taille'}: ${sv.value}`);
                              }
                           }
                        });
                     } else {
                        if (actualV.stock === 0) {
                           const key = `v-${p.id}-${actualV.value}`;
                           if (!notifiedIdsRef.current.has(key)) {
                              notifiedIdsRef.current.add(key);
                              triggerOutOfStockToast(p, `${actualV.name}: ${actualV.value}`);
                           }
                        }
                     }
                  });
               }
            });
         } catch (err) {
            console.error("Failed to check low stock", err);
         }
      };

      const triggerOutOfStockToast = (product: any, variantLabel: string | null) => {
         const description = variantLabel 
            ? `La variante "${variantLabel}" est en rupture de stock.`
            : `Le produit est en rupture de stock.`;

         toast.error(`Alerte Rupture de Stock ! 🚨`, {
            description: `Produit: ${product.name}. ${description}`,
            duration: 20000,
            action: {
               label: "Réappro.",
               onClick: () => {
                  setAdminView('inventory', 'STOCK');
                  setQuickAdjustProduct(product);
               }
            }
         });
      };

      // Initial check
      checkLowStock();

      // Check every 2 minutes — low-stock alerts don't need near-real-time
      // polling, and this ran against the DB from every open admin tab.
      const interval = setInterval(checkLowStock, 120000);
      return () => clearInterval(interval);
   }, [activeStore?.id, isAgent, isLivreur, setAdminView, setQuickAdjustProduct]);

   useEffect(() => {
      const handleResize = () => {
         setIsMobile(window.innerWidth < 1024);
      };

      handleResize();
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
   }, []);

   useEffect(() => {
      if (isMobile) {
         setSidebarCollapsed(true);
      }
   }, [isMobile, setSidebarCollapsed]);

   const sidebarWidth = isSuperAdmin ? (sidebarCollapsed ? '80px' : '288px') : (sidebarCollapsed ? '70px' : '260px');

   // Confirmateur gets their own focused dashboard — no sidebar/header clutter
   if (isAgent) return <AgentDashboard />;
   // Livreur likewise: his own mobile-first shell, not the generic admin one.
   if (isLivreur) return <LivreurDashboard />;

   return (
      <div className="min-h-screen flex bg-[#F8F9FC]" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
         {/* Sidebar Overlay for Mobile */}
         {isMobile && !sidebarCollapsed && (
            <div 
               className="fixed inset-0 z-[45] bg-black/50 backdrop-blur-sm transition-opacity duration-300"
               onClick={() => setSidebarCollapsed(true)}
            />
         )}

         {isSuperAdmin ? <SuperAdminSidebar /> : <AdminSidebar />}
         
         <div
            className="flex-1 flex flex-col min-h-screen transition-all duration-300 w-full"
            style={{ 
               marginLeft: isMobile ? '0' : sidebarWidth 
            }}
         >
            <AdminHeader />
            <div className="flex-1 overflow-auto custom-scrollbar flex flex-col pt-16">
               <main className="flex-1 p-3 sm:p-6 min-h-screen">
                  <div className="max-w-[1600px] mx-auto w-full">
                     {/* 
                         Unified registry ensures a stable component tree hierarchy 
                         to prevent hook mismatch errors during role/view transitions.
                     */}
                     <SuperAdminViewRegistry key={`admin-registry-${isSuperAdmin ? 'super' : 'standard'}`} />
                  </div>
               </main>
            </div>
         </div>
      </div>
   );
}
