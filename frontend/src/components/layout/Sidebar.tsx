import { NavLink } from 'react-router-dom';
import {
  Bell,
  CreditCard,
  Download,
  Film,
  HardDriveDownload,
  Key,
  LayoutDashboard,
  Layers,
  LogOut,
  Megaphone,
  Package,
  Server,
  Settings,
  ShieldCheck,
  Sliders,
  Tv,
  User,
  Users,
  UsersRound,
  Wallet,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { usePanelSettings } from '../../hooks/usePanelSettings';
import { getImageUrl } from '../../utils/imageUrl';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  key: string;
  roles?: string[];
}

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

const Icons = {
  dashboard: <LayoutDashboard className="w-5 h-5" />,
  customers: <Users className="w-5 h-5" />,
  resellers: <UsersRound className="w-5 h-5" />,
  financial: <Wallet className="w-5 h-5" />,
  packages: <Package className="w-5 h-5" />,
  bouquets: <Layers className="w-5 h-5" />,
  users: <User className="w-5 h-5" />,
  vod: <Film className="w-5 h-5" />,
  live: <Tv className="w-5 h-5" />,
  marketing: <Megaphone className="w-5 h-5" />,
  premium: <ShieldCheck className="w-5 h-5" />,
  settings: <Settings className="w-5 h-5" />,
  notifications: <Bell className="w-5 h-5" />,
  panel: <Sliders className="w-5 h-5" />,
  core: <Server className="w-5 h-5" />,
  asaas: <CreditCard className="w-5 h-5" />,
  backups: <HardDriveDownload className="w-5 h-5" />,
  import: <Download className="w-5 h-5" />,
  tmdb: <Key className="w-5 h-5" />,
  logout: <LogOut className="w-5 h-5" />,
};

// All menu keys
export const ALL_MENU_KEYS = [
  'dashboard', 'customers', 'financial', 'billing_report', 'billing_hierarchy',
  'packages', 'bouquets', 'users', 'resellers', 'vod', 'live', 'marketing', 'premium',
  'notifications', 'panel_settings', 'tmdb_keys', 'asaas', 'backups', 'import_sigma', 'xui_connection', 'core'
];

// Labels
export const MENU_KEY_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  bouquets: 'Categorias',
  users: 'Revendedores',
  resellers: 'Revendedores',
  vod: 'Filmes',
  live: 'LIVE TV',
  marketing: 'Marketing',
  premium: 'Premium',
  notifications: 'Notificações',
  panel_settings: 'Config. do Painel',
  tmdb_keys: 'TMDB Keys',
  asaas: 'Pagamentos',
  backups: 'Backups',
  import_sigma: 'Importar SIGMA',
  xui_connection: 'Servidores',
  core: 'Xtream Novo',
};

// Default permissions
const DEFAULT_RESELLER_KEYS = ['dashboard', 'customers', 'users', 'panel_settings', 'notifications', 'core'];
const DEFAULT_MASTER_RESELLER_KEYS = ['dashboard', 'customers', 'users', 'panel_settings', 'notifications', 'core', 'live', 'vod'];

// Navigation items
const navItems: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: Icons.dashboard, key: 'dashboard' },
];

const serverItems: NavItem[] = [
  { path: '/core', label: 'Xtream Novo', icon: Icons.core, key: 'core', roles: ['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER', 'RESELLER'] },
  { path: '/core?tab=bouquets', label: 'Categorias', icon: Icons.bouquets, key: 'core', roles: ['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER', 'RESELLER'] },
  { path: '/core?tab=packages', label: 'Pacotes', icon: Icons.packages, key: 'core', roles: ['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER', 'RESELLER'] },
  { path: '/core?tab=lines', label: 'Clientes', icon: Icons.customers, key: 'core', roles: ['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER', 'RESELLER'] },
];

const bouquetItems: NavItem[] = [
  { path: '/bouquets', label: 'Gerir Bouquets', icon: Icons.bouquets, key: 'bouquets', roles: ['SUPER_ADMIN', 'ADMIN'] },
];

const managementItems: NavItem[] = [
  { path: '/users', label: 'Revendedores', icon: Icons.users, key: 'users', roles: ['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER', 'RESELLER'] },
  { path: '/settings/access-groups', label: 'Grupos de Acesso', icon: Icons.settings, key: 'access_groups', roles: ['SUPER_ADMIN', 'ADMIN'] },
  { path: '/settings/panel', label: 'Configurações', icon: Icons.panel, key: 'panel_settings' },
  { path: '/settings/tmdb-keys', label: 'TMDB Keys', icon: Icons.tmdb, key: 'tmdb_keys', roles: ['SUPER_ADMIN', 'ADMIN'] },
  { path: '/backups', label: 'Backups', icon: Icons.backups, key: 'backups', roles: ['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'] },
  { path: '/settings/asaas', label: 'Pagamentos', icon: Icons.asaas, key: 'asaas', roles: ['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'] },
];

