/**
 * Utilitários para formatação de datas no timezone do Brasil (America/Sao_Paulo)
 */

const TIMEZONE = 'America/Sao_Paulo';

/**
 * Formata uma data para formato brasileiro (dd/mm/yyyy)
 */
export function formatDate(dateStr: string | undefined | null): string {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: TIMEZONE,
    });
  } catch (e) {
    return '-';
  }
}

/**
 * Formata uma data com hora para formato brasileiro (dd/mm/yyyy HH:mm)
 */
export function formatDateTime(dateStr: string | undefined | null): string {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: TIMEZONE,
    });
  } catch (e) {
    return '-';
  }
}

/**
 * Formata uma data com hora completa (dd/mm/yyyy HH:mm:ss)
 */
export function formatDateTimeFull(dateStr: string | undefined | null): string {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: TIMEZONE,
    });
  } catch (e) {
    return '-';
  }
}

/**
 * Converte uma data local para ISO string no timezone do Brasil
 */
export function toBrazilTimezone(date: Date): string {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  const hour = parts.find(p => p.type === 'hour')?.value;
  const minute = parts.find(p => p.type === 'minute')?.value;
  const second = parts.find(p => p.type === 'second')?.value;
  
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

/**
 * Cria uma data no timezone do Brasil a partir de uma string
 */
export function parseBrazilDate(dateStr: string): Date {
  // Assume que a string já está no formato correto e cria a data
  // O JavaScript Date sempre trabalha em UTC internamente
  return new Date(dateStr);
}

