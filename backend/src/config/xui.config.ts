import { env } from './env.js';

// Configuração para API direta do XUI.ONE
export const xuiConfig = {
  // URL base do servidor XUI (ex: https://atmt.space:9000)
  baseUrl: env.XUI_BASE_URL,
  
  // Access Code criado em: MANAGEMENT → ACCESS CONTROL → ACCESS CODES
  accessCode: env.XUI_ACCESS_CODE,
  
  // API Key do usuário (User Profile → API Key)
  apiKey: env.XUI_API_KEY,
  
  // Timeouts e retry
  timeout: 30000,
  retryAttempts: 3,
  retryDelay: 1000,
  
  // Cache (em segundos)
  cache: {
    packages: 300,      // 5 minutos
    bouquets: 300,      // 5 minutos
    lines: 60,          // 1 minuto
    stats: 120,         // 2 minutos
  },
};

// Actions disponíveis na API XUI.ONE
export const xuiActions = {
  // Linhas (Clientes)
  GET_LINES: 'get_lines',
  GET_LINE: 'get_line',
  CREATE_LINE: 'create_line',
  EDIT_LINE: 'edit_line',
  DELETE_LINE: 'delete_line',
  DISABLE_LINE: 'disable_line',
  ENABLE_LINE: 'enable_line',
  BAN_LINE: 'ban_line',
  UNBAN_LINE: 'unban_line',
  
  // Pacotes
  GET_PACKAGES: 'get_packages',
  GET_PACKAGE: 'get_package',
  
  // Bouquets
  GET_BOUQUETS: 'get_bouquets',
  
  // Usuários/Revendedores
  GET_USERS: 'get_users',
  GET_USER: 'get_user',
  CREATE_USER: 'create_user',
  USER_INFO: 'user_info',
  
  // Grupos
  GET_GROUPS: 'get_groups',
  
  // Conexões ao vivo
  LIVE_CONNECTIONS: 'live_connections',
  KILL_CONNECTION: 'kill_connection',
  
  // Logs
  ACTIVITY_LOGS: 'activity_logs',
  CREDIT_LOGS: 'credit_logs',
  CLIENT_LOGS: 'client_logs',
  LOGIN_LOGS: 'login_logs',
  
  // Servidor
  GET_SERVER_STATS: 'get_server_stats',
  GET_FPM_STATUS: 'get_fpm_status',
  GET_FREE_SPACE: 'get_free_space',
};
