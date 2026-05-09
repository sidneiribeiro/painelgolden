import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';
import { useThemeStore } from './store/themeStore';
import { ErrorBoundary } from './components/ErrorBoundary';
import { logger } from './utils/logger';

// Inicializar tema
try {
  const theme = useThemeStore.getState().theme;
  document.documentElement.classList.add(theme);
} catch (error) {
  logger.error('Erro ao inicializar tema', error);
  document.documentElement.classList.add('dark'); // Fallback para dark
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60, // 1 minuto
    },
  },
});

// Verificar se está em ambiente de desenvolvimento
if (import.meta.env.DEV) {
  console.log('🔧 Modo de desenvolvimento ativo');
  console.log('📍 URL:', window.location.href);
  console.log('🌐 Hostname:', window.location.hostname);
  console.log('📦 VITE_API_URL:', import.meta.env.VITE_API_URL);
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  const error = new Error('Elemento root não encontrado');
  logger.error('Elemento root não encontrado no DOM', error);
  throw error;
}

try {
  ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#1a1a24',
              color: '#fff',
              border: '1px solid #2d2d3a',
            },
            success: {
              iconTheme: {
                primary: '#00ff88',
                secondary: '#1a1a24',
              },
            },
            error: {
              iconTheme: {
                primary: '#ff4444',
                secondary: '#1a1a24',
              },
            },
          }}
        />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
  );
} catch (error) {
  logger.error('Erro ao renderizar aplicação', error);
  rootElement.innerHTML = `
    <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #18181b; color: white; padding: 20px; text-align: center;">
      <div>
        <h1 style="color: #ef4444; margin-bottom: 20px;">⚠️ Erro Fatal</h1>
        <p style="margin-bottom: 20px;">Erro ao inicializar a aplicação.</p>
        <pre style="background: #27272a; padding: 15px; border-radius: 8px; overflow: auto; text-align: left; font-size: 12px;">
${error instanceof Error ? error.message : String(error)}
${error instanceof Error && error.stack ? '\n' + error.stack : ''}
        </pre>
        <button 
          onclick="window.location.reload()" 
          style="margin-top: 20px; padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 8px; cursor: pointer;"
        >
          Recarregar Página
        </button>
      </div>
    </div>
  `;
}
