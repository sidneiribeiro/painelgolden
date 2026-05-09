/**
 * Hook para logout automático por inatividade
 * 
 * Detecta quando o usuário fica inativo por X minutos
 * e faz logout automático para garantir que os dados
 * sejam sempre atualizados quando o usuário voltar.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';

interface UseIdleTimeoutOptions {
  /** Tempo de inatividade em minutos antes de fazer logout (padrão: 30 minutos) */
  timeoutMinutes?: number;
  /** Se deve fazer logout quando a aba fica em background por muito tempo */
  logoutOnBackground?: boolean;
  /** Tempo em background antes de fazer logout (padrão: 5 minutos) */
  backgroundTimeoutMinutes?: number;
}

export function useIdleTimeout(options: UseIdleTimeoutOptions = {}) {
  const {
    timeoutMinutes = 30, // 30 minutos de inatividade
    logoutOnBackground = true,
    backgroundTimeoutMinutes = 5, // 5 minutos em background
  } = options;

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const backgroundTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const logout = useAuthStore((state) => state.logout);

  const resetTimeout = useCallback(() => {
    // Limpar timeout anterior
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Definir novo timeout
    const timeoutMs = timeoutMinutes * 60 * 1000;
    timeoutRef.current = setTimeout(() => {
      console.log(`🔒 Inatividade detectada (${timeoutMinutes} minutos) - Fazendo logout automático...`);
      logout();
      // Redirecionar para login após logout
      window.location.href = '/login';
    }, timeoutMs);
  }, [timeoutMinutes, logout]);

  const handleActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    resetTimeout();
  }, [resetTimeout]);

  // Detecta atividade do usuário
  useEffect(() => {
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    
    events.forEach(event => {
      document.addEventListener(event, handleActivity, true);
    });

    // Iniciar timeout inicial
    resetTimeout();

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, handleActivity, true);
      });
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [handleActivity, resetTimeout]);

  // Detecta quando a aba fica em background
  useEffect(() => {
    if (!logoutOnBackground) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Aba ficou em background - iniciar timeout
        if (backgroundTimeoutRef.current) {
          clearTimeout(backgroundTimeoutRef.current);
        }
        
        const backgroundTimeoutMs = backgroundTimeoutMinutes * 60 * 1000;
        backgroundTimeoutRef.current = setTimeout(() => {
          console.log(`🔒 Aba em background por muito tempo (${backgroundTimeoutMinutes} minutos) - Fazendo logout automático...`);
          logout();
          window.location.href = '/login';
        }, backgroundTimeoutMs);
      } else {
        // Aba voltou ao foco - limpar timeout de background
        if (backgroundTimeoutRef.current) {
          clearTimeout(backgroundTimeoutRef.current);
          backgroundTimeoutRef.current = null;
        }
        // Resetar timeout de atividade
        handleActivity();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (backgroundTimeoutRef.current) {
        clearTimeout(backgroundTimeoutRef.current);
      }
    };
  }, [logoutOnBackground, backgroundTimeoutMinutes, logout, handleActivity]);

  return {
    resetTimeout: handleActivity,
  };
}

