// ===========================================
// TIPOS DO PAINEL IPTV
// ===========================================

// ============ CUSTOMER TYPES ============
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
  customer_renew_template: string;
  customer_renew_confirmation_template: string;
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

export interface CreateCustomerDto {
  server_id: string;
  package_id: string;
  trial_hours?: number;
  connections: number;
  name?: string;
  whatsapp?: string;
  email?: string;
}

export interface RenewCustomerDto {
  package_id: string;
  connections?: number;
}

// ============ PACKAGE TYPES ============
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
  template: string;
  connections: number;
  bouquets: string[] | null;
}

// ============ SERVER TYPES ============
export interface Server {
  id: string;
  name: string;
  type: 'XUIONE';
  dns: string;
  dns_list: string[];
  status: string;
  connection_type: 'IPTV';
  m3u_templates: any;
  reseller_action: any;
}

export interface ServerBouquet {
  id: string;
  name: string;
}

// ============ DASHBOARD TYPES ============
export interface CustomersCount {
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
  comparison?: Record<string, any>;
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

// ============ RESELLER TYPES ============
export interface Reseller {
  id: string;
  username: string;
  email: string;
  credits: number;
  role: string;
  status: 'ACTIVE' | 'INACTIVE' | 'BANNED';
  parent?: string;
}

// ============ API RESPONSE TYPES ============
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

// ============ AUTH TYPES ============
export interface LoginDto {
  username: string;
  password: string;
  twofactor_code?: string;
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  credits: number;
  role: string;
  status: string;
}

// ============ NOTIFICATION TYPES ============
export interface NotificationPayload {
  to: string;
  message: string;
}

export interface WhatsAppPayload extends NotificationPayload {
  appKey: string;
  authKey: string;
}

export interface TelegramPayload extends NotificationPayload {
  botToken: string;
  chatId: string;
}

// ============ SETTINGS TYPES ============
export interface SettingItem {
  variable: string;
  value: string;
}

// ============ ORDER TYPES ============
export interface CustomerOrder {
  id: string;
  username: string;
  status: string;
  package_id: string;
  created_at: string;
}

export interface CreditOrder {
  id: string;
  credits: number;
  status: string;
  created_at: string;
}

// ============ CREDIT TRANSACTION ============
export interface CreditTransaction {
  id: string;
  created_at: string;
  source_user: string;
  source_user_credits_before: number;
  source_user_credits_after: number;
  destination_user: string;
  customer: string | null;
  credits: number;
  action: 'SALE' | 'RENEW' | 'CREDIT_TRANSFER' | 'REFUND';
}
