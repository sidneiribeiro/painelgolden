import { NavLink } from 'react-router-dom';
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

// SVG Icons
const Icons = {
  dashboard: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  ),
  customers: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  resellers: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  ),
  financial: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  billing: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  hierarchy: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
    </svg>
  ),
  packages: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
  bouquets: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
    </svg>
  ),
  users: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  vod: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  ),
  live: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
    </svg>
  ),
  marketing: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
    </svg>
  ),
  premium: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
    </svg>
  ),
  settings: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  notifications: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  ),
  panel: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
    </svg>
  ),
  core: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V7z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9h8M8 13h8M8 17h5" />
    </svg>
  ),
  asaas: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  ),
  backups: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  ),
  import: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  ),
  xui: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
    </svg>
  ),
  logout: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  ),
};

// All menu keys
export const ALL_MENU_KEYS = [
  'dashboard', 'customers', 'financial', 'billing_report', 'billing_hierarchy',
  'packages', 'bouquets', 'users', 'resellers', 'vod', 'live', 'marketing', 'premium',
  'notifications', 'panel_settings', 'asaas', 'backups', 'import_sigma', 'xui_connection', 'core'
];

// Labels
export const MENU_KEY_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  bouquets: 'Bouquets',
  users: 'Usuários',
  resellers: 'Revendedores',
  vod: 'VOD',
  live: 'LIVE TV',
  marketing: 'Marketing',
  premium: 'Premium',
  notifications: 'Notificações',
  panel_settings: 'Config. do Painel',
  asaas: 'Pagamentos',
  backups: 'Backups',
  import_sigma: 'Importar SIGMA',
  xui_connection: 'Servidores',
  core: 'Xtream Novo',
};

// Default permissions
const DEFAULT_RESELLER_KEYS = ['dashboard', 'notifications', 'panel_settings', 'core'];
const DEFAULT_MASTER_RESELLER_KEYS = ['dashboard', 'notifications', 'panel_settings', 'asaas', 'backups', 'core'];

// Navigation items
const navItems: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: Icons.dashboard, key: 'dashboard' },
];

const serverItems: NavItem[] = [
  { path: '/core', label: 'Xtream Novo', icon: Icons.core, key: 'core', roles: ['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER', 'RESELLER'] },
];

const bouquetItems: NavItem[] = [
  { path: '/bouquets', label: 'Gerir Bouquets', icon: Icons.bouquets, key: 'bouquets', roles: ['SUPER_ADMIN', 'ADMIN'] },
];

const contentItems: NavItem[] = [
  { path: '/live/streams', label: 'Streams (Live)', icon: Icons.live, key: 'live', roles: ['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'] },
  { path: '/live/import', label: 'Importar Streams', icon: Icons.import, key: 'live', roles: ['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'] },
  { path: '/vod', label: 'Filmes / Séries', icon: Icons.vod, key: 'vod', roles: ['SUPER_ADMIN', 'ADMIN'] },
  { path: '/vod/items', label: 'Itens VOD', icon: Icons.vod, key: 'vod', roles: ['SUPER_ADMIN', 'ADMIN'] },
  { path: '/vod/import-v2', label: 'Importar VOD', icon: Icons.import, key: 'vod', roles: ['SUPER_ADMIN', 'ADMIN'] },
  { path: '/vod/schedules', label: 'Agendamentos VOD', icon: Icons.settings, key: 'vod', roles: ['SUPER_ADMIN', 'ADMIN'] },
];

const managementItems: NavItem[] = [
  { path: '/users', label: 'Usuários', icon: Icons.users, key: 'users', roles: ['SUPER_ADMIN', 'ADMIN'] },
  { path: '/settings/access-groups', label: 'Grupos de Acesso', icon: Icons.settings, key: 'access_groups', roles: ['SUPER_ADMIN', 'ADMIN'] },
  { path: '/settings/panel', label: 'Configurações', icon: Icons.panel, key: 'panel_settings' },
  { path: '/backups', label: 'Backups', icon: Icons.backups, key: 'backups', roles: ['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'] },
  { path: '/settings/asaas', label: 'Pagamentos', icon: Icons.asaas, key: 'asaas', roles: ['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'] },
];

const marketingItems: NavItem[] = [
  { path: '/marketing/config', label: 'Configuração', icon: Icons.settings, key: 'marketing', roles: ['SUPER_ADMIN', 'ADMIN'] },
  { path: '/marketing/banners', label: 'Banners e Vídeos', icon: Icons.marketing, key: 'marketing', roles: ['SUPER_ADMIN', 'ADMIN'] },
  { path: '/marketing/jogos-do-dia', label: 'Jogos do Dia', icon: Icons.premium, key: 'marketing', roles: ['SUPER_ADMIN', 'ADMIN'] },
  { path: '/marketing/video-promocional', label: 'Vídeo Promocional', icon: Icons.vod, key: 'marketing', roles: ['SUPER_ADMIN', 'ADMIN'] },
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
    if (userMenuPermissions && userMenuPermissions.length > 0) return userMenuPermissions;
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

        {/* Servidores */}
        {filterByRole(serverItems).length > 0 && (
          <div className="mb-6">
            <p className="text-[10px] uppercase text-zinc-400 dark:text-zinc-500 font-semibold tracking-wider px-4 mb-2">Servidores</p>
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

        {/* Gestão Completa */}
        {filterByRole(managementItems).length > 0 && (
          <div className="mb-6">
            <p className="text-[10px] uppercase text-zinc-400 dark:text-zinc-500 font-semibold tracking-wider px-4 mb-2">Gestão Completa</p>
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

        {/* Conteúdos */}
        {filterByRole(contentItems).length > 0 && (
          <div className="mb-6">
            <p className="text-[10px] uppercase text-zinc-400 dark:text-zinc-500 font-semibold tracking-wider px-4 mb-2">Conteúdos</p>
            {filterByRole(contentItems).map((item) => (
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

        {/* Bouquets */}
        {filterByRole(bouquetItems).length > 0 && (
          <div className="mb-6">
            <p className="text-[10px] uppercase text-zinc-400 dark:text-zinc-500 font-semibold tracking-wider px-4 mb-2">Bouquets</p>
            {filterByRole(bouquetItems).map((item) => (
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
