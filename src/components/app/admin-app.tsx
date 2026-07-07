import { useEffect, useState } from 'react';
import { useAppStore } from '@/store/app-store';

// Admin components
import AdminSidebar from '@/components/admin/admin-sidebar';
import SuperAdminSidebar from '@/components/admin/super-admin-sidebar';
import AdminHeader from '@/components/admin/admin-header';
import AgentDashboard from '@/components/agent/agent-dashboard';

import SuperAdminViewRegistry from '@/components/admin/super-admin-view-registry';

export function AdminApp() {
   const { sidebarCollapsed, setSidebarCollapsed, user: currentUser } = useAppStore();
   const [isMobile, setIsMobile] = useState(false);
   const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
   const isAgent = currentUser?.role === 'CONFIRMATEUR';

   useEffect(() => {
      const handleResize = () => {
         const mobile = window.innerWidth < 1024;
         setIsMobile(mobile);
         // Auto-collapse sidebar on mobile initially or when resizing down
         if (mobile && !sidebarCollapsed) {
            setSidebarCollapsed(true);
         }
      };

      handleResize();
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
   }, [sidebarCollapsed, setSidebarCollapsed]);

   const sidebarWidth = isSuperAdmin ? (sidebarCollapsed ? '80px' : '288px') : (sidebarCollapsed ? '70px' : '260px');

   // Confirmateur gets their own focused dashboard — no sidebar/header clutter
   if (isAgent) return <AgentDashboard />;

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
