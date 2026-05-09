import axios, { AxiosInstance } from 'axios';
import { prisma } from '../config/database.js';
import { createLogger } from '../utils/logger.js';
import { encrypt, decrypt } from '../utils/crypto.js';

const logger = createLogger('AsaasService');

interface AsaasCustomer {
  id: string;
  name: string;
  cpfCnpj?: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
}

interface AsaasPaymentRequest {
  customer: string;
  billingType: 'PIX' | 'BOLETO' | 'CREDIT_CARD';
  value: number;
  dueDate: string;
  description?: string;
  externalReference?: string;
}

interface AsaasPaymentResponse {
  id: string;
  customer: string;
  value: number;
  netValue: number;
  billingType: string;
  status: string;
  dueDate: string;
  invoiceUrl: string;
  invoiceNumber: string;
}

interface AsaasPixQrCode {
  encodedImage: string;
  payload: string;
  expirationDate?: string;
}

interface AsaasStaticPixQrCode {
  id: string;
  encodedImage: string;
  payload: string;
  allowsMultiplePayments: boolean;
}

export class AsaasService {
  private client: AxiosInstance;
  private apiKey: string;

  constructor(apiKey: string, sandbox: boolean = true) {
    this.apiKey = apiKey;
    const baseURL = sandbox 
      ? 'https://sandbox.asaas.com/api/v3'
      : 'https://www.asaas.com/api/v3';

    this.client = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
        'access_token': apiKey,
      },
    });

    this.client.interceptors.request.use((config) => {
      logger.info(`[Asaas] ${config.method?.toUpperCase()} ${config.url}`);
      return config;
    });

    this.client.interceptors.response.use(
      (response) => {
        logger.info(`[Asaas] Response: ${response.status}`);
        return response;
      },
      (error) => {
        logger.error(`[Asaas] Error: ${error.response?.status} - ${JSON.stringify(error.response?.data)}`);
        throw error;
      }
    );
  }

  // ==========================================
  // CLIENTES
  // ==========================================

  async getOrCreateCustomer(data: {
    name: string;
    cpfCnpj?: string;
    email?: string;
    phone?: string;
    externalReference?: string;
  }): Promise<AsaasCustomer> {
    if (data.externalReference) {
      try {
        const existing = await this.findCustomerByReference(data.externalReference);
        if (existing) {
          logger.info(`[Asaas] Cliente encontrado: ${existing.id}`);
          return existing;
        }
      } catch (e) {
        // Não encontrou, vai criar
        logger.info(`[Asaas] Cliente não encontrado por externalReference, criando novo`);
      }
    }

    const customerData: any = {
      name: data.name,
      externalReference: data.externalReference,
      notificationDisabled: false,
    };
    
    // Email e telefone são opcionais
    if (data.email) {
      customerData.email = data.email;
    }
    if (data.phone) {
      customerData.phone = data.phone;
      customerData.mobilePhone = data.phone;
    }
    
    // CPF/CNPJ é opcional no Asaas
    // NÃO incluir CPF/CNPJ se não for fornecido ou se for inválido
    // O Asaas permite criar clientes sem CPF/CNPJ
    if (data.cpfCnpj && data.cpfCnpj.trim() !== '' && data.cpfCnpj !== '00000000000') {
      customerData.cpfCnpj = data.cpfCnpj;
    }
    
    // Log para debug - mostra o que estamos enviando
    logger.info(`[Asaas] Criando cliente no Asaas:`, JSON.stringify(customerData, null, 2));
    
    const response = await this.client.post<AsaasCustomer>('/customers', customerData);

    logger.info(`[Asaas] Cliente criado: ${response.data.id}`);
    return response.data;
  }

  async findCustomerByReference(reference: string): Promise<AsaasCustomer | null> {
    const response = await this.client.get('/customers', {
      params: { externalReference: reference },
    });

    if (response.data.data && response.data.data.length > 0) {
      return response.data.data[0];
    }
    return null;
  }

  async updateCustomer(customerId: string, data: {
    name?: string;
    cpfCnpj?: string;
    email?: string;
    phone?: string;
  }): Promise<AsaasCustomer> {
    const response = await this.client.put<AsaasCustomer>(`/customers/${customerId}`, data);
    logger.info(`[Asaas] Cliente atualizado: ${customerId}`);
    return response.data;
  }

  // ==========================================
  // COBRANÇAS
  // ==========================================

  async createPixPayment(data: {
    customerId?: string;
    value: number;
    dueDate: string;
    description?: string;
    externalReference?: string;
  }): Promise<AsaasPaymentResponse> {
    try {
      const paymentData: any = {
        billingType: 'PIX',
        value: data.value,
        dueDate: data.dueDate,
        description: data.description || 'Renovação IPTV',
      };

      // Se tiver externalReference, incluir (permite rastrear o pagamento)
      if (data.externalReference) {
        paymentData.externalReference = data.externalReference;
      }

      // Se tiver customerId, incluir (mas não é obrigatório para PIX direto)
      if (data.customerId) {
        paymentData.customer = data.customerId;
      }

      const response = await this.client.post<AsaasPaymentResponse>('/payments', paymentData);

      logger.info(`[Asaas] Cobrança PIX criada (sem cliente): ${response.data.id}`);
      return response.data;
    } catch (error: any) {
      logger.error(`[Asaas] Erro ao criar cobrança PIX: ${error.response?.data || error.message}`);
      throw error;
    }
  }

  async createPaymentLink(data: {
    customerId?: string;
    value: number;
    dueDate: string;
    description?: string;
    externalReference?: string;
  }): Promise<AsaasPaymentResponse> {
    // Cria um payment link (não requer CPF/CNPJ)
    const dueDate = new Date(data.dueDate);
    const dueDateLimitDays = Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    
    const linkData = {
      name: data.description || 'Renovação IPTV',
      description: data.description || 'Renovação de assinatura IPTV',
      value: data.value,
      billingType: 'UNDEFINED' as const, // Permite múltiplas formas de pagamento
      chargeType: 'DETACHED' as const, // Cobrança avulsa
      dueDateLimitDays: Math.max(1, dueDateLimitDays),
    };

    const response = await this.client.post<any>('/paymentLinks', linkData);

    // Converte payment link para formato de payment response
    const paymentResponse: AsaasPaymentResponse = {
      id: response.data.id,
      customer: data.customerId || '',
      value: data.value,
      netValue: data.value,
      billingType: 'PIX',
      status: 'PENDING',
      dueDate: data.dueDate,
      invoiceUrl: response.data.url,
      invoiceNumber: response.data.id,
    };

    logger.info(`[Asaas] Payment link criado: ${response.data.url}`);
    return paymentResponse;
  }

  async getPixQrCode(paymentId: string): Promise<AsaasPixQrCode> {
    const response = await this.client.get<AsaasPixQrCode>(`/payments/${paymentId}/pixQrCode`);
    return response.data;
  }

  async createStaticPixQrCode(data: {
    addressKey: string; // Chave PIX cadastrada no Asaas
    description: string;
    value: number;
    externalReference?: string;
  }): Promise<AsaasStaticPixQrCode> {
    const qrCodeData: any = {
      addressKey: data.addressKey,
      description: data.description,
      value: data.value,
      format: 'ALL', // Retorna payload e imagem
    };

    if (data.externalReference) {
      qrCodeData.externalReference = data.externalReference;
    }

    const response = await this.client.post<AsaasStaticPixQrCode>('/pix/qrCodes/static', qrCodeData);
    
    logger.info(`[Asaas] QR Code PIX Estático criado: ${response.data.id}`);
    return response.data;
  }

  async getPayment(paymentId: string): Promise<AsaasPaymentResponse> {
    const response = await this.client.get<AsaasPaymentResponse>(`/payments/${paymentId}`);
    return response.data;
  }

  async listPaymentsByCustomer(customerId: string): Promise<AsaasPaymentResponse[]> {
    const response = await this.client.get('/payments', {
      params: { customer: customerId },
    });
    return response.data.data || [];
  }

  async cancelPayment(paymentId: string): Promise<void> {
    await this.client.delete(`/payments/${paymentId}`);
    logger.info(`[Asaas] Cobrança cancelada: ${paymentId}`);
  }

  // ==========================================
  // UTILITÁRIOS
  // ==========================================

  async testConnection(): Promise<boolean> {
    try {
      await this.client.get('/customers', { params: { limit: 1 } });
      return true;
    } catch (error) {
      return false;
    }
  }
}

export async function getAsaasService(userId: string): Promise<AsaasService | null> {
  const config = await prisma.asaasConfig.findUnique({
    where: { userId },
  });

  if (!config || !config.isActive) {
    return null;
  }

  const apiKey = decrypt(config.apiKey);
  const isSandbox = config.environment === 'sandbox';

  return new AsaasService(apiKey, isSandbox);
}

