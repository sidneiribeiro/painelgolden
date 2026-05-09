// ===========================================
// TIPOS DO FRONTEND
// ===========================================

// ============ USER / AUTH ============
export interface User {
  id: string;
  username: string;
  email: string;
  role: 'ADMIN' | 'MASTER_RESELLER' | 'RESELLER';
  credits: number;
  status: 'ACTIVE' | 'INACTIVE' | 'BANNED';
  createdAt: string;
  lastLoginAt?: string;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
}

// ============ CUSTOMER ============
export interface Customer {
  id: string;
  user_id: string;
  server_id: string;
  package_id: string;
  username: string;
  password: string;
  name: string | null;
  email: string | null;
  whatsapp: string | null;
  telegram: string | null;
  status: 'ACTIVE' | 'EXPIRED' | 'BANNED';
  is_trial: 'YES' | 'NO';
  connections: number;
  expires_at: string;
  expires_at_tz: string;
  created_at: string;
  updated_at: string;
  package: string;
  plan_price: number;
  server: string;
  m3u_url: string;
  m3u_url_short: string;
  renew_url: string;
  customer_renew_template?: string;
}

export interface CustomerFilters {
  page?: number;
  perPage?: number;
  username?: string;
  serverId?: string;
  packageId?: string;
  expiryFrom?: string;
  expiryTo?: string;
  status?: 'ACTIVE' | 'EXPIRED' | 'BANNED';
  isTrial?: 'YES' | 'NO';
  connections?: number;
}

export interface CreateCustomerData {
  server_id: string;
  package_id: string;
  trial_hours?: number;
  connections: number;
  name?: string;
  whatsapp?: string;
  email?: string;
}

// ============ PACKAGE ============
export interface Package {
  id: string;
  server_id: string;
  server_package_id: string;
  server: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  is_trial: 'YES' | 'NO';
  is_mag: boolean;
  is_asnlock: boolean;
  is_isplock: boolean;
  is_restreamer: boolean;
  plan_price: number;
  credits: number;
  duration: number;
  duration_in: 'HOURS' | 'DAYS' | 'MONTHS' | 'YEARS';
  template?: string;
  connections: number;
  bouquets: string[] | null;
}

// ============ SERVER ============
export interface Server {
  id: string;
  name: string;
  type: 'XUIONE';
  dns: string;
  dns_list: string[];
  status: string;
  connection_type: 'IPTV';
}

// ============ DASHBOARD ============
export interface DashboardStats {
  customers: {
    mine: {
      active: number;
      toExpire: number;
      inactive: number;
      revenue: string;
    };
    tree: {
      active: number;
      toExpire: number;
      inactive: number;
      revenue: number;
    };
  };
  online: number;
}

export interface ChartData {
  description: string;
  categories: string[];
  series: Array<{
    name: string;
    data: number[];
    color?: string;
  }>;
  total?: number | string;
  change?: number;
}

// ============ NOTIFICATIONS ============
export interface NotificationSettings {
  id: string;
  enabled: boolean;
  daysBefore: string;
  whatsappEnabled: boolean;
  botbotAppKey: string | null;
  botbotAuthKey: string | null;
  telegramEnabled: boolean;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  emailEnabled: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPass: string | null;
  reminderTemplate: string | null;
  renewalTemplate: string | null;
  welcomeTemplate: string | null;
}

export interface NotificationLog {
  id: string;
  customerId: string;
  customerName: string | null;
  whatsapp: string | null;
  telegram: string | null;
  email: string | null;
  type: 'EXPIRY_REMINDER' | 'RENEWAL_CONFIRMATION' | 'WELCOME' | 'CUSTOM';
  channel: 'WHATSAPP' | 'TELEGRAM' | 'EMAIL';
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
  message: string;
  sentAt: string | null;
  error: string | null;
  createdAt: string;
}

export interface NotificationStats {
  total: number;
  sent: number;
  failed: number;
  todaySent: number;
  successRate: string;
}

// ============ PAGINATION ============
export interface PaginatedResponse<T> {
  data: T[];
  links: {
    first: string;
    last: string;
    prev: string | null;
    next: string | null;
  };
  meta: {
    current_page: number;
    from: number;
    last_page: number;
    path: string;
    per_page: number;
    to: number;
    total: number;
  };
}

export interface ApiResponse<T> {
  data: T;
}

// ============ LIVE CONNECTIONS ============
export interface LiveConnection {
  id: string;
  user_username: string;
  active_connections: number;
  max_connections: number;
  stream_display_name: string;
  user_agent: string;
  country_code: string;
  quality: string;
}

// ============ ACTION LOG ============
export interface ActionLog {
  id: string;
  userId: string;
  action: string;
  entity: string;
  entityId: string | null;
  details: Record<string, any> | null;
  ip: string | null;
  createdAt: string;
}
