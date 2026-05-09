/**
 * ==========================================================
 * LINE CREATOR SERVICE - Serviço Robusto para Criação de Linhas
 * ==========================================================
 * 
 * Este serviço implementa a lógica correta para criar linhas (usuários)
 * no XUI.ONE, seguindo estritamente as especificações da API.
 * 
 * REGRAS CRÍTICAS:
 * 1. exp_date: SEMPRE calculado, NUNCA null
 * 2. is_trial: 1 para teste, 0 para oficial - DEFINIDO EXPLICITAMENTE
 * 3. bouquet_ids: Array de inteiros formatado corretamente
 */

import axios, { AxiosInstance } from 'axios';
import { createLogger } from '../utils/logger.js';
import { prisma } from '../config/database.js';
import { decryptApiKey } from '../controllers/xuiSettings.controller.js';
import { XUIDBClient } from './xui.db.client.js';
import type { XuiServer, Package } from '@prisma/client';

const logger = createLogger('LineCreator');

// ===========================================
// TIPOS E INTERFACES
// ===========================================

export interface CreateLineInput {
  // Dados obrigatórios
  serverId: string;
  packageId: string;
  resellerUserId: string;
  
  // Configurações
  connections?: number;
  
  // Para testes com duração customizada
  trialHours?: number;
  
  // Data manual (opcional)
  customExpiresAt?: Date;
  
  // Dados do cliente (opcional)
  name?: string;
  email?: string;
  whatsapp?: string;
  
  // Bouquets customizados (opcional - sobrescreve do pacote)
  customBouquets?: number[];
}

export interface CreateLineResult {
  success: boolean;
  error?: string;
  
  // Dados da linha criada
  xuiLineId?: number;
  username?: string;
  password?: string;
  expiresAt?: Date;
  
  // Metadados
  isTrial?: boolean;
  packageName?: string;
  serverName?: string;
  bouquetsApplied?: number[];
  
  // URLs gerados
  urls?: {
    m3u_ts: string;
    m3u_hls: string;
    ssiptv?: string;
  };
  
  // Debug
  debugPayload?: Record<string, any>;
}

// ===========================================
// CONSTANTES DE CÁLCULO
// ===========================================

const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;
const SECONDS_PER_MONTH = 30 * 86400; // 30 dias

// ===========================================
// FUNÇÕES AUXILIARES
// ===========================================

/**
 * Calcula o timestamp de expiração em SEGUNDOS
 * NUNCA retorna null ou undefined!
 */
function calculateExpirationTimestamp(
  duration: number,
  unit: string,
  isTrialWithHours?: number
): number {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  
  // Se for teste com horas específicas
  if (isTrialWithHours && isTrialWithHours > 0) {
    const expiration = nowInSeconds + (isTrialWithHours * SECONDS_PER_HOUR);
    logger.info(`[ExpCalc] Trial ${isTrialWithHours}h: ${expiration} (${new Date(expiration * 1000).toISOString()})`);
    return expiration;
  }
  
  let durationInSeconds: number;
  
  switch (unit.toUpperCase()) {
    case 'HOURS':
    case 'HOUR':
      durationInSeconds = duration * SECONDS_PER_HOUR;
      break;
    case 'DAYS':
    case 'DAY':
      durationInSeconds = duration * SECONDS_PER_DAY;
      break;
    case 'MONTHS':
    case 'MONTH':
      durationInSeconds = duration * SECONDS_PER_MONTH;
      break;
    default:
      // Fallback: assume dias
      logger.warn(`[ExpCalc] Unidade desconhecida '${unit}', assumindo DAYS`);
      durationInSeconds = duration * SECONDS_PER_DAY;
  }
  
  const expiration = nowInSeconds + durationInSeconds;
  logger.info(`[ExpCalc] ${duration} ${unit}: ${expiration} (${new Date(expiration * 1000).toISOString()})`);
  
  return expiration;
}

