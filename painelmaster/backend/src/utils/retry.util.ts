/**
 * Utilitário para retry com backoff exponencial
 * Implementa retry automático com delays exponenciais para operações que podem falhar
 */

import { logger } from './logger.js';

export interface RetryOptions {
  maxRetries?: number; // Máximo de tentativas (padrão: 3)
  initialDelay?: number; // Delay inicial em ms (padrão: 1000 = 1s)
  maxDelay?: number; // Delay máximo em ms (padrão: 60000 = 60s)
  exponentialBase?: number; // Base exponencial (padrão: 2)
  retryableErrors?: number[]; // Códigos HTTP que devem ser retentados (padrão: [408, 429, 500, 502, 503, 504])
  retryableErrorCodes?: string[]; // Códigos de erro que devem ser retentados (ex: 'ECONNABORTED', 'ETIMEDOUT')
  onRetry?: (attempt: number, error: any) => void; // Callback quando retentar
  shouldRetry?: (error: any, attempt: number) => boolean; // Função customizada para decidir se deve retentar
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'shouldRetry'>> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 60000,
  exponentialBase: 2,
  retryableErrors: [408, 429, 500, 502, 503, 504],
  retryableErrorCodes: ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET'],
};

/**
 * Executa uma operação com retry e backoff exponencial
 * 
 * @param operation Função assíncrona a ser executada
 * @param options Opções de retry
 * @returns Resultado da operação
 * @throws Erro da última tentativa se todas falharem
 * 
 * @example
 * ```typescript
 * const result = await withRetry(
 *   async () => await axios.get('/api/data'),
 *   { maxRetries: 3, initialDelay: 1000 }
 * );
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  let lastError: any;

  for (let attempt = 1; attempt <= opts.maxRetries; attempt++) {
    try {
      const result = await operation();
      
      // Se chegou aqui, operação foi bem-sucedida
      if (attempt > 1) {
        logger.debug(`[Retry] Operação bem-sucedida após ${attempt} tentativa(s)`);
      }
      
      return result;
    } catch (error: any) {
      lastError = error;

      // Se é a última tentativa, não retentar
      if (attempt >= opts.maxRetries) {
        logger.warn(`[Retry] Todas as ${opts.maxRetries} tentativas falharam`);
        throw error;
      }

      // Verificar se deve retentar usando função customizada
      if (opts.shouldRetry) {
        if (!opts.shouldRetry(error, attempt)) {
          throw error;
        }
      } else {
        // Verificar se erro é retentável
        const shouldRetry = isRetryableError(error, opts);
        if (!shouldRetry) {
          logger.debug(`[Retry] Erro não retentável: ${error.message}`);
          throw error;
        }
      }

      // Calcular delay exponencial
      const delay = calculateExponentialDelay(attempt - 1, opts);

      // Callback antes de retentar
      if (opts.onRetry) {
        opts.onRetry(attempt, error);
      }

      logger.debug(
        `[Retry] Tentativa ${attempt}/${opts.maxRetries} falhou: ${error.message}. ` +
        `Retentando em ${delay}ms...`
      );

      // Aguardar antes de retentar
      await sleep(delay);
    }
  }

  // Nunca deve chegar aqui, mas TypeScript precisa
  throw lastError;
}

/**
 * Verifica se um erro é retentável
 */
function isRetryableError(error: any, options: Required<Omit<RetryOptions, 'onRetry' | 'shouldRetry'>>): boolean {
  // Timeout ou erro de conexão
  const isTimeout = options.retryableErrorCodes.some(code => 
    error.code === code || 
    error.message?.includes(code) ||
    error.message?.toLowerCase().includes('timeout')
  );

  if (isTimeout) {
    return true;
  }

  // Erro HTTP com código retentável
  if (error.response) {
    const status = error.response.status;
    if (options.retryableErrors.includes(status)) {
      return true;
    }
  }

  // Status code direto (alguns casos)
  if (error.status && options.retryableErrors.includes(error.status)) {
    return true;
  }

  return false;
}

/**
 * Calcula delay exponencial com backoff
 * 
 * @param attempt Número da tentativa (0-indexed)
 * @param options Opções de retry
 * @returns Delay em milissegundos
 */
function calculateExponentialDelay(
  attempt: number,
  options: Required<Omit<RetryOptions, 'onRetry' | 'shouldRetry'>>
): number {
  const delay = options.initialDelay * Math.pow(options.exponentialBase, attempt);
  return Math.min(delay, options.maxDelay);
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry específico para operações HTTP/Axios
 */
export async function retryHttp<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  return withRetry(operation, {
    ...options,
    retryableErrors: options.retryableErrors || [408, 429, 500, 502, 503, 504],
    retryableErrorCodes: options.retryableErrorCodes || ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET'],
  });
}

/**
 * Retry específico para operações de banco de dados
 */
export async function retryDatabase<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  return withRetry(operation, {
    ...options,
    maxRetries: options.maxRetries || 3,
    initialDelay: options.initialDelay || 500,
    retryableErrorCodes: options.retryableErrorCodes || ['ECONNRESET', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST'],
  });
}

