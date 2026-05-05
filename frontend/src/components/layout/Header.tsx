import { useLocation } from 'react-router-dom';
import { ThemeToggle } from '../ui/ThemeToggle';
import { usePanelSettings } from '../../hooks/usePanelSettings';
import { getImageUrl } from '../../utils/imageUrl';

interface HeaderProps {
  onMenuClick?: () => void;
}

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/customers': 'Clientes',
  '/packages': 'Pacotes',
  '/bouquets': 'Bouquets',
  '/users': 'Usuários',
  '/settings/xui-connection': 'Servidores',
  '/settings/notifications': 'Notificações',
  '/settings/access-groups': 'Grupos de Acesso',
  '/settings/panel': 'Configurações',
  '/settings/tmdb-keys': 'Chaves TMDB',
  '/live/streams': 'Streams (Live)',
  '/live/import': 'Importar Streams',
  '/core': 'Xtream Novo',
};

export function Header({ onMenuClick }: HeaderProps) {
  const location = useLocation();
  const title = pageTitles[location.pathname] || 'PainelMaster';
  const { data: panelSettings } = usePanelSettings();

  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-white/80 dark:bg-zinc-950/80 border-b border-zinc-200/50 dark:border-zinc-800/50">
      <div className="h-16 px-4 lg:px-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Botão Menu Mobile */}
          <button
            onClick={onMenuClick}
            className="lg:hidden p-2 -ml-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
            aria-label="Abrir menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Logo Mobile */}
          <div className="lg:hidden flex items-center gap-3">
            {panelSettings?.logoUrl ? (
              <img
                src={getImageUrl(panelSettings.logoUrl) || ''}
                alt={panelSettings.panelName}
                className="w-9 h-9 object-contain"
                onError={(e) => {
                  console.error('Erro ao carregar logo:', e);
                  (e.target as HTMLImageElement).style.display = 'none';
                  const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                  if (fallback) fallback.style.display = 'flex';
                }}
              />
            ) : null}
            <div className={`w-9 h-9 bg-gradient-to-br from-cyan-500 to-violet-600 rounded-xl flex items-center justify-center shadow-lg shadow-cyan-500/20 ${panelSettings?.logoUrl ? 'hidden' : ''}`}>
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
              </svg>
            </div>
          </div>

          {/* Título da Página */}
          <div className="flex items-center gap-3">
            <h1 className="text-lg lg:text-xl font-semibold text-zinc-900 dark:text-white">{title}</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Data atual */}
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800/80 text-xs text-zinc-600 dark:text-zinc-300">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span>{new Date().toLocaleDateString('pt-BR', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}</span>
          </div>

          {/* Botão de Recarregar */}
          <button
            onClick={() => {
              localStorage.removeItem('react-query-cache');
              window.location.reload();
            }}
            className="p-2.5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
            title="Recarregar página"
            aria-label="Recarregar página"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          {/* Toggle de Tema */}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

export default Header;