/**
 * Formata bouquets para a API XUI
 * A API espera: bouquet[0]=1&bouquet[1]=2&bouquet[2]=3
 * OU bouquets_selected[0]=1&bouquets_selected[1]=2
 */
function formatBouquetsForXUI(bouquetIds: number[]): Record<string, number> {
  const formatted: Record<string, number> = {};
  
  if (!bouquetIds || bouquetIds.length === 0) {
    logger.warn('[Bouquets] Nenhum bouquet fornecido!');
    return formatted;
  }
  
  // Garantir que são números válidos
  const validIds = bouquetIds
    .map(id => parseInt(String(id), 10))
    .filter(id => !isNaN(id) && id > 0);
  
  if (validIds.length === 0) {
    logger.warn('[Bouquets] Nenhum bouquet válido após filtragem!');
    return formatted;
  }
  
  // Formato: bouquet[0], bouquet[1], etc.
  validIds.forEach((id, index) => {
    formatted[`bouquet[${index}]`] = id;
  });
  
  logger.info(`[Bouquets] Formatados ${validIds.length} bouquets:`, validIds);
  
  return formatted;
}

/**
 * Extrai bouquets do pacote (pode ser JSON string ou array)
 */
function extractBouquetsFromPackage(pkg: Package): number[] {
  if (!pkg.bouquets) {
    return [];
  }
  
  try {
    const parsed = typeof pkg.bouquets === 'string' 
      ? JSON.parse(pkg.bouquets) 
      : pkg.bouquets;
    
    if (Array.isArray(parsed)) {
      return parsed.map(b => parseInt(String(b), 10)).filter(b => !isNaN(b));
    }
    
    return [];
  } catch (error) {
    logger.error('[Bouquets] Erro ao parsear bouquets do pacote:', error);
    return [];
  }
}

/**
 * Cria cliente HTTP para o XUI
 * Suporta XUI ONE (accessCode + api_key) e Xtream UI (api.php + username/password)
 */
function createXUIHttpClient(server: XuiServer): AxiosInstance {
  const serverType = ((server as any).serverType || 'XUIONE') as string;
  const baseUrl = server.baseUrl.replace(/\/$/, '');

  if (serverType === 'XTREAMUI') {
    const apiUsername = (server as any).apiUsername || '';
    let apiPassword = (server as any).apiPassword || '';
    try { apiPassword = decryptApiKey(apiPassword); } catch { /* use as-is */ }
    const fullBaseUrl = `${baseUrl}/api.php`;
    logger.info(`[LineCreator] Xtream UI HTTP Client baseURL: ${fullBaseUrl}`);
    return axios.create({
      baseURL: fullBaseUrl,
      timeout: 30000,
      params: { username: apiUsername, password: apiPassword },
    });
  } else {
    const apiKey = decryptApiKey(server.apiKey);
    const fullBaseUrl = `${baseUrl}/${server.accessCode}`;
    logger.info(`[LineCreator] XUI ONE HTTP Client baseURL: ${fullBaseUrl}`);
    return axios.create({
      baseURL: fullBaseUrl,
      timeout: 30000,
      params: { api_key: apiKey },
    });
  }
}

// ===========================================
// SERVIÇO PRINCIPAL
// ===========================================

export class LineCreatorService {
  