const marketingItems: NavItem[] = [
  { path: '/marketing/config', label: 'Configuração', icon: Icons.settings, key: 'marketing', roles: ['SUPER_ADMIN', 'ADMIN'] },
  { path: '/marketing/banners', label: 'Banners e Vídeos', icon: Icons.marketing, key: 'marketing', roles: ['SUPER_ADMIN', 'ADMIN'] },
  { path: '/marketing/jogos-do-dia', label: 'Jogos do Dia', icon: Icons.premium, key: 'marketing', roles: ['SUPER_ADMIN', 'ADMIN'] },
  { path: '/marketing/video-promocional', label: 'Vídeo Promocional', icon: Icons.vod, key: 'marketing', roles: ['SUPER_ADMIN', 'ADMIN'] },
];

const liveItems: NavItem[] = [
  { path: '/live/streams', label: 'Canais (Live)', icon: Icons.live, key: 'live', roles: ['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'] },
  { path: '/live/import', label: 'Importar (Live)', icon: Icons.import, key: 'live', roles: ['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'] },
];

const vodItems: NavItem[] = [
  { path: '/vod/movies', label: 'Filmes', icon: Icons.vod, key: 'vod', roles: ['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'] },
  { path: '/vod/series', label: 'Séries', icon: Icons.vod, key: 'vod', roles: ['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'] },
];

