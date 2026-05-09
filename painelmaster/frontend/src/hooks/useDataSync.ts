/**
 * Hook de Sincronização de Dados em Tempo Real
 * 
 * Este hook garante que dados críticos (créditos, status de clientes, etc.)
 * sejam sempre atualizados, especialmente em dispositivos móveis/PWA.
 */

import { useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface UseSyncOptions {
  /** Intervalo de sincronização em ms (padrão: 30s) */
  interval?: number;
  /** Se deve sincronizar ao voltar do background */
  syncOnFocus?: boolean;
  /** Se deve sincronizar ao reconectar */
  syncOnReconnect?: boolean;
  /** Query keys específicas para invalidar */
  queryKeys?: string[][];
}

const DEFAULT_CRITICAL_KEYS = [
  ['customers'],
  ['dashboard'],
  ['financial'],
  ['dashboard', 'stats'],
  ['customers', 'expiring'],
];

export function useDataSync(options: UseSyncOptions = {}) {
  const {
    interval = 30000,
    syncOnFocus = true,
    syncOnReconnect = true,
    queryKeys = DEFAULT_CRITICAL_KEYS,
  } = options;

  const queryClient = useQueryClient();
  const lastSyncRef = useRef<number>(Date.now());
  const isOnlineRef = useRef<boolean>(navigator.onLine);

  // Função para invalidar queries críticas
  const syncData = useCallback(async (reason: string = 'manual') => {
    const now = Date.now();
    const timeSinceLastSync = now - lastSyncRef.current;
    
    // Evita sincronizações muito frequentes (mínimo 5 segundos entre syncs)
    if (timeSinceLastSync < 5000 && reason !== 'force') {
      console.log(`⏳ Sync ignorado (último sync há ${Math.round(timeSinceLastSync / 1000)}s)`);
      return;
    }

    console.log(`🔄 Sincronizando dados... (motivo: ${reason})`);
    lastSyncRef.current = now;

    // Invalida todas as queries críticas
    await Promise.all(
      queryKeys.map(key => 
        queryClient.invalidateQueries({ queryKey: key })
      )
    );

    console.log('✅ Dados sincronizados');
  }, [queryClient, queryKeys]);

  // Força sincronização completa (limpa cache e recarrega)
  const forceSync = useCallback(async () => {
    console.log('🔄 Forçando sincronização completa...');
    
    // Remove todos os dados do cache
    queryClient.clear();
    
    // Invalida tudo para forçar refetch
    await queryClient.invalidateQueries();
    
    lastSyncRef.current = Date.now();
    console.log('✅ Cache limpo e dados recarregados');
  }, [queryClient]);

  // Sincronização periódica
  useEffect(() => {
    const intervalId = setInterval(() => {
      syncData('interval');
    }, interval);

    return () => clearInterval(intervalId);
  }, [syncData, interval]);

  // Sincronização ao voltar do background (mobile/PWA)
  useEffect(() => {
    if (!syncOnFocus) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const inactiveTime = Date.now() - lastSyncRef.current;
        // Se ficou mais de 30 segundos em background, sincroniza
        if (inactiveTime > 30000) {
          syncData('visibility');
        }
      }
    };

    const handleFocus = () => {
      const inactiveTime = Date.now() - lastSyncRef.current;
      if (inactiveTime > 30000) {
        syncData('focus');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [syncOnFocus, syncData]);

  // Sincronização ao reconectar internet
  useEffect(() => {
    if (!syncOnReconnect) return;

    const handleOnline = () => {
      if (!isOnlineRef.current) {
        console.log('📶 Conexão restaurada - sincronizando...');
        isOnlineRef.current = true;
        syncData('reconnect');
      }
    };

    const handleOffline = () => {
      console.log('📵 Conexão perdida');
      isOnlineRef.current = false;
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncOnReconnect, syncData]);

  return {
    syncData,
    forceSync,
    lastSync: lastSyncRef.current,
  };
}

/**
 * Hook específico para sincronizar dados de clientes
 */
export function useCustomerSync() {
  return useDataSync({
    interval: 15000, // 15 segundos
    queryKeys: [
      ['customers'],
      ['customers', 'expiring'],
    ],
  });
}

/**
 * Hook específico para sincronizar dados financeiros
 */
export function useFinancialSync() {
  return useDataSync({
    interval: 30000, // 30 segundos
    queryKeys: [
      ['financial'],
      ['dashboard', 'stats'],
    ],
  });
}


