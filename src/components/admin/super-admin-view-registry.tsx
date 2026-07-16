'use client';

import React from 'react';
import { useAppStore } from '@/store/app-store';
import OverviewPage from './overview-page';
import OrdersPage from './orders-page';
import ProductsPage from './products-page';
import InventoryDashboard from './modules/inventory-dashboard';
import FinanceDashboard from './modules/finance-dashboard';
import ProtocolScanner from './modules/protocol-scanner';
import ExpensesDashboard from './modules/expenses-dashboard';
import PointOfSale from './modules/point-of-sale';
import EmployeesPage from './employees-page';
import AnalyticsPage from './analytics-page';
import AuditPage from './audit-page';
import StoresPage from './stores-page';
import PromotionsPage from './promotions-page';
import CustomersPage from './customers-page';
import PartnersDashboard from './modules/partners-dashboard';
import SendpilotDashboard from './modules/sendpilot-dashboard';
import DeliveryPartners from './modules/delivery-partners';
import LandingPagesDashboard from './modules/landing-pages-dashboard';
import { SettingsPlaceholder } from '../app/settings-placeholder';
import VisitorsPage from './visitors-page';
import MetaAdsDashboard from './modules/meta-ads-dashboard';
import MetaQueueDashboard from './modules/meta-queue-dashboard';
import UpsellManager from './modules/upsell-manager';
import PurchaseManager from './modules/purchase-manager';

export default function SuperAdminView() {
  const { adminView, adminSubView } = useAppStore();

  switch (adminView) {
    case 'overview':
      return <OverviewPage key="overview" />;
    case 'orders':
      return <OrdersPage key={`orders-${adminSubView || 'all'}`} />;
    case 'products':
      return <ProductsPage key="products" />;
    case 'inventory':
      return <InventoryDashboard key={`inventory-${adminSubView || 'core'}`} />;
    case 'expenses':
      return <ExpensesDashboard key={`expenses-${adminSubView || 'all'}`} />;
    case 'finances':
      return <FinanceDashboard key={`finances-${adminSubView || 'wallets'}`} />;
    case 'users_management':
    case 'employees':
      return <EmployeesPage key={`employees-${adminSubView || 'infra'}`} />;
    case 'analytics':
      return <AnalyticsPage key={`analytics-${adminSubView || 'kpi'}`} />;
    case 'audit':
      return <AuditPage key={`audit-${adminSubView || 'logs'}`} />;
    case 'stores':
    case 'stores_menu':
      return <StoresPage key={`stores-${adminSubView || 'list'}`} />;
    case 'promotions':
      return <PromotionsPage key={`promotions-${adminSubView || 'all'}`} />;
    case 'customers':
    case 'clients_management':
      return <CustomersPage key={`customers-${adminSubView || 'list'}`} />;
    case 'visitors':
      return <VisitorsPage key="visitors" />;
    case 'partners':
      return <PartnersDashboard key={`partners-${adminSubView || 'overview'}`} />;
    case 'pos':
      return <PointOfSale key="pos" />;
    case 'scanner':
      return <ProtocolScanner key="scanner" />;
    case 'sendpilot':
      return <SendpilotDashboard key={`sendpilot-${adminSubView || 'core'}`} />;
    case 'delivery':
    case 'delivery_partners':
      return <DeliveryPartners key={`delivery-${adminSubView || 'carriers'}`} />;
    case 'landing_pages':
      return <LandingPagesDashboard key="landing_pages" />;
    case 'meta_ads':
      return <MetaAdsDashboard key="meta_ads" />;
    case 'meta_queue':
      return <MetaQueueDashboard key="meta_queue" />;
    case 'upsell':
      return <UpsellManager key="upsell" />;
    case 'purchase_vouchers':
      return <PurchaseManager key="purchase_vouchers" />;
    case 'settings':
      return <SettingsPlaceholder key="settings" />;
    default:
      return <div className="p-20 text-center text-neutral-800 uppercase tracking-[0.5em] font-black">Protocol Node Undefined // {adminView}</div>;
  }
}
