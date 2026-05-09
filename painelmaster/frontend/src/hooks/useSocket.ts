/**
 * Hook para gerenciar conexão Socket.io
 * Monitora progresso de importações em tempo real
 */

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';

// Construir URL do Socket.io corretamente para diferentes ambientes
const getSocketUrl = () => {
  const apiUrl = import.meta.env.VITE_API_URL;
  
  if (import.meta.env.DEV) {
    // Em desenvolvimento, conectar diretamente ao backend
    return 'http://localhost:3001';
  }
  
  if (import.meta.env.PROD) {
    // Em produção, usar a mesma origem do site
    return window.location.origin;
  }
  
  // Fallback
  return 'http://localhost:3001';
};

const SOCKET_URL = getSocketUrl();

export interface ProcessUpdate {
  status: 'idle' | 'processing' | 'completed' | 'error' | 'paused';
  progress: number;
  processedItems: number;
  addedItems: number;
  totalItems: number;
  timeRemaining?: string;
  error?: string;
  currentItem?: string;
  message?: string;
  stats?: {
    totalItems?: number;
    importedItems?: number;
  };
}

interface UseSocketOptions {
  onProcessUpdate?: (update: ProcessUpdate) => void;
  onProcessComplete?: (result: any) => void;
  onProcessError?: (error: string) => void;
}

export function useSocket(options: UseSocketOptions = {}) {
  const { onProcessUpdate, onProcessComplete, onProcessError } = options;
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [processStatus, setProcessStatus] = useState<ProcessUpdate>({
    status: 'idle',
    progress: 0,
    processedItems: 0,
    addedItems: 0,
    totalItems: 0,
  });
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);

  // ⚠️ FIX: Usar useRef para callbacks para evitar reconexões infinitas
  const callbacksRef = useRef({ onProcessUpdate, onProcessComplete, onProcessError });
  callbacksRef.current = { onProcessUpdate, onProcessComplete, onProcessError };

  useEffect(() => {
    if (!token || !user) {
      console.log('Socket: Sem token ou usuário, não conectando');
      return;
    }

    // Usar ID do usuário para sincronizar com backend
    const userId = user.id || user.username || 'anonymous';
    console.log('Socket: Conectando ao servidor:', SOCKET_URL, 'userId:', userId);

    // Criar conexão Socket.io
    const socket = io(SOCKET_URL, {
      auth: {
        token,
        userId, // ⚠️ IMPORTANTE: Passar userId para o backend
      },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    socketRef.current = socket;

    // Event listeners
    socket.on('connect', () => {
      console.log('Socket: Conectado!');
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('Socket: Desconectado');
      setIsConnected(false);
    });

    socket.on('connect_error', (error) => {
      console.error('Socket: Erro de conexão:', error);
      setIsConnected(false);
    });

    // Eventos de progresso
    socket.on('processUpdate', (update: ProcessUpdate) => {
      console.log('Socket: Atualização de progresso:', update);
      setProcessStatus(update);
      callbacksRef.current.onProcessUpdate?.(update);
    });

    socket.on('processComplete', (result: any) => {
      console.log('Socket: Processo completo:', result);
      setProcessStatus({
        status: 'completed',
        progress: 100,
        processedItems: result.total || 0,
        addedItems: result.inserted || 0,
        totalItems: result.total || 0,
      });
      callbacksRef.current.onProcessComplete?.(result);
    });

    socket.on('processError', (error: string) => {
      console.error('Socket: Erro no processo:', error);
      setProcessStatus((prev) => ({
        ...prev,
        status: 'error',
        error,
      }));
      callbacksRef.current.onProcessError?.(error);
    });

    // Cleanup
    return () => {
      console.log('Socket: Desconectando...');
      socket.disconnect();
    };
  }, [token, user]); // ⚠️ FIX: Removido callbacks das dependências

  return {
    socket: socketRef.current,
    isConnected,
    processStatus,
  };
}

