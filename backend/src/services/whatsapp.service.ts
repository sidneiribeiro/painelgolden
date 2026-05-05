import axios from 'axios';
import FormData from 'form-data';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('WhatsAppService');

interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface SendOptions {
  to: string;
  message: string;
  appKey: string;
  authKey: string;
  typingDelay?: number;
}

interface SendImageOptions extends SendOptions {
  imageUrl: string;
  caption?: string;
}

/**
 * Serviço para envio de mensagens via WhatsApp (BotBot.chat API)
 * Documentação: https://botbot.chat
 * 
 * IMPORTANTE: A API usa multipart/form-data, não JSON!
 */
export class WhatsAppService {
  private readonly baseUrl = 'https://botbot.chat/api';
  private readonly endpoint = '/create-message';

  /**
   * Envia mensagem via BotBot.chat (compatível com bot.service.ts)
   * @param options Opções de envio (to, message, appKey, authKey)
   */
  async send(options: SendOptions): Promise<boolean> {
    const result = await this.sendMessage(
      options.to,
      options.message,
      options.appKey,
      options.authKey,
      options.typingDelay
    );
    return result.success;
  }

  /**
   * Envia mensagem de texto via BotBot.chat API
   * @param phone Número de telefone completo com código do país (ex: 5524999999999)
   * @param message Mensagem a ser enviada (máximo 1000 palavras)
   * @param appKey App Key do BotBot.chat
   * @param authKey Auth Key do BotBot.chat
   * @param typingDelay Delay de digitação em segundos (padrão: 3)
   */
  async sendMessage(
    phone: string,
    message: string,
    appKey: string,
    authKey: string,
    typingDelay: number = 3
  ): Promise<SendResult> {
    try {
      // Normaliza o número de telefone (remove tudo exceto dígitos)
      // Formato esperado: código país + DDD + número (ex: 5524999999999)
      const normalizedPhone = phone.replace(/\D/g, '');
      
      if (!normalizedPhone || normalizedPhone.length < 10) {
        logger.error(`Número de telefone inválido: ${phone} (normalizado: ${normalizedPhone})`);
        return {
          success: false,
          error: `Número de telefone inválido: ${phone}`,
        };
      }

      if (!message || message.trim().length === 0) {
        logger.error('Mensagem vazia');
        return {
          success: false,
          error: 'Mensagem não pode estar vazia',
        };
      }

      // BotBot.chat usa multipart/form-data, não JSON!
      const formData = new FormData();
      formData.append('appkey', appKey);
      formData.append('authkey', authKey);
      formData.append('to', normalizedPhone);
      formData.append('typingDelay', typingDelay.toString());
      formData.append('message', message);

      const url = `${this.baseUrl}${this.endpoint}`;
      
      logger.info(`Enviando mensagem via BotBot.chat para ${normalizedPhone}`, {
        url,
        appKey: appKey.substring(0, 8) + '...',
      });

      const response = await axios.post(url, formData, {
        headers: {
          ...formData.getHeaders(),
        },
        timeout: 30000,
      });

      // Verifica se foi bem-sucedido
      // Resposta esperada: { "message_status": "Success", "data": { ... } }
      if (response.data?.message_status === 'Success' || response.status === 200) {
        logger.info(`✅ Mensagem enviada com sucesso para ${normalizedPhone}`, {
          response: response.data,
        });
        return {
          success: true,
          messageId: response.data?.data?.status_code?.toString() || 'sent',
        };
      }

      // Se não for sucesso, verifica erro
      const errorMsg = response.data?.message_status || response.data?.error || 'Resposta inesperada da API';
      logger.warn(`Falha ao enviar mensagem para ${normalizedPhone}:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message_status || 
                          error.response?.data?.error || 
                          error.response?.data?.message ||
                          error.message || 
                          'Erro desconhecido';
      
      logger.error(`❌ Erro ao enviar WhatsApp para ${phone}:`, {
        error: errorMessage,
        status: error.response?.status,
        data: error.response?.data,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Envia mensagem com imagem via BotBot.chat API
   * @param phone Número de telefone completo
   * @param imageUrl URL da imagem (jpg, jpeg, png, webp)
   * @param caption Legenda da imagem (opcional)
   * @param appKey App Key do BotBot.chat
   * @param authKey Auth Key do BotBot.chat
   * @param typingDelay Delay de digitação (padrão: 3)
   */
  async sendImage(
    phone: string,
    imageUrl: string,
    caption: string,
    appKey: string,
    authKey: string,
    typingDelay: number = 3
  ): Promise<SendResult> {
    try {
      const normalizedPhone = phone.replace(/\D/g, '');
      
      if (!normalizedPhone || normalizedPhone.length < 10) {
        return {
          success: false,
          error: `Número de telefone inválido: ${phone}`,
        };
      }

      // BotBot.chat usa multipart/form-data
      const formData = new FormData();
      formData.append('appkey', appKey);
      formData.append('authkey', authKey);
      formData.append('to', normalizedPhone);
      formData.append('typingDelay', typingDelay.toString());
      formData.append('file', imageUrl); // URL do arquivo
      if (caption) {
        formData.append('message', caption);
      }

      const url = `${this.baseUrl}${this.endpoint}`;
      
      logger.info(`Enviando imagem via BotBot.chat para ${normalizedPhone}`);

      const response = await axios.post(url, formData, {
        headers: {
          ...formData.getHeaders(),
        },
        timeout: 30000,
      });

      if (response.data?.message_status === 'Success' || response.status === 200) {
        logger.info(`✅ Imagem enviada com sucesso para ${normalizedPhone}`);
        return {
          success: true,
          messageId: response.data?.data?.status_code?.toString() || 'sent',
        };
      }

      return {
        success: false,
        error: response.data?.message_status || response.data?.error || 'Falha ao enviar imagem',
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 
               error.response?.data?.message_status || 
               error.message,
      };
    }
  }

  /**
   * Envia mensagem usando template do BotBot.chat
   * @param phone Número de telefone completo
   * @param templateId ID do template no BotBot.chat
   * @param variables Variáveis para substituir no template ({variableKey1: 'value1', ...})
   * @param appKey App Key do BotBot.chat
   * @param authKey Auth Key do BotBot.chat
   * @param typingDelay Delay de digitação (padrão: 3)
   */
  async sendTemplate(
    phone: string,
    templateId: string,
    variables: Record<string, string>,
    appKey: string,
    authKey: string,
    typingDelay: number = 3
  ): Promise<SendResult> {
    try {
      const normalizedPhone = phone.replace(/\D/g, '');
      
      if (!normalizedPhone || normalizedPhone.length < 10) {
        return {
          success: false,
          error: `Número de telefone inválido: ${phone}`,
        };
      }

      // BotBot.chat usa multipart/form-data
      const formData = new FormData();
      formData.append('appkey', appKey);
      formData.append('authkey', authKey);
      formData.append('to', normalizedPhone);
      formData.append('typingDelay', typingDelay.toString());
      formData.append('template_id', templateId);
      
      // Adiciona variáveis como objeto JSON
      if (variables && Object.keys(variables).length > 0) {
        formData.append('variables', JSON.stringify(variables));
      }

      const url = `${this.baseUrl}${this.endpoint}`;
      
      logger.info(`Enviando template via BotBot.chat para ${normalizedPhone}`, { templateId });

      const response = await axios.post(url, formData, {
        headers: {
          ...formData.getHeaders(),
        },
        timeout: 30000,
      });

      if (response.data?.message_status === 'Success' || response.status === 200) {
        logger.info(`✅ Template enviado com sucesso para ${normalizedPhone}`);
        return {
          success: true,
          messageId: response.data?.data?.status_code?.toString() || 'sent',
        };
      }

      return {
        success: false,
        error: response.data?.message_status || response.data?.error || 'Falha ao enviar template',
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 
               error.response?.data?.message_status || 
               error.message,
      };
    }
  }

  /**
   * Verifica se o número está no WhatsApp (se a API do BotBot.chat tiver esse endpoint)
   */
  async checkNumber(phone: string, appKey: string, authKey: string): Promise<boolean> {
    // Nota: BotBot.chat pode não ter esse endpoint, então retorna true por padrão
    // Implementar se a API fornecer essa funcionalidade
    return true;
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

// Instância exportada para uso
export const whatsappService = {
  send: async (options: SendOptions): Promise<boolean> => {
    const service = new WhatsAppService();
    return service.send(options);
  },
  sendMessage: async (
    phone: string,
    message: string,
    appKey: string,
    authKey: string,
    typingDelay?: number
  ): Promise<SendResult> => {
    const service = new WhatsAppService();
    return service.sendMessage(phone, message, appKey, authKey, typingDelay);
  },
  sendImage: async (
    phone: string,
    imageUrl: string,
    caption: string,
    appKey: string,
    authKey: string,
    typingDelay?: number
  ): Promise<SendResult> => {
    const service = new WhatsAppService();
    return service.sendImage(phone, imageUrl, caption, appKey, authKey, typingDelay);
  },
  sendTemplate: async (
    phone: string,
    templateId: string,
    variables: Record<string, string>,
    appKey: string,
    authKey: string,
    typingDelay?: number
  ): Promise<SendResult> => {
    const service = new WhatsAppService();
    return service.sendTemplate(phone, templateId, variables, appKey, authKey, typingDelay);
  },
  checkNumber: async (phone: string, appKey: string, authKey: string): Promise<boolean> => {
    const service = new WhatsAppService();
    return service.checkNumber(phone, appKey, authKey);
  },
};

export default WhatsAppService;