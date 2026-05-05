import axios, { AxiosInstance, AxiosError } from 'axios';
import { xuiConfig, xuiActions } from '../config/xui.config.js';
import { createLogger } from '../utils/logger.js';
import { decryptApiKey } from '../controllers/xuiSettings.controller.js';
import type { XuiServer } from '@prisma/client';

const logger = createLogger('XuiClient');

// ===========================================
// TIPOS DA API XUI.ONE
// ===========================================

export interface XUILine {
  id: number;
  username: string;
  password: string;
  exp_date: number;           // Unix timestamp (segundos)
  max_connections: number;
  is_trial: 0 | 1;
  enabled: 0 | 1;
  is_banned?: 0 | 1;  // Não existe no Xtream UI, opcional
  admin_enabled: 0 | 1;
  admin_notes: string;
  reseller_notes: string;
  bouquet: number[];
  created_at: number;
  created_by: number;
}

export interface XUIPackage {
  id: number | string;
  package_name: string;
  is_trial: 0 | 1 | string;
  is_official: 0 | 1 | string;
  trial_credits: number | string;
  official_credits: number | string;
  trial_duration: number | string;
  trial_duration_in: 'hours' | 'days' | 'months' | string;
  official_duration: number | string;
  official_duration_in: 'hours' | 'days' | 'months' | string;
  groups?: number[] | string; // Pode ser array ou string JSON
  bouquets?: number[] | string; // Pode ser array ou string JSON (ex: "[1,2,3]")
  output_formats?: number[] | string;
}

export interface XUIBouquet {
  id: number;
  bouquet_name: string;
}

export interface XUIUser {
  id: number;
  user_id?: number;  // Pode vir como user_id ou id
  username: string;
  email: string;
  credits: number;
  member_group_id: number;
  enabled: 0 | 1;
  is_admin: 0 | 1;
  created_at: number;
  api_key?: string;  // API key do usuário (se disponível)
}

export interface XUILiveConnection {
  id: number;
  user_id: number;
  username: string;
  stream_id: number;
  stream_display_name: string;
  user_agent: string;
  user_ip: string;
  container: string;
  date_start: number;
  server_id: number;
  pid: number;
  bitrate: number;
  country: string;
}

export interface CreateLineParams {
  username?: string;
  password?: string;
  max_connections: number;
  exp_date?: number;         // Data de expiração (Unix timestamp) - opcional se usar package_id
  package_id?: number;       // ID do pacote no XUI (alternativa ao exp_date)
  is_trial?: 0 | 1;
  bouquets?: number[];
  allowed_outputs?: number[];
  admin_notes?: string;
  reseller_notes?: string;
}

export interface EditLineParams {
  exp_date?: number;
  max_connections?: number;
  username?: string;
  password?: string;
  bouquets?: number[];
  allowed_outputs?: number[];
  admin_notes?: string;
  reseller_notes?: string;
  package_id?: number;       // Para renovar usando pacote
  is_trial?: 0 | 1;          // Para converter trial em oficial
  enabled?: 0 | 1;           // Para ativar/desativar linha
}

// ===========================================
// CACHE SIMPLES EM MEMÓRIA
// ===========================================

const cache = new Map<string, { data: any; expiresAt: number }>();

function getFromCache<T>(key: string): T | null {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as T;
  }
  cache.delete(key);
  return null;
}

