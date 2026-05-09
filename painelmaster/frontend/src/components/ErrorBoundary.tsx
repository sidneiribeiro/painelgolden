import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary capturou um erro:', error, errorInfo);
    // Enviar para serviço de log se necessário
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem('lastError', JSON.stringify({
          message: error.message,
          stack: error.stack,
          componentStack: errorInfo.componentStack,
          timestamp: new Date().toISOString(),
        }));
      } catch (e) {
        // Ignorar se não conseguir salvar
      }
    }
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-zinc-900 rounded-lg p-6 border border-zinc-800">
            <h1 className="text-2xl font-bold mb-4 text-red-400">⚠️ Erro ao Carregar</h1>
            <p className="text-zinc-300 mb-4">
              Ocorreu um erro ao carregar o aplicativo. Por favor, tente novamente.
            </p>
            {this.state.error && (
              <details className="mb-4" open>
                <summary className="text-sm text-zinc-400 cursor-pointer mb-2">
                  Detalhes do erro (clique para expandir)
                </summary>
                <div className="bg-zinc-800 p-3 rounded overflow-auto">
                  <div className="text-xs text-red-300 mb-2">
                    <strong>Erro:</strong> {this.state.error.message}
                  </div>
                  {this.state.error.stack && (
                    <pre className="text-xs text-zinc-400 whitespace-pre-wrap break-words">
                      {this.state.error.stack}
                    </pre>
                  )}
                  <div className="mt-3 text-xs text-zinc-500">
                    <strong>URL:</strong> {window.location.href}
                    <br />
                    <strong>User Agent:</strong> {navigator.userAgent}
                  </div>
                </div>
              </details>
            )}
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              Recarregar Página
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