  /**
   * MÉTODO PRINCIPAL: Criar linha no XUI.ONE
   * 
   * Este método segue a lógica estrita:
   * 1. Busca servidor e pacote do banco
   * 2. Calcula exp_date (NUNCA null)
   * 3. Define is_trial explicitamente (0 ou 1)
   * 4. Formata bouquets corretamente
   * 5. Envia requisição para XUI
   * 6. Salva no banco local
   */
  static async createLine(input: CreateLineInput): Promise<CreateLineResult> {
    const startTime = Date.now();
    
    logger.info('========================================');
    logger.info('[CreateLine] INICIANDO CRIAÇÃO DE LINHA');
    logger.info('========================================');
    logger.info('[CreateLine] Input:', {
      serverId: input.serverId,
      packageId: input.packageId,
      resellerUserId: input.resellerUserId,
      connections: input.connections,
      trialHours: input.trialHours,
    });
    
    try {
      // ===========================================
      // PASSO 1: Buscar servidor
      // ===========================================
      const server = await prisma.xuiServer.findUnique({
        where: { id: input.serverId },
      });
      
      if (!server) {
        return { success: false, error: 'Servidor não encontrado' };
      }
      
      logger.info('[CreateLine] Servidor:', server.name);
      
      // ===========================================
      // PASSO 2: Buscar pacote
      // ===========================================
      const pkg = await prisma.package.findUnique({
        where: { id: input.packageId },
      });
      
      if (!pkg) {
        return { success: false, error: 'Pacote não encontrado' };
      }
      
      logger.info('[CreateLine] Pacote:', {
        name: pkg.name,
        isTrial: pkg.isTrial,
        duration: pkg.duration,
        durationUnit: pkg.durationUnit,
        externalId: pkg.externalId,
        bouquets: pkg.bouquets,
      });
      
      // ===========================================
      // PASSO 3: Determinar tipo (Trial vs Oficial)
      // ===========================================
      // REGRA: is_trial é 1 APENAS se:
      // - O pacote é marcado como trial OU
      // - trialHours foi especificado
      const isTrialRequest = pkg.isTrial === true || (input.trialHours !== undefined && input.trialHours > 0);
      const xuiIsTrial: 0 | 1 = isTrialRequest ? 1 : 0;
      
      logger.info('[CreateLine] Tipo de usuário:', {
        isTrialRequest,
        xuiIsTrial,
        reason: pkg.isTrial ? 'Pacote é trial' : input.trialHours ? 'trialHours especificado' : 'Conta oficial',
      });
      
      // ===========================================
      // PASSO 4: Calcular exp_date (NUNCA NULL!)
      // ===========================================
      let expTimestamp: number;
      
      if (input.customExpiresAt) {
        // Data manual fornecida
        expTimestamp = Math.floor(input.customExpiresAt.getTime() / 1000);
        logger.info('[CreateLine] Usando data manual:', input.customExpiresAt.toISOString());
      } else if (input.trialHours && input.trialHours > 0) {
        // Teste com horas específicas
        expTimestamp = calculateExpirationTimestamp(0, 'HOURS', input.trialHours);
      } else {
        // Calcular baseado no pacote
        expTimestamp = calculateExpirationTimestamp(pkg.duration, pkg.durationUnit);
      }
      
      // Validação crítica: exp_date NUNCA pode ser null ou inválido
      if (!expTimestamp || isNaN(expTimestamp) || expTimestamp <= 0) {
        logger.error('[CreateLine] ERRO CRÍTICO: exp_date inválido!', expTimestamp);
        return { success: false, error: 'Erro ao calcular data de expiração' };
      }
      
      const expiresAt = new Date(expTimestamp * 1000);
      logger.info('[CreateLine] exp_date calculado:', {
        timestamp: expTimestamp,
        date: expiresAt.toISOString(),
      });
      
      // ===========================================
      // PASSO 5: Preparar bouquets
      // ===========================================
      const bouquetIds = input.customBouquets && input.customBouquets.length > 0
        ? input.customBouquets
        : extractBouquetsFromPackage(pkg);
      
      const bouquetParams = formatBouquetsForXUI(bouquetIds);
      
      // ===========================================
      // PASSO 6: Determinar package_id do XUI
      // ===========================================
      // Alguns servidores XUI requerem package_id em vez de exp_date
      let xuiPackageId: number | undefined;
      
      if (pkg.externalId && /^\d+$/.test(pkg.externalId)) {
        xuiPackageId = parseInt(pkg.externalId, 10);
      } else {
        // Fallback: buscar primeiro pacote com ID numérico
        const fallbackPkg = await prisma.package.findFirst({
          where: { serverId: server.id },
          orderBy: { sortOrder: 'asc' },
        });
        
        if (fallbackPkg && /^\d+$/.test(fallbackPkg.externalId)) {
          xuiPackageId = parseInt(fallbackPkg.externalId, 10);
          logger.info('[CreateLine] Usando fallback package_id:', xuiPackageId);
        }
      }
      
      // ===========================================
      // PASSO 7: Montar payload da API XUI
      // ===========================================
      const httpClient = createXUIHttpClient(server);
      
      const xuiPayload: Record<string, any> = {
        action: 'create_line',
        max_connections: input.connections || 1,
        is_trial: xuiIsTrial,  // EXPLÍCITO: 0 ou 1
        ...bouquetParams,      // bouquet[0]=1, bouquet[1]=2, etc.
      };

      const serverTypeForPayload = ((server as any).serverType || 'XUIONE') as string;
      if (serverTypeForPayload === 'XTREAMUI') {
        const formats = ['m3u8', 'ts', 'rtmp'];
        xuiPayload.allowed_output_formats = formats;
        xuiPayload.output_formats = formats;
        xuiPayload.allowed_outputs = formats;
        xuiPayload.allowed_output_formats_json = JSON.stringify(formats);
        xuiPayload.output_formats_json = JSON.stringify(formats);
        xuiPayload.allowed_outputs_json = JSON.stringify(formats);
      }
      
      // Estratégia: Tentar com exp_date primeiro, fallback para package_id
      // Alguns XUI não aceitam exp_date manual
      if (xuiPackageId) {
        xuiPayload.package_id = xuiPackageId;
      }
      
      // SEMPRE incluir exp_date (mesmo que alguns XUI ignorem)
      xuiPayload.exp_date = expTimestamp;
      
      // Log do payload para debug
      logger.info('[CreateLine] ========== PAYLOAD XUI ==========');
      logger.info('[CreateLine] URL:', `${server.baseUrl}/${server.accessCode}/`);
      logger.info('[CreateLine] Params:', {
        ...xuiPayload,
        api_key: '***HIDDEN***',
      });
      logger.info('[CreateLine] ===================================');
      
      // ===========================================
      // PASSO 8: Enviar requisição para XUI
      // ===========================================
      let xuiResponse: any;
      
      try {
        // accessCode já está no baseURL do httpClient
        const response = await httpClient.get('/', {
          params: xuiPayload,
        });
        xuiResponse = response.data;
        
        logger.info('[CreateLine] Resposta XUI:', xuiResponse);
        
      } catch (error: any) {
        logger.error('[CreateLine] Erro na requisição XUI:', error.message);
        return {
          success: false,
          error: `Erro ao conectar com XUI: ${error.message}`,
          debugPayload: xuiPayload,
        };
      }
      
      // ===========================================
      // PASSO 9: Validar resposta do XUI
      // ===========================================
      if (xuiResponse?.status === 'STATUS_INVALID_DATE') {
        // XUI não aceita exp_date, tentar novamente sem exp_date
        logger.warn('[CreateLine] XUI rejeitou exp_date, tentando sem...');
        
        delete xuiPayload.exp_date;
        
        try {
          const retryResponse = await httpClient.get('/', {
            params: xuiPayload,
          });
          xuiResponse = retryResponse.data;
          logger.info('[CreateLine] Retry response:', xuiResponse);
        } catch (error: any) {
          return {
            success: false,
            error: `Erro no retry: ${error.message}`,
            debugPayload: xuiPayload,
          };
        }
      }
      
      // Verificar sucesso - suporta XUI ONE e Xtream UI
      const serverType = ((server as any).serverType || 'XUIONE') as string;
      let lineData: any;

      if (serverType === 'XTREAMUI') {
        // Xtream UI: retorna { result: 1, ... } ou dados diretos
        if (xuiResponse?.result === 0 || xuiResponse?.result === false) {
          logger.error('[CreateLine] Xtream UI retornou erro:', xuiResponse);
          return {
            success: false,
            error: xuiResponse?.message || 'Xtream UI retornou erro',
            debugPayload: xuiPayload,
          };
        }
        lineData = xuiResponse;
      } else {
        // XUI ONE: retorna { status: 'STATUS_SUCCESS', data: {...} }
        if (xuiResponse?.status !== 'STATUS_SUCCESS' || !xuiResponse?.data) {
          logger.error('[CreateLine] XUI retornou erro:', xuiResponse);
          return {
            success: false,
            error: xuiResponse?.message || xuiResponse?.status || 'XUI retornou erro desconhecido',
            debugPayload: xuiPayload,
          };
        }
        lineData = xuiResponse.data;
      }

      const xuiLineId = parseInt(lineData?.id || lineData?.line_id || lineData?.user_id || 0, 10);
      const username = lineData?.username;
      const password = lineData?.password;
      
      if (!xuiLineId || !username || !password) {
        return {
          success: false,
          error: 'XUI não retornou dados completos da linha',
          debugPayload: xuiPayload,
        };
      }
      
      logger.info('[CreateLine] Linha criada no XUI:', {
        id: xuiLineId,
        username,
        is_trial: lineData.is_trial,
        exp_date: lineData.exp_date,
        bouquet: lineData.bouquet,
      });

      if (serverType === 'XTREAMUI' && server.dbHost) {
        try {
          const dbClient = new XUIDBClient(server);
          await dbClient.updateLine(xuiLineId, { allowed_outputs: [1, 2, 3] });
          await dbClient.disconnect();
        } catch (e: any) {
          logger.warn(`[CreateLine] Falha ao aplicar outputs no DB do Xtream UI: ${e?.message || e}`);
        }
      }
      
      // ===========================================
      // PASSO 10: Salvar no banco local
      // ===========================================
      const customer = await prisma.customer.create({
        data: {
          serverId: server.id,
          externalId: String(xuiLineId),
          username,
          password,
          name: input.name || null,
          email: input.email || null,
          whatsapp: input.whatsapp || null,
          packageId: pkg.id,
          resellerUserId: input.resellerUserId,
          isTrial: isTrialRequest,
          connections: input.connections || 1,
          expiresAt,
          status: 'ACTIVE',
        },
      });
      
      logger.info('[CreateLine] Cliente salvo no banco:', customer.id);
      
      // ===========================================
      // PASSO 11: Gerar URLs
      // ===========================================
      const dns = server.dnsPrimary?.replace(/\/$/, '') || server.baseUrl.replace(/\/$/, '');
      
      const urls = {
        m3u_ts: `${dns}/get.php?username=${username}&password=${password}&type=m3u_plus&output=mpegts`,
        m3u_hls: `${dns}/get.php?username=${username}&password=${password}&type=m3u_plus&output=hls`,
        ssiptv: undefined as string | undefined,
      };
      
      try {
        const dnsHost = new URL(dns).hostname;
        urls.ssiptv = `http://e.${dnsHost}/p/${username}/${password}/ssiptv`;
      } catch {
        // Ignora erro de URL
      }
      
      // ===========================================
      // PASSO 12: Retornar resultado
      // ===========================================
      const elapsed = Date.now() - startTime;
      logger.info(`[CreateLine] CONCLUÍDO em ${elapsed}ms`);
      logger.info('========================================');
      
      return {
        success: true,
        xuiLineId,
        username,
        password,
        expiresAt,
        isTrial: isTrialRequest,
        packageName: pkg.name,
        serverName: server.name,
        bouquetsApplied: bouquetIds,
        urls,
        debugPayload: xuiPayload,
      };
      
    } catch (error: any) {
      logger.error('[CreateLine] ERRO FATAL:', error);
      return {
        success: false,
        error: error.message || 'Erro interno ao criar linha',
      };
    }
  }
}

export default LineCreatorService;
