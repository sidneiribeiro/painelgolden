/**
 * Utilitários para evitar overflow em colunas Prisma Int (32-bit signed).
 */
export const PRISMA_INT_MIN = -2147483648;
export const PRISMA_INT_MAX = 2147483647;

/**
 * Garante que um valor cabe em um Prisma Int (32 bits).
 * Valores inválidos, NaN ou fora do range retornam o fallback.
 */
export function clampToPrismaInt(value: unknown, fallback: number = 0): number {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
      ? parseInt(value, 10)
      : NaN;
  if (!Number.isFinite(n)) return fallback;
  const int = Math.trunc(n);
  if (int < PRISMA_INT_MIN) return PRISMA_INT_MIN;
  if (int > PRISMA_INT_MAX) return PRISMA_INT_MAX;
  return int;
}
