import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';

interface RoleProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles: Array<'SUPER_ADMIN' | 'ADMIN' | 'MASTER_RESELLER' | 'RESELLER'>;
  menuKey?: string;
  redirectTo?: string;
}

function parseMenuPermissions(raw: unknown): string[] | null {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function RoleProtectedRoute({
  children,
  allowedRoles,
  menuKey,
  redirectTo = '/'
}: RoleProtectedRouteProps) {
  const user = useAuthStore((state) => state.user);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') {
    return <>{children}</>;
  }

  if (allowedRoles.includes(user.role)) {
    return <>{children}</>;
  }

  if (menuKey && (user.role === 'MASTER_RESELLER' || user.role === 'RESELLER')) {
    const perms = parseMenuPermissions((user as any).menuPermissions);
    if (perms && perms.includes(menuKey)) {
      return <>{children}</>;
    }
  }

  return <Navigate to={redirectTo} replace />;
}

export default RoleProtectedRoute;
