// Logger simples para debug
export const logger = {
  error: (message: string, error?: any) => {
    console.error(`[ERROR] ${message}`, error);
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const errors = JSON.parse(localStorage.getItem('appErrors') || '[]');
        errors.push({
          message,
          error: error?.toString(),
          stack: error?.stack,
          timestamp: new Date().toISOString(),
        });
        // Manter apenas últimos 10 erros
        localStorage.setItem('appErrors', JSON.stringify(errors.slice(-10)));
      } catch (e) {
        // Ignorar se não conseguir salvar
      }
    }
  },
  warn: (message: string, data?: any) => {
    console.warn(`[WARN] ${message}`, data);
  },
  info: (message: string, data?: any) => {
    console.info(`[INFO] ${message}`, data);
  },
};


