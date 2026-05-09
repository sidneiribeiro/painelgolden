/**
 * Política de conexões permitidas ao criar/editar um cliente IPTV.
 *
 * - SUPER_ADMIN / ADMIN: livres para definir qualquer valor.
 * - MASTER_RESELLER / RESELLER: limitados pelo número de conexões do pacote
 *   (não podem dar mais conexões do que o pacote permite).
 *
 * Aceita `requested` como número ou null; retorna sempre um inteiro ≥ 1.
 */
export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'MASTER_RESELLER' | 'RESELLER' | string;

export function resolveAllowedCustomerConnections(
  role: UserRole,
  requested: number | null | undefined,
  packageConnections: number | null | undefined,
): number {
  const requestedNum = Number(requested);
  const packageNum = Number(packageConnections);

  const requestedValid = Number.isFinite(requestedNum) && requestedNum > 0;
  const packageValid = Number.isFinite(packageNum) && packageNum > 0;

  const isPrivileged = role === 'SUPER_ADMIN' || role === 'ADMIN';

  if (isPrivileged) {
    if (requestedValid) return Math.max(1, Math.trunc(requestedNum));
    if (packageValid) return Math.max(1, Math.trunc(packageNum));
    return 1;
  }

  // Revendedores: nunca acima do pacote
  const cap = packageValid ? Math.max(1, Math.trunc(packageNum)) : 1;
  if (!requestedValid) return cap;
  return Math.min(cap, Math.max(1, Math.trunc(requestedNum)));
}

export default resolveAllowedCustomerConnections;
