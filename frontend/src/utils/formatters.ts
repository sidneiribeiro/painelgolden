import { format, formatDistanceToNow, differenceInDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';

const TIMEZONE = 'America/Sao_Paulo';

/**
 * Formata valor em centavos para moeda brasileira
 */
export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}

/**
 * Formata data para formato brasileiro (DD/MM/YYYY) no timezone de Brasília
 */
export function formatDate(dateString: string | Date): string {
  if (!dateString) return '-';
  try {
    const date = typeof dateString === 'string' ? parseISO(dateString) : dateString;
    return formatInTimeZone(date, TIMEZONE, 'dd/MM/yyyy', { locale: ptBR });
  } catch (e) {
    return '-';
  }
}

/**
 * Formata data e hora (DD/MM/YYYY HH:mm) no timezone de Brasília
 */
export function formatDateTime(dateString: string | Date): string {
  if (!dateString) return '-';
  try {
    const date = typeof dateString === 'string' ? parseISO(dateString) : dateString;
    return formatInTimeZone(date, TIMEZONE, 'dd/MM/yyyy HH:mm', { locale: ptBR });
  } catch (e) {
    return '-';
  }
}

/**
 * Formata data relativa (ex: "há 2 dias")
 */
export function formatRelativeDate(dateString: string | Date): string {
  const date = typeof dateString === 'string' ? parseISO(dateString) : dateString;
  return formatDistanceToNow(date, { addSuffix: true, locale: ptBR });
}

/**
 * Calcula dias até uma data
 */
export function daysUntil(dateString: string | Date): number {
  const date = typeof dateString === 'string' ? parseISO(dateString) : dateString;
  return differenceInDays(date, new Date());
}

/**
 * Formata dias restantes com texto
 */
export function formatDaysRemaining(dateString: string): string {
  const days = daysUntil(dateString);
  
  if (days < 0) return `Expirado há ${Math.abs(days)} dia(s)`;
  if (days === 0) return 'Expira hoje';
  if (days === 1) return 'Expira amanhã';
  return `${days} dias restantes`;
}

/**
 * Limpa número de telefone
 */
export function cleanPhoneNumber(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * Formata número de telefone brasileiro
 */
export function formatPhoneNumber(phone: string): string {
  const cleaned = cleanPhoneNumber(phone);
  if (cleaned.length === 11) {
    return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 7)}-${cleaned.slice(7)}`;
  }
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
}

/**
 * Trunca texto
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

/**
 * Formata status do cliente
 */
export function formatCustomerStatus(status: string): string {
  const statusMap: Record<string, string> = {
    ACTIVE: 'Ativo',
    EXPIRED: 'Expirado',
    BANNED: 'Bloqueado',
  };
  return statusMap[status] || status;
}

/**
 * Formata tipo de notificação
 */
export function formatNotificationType(type: string): string {
  const typeMap: Record<string, string> = {
    EXPIRY_REMINDER: 'Lembrete de Vencimento',
    RENEWAL_CONFIRMATION: 'Confirmação de Renovação',
    WELCOME: 'Boas-vindas',
    CUSTOM: 'Personalizada',
  };
  return typeMap[type] || type;
}

/**
 * Formata canal de notificação
 */
export function formatNotificationChannel(channel: string): string {
  const channelMap: Record<string, string> = {
    WHATSAPP: 'WhatsApp',
    TELEGRAM: 'Telegram',
    EMAIL: 'Email',
  };
  return channelMap[channel] || channel;
}

/**
 * Formata status de notificação
 */
export function formatNotificationStatus(status: string): string {
  const statusMap: Record<string, string> = {
    PENDING: 'Pendente',
    SENT: 'Enviada',
    FAILED: 'Falhou',
    SKIPPED: 'Ignorada',
  };
  return statusMap[status] || status;
}

