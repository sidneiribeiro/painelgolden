/**
 * Utilitários para cálculo de datas e timestamps Unix
 */

/**
 * Calcula o timestamp Unix de expiração baseado na duração
 * @param duration - Número (ex: 3, 6, 12, 24, 1, 30)
 * @param unit - 'hours' | 'days' | 'months'
 * @returns Timestamp Unix em SEGUNDOS (não milissegundos!)
 */
export function calculateExpTimestamp(duration: number, unit: string): number {
  const now = Date.now(); // milissegundos
  let milliseconds = 0;

  switch (unit.toLowerCase()) {
    case 'hours':
    case 'hour':
      milliseconds = duration * 60 * 60 * 1000;
      break;
    case 'days':
    case 'day':
      milliseconds = duration * 24 * 60 * 60 * 1000;
      break;
    case 'months':
    case 'month':
      milliseconds = duration * 30 * 24 * 60 * 60 * 1000;
      break;
    default:
      // Se não reconhecer, assume dias
      milliseconds = duration * 24 * 60 * 60 * 1000;
  }

  // Retorna em SEGUNDOS (XUI usa timestamp Unix em segundos)
  return Math.floor((now + milliseconds) / 1000);
}

/**
 * Converte timestamp Unix (segundos) para Date do JavaScript
 */
export function unixToDate(unixTimestamp: number): Date {
  return new Date(unixTimestamp * 1000);
}

/**
 * Verifica se um timestamp está expirado
 */
export function isExpired(unixTimestamp: number): boolean {
  return unixTimestamp * 1000 < Date.now();
}

