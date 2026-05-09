/**
 * Constrói a URL completa para imagens (logos, etc.)
 * Uploads são servidos via backend em /api/uploads
 */
export function getImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  
  // Se já é uma URL completa, retorna como está
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  
  // Remove barra inicial se houver
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  
  // Sempre usar /api/uploads em produção (NGINX faz proxy para o backend)
  // Em desenvolvimento, usar localhost:3001
  if (import.meta.env.PROD) {
    return `/api/${cleanPath}`;
  } else {
    return `http://localhost:3001/api/${cleanPath}`;
  }
}

