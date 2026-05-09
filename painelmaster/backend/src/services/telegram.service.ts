import axios from 'axios';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('TelegramService');

interface SendResult {
  success: boolean;
  messageId?: number;
  error?: string;
}

/**
 * Serviço para envio de mensagens via Telegram Bot API
 */
export class TelegramService {
  private botToken: string;
  private baseUrl: string;

  constructor(botToken: string) {
    this.botToken = botToken;
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  /**
   * Envia mensagem de texto
   */
  async sendMessage(chatId: string, message: string, parseMode: 'Markdown' | 'HTML' = 'Markdown'): Promise<SendResult> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/sendMessage`,
        {
          chat_id: chatId,
          text: message,
          parse_mode: parseMode,
          disable_web_page_preview: true,
        },
        {
          timeout: 15000,
        }
      );

      if (response.data?.ok) {
        logger.info(`Mensagem Telegram enviada para ${chatId}`);
        return {
          success: true,
          messageId: response.data.result?.message_id,
        };
      }

      logger.warn(`Falha ao enviar Telegram para ${chatId}: ${response.data?.description}`);
      return {
        success: false,
        error: response.data?.description || 'Erro desconhecido',
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.description || error.message || 'Erro desconhecido';
      logger.error(`Erro ao enviar Telegram: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Envia foto
   */
  async sendPhoto(chatId: string, photoUrl: string, caption?: string): Promise<SendResult> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/sendPhoto`,
        {
          chat_id: chatId,
          photo: photoUrl,
          caption: caption || '',
          parse_mode: 'Markdown',
        },
        {
          timeout: 60000, // Aumentado para 60 segundos para envio de imagens grandes
        }
      );

      return {
        success: !!response.data?.ok,
        messageId: response.data?.result?.message_id,
        error: response.data?.description,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.description || error.message,
      };
    }
  }

  /**
   * Verifica se o bot está funcionando
   */
  async getMe(): Promise<{ ok: boolean; username?: string }> {
    try {
      const response = await axios.get(`${this.baseUrl}/getMe`, {
        timeout: 10000,
      });

      return {
        ok: !!response.data?.ok,
        username: response.data?.result?.username,
      };
    } catch {
      return { ok: false };
    }
  }

  /**
   * Obtém informações do chat
   */
  async getChat(chatId: string): Promise<{ ok: boolean; title?: string }> {
    try {
      const response = await axios.get(`${this.baseUrl}/getChat`, {
        params: { chat_id: chatId },
        timeout: 10000,
      });

      return {
        ok: !!response.data?.ok,
        title: response.data?.result?.title || response.data?.result?.username,
      };
    } catch {
      return { ok: false };
    }
  }

  /**
   * Substitui variáveis no template
   */
  static formatMessage(template: string, data: Record<string, string | number>): string {
    let message = template;
    for (const [key, value] of Object.entries(data)) {
      message = message.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
    }
    return message;
  }
}

export default TelegramService;