export function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const userRole = user?.role || 'RESELLER';
  const { data: panelSettings } = usePanelSettings();

  const userMenuPermissions: string[] | null = (() => {
    if (!user?.menuPermissions) return null;
    try {
      const parsed = typeof user.menuPermissions === 'string' ? JSON.parse(user.menuPermissions) : user.menuPermissions;
      return Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  })();

  const effectivePermissions: string[] | null = (() => {
    if (['SUPER_ADMIN', 'ADMIN'].includes(userRole)) return null;
    if (userRole === 'MASTER_RESELLER') return DEFAULT_MASTER_RESELLER_KEYS;
    return DEFAULT_RESELLER_KEYS;
  })();

  const filterByRole = (items: NavItem[]) => {
    return items.filter((item) => {
      if (item.roles && !item.roles.includes(userRole)) return false;
      if (!effectivePermissions) return true;
      return effectivePermissions.includes(item.key);
    });
  };

  const isSectionAllowed = (sectionKey: string) => {
    if (!effectivePermissions) return true;
    return effectivePermissions.includes(sectionKey);
  };

  const handleNavClick = () => {
    if (onClose) onClose();
  };

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all ${
      isActive
        ? 'bg-gradient-to-r from-cyan-500/15 to-violet-500/15 text-cyan-600 dark:text-cyan-400 font-medium'
        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-white'
    }`;

  return (
    <aside
      className={`
        fixed left-0 top-0 h-screen w-64 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-xl border-r border-zinc-200/50 dark:border-zinc-800/50 flex flex-col z-40
        transform transition-transform duration-300 ease-in-out shadow-xl shadow-zinc-200/10 dark:shadow-black/10
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0
      `}
    >
      {/* Logo */}
      <div className="h-20 px-6 flex items-center border-b border-zinc-200/50 dark:border-zinc-800/50">
        <div className="flex items-center gap-3">
          {panelSettings?.logoUrl ? (
            <img
              src={getImageUrl(panelSettings.logoUrl) || ''}
              alt={panelSettings.panelName}
              className="w-10 h-10 object-contain"
              onError={(e) => {
                console.error('Erro ao carregar logo:', e);
                (e.target as HTMLImageElement).style.display = 'none';
                const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                if (fallback) fallback.style.display = 'flex';
              }}
            />
          ) : null}
          <div className={`w-10 h-10 bg-gradient-to-br from-cyan-500 via-violet-500 to-cyan-600 rounded-xl flex items-center justify-center shadow-lg shadow-cyan-500/20 ${panelSettings?.logoUrl ? 'hidden' : ''}`}>
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-bold bg-gradient-to-r from-cyan-600 to-violet-600 dark:from-cyan-400 dark:to-violet-400 bg-clip-text text-transparent">
              {panelSettings?.panelName || 'PAINEL'}
            </h1>
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Gestão</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-4 space-y-1">
        {/* Main Nav */}
        <div className="mb-6">
          <p className="text-[10px] uppercase text-zinc-400 dark:text-zinc-500 font-semibold tracking-wider px-4 mb-2">Principal</p>
          {filterByRole(navItems).map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={navLinkClass}
              end={item.path === '/'}
              onClick={handleNavClick}
            >
              <span className="text-zinc-500 dark:text-zinc-400">{item.icon}</span>
              <span className="text-sm">{item.label}</span>
            </NavLink>
          ))}
        </div>

        {/* Xtream Novo */}
        {filterByRole(serverItems).length > 0 && (
          <div className="mb-6">
            <p className="text-[10px] uppercase text-zinc-400 dark:text-zinc-500 font-semibold tracking-wider px-4 mb-2">Xtream Novo</p>
            {filterByRole(serverItems).map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={navLinkClass}
                onClick={handleNavClick}
              >
                <span className="text-zinc-500 dark:text-zinc-400">{item.icon}</span>
                <span className="text-sm">{item.label}</span>
              </NavLink>
            ))}
          </div>
        )}

        {/* Administração */}
        {filterByRole(managementItems).length > 0 && (
          <div className="mb-6">
            <p className="text-[10px] uppercase text-zinc-400 dark:text-zinc-500 font-semibold tracking-wider px-4 mb-2">Administração</p>
            {filterByRole(managementItems).map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={navLinkClass}
                onClick={handleNavClick}
              >
                <span className="text-zinc-500 dark:text-zinc-400">{item.icon}</span>
                <span className="text-sm">{item.label}</span>
              </NavLink>
            ))}
          </div>
        )}

        {/* Marketing */}
        {filterByRole(marketingItems).length > 0 && (
          <div>
            <p className="text-[10px] uppercase text-zinc-400 dark:text-zinc-500 font-semibold tracking-wider px-4 mb-2">Marketing</p>
            {filterByRole(marketingItems).map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={navLinkClass}
                onClick={handleNavClick}
              >
                <span className="text-zinc-500 dark:text-zinc-400">{item.icon}</span>
                <span className="text-sm">{item.label}</span>
              </NavLink>
            ))}
          </div>
        )}

        {/* LIVE TV */}
        {filterByRole(liveItems).length > 0 && (
          <div className="mt-6">
            <p className="text-[10px] uppercase text-zinc-400 dark:text-zinc-500 font-semibold tracking-wider px-4 mb-2">LIVE TV</p>
            {filterByRole(liveItems).map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={navLinkClass}
                onClick={handleNavClick}
              >
                <span className="text-zinc-500 dark:text-zinc-400">{item.icon}</span>
                <span className="text-sm">{item.label}</span>
              </NavLink>
            ))}
          </div>
        )}

        {/* Filmes / Séries */}
        {filterByRole(vodItems).length > 0 && (
          <div className="mt-6">
            <p className="text-[10px] uppercase text-zinc-400 dark:text-zinc-500 font-semibold tracking-wider px-4 mb-2">Filmes e Séries</p>
            {filterByRole(vodItems).map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={navLinkClass}
                onClick={handleNavClick}
              >
                <span className="text-zinc-500 dark:text-zinc-400">{item.icon}</span>
                <span className="text-sm">{item.label}</span>
              </NavLink>
            ))}
          </div>
        )}
      </nav>

      {/* User Info & Logout */}
      <div className="p-4 border-t border-zinc-200/50 dark:border-zinc-800/50">
        {user && (
          <div className="bg-gradient-to-r from-cyan-500/5 to-violet-500/5 dark:from-cyan-500/10 dark:to-violet-500/10 rounded-xl p-3 mb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-cyan-500 to-violet-600 rounded-lg flex items-center justify-center text-white font-semibold text-sm">
                {user.username?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">{user.username}</p>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  {userRole === 'SUPER_ADMIN' && 'Super Admin'}
                  {userRole === 'ADMIN' && 'Administrador'}
                  {userRole === 'MASTER_RESELLER' && 'Master Revenda'}
                  {userRole === 'RESELLER' && 'Revendedor'}
                </p>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {(user as any).billingType === 'POSTPAID' ? 'Vencimento' : 'Créditos'}
              </span>
              <span className="text-sm font-bold text-cyan-600 dark:text-cyan-400">
                {(user as any).billingType === 'POSTPAID'
                  ? (user as any).dueDate
                    ? new Date((user as any).dueDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
                    : 'N/A'
                  : user.credits || 0
                }
              </span>
            </div>
          </div>
        )}

        <button
          onClick={logout}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 rounded-xl hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors font-medium text-sm"
        >
          {Icons.logout}
          <span>Sair</span>
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
