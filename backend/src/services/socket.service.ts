/**
 * Serviço Socket.io para atualizações em tempo real
 * Gerencia progresso de importações VOD e outras operações longas
 */

import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { logger } from '../utils/logger.js';

interface ProcessState {
  status: 'idle' | 'processing' | 'paused' | 'completed' | 'error' | 'cancelled';
  progress: number; // 0-100
  processedItems: number;
  totalItems: number;
  addedItems: number;
  skippedItems: number;
  currentItem?: string;
  message?: string; // Mensagem atual do processo
  timeRemaining?: string;
  startTime?: number;
  completedAt?: number; // Timestamp quando foi completado
  error?: string;
  log?: string[];
  // ⚠️ PAUSE/RESUME/CANCEL: Flags de controle
  isRunning: boolean;
  isPaused: boolean;
  isCompleted: boolean;
}

class SocketService {
  private io: SocketIOServer | null = null;
  private userProcesses = new Map<string, ProcessState>();

  /**
   * Inicializa Socket.io
   */
  initialize(server: HTTPServer): SocketIOServer {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: process.env.FRONTEND_URL || '*',
        methods: ['GET', 'POST'],
        credentials: true,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
      transports: ['websocket', 'polling'],
    });

    this.io.on('connection', (socket: Socket) => {
      logger.info(`[SocketService] Cliente conectado: ${socket.id}`);

      // Enviar estado atual do processo, se existir (apenas se ainda estiver rodando)
      const userId = this.getUserIdFromSocket(socket);
      if (userId) {
        const currentProcess = this.userProcesses.get(userId);
        // ⚠️ CORREÇÃO CRÍTICA: Não enviar estado se processo já foi completado há mais de 10 segundos
        if (currentProcess && currentProcess.isRunning && !currentProcess.isCompleted) {
          socket.emit('processUpdate', currentProcess);
        } else if (currentProcess && currentProcess.isCompleted) {
          // Se processo foi completado, limpar após 10 segundos para evitar reenvio
          const completedTime = currentProcess.completedAt || Date.now();
          const timeSinceCompletion = Date.now() - completedTime;
          if (timeSinceCompletion < 10000) {
            // Ainda dentro de 10 segundos, enviar estado final uma vez (sem mensagens antigas)
            const finalState = {
              ...currentProcess,
              message: currentProcess.currentItem || 'Importação concluída',
              currentItem: currentProcess.currentItem || 'Importação concluída',
            };
            socket.emit('processUpdate', finalState);
          } else {
            // Mais de 10 segundos, remover do cache para não reenviar
            this.userProcesses.delete(userId);
            logger.debug(`[SocketService] Removendo processo completado há mais de 10s do cache (userId: ${userId})`);
          }
        }
      }

      socket.on('disconnect', (reason) => {
        logger.info(`[SocketService] Cliente desconectado: ${socket.id}, motivo: ${reason}`);
      });

      socket.on('error', (error) => {
        logger.error(`[SocketService] Erro no socket ${socket.id}:`, error);
      });
    });

    logger.info('[SocketService] Socket.io inicializado');
    return this.io;
  }

  /**
   * Obtém ID do usuário do socket (pode ser melhorado com autenticação JWT)
   */
  private getUserIdFromSocket(socket: Socket): string | null {
    // Tentar obter userId do auth ou query params, senão usa socket.id
    const userId = (socket.handshake.auth as any)?.userId || 
                   socket.handshake.query.userId as string || 
                   socket.id;
    logger.debug(`[SocketService] getUserIdFromSocket: ${userId}`);
    return userId;
  }

  /**
   * Atualiza estado do processo de um usuário e emite evento
   */
  updateUserProcess(userId: string, processData: Partial<ProcessState>): void {
    const currentState = this.userProcesses.get(userId) || {
      status: 'idle',
      progress: 0,
      processedItems: 0,
      totalItems: 0,
      addedItems: 0,
      skippedItems: 0,
      isRunning: false,
      isPaused: false,
      isCompleted: false,
    };

    // ⚠️ CORREÇÃO: Não atualizar se o processo já foi completado (evita logs repetidos)
    if (currentState.isCompleted && processData.status !== 'processing' && processData.status !== 'idle') {
      logger.debug(`[SocketService] ⚠️ Tentativa de atualizar processo já completado (userId: ${userId}, status: ${currentState.status}). Ignorando atualização.`);
      return;
    }

    logger.info(`[SocketService] ⚡ updateUserProcess chamado para userId: ${userId}`, {
      status: processData.status,
      progress: processData.progress,
      processedItems: processData.processedItems,
      totalItems: processData.totalItems,
      currentStatus: currentState.status,
      isCompleted: currentState.isCompleted,
    });

    const newState: ProcessState = {
      ...currentState,
      ...processData,
      // ⚠️ PAUSE/RESUME/CANCEL: Sincronizar flags com status
      isRunning: processData.status === 'processing' || (currentState.isRunning && processData.status !== 'completed' && processData.status !== 'error' && processData.status !== 'cancelled'),
      isPaused: processData.status === 'paused' || (currentState.isPaused && processData.status !== 'processing' && processData.status !== 'completed' && processData.status !== 'error' && processData.status !== 'cancelled'),
      isCompleted: processData.status === 'completed' || processData.status === 'error' || processData.status === 'cancelled',
      // ⚠️ CORREÇÃO: Marcar timestamp quando completado e limpar mensagens antigas
      completedAt: (processData.status === 'completed' || processData.status === 'error' || processData.status === 'cancelled') 
        ? (currentState.completedAt || Date.now())
        : undefined,
      // ⚠️ CORREÇÃO: Limpar mensagem antiga quando processo é completado
      message: (processData.status === 'completed' || processData.status === 'error' || processData.status === 'cancelled')
        ? (processData.message || processData.currentItem || currentState.message)
        : (processData.message || processData.currentItem || currentState.message),
    };

    // ⚠️ ESTIMATIVA: Calcular tempo restante se tiver dados suficientes
    if (newState.startTime && newState.totalItems > 0 && newState.processedItems > 0 && !newState.isCompleted) {
      newState.timeRemaining = this.calculateTimeRemaining(newState);
    } else if (newState.isCompleted) {
      newState.timeRemaining = undefined; // Limpar quando completar
    }

    this.userProcesses.set(userId, newState);

    if (this.io) {
      const connectedClients = this.io.sockets.sockets.size;
      logger.info(`[SocketService] 📡 Emitindo processUpdate para ${connectedClients} clientes conectados`, {
        userId,
        status: newState.status,
        progress: newState.progress,
        processedItems: newState.processedItems,
        totalItems: newState.totalItems,
        timeRemaining: newState.timeRemaining,
      });
      
      // Emitir para todos os sockets do usuário (por enquanto, broadcast geral)
      this.io.emit('processUpdate', newState);
      
      logger.debug(`[SocketService] Estado atualizado para ${userId}:`, {
        status: newState.status,
        progress: newState.progress,
        processedItems: newState.processedItems,
        totalItems: newState.totalItems,
        timeRemaining: newState.timeRemaining,
        isRunning: newState.isRunning,
        isPaused: newState.isPaused,
      });
    } else {
      logger.error('[SocketService] ❌ Socket.io NÃO INICIALIZADO!');
    }
  }

  /**
   * ⚠️ ESTIMATIVA: Calcula tempo restante estimado
   */
  private calculateTimeRemaining(state: ProcessState): string {
    if (!state.startTime || state.totalItems === 0 || state.processedItems === 0) {
      return '';
    }

    const elapsedTime = (Date.now() - state.startTime) / 1000; // segundos
    const itemsPerSecond = state.processedItems / elapsedTime;
    const remainingItems = state.totalItems - state.processedItems;
    const estimatedSeconds = Math.round(remainingItems / itemsPerSecond);

    return this.formatTime(estimatedSeconds);
  }

  /**
   * ⚠️ ESTIMATIVA: Formata tempo em formato legível
   */
  private formatTime(seconds: number): string {
    if (seconds < 60) {
      return `${seconds}s`;
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      if (minutes > 0) {
        return `${hours}h ${minutes}m`;
      }
      return `${hours}h`;
    }

    if (secs > 0) {
      return `${minutes}m ${secs}s`;
    }

    return `${minutes}m`;
  }

  /**
   * ⚠️ PAUSE/RESUME/CANCEL: Pausa o processo de um usuário
   */
  pauseUserProcess(userId: string): boolean {
    const state = this.userProcesses.get(userId);
    if (!state || !state.isRunning || state.isCompleted) {
      return false;
    }

    this.updateUserProcess(userId, {
      status: 'paused',
      isPaused: true,
    });

    logger.info(`[SocketService] Processo pausado para ${userId}`);
    return true;
  }

  /**
   * ⚠️ EMERGÊNCIA: Pausa TODOS os processos em andamento
   */
  pauseAllProcesses(): boolean {
    let pausedAny = false;
    
    for (const [userId, state] of this.userProcesses.entries()) {
      if (state.isRunning && !state.isCompleted && state.status === 'processing') {
        this.updateUserProcess(userId, {
          status: 'paused',
          isPaused: true,
        });
        logger.warn(`[SocketService] 🚨 PROCESSO PAUSADO FORÇADAMENTE: ${userId}`);
        pausedAny = true;
      }
    }
    
    return pausedAny;
  }

  /**
   * ⚠️ PAUSE/RESUME/CANCEL: Retoma o processo de um usuário
   */
  resumeUserProcess(userId: string): boolean {
    const state = this.userProcesses.get(userId);
    if (!state || !state.isPaused || state.isCompleted) {
      return false;
    }

    this.updateUserProcess(userId, {
      status: 'processing',
      isPaused: false,
    });

    logger.info(`[SocketService] Processo retomado para ${userId}`);
    return true;
  }

  /**
   * ⚠️ PAUSE/RESUME/CANCEL: Cancela o processo de um usuário
   */
  cancelUserProcess(userId: string): boolean {
    const state = this.userProcesses.get(userId);
    if (!state || state.isCompleted) {
      return false;
    }

    this.updateUserProcess(userId, {
      status: 'cancelled',
      isRunning: false,
      isPaused: false,
      isCompleted: true,
    });

    logger.info(`[SocketService] Processo cancelado para ${userId}`);
    return true;
  }

  /**
   * ⚠️ EMERGÊNCIA: Cancela TODOS os processos em andamento
   */
  cancelAllProcesses(): boolean {
    let cancelledAny = false;
    
    for (const [userId, state] of this.userProcesses.entries()) {
      if (!state.isCompleted && (state.status === 'processing' || state.status === 'paused')) {
        this.updateUserProcess(userId, {
          status: 'cancelled',
          isRunning: false,
          isPaused: false,
          isCompleted: true,
        });
        logger.warn(`[SocketService] 🚨 PROCESSO CANCELADO FORÇADAMENTE: ${userId}`);
        cancelledAny = true;
      }
    }
    
    return cancelledAny;
  }

  /**
   * Remove processo de um usuário
   */
  removeUserProcess(userId: string): void {
    this.userProcesses.delete(userId);
    if (this.io) {
      this.io.emit('processRemoved', { userId });
    }
  }

  /**
   * Obtém estado atual do processo
   */
  getUserProcess(userId: string): ProcessState | undefined {
    return this.userProcesses.get(userId);
  }

  /**
   * Obtém instância do Socket.io
   */
  getIO(): SocketIOServer | null {
    return this.io;
  }
}

export const socketService = new SocketService();
export type { ProcessState };