function setCache(key: string, data: any, ttlSeconds: number): void {
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

// ===========================================
// XUI CLIENT - API DIRETA
// ===========================================

// Interface para configuração manual (teste de conexão)
interface XUIClientConfig {
  baseUrl: string;
  serverType?: string;
  accessCode: string;
  apiKey: string;
  apiUsername?: string;
  apiPassword?: string;
  needsDecrypt?: boolean;
}

export class XUIClient {
  private client: AxiosInstance;
  private accessCode: string;
  private apiKey: string;
  private serverType: 'XUIONE' | 'XTREAMUI';

  // Aceita XuiServer do Prisma OU config manual
  constructor(serverOrConfig: XuiServer | XUIClientConfig) {
    this.accessCode = serverOrConfig.accessCode;
    this.serverType = ((serverOrConfig as any).serverType || 'XUIONE') as 'XUIONE' | 'XTREAMUI';
    
    const needsDecrypt = 'needsDecrypt' in serverOrConfig 
      ? serverOrConfig.needsDecrypt !== false 
      : true;
    
    this.apiKey = needsDecrypt 
      ? decryptApiKey(serverOrConfig.apiKey) 
      : serverOrConfig.apiKey;

    const baseUrl = serverOrConfig.baseUrl.replace(/\/$/, '');

    if (this.serverType === 'XTREAMUI') {
      // Xtream UI: {baseUrl}/api.php?username=X&password=Y&action=...
      const apiUser = (serverOrConfig as any).apiUsername || '';
      let apiPass = (serverOrConfig as any).apiPassword || '';
      // apiPassword é armazenado criptografado no banco (igual apiKey)
      if (needsDecrypt && apiPass) {
        try { apiPass = decryptApiKey(apiPass); } catch { /* usar como está */ }
      }
      const fullBaseUrl = `${baseUrl}/api.php`;
      logger.info(`[XUIClient] Xtream UI mode - baseURL: ${fullBaseUrl}`);

      this.client = axios.create({
        baseURL: fullBaseUrl,
        timeout: 30000,
        params: {
          username: apiUser,
          password: apiPass,
        },
      });
    } else {
      // XUI ONE: {baseUrl}/{accessCode}/?api_key=X&action=...
      const fullBaseUrl = `${baseUrl}/${this.accessCode}`;
      logger.info(`[XUIClient] XUI ONE mode - baseURL: ${fullBaseUrl}`);

      this.client = axios.create({
        baseURL: fullBaseUrl,
        timeout: 30000,
        params: {
          api_key: this.apiKey,
        },
      });
    }

    // Interceptor para logging
    this.client.interceptors.response.use(
      (response) => {
        const action = response.config.params?.action;
        logger.debug(`[XUI] ${action}: OK`);
        return response;
      },
      (error: AxiosError) => {
        logger.error('[XUI] Request failed: ' + error.message);
        throw error;
      }
    );
  }

  /**
   * Normaliza resposta: XUI ONE retorna { status, data }, Xtream UI retorna dados diretos
   */
  private normalizeResponse(data: any): { success: boolean; data: any; status?: string } {
    if (this.serverType === 'XTREAMUI') {
      // Xtream UI: retorna dados direto ou { result: 1, ... }
      if (data?.result === 1 || data?.result === true) {
        return { success: true, data };
      }
      if (data?.result === 0 || data?.result === false) {
        return { success: false, data, status: data?.message || 'ERROR' };
      }
      // Se retornou algo, assume sucesso
      if (data !== null && data !== undefined) {
        return { success: true, data };
      }
      return { success: false, data: null };
    } else {
      // XUI ONE: retorna { status: 'STATUS_SUCCESS', data: {...} }
      if (data?.status === 'STATUS_SUCCESS') {
        return { success: true, data: data.data || data, status: data.status };
      }
      return { success: data?.status !== undefined ? false : true, data, status: data?.status };
    }
  }

  /**
   * Método genérico para retry
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    attempts = xuiConfig.retryAttempts
  ): Promise<T> {
    for (let i = 0; i < attempts; i++) {
      try {
        return await operation();
      } catch (error) {
        if (i === attempts - 1) throw error;
        logger.warn(`Tentativa ${i + 1} falhou, tentando novamente...`);
        await new Promise((r) => setTimeout(r, xuiConfig.retryDelay * (i + 1)));
      }
    }
    throw new Error('Todas as tentativas falharam');
  }

  // ==========================================
  // LINHAS (CLIENTES IPTV)
  // ==========================================

  /**
   * Lista todas as linhas (clientes)
   */
  async getLines(): Promise<XUILine[]> {
    const response = await this.withRetry(() =>
      this.client.get('', { params: { action: xuiActions.GET_LINES } })
    );
    
    let lines: XUILine[] = [];
    const normalized = this.normalizeResponse(response.data);
    
    // Tentar múltiplos formatos de resposta
    if (Array.isArray(normalized.data)) {
      lines = normalized.data;
    } else if (Array.isArray(response.data)) {
      lines = response.data;
    } else if (response.data && Array.isArray(response.data.data)) {
      lines = response.data.data;
    } else if (response.data && Array.isArray(response.data.lines)) {
      lines = response.data.lines;
    }
    
    // Normalizar campos: Xtream UI não tem is_banned
    lines = lines.map(l => ({
      ...l,
      is_banned: l.is_banned ?? 0,
      admin_enabled: l.admin_enabled ?? 1,
      bouquet: typeof l.bouquet === 'string' ? (() => { try { return JSON.parse(l.bouquet as any); } catch { return []; } })() : (l.bouquet || []),
    }));
    
    logger.info(`[XUI] getLines retornou ${lines.length} linhas`);
    
    if (lines.length === 50) {
      logger.warn(`[XUI] getLines retornou exatamente 50 linhas, pode haver mais clientes (limite da API)`);
    }
    
    return lines;
  }

  /**
   * Obtém uma linha específica
   */
  async getLine(id: number): Promise<XUILine> {
    const { data } = await this.client.get('', {
      params: { action: xuiActions.GET_LINE, id },
    });
    logger.info('[XUIClient] getLine response:', { id, hasUsername: !!data?.username, dataKeys: Object.keys(data || {}) });
    
    const normalized = this.normalizeResponse(data);
    let line = normalized.data?.line || normalized.data || data?.line || data;
    
    // Normalizar campos: Xtream UI não tem is_banned, bouquet pode ser string JSON
    if (line) {
      line.is_banned = line.is_banned ?? 0;
      line.admin_enabled = line.admin_enabled ?? 1;
      if (typeof line.bouquet === 'string') {
        try { line.bouquet = JSON.parse(line.bouquet); } catch { line.bouquet = []; }
      }
    }
    
    return line;
  }

  /**
   * Criar linha no XUI.ONE
   * BASEADO NA ANÁLISE: XUI não aceita bouquets/is_trial no create_line
   * SOLUÇÃO: Criar linha e depois editá-la para aplicar bouquets e is_trial
   */
  async createLine(params: {
    max_connections: number;
    exp_date?: number;        // Timestamp em SEGUNDOS (opcional se usar package_id)
    package_id?: number;      // ID do pacote no XUI (preferido quando disponível)
    is_trial: 0 | 1;
    bouquets: number[];
    allowed_outputs: number[];
    username: string;
    password: string;
    member_id: number;       // ID do reseller (2 = super-neo)
    admin_notes?: string;
    reseller_notes?: string;
  }): Promise<{ result: boolean; line_id: number; username: string; password: string; exp_date?: number }> {
    
    // Criamos a linha básica primeiro
    const queryParams: Record<string, any> = {
      action: 'create_line',
      username: params.username,
      password: params.password,
      max_connections: String(params.max_connections),
      member_id: String(params.member_id),
    };
    
    // Preferir package_id (XUI ONE não aceita exp_date manual em alguns casos)
    if (params.package_id) {
      queryParams.package_id = String(params.package_id);
      logger.info('[XUI] createLine usando package_id:', params.package_id);
    } else if (params.exp_date) {
      queryParams.exp_date = String(params.exp_date);
      logger.info('[XUI] createLine usando exp_date:', params.exp_date);
    } else {
      throw new Error('É necessário fornecer package_id ou exp_date');
    }
    
    if (params.admin_notes) {
      queryParams.admin_notes = params.admin_notes;
    }
    if (params.reseller_notes) {
      queryParams.reseller_notes = params.reseller_notes;
    }

    // Xtream UI aceita bouquets e is_trial no create_line
    if (this.serverType === 'XTREAMUI') {
      if (params.bouquets?.length) {
        queryParams.bouquet = JSON.stringify(params.bouquets);
      }
      if (params.is_trial !== undefined) {
        queryParams.is_trial = String(params.is_trial);
      }
      if (params.allowed_outputs?.length) {
        const formats = ['m3u8', 'ts', 'rtmp'];
        queryParams.allowed_outputs = formats;
        queryParams.allowed_output_formats = formats;
        queryParams.output_formats = formats;
        queryParams.allowed_outputs_json = JSON.stringify(formats);
        queryParams.allowed_output_formats_json = JSON.stringify(formats);
        queryParams.output_formats_json = JSON.stringify(formats);
      }
    }

    logger.info('[XUI] createLine Params', queryParams);

    try {
      // Criar linha básica
      const { data } = await this.client.get('', { params: queryParams });

      logger.info('[XUI] createLine Response', { data });

      const normalized = this.normalizeResponse(data);
      if (!normalized.success) {
        throw new Error(data?.message || normalized.status || 'Erro desconhecido');
      }

      // Extrair dados da linha criada (formato varia entre XUI ONE e Xtream UI)
      const lineData = normalized.data;
      const lineId = parseInt(lineData?.id || lineData?.line_id || lineData?.user_id || 0);
      const createdUsername = lineData?.username || params.username;
      const createdPassword = lineData?.password || params.password;

      if (!lineId) {
        throw new Error('API não retornou ID da linha criada');
      }

      logger.info('[XUI] Linha criada com ID:', lineId);

      // Editar linha para aplicar bouquets e is_trial
      const bouquets = params.bouquets.length > 0 ? params.bouquets : [1, 2, 3];
      const editParams: EditLineParams = {
        is_trial: params.is_trial,
        bouquets: bouquets,
      };

      if (params.admin_notes) {
        editParams.admin_notes = params.admin_notes;
      }
      if (params.reseller_notes) {
        editParams.reseller_notes = params.reseller_notes;
      }

      logger.info('[XUI] Editando linha para aplicar bouquets e is_trial', editParams);

      const editResult = await this.editLine(lineId, editParams);
      
      if (!editResult.result) {
        logger.warn('[XUI] Falha ao editar linha após criação, mas linha foi criada', editResult);
      } else {
        logger.info('[XUI] Linha editada com sucesso - bouquets e is_trial aplicados');
      }

      return {
        result: true,
        line_id: lineId,
        username: createdUsername,
        password: createdPassword,
        exp_date: lineData?.exp_date ? parseInt(lineData.exp_date) : undefined,
      };
    } catch (error: any) {
      logger.error('[XUI] createLine ERRO: ' + error.message);
      if (error.response) {
        logger.error('[XUI] createLine Response Error', { data: error.response.data });
      }
      throw error;
    }
  }

  /**
   * Edita uma linha existente
   */
  async editLine(id: number, params: EditLineParams): Promise<{ result: boolean; status?: string; data?: any }> {
    const queryParams: Record<string, any> = {
      action: xuiActions.EDIT_LINE,
      id,
    };

    // Parâmetros básicos
    if (params.exp_date !== undefined) queryParams.exp_date = params.exp_date;
    if (params.max_connections !== undefined) queryParams.max_connections = params.max_connections;
    if (params.username) queryParams.username = params.username;
    if (params.password) queryParams.password = params.password;
    if (params.enabled !== undefined) queryParams.enabled = params.enabled;
    if (params.admin_notes) queryParams.admin_notes = params.admin_notes;
    if (params.reseller_notes) queryParams.reseller_notes = params.reseller_notes;
    
    // Parâmetros de renovação
    if (params.package_id !== undefined) queryParams.package_id = params.package_id;
    if (params.is_trial !== undefined) queryParams.is_trial = params.is_trial;

    // Bouquets como array
    if (params.bouquets?.length) {
      if (this.serverType === 'XTREAMUI') {
        // Xtream UI: enviar bouquet como JSON string
        queryParams.bouquet = JSON.stringify(params.bouquets);
      } else {
        // XUI ONE: enviar como bouquets_selected[0], bouquets_selected[1], etc.
        params.bouquets.forEach((b, i) => {
          queryParams[`bouquets_selected[${i}]`] = b;
        });
      }
    }

    if (params.allowed_outputs?.length && this.serverType === 'XTREAMUI') {
      const formats = ['m3u8', 'ts', 'rtmp'];
      queryParams.allowed_outputs = formats;
      queryParams.allowed_output_formats = formats;
      queryParams.output_formats = formats;
      queryParams.allowed_outputs_json = JSON.stringify(formats);
      queryParams.allowed_output_formats_json = JSON.stringify(formats);
      queryParams.output_formats_json = JSON.stringify(formats);
    }

    logger.info('[XUIClient] editLine - Params:', queryParams);
    
    const { data } = await this.client.get('/', { params: queryParams });
    
    logger.info('[XUIClient] editLine - Response:', data);
    
    const normalized = this.normalizeResponse(data);
    if (normalized.success) {
      return { result: true, status: normalized.status, data: normalized.data };
    }
    
    if (data?.status === 'STATUS_INVALID_DATE') {
      logger.warn('[XUIClient] editLine - XUI rejeitou exp_date');
      return { result: false, status: data.status };
    }
    
    return { result: false, status: normalized.status || data?.status };
  }

  /**
   * Renova uma linha usando package_id (método recomendado)
   * 
   * Como alguns XUI não aceitam exp_date manual (STATUS_INVALID_DATE),
   * usamos package_id para renovar. A expiração é calculada localmente.
   */
  async renewLine(
    id: number, 
    packageId: number,
    options?: { 
      additionalDays?: number;
      convertToOfficial?: boolean;
    }
  ): Promise<{ result: boolean; newExpDate: number; convertedToOfficial?: boolean }> {
    const { additionalDays, convertToOfficial } = options || {};
    
    // Calcular nova data de expiração localmente
    const now = Date.now();
    const daysToAdd = additionalDays || 30; // Padrão: 30 dias
    const newExpDate = Math.floor((now + (daysToAdd * 24 * 60 * 60 * 1000)) / 1000);
    
    // Montar parâmetros
    const editParams: EditLineParams = {
      package_id: packageId,
    };
    
    // Se converter para oficial (remover flag trial)
    if (convertToOfficial) {
      editParams.is_trial = 0;
    }

    const result = await this.editLine(id, editParams);
    
    if (result.result) {
      logger.info(`Linha ${id} renovada com package_id=${packageId}. Convertida para oficial: ${convertToOfficial}`);
    } else {
      logger.warn(`Falha ao renovar linha ${id}: ${result.status}`);
    }
    
    return { 
      result: result.result, 
      newExpDate,
      convertedToOfficial: convertToOfficial && result.result,
    };
  }

  /**
   * Desabilita (bloqueia) uma linha
   */
  async disableLine(id: number): Promise<{ result: boolean }> {
    const { data } = await this.client.get('', {
      params: { action: xuiActions.DISABLE_LINE, id },
    });
    const normalized = this.normalizeResponse(data);
    logger.info(`Linha ${id} desabilitada`);
    return { result: normalized.success };
  }

  /**
   * Habilita (desbloqueia) uma linha
   */
  async enableLine(id: number): Promise<{ result: boolean }> {
    const { data } = await this.client.get('', {
      params: { action: xuiActions.ENABLE_LINE, id },
    });
    const normalized = this.normalizeResponse(data);
    logger.info(`Linha ${id} habilitada`);
    return { result: normalized.success };
  }

  /**
   * Bane uma linha (bloqueio permanente)
   */
  async banLine(id: number): Promise<{ result: boolean }> {
    const { data } = await this.client.get('', {
      params: { action: xuiActions.BAN_LINE, id },
    });
    const normalized = this.normalizeResponse(data);
    logger.info(`Linha ${id} banida`);
    return { result: normalized.success };
  }

  /**
   * Remove ban de uma linha
   */
  async unbanLine(id: number): Promise<{ result: boolean }> {
    const { data } = await this.client.get('', {
      params: { action: xuiActions.UNBAN_LINE, id },
    });
    const normalized = this.normalizeResponse(data);
    logger.info(`Linha ${id} desbanida`);
    return { result: normalized.success };
  }

  /**
   * Deleta uma linha
   */
  async deleteLine(id: number): Promise<{ result: boolean }> {
    const { data } = await this.client.get('', {
      params: { action: xuiActions.DELETE_LINE, id },
    });
    const normalized = this.normalizeResponse(data);
    logger.info(`Linha ${id} deletada`);
    return { result: normalized.success };
  }

  // ==========================================
  // PACOTES
  // ==========================================

  /**
   * Lista todos os pacotes
   */
  async getPackages(): Promise<XUIPackage[]> {
    const cacheKey = 'packages';
    const cached = getFromCache<XUIPackage[]>(cacheKey);
    if (cached) return cached;

    const { data } = await this.withRetry(() =>
      this.client.get('', { params: { action: xuiActions.GET_PACKAGES } })
    );
    
    // Normalizar: XUI ONE retorna array direto, Xtream UI pode envolver em objeto
    const normalized = this.normalizeResponse(data);
    let packages: XUIPackage[] = [];
    if (Array.isArray(normalized.data)) {
      packages = normalized.data;
    } else if (Array.isArray(data)) {
      packages = data;
    } else if (data?.data && Array.isArray(data.data)) {
      packages = data.data;
    }
    setCache(cacheKey, packages, xuiConfig.cache.packages);
    return packages;
  }

  /**
   * Obtém um pacote específico
   */
  async getPackage(id: number): Promise<XUIPackage> {
    const { data } = await this.client.get('', {
      params: { action: xuiActions.GET_PACKAGE, id },
    });
    const normalized = this.normalizeResponse(data);
    return normalized.data?.package || normalized.data || data?.package || data;
  }

  // ==========================================
  // BOUQUETS
  // ==========================================

  /**
   * Lista todos os bouquets
   */
  async getBouquets(): Promise<XUIBouquet[]> {
    const cacheKey = 'bouquets';
    const cached = getFromCache<XUIBouquet[]>(cacheKey);
    if (cached) return cached;

    const { data } = await this.withRetry(() =>
      this.client.get('', { params: { action: xuiActions.GET_BOUQUETS } })
    );
    
    const normalized = this.normalizeResponse(data);
    let bouquets: XUIBouquet[] = [];
    if (Array.isArray(normalized.data)) {
      bouquets = normalized.data;
    } else if (Array.isArray(data)) {
      bouquets = data;
    } else if (data?.data && Array.isArray(data.data)) {
      bouquets = data.data;
    }
    setCache(cacheKey, bouquets, xuiConfig.cache.bouquets);
    return bouquets;
  }

  // ==========================================
  // USUÁRIOS / REVENDEDORES
  // ==========================================

  /**
   * Lista todos os usuários (revendedores)
   */
  async getUsers(): Promise<XUIUser[]> {
    const { data } = await this.client.get('', {
      params: { action: xuiActions.GET_USERS },
    });
    const normalized = this.normalizeResponse(data);
    if (Array.isArray(normalized.data)) return normalized.data;
    if (Array.isArray(data)) return data;
    if (data?.data && Array.isArray(data.data)) return data.data;
    return [];
  }

  /**
   * Lista grupos de membros (Member Groups)
   */
  async getGroups(): Promise<Array<{
    group_id: string;
    group_name: string;
    is_admin: string;
    is_reseller: string;
    allow_change_bouquets?: string;
  }>> {
    const { data } = await this.client.get('', {
      params: { action: xuiActions.GET_GROUPS },
    });
    
    const normalized = this.normalizeResponse(data);
    if (Array.isArray(normalized.data)) return normalized.data;
    if (Array.isArray(data)) return data;
    if (data?.data && Array.isArray(data.data)) return data.data;
    return [];
  }

  /**
   * Cria um usuário reseller no XUI
   */
  async createUser(params: {
    username: string;
    password: string;
    email?: string;
    member_group_id: number;  // 2 = Reseller
    credits?: number;
    owner_id?: number;        // ID do owner (admin)
  }): Promise<{ result: boolean; user_id: number; username: string; api_key?: string }> {
    const queryParams: Record<string, any> = {
      action: xuiActions.CREATE_USER,
      username: params.username,
      password: params.password,
      member_group_id: params.member_group_id,
    };

    if (params.email) queryParams.email = params.email;
    if (params.credits !== undefined) queryParams.credits = params.credits;
    if (params.owner_id !== undefined) queryParams.owner_id = params.owner_id;

    logger.info('[XUIClient] createUser - Params:', { ...queryParams, password: '***HIDDEN***' });

    const { data } = await this.client.get('/', { params: queryParams });

    logger.info('[XUIClient] createUser - Response:', data);

    const normalized = this.normalizeResponse(data);
    if (normalized.success && normalized.data) {
      const userData = normalized.data;
      return {
        result: true,
        user_id: parseInt(userData.id || userData.user_id || 0, 10),
        username: userData.username || params.username,
        api_key: userData.api_key || undefined,
      };
    }

    throw new Error(data?.message || normalized.status || 'Falha ao criar usuário');
  }

  /**
   * Obtém um usuário específico
   */
  async getUser(id: number): Promise<XUIUser> {
    const { data } = await this.client.get('', {
      params: { action: xuiActions.GET_USER, id },
    });
    const normalized = this.normalizeResponse(data);
    return normalized.data?.user || normalized.data || data?.user || data;
  }

  /**
   * Obtém info do usuário atual (da API Key)
   */
  async getUserInfo(): Promise<{
    user_id: number;
    username: string;
    credits: number;
    member_group: any;
  }> {
    const { data } = await this.client.get('', {
      params: { action: xuiActions.USER_INFO },
    });
    
    const normalized = this.normalizeResponse(data);
    const d = normalized.data;
    
    // XUI ONE: { status: 'STATUS_SUCCESS', data: { id, username, credits, ... } }
    // Xtream UI: { user_info: { username, ... }, server_info: { ... } } or direct data
    if (d?.user_info) {
      // Xtream UI format
      return {
        user_id: parseInt(d.user_info.id || d.user_info.user_id || 0),
        username: d.user_info.username || 'admin',
        credits: parseInt(d.user_info.credits || 0),
        member_group: d.user_info.member_group_id || null,
      };
    }
    
    return {
      user_id: parseInt(d?.id || d?.user_id || 0),
      username: d?.username || 'unknown',
      credits: parseInt(d?.credits || 0),
      member_group: data?.permissions || d?.member_group_id || null,
    };
  }

  // ==========================================
  // CONEXÕES AO VIVO
  // ==========================================

  /**
   * Lista todas as conexões ativas
   */
  async getLiveConnections(): Promise<XUILiveConnection[]> {
    const { data } = await this.client.get('', {
      params: { action: xuiActions.LIVE_CONNECTIONS },
    });
    const normalized = this.normalizeResponse(data);
    if (Array.isArray(normalized.data)) return normalized.data;
    if (data && data.data && Array.isArray(data.data)) return data.data;
    return Array.isArray(data) ? data : [];
  }

  /**
   * Mata uma conexão específica
   */
  async killConnection(id: number): Promise<{ result: boolean }> {
    const { data } = await this.client.get('', {
      params: { action: xuiActions.KILL_CONNECTION, id },
    });
    const normalized = this.normalizeResponse(data);
    return { result: normalized.success };
  }

  // ==========================================
  // LOGS
  // ==========================================

  async getActivityLogs(): Promise<any[]> {
    const { data } = await this.client.get('', {
      params: { action: xuiActions.ACTIVITY_LOGS },
    });
    const normalized = this.normalizeResponse(data);
    if (Array.isArray(normalized.data)) return normalized.data;
    return Array.isArray(data) ? data : (data?.data && Array.isArray(data.data) ? data.data : []);
  }

  async getCreditLogs(): Promise<any[]> {
    const { data } = await this.client.get('', {
      params: { action: xuiActions.CREDIT_LOGS },
    });
    const normalized = this.normalizeResponse(data);
    if (Array.isArray(normalized.data)) return normalized.data;
    return Array.isArray(data) ? data : (data?.data && Array.isArray(data.data) ? data.data : []);
  }

  async getLoginLogs(): Promise<any[]> {
    const { data } = await this.client.get('', {
      params: { action: xuiActions.LOGIN_LOGS },
    });
    const normalized = this.normalizeResponse(data);
    if (Array.isArray(normalized.data)) return normalized.data;
    return Array.isArray(data) ? data : (data?.data && Array.isArray(data.data) ? data.data : []);
  }

  // ==========================================
  // SERVIDOR
  // ==========================================

  async getServerStats(serverId: number): Promise<any> {
    const { data } = await this.client.get('', {
      params: { action: xuiActions.GET_SERVER_STATS, server_id: serverId },
    });
    return data;
  }

  // ==========================================
  // HELPERS ESTÁTICOS
  // ==========================================

  /**
   * Calcula timestamp Unix para X duração a partir de agora
   */
  static calculateExpDate(duration: number, unit: 'hours' | 'days' | 'months'): number {
    const now = Date.now();
    let ms = 0;

    switch (unit) {
      case 'hours':
        ms = duration * 60 * 60 * 1000;
        break;
      case 'days':
        ms = duration * 24 * 60 * 60 * 1000;
        break;
      case 'months':
        ms = duration * 30 * 24 * 60 * 60 * 1000;
        break;
    }

    return Math.floor((now + ms) / 1000);
  }

  /**
   * Verifica se uma linha está expirada
   */
  static isExpired(expDate: number): boolean {
    return expDate * 1000 < Date.now();
  }

  /**
   * Calcula dias até expirar (negativo = já expirou)
   */
  static daysUntilExpiry(expDate: number): number {
    const diff = (expDate * 1000) - Date.now();
    return Math.ceil(diff / (24 * 60 * 60 * 1000));
  }

  /**
   * Converte linha XUI para formato do painel
   */
  static formatLine(line: XUILine): any {
    return {
      id: String(line.id),
      username: line.username,
      password: line.password,
      status: (line.is_banned ?? 0) ? 'BANNED' : line.enabled ? 'ACTIVE' : 'EXPIRED',
      is_trial: line.is_trial ? 'YES' : 'NO',
      connections: line.max_connections,
      expires_at: new Date(line.exp_date * 1000).toISOString(),
      created_at: new Date(line.created_at * 1000).toISOString(),
      bouquets: line.bouquet,
      admin_notes: line.admin_notes,
      reseller_notes: line.reseller_notes,
    };
  }

  /**
   * Limpa cache
   */
  clearCache(): void {
    cache.clear();
    logger.info('Cache limpo');
  }
}

// Instância singleton removida - usar new XUIClient(server) diretamente
