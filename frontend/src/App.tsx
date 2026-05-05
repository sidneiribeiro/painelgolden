import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout, AuthLayout } from './components/layout';
import {
  LoginPage,
  DashboardPage,
  CustomersPage,
  NotFoundPage,
  XuiConnectionPage,
  NotificationsPage,
  AccessGroupsPage,
  UsersPage,
  PackagesPage,
  BouquetsPage,
  AsaasPage,
  PublicPaymentPage,
  PublicCoreCheckoutPage,
  BackupsPage,
  FinancialPage,
  ImportSigmaPage,
  VODDashboardPage,
  VODItemsPage,
  VODImportPage,
  VODImportV2Page,
  VODSchedulePage,
  LiveImportPage,
  LiveStreamsPage,
  CoreXtreamPage,
  LandingPage,
  MarketingConfigPage,
  MarketingBannersPage,
  JogosDoDiaPage,
  VideoPromocionalPage,
} from './pages';
import { PremiumSourcesPage } from './pages/premium/PremiumSourcesPage';
import { PremiumPlansPage } from './pages/premium/PremiumPlansPage';
import { PanelSettingsPage } from './pages/settings/PanelSettingsPage';
import { TMDBKeysPage } from './pages/settings/TMDBKeysPage';
import { ImportSourcesPage } from './pages/vod/ImportSourcesPage';
import { useAuthStore } from './store/authStore';
import BillingReportPage from "./pages/admin/BillingReport";
import HierarchicalViewPage from "./pages/admin/HierarchicalView";
import { RoleProtectedRoute } from './components/auth/RoleProtectedRoute';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function getSubdomainReseller(hostname: string) {
  const parts = (hostname || '').split('.').filter(Boolean);
  if (parts.length < 3) return '';
  const sub = parts[0].toLowerCase();
  if (sub === 'www') return '';
  return sub;
}

function PublicCoreCheckoutSubdomainRoute() {
  let hostname = '';
  try {
    hostname = window.location.hostname || '';
  } catch {
    hostname = '';
  }
  const reseller = getSubdomainReseller(hostname);
  return <PublicCoreCheckoutPage resellerOverride={reseller || undefined} />;
}

function App() {
  let hostname = '';
  try {
    hostname = window.location.hostname || '';
  } catch (e) {
    console.warn('Erro ao obter hostname:', e);
    hostname = '';
  }
  
  // Landing configurável via env VITE_LANDING_HOSTNAME (ex.: "site.meudominio.com")
  const landingHostname = (import.meta as any).env?.VITE_LANDING_HOSTNAME || '';
  const isLandingPage =
    (landingHostname && hostname === landingHostname) || hostname.startsWith('site.');

  return (
    <BrowserRouter>
      <Routes>
        {isLandingPage ? (
          <>
            <Route path="/" element={<LandingPage />} />
            <Route path="/landing" element={<LandingPage />} />
            <Route path="*" element={<LandingPage />} />
          </>
        ) : (
          <>
            <Route path="/landing" element={<LandingPage />} />
            <Route path="/pay/:token" element={<PublicPaymentPage />} />
            <Route path="/core/checkout/:reseller" element={<PublicCoreCheckoutPage />} />
            <Route path="/core/checkout" element={<PublicCoreCheckoutSubdomainRoute />} />
            <Route path="/login" element={<PublicRoute><AuthLayout><LoginPage /></AuthLayout></PublicRoute>} />
            <Route path="/" element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
              <Route index element={<DashboardPage />} />
              <Route path="customers" element={<CustomersPage />} />
              <Route path="packages" element={<PackagesPage />} />
              <Route path="bouquets" element={<BouquetsPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="settings">
                <Route path="xui-connection" element={<RoleProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN']}><XuiConnectionPage /></RoleProtectedRoute>} />
                <Route path="notifications" element={<RoleProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN']} menuKey="notifications"><NotificationsPage /></RoleProtectedRoute>} />
                <Route path="access-groups" element={<RoleProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN']}><AccessGroupsPage /></RoleProtectedRoute>} />
                <Route path="panel" element={<PanelSettingsPage />} />
                <Route path="asaas" element={<RoleProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER', 'RESELLER']} menuKey="asaas"><AsaasPage /></RoleProtectedRoute>} />
                <Route path="tmdb-keys" element={<RoleProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN']}><TMDBKeysPage /></RoleProtectedRoute>} />
              </Route>
              <Route path="backups" element={<RoleProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN']} menuKey="backups"><BackupsPage /></RoleProtectedRoute>} />
              <Route path="financial" element={<RoleProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN']} menuKey="financial"><FinancialPage /></RoleProtectedRoute>} />
              <Route path="billing">
                <Route path="report" element={<RoleProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER', 'RESELLER']} menuKey="billing_report"><BillingReportPage /></RoleProtectedRoute>} />
                <Route path="hierarchy" element={<RoleProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER', 'RESELLER']} menuKey="billing_hierarchy"><HierarchicalViewPage /></RoleProtectedRoute>} />
              </Route>
              <Route path="import-sigma" element={<ImportSigmaPage />} />
              <Route path="vod">
                <Route index element={<VODDashboardPage />} />
                <Route path="items" element={<VODItemsPage />} />
                <Route path="import" element={<RoleProtectedRoute allowedRoles={['SUPER_ADMIN']}><VODImportPage /></RoleProtectedRoute>} />
                <Route path="import-v2" element={<RoleProtectedRoute allowedRoles={['SUPER_ADMIN']}><VODImportV2Page /></RoleProtectedRoute>} />
                <Route path="schedules" element={<VODSchedulePage />} />
                <Route path="sources" element={<RoleProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN']} menuKey="vod"><ImportSourcesPage /></RoleProtectedRoute>} />
              </Route>
              <Route path="live">
                <Route path="streams" element={<RoleProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER']}><LiveStreamsPage /></RoleProtectedRoute>} />
                <Route path="import" element={<RoleProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER']}><LiveImportPage /></RoleProtectedRoute>} />
              </Route>
              <Route path="marketing">
                <Route path="config" element={<RoleProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN']} menuKey="marketing"><MarketingConfigPage /></RoleProtectedRoute>} />
                <Route path="banners" element={<RoleProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN']} menuKey="marketing"><MarketingBannersPage /></RoleProtectedRoute>} />
                <Route path="jogos-do-dia" element={<RoleProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN']} menuKey="marketing"><JogosDoDiaPage /></RoleProtectedRoute>} />
                <Route path="video-promocional" element={<RoleProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN']} menuKey="marketing"><VideoPromocionalPage /></RoleProtectedRoute>} />
              </Route>
              <Route path="core" element={<RoleProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER', 'RESELLER']} menuKey="core"><CoreXtreamPage /></RoleProtectedRoute>} />
              <Route path="premium">
                <Route path="sources" element={<RoleProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN']}><PremiumSourcesPage /></RoleProtectedRoute>} />
                <Route path="plans" element={<RoleProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN']}><PremiumPlansPage /></RoleProtectedRoute>} />
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}

export default App;
