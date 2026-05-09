import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

interface PanelSettings {
  id: string;
  panelName: string;
  logoUrl: string | null;
}

function getSubdomainReseller(hostname: string) {
  const parts = (hostname || '').split('.').filter(Boolean);
  if (parts.length < 3) return '';
  const sub = parts[0].toLowerCase();
  if (sub === 'www') return '';
  return sub;
}

export function usePanelSettings(publicEndpoint = false) {
  const endpoint = publicEndpoint ? '/settings/panel/public' : '/settings/panel';
  
  return useQuery({
    queryKey: ['panelSettings', publicEndpoint ? 'public' : 'private'],
    queryFn: async () => {
      try {
        if (publicEndpoint) {
          let hostname = '';
          try {
            hostname = window.location.hostname || '';
          } catch {
            hostname = '';
          }
          const reseller = getSubdomainReseller(hostname);
          const qs = reseller ? `?reseller=${encodeURIComponent(reseller)}` : '';
          const res = await api.get(`${endpoint}${qs}`);
          return res.data.data as PanelSettings;
        }

        const res = await api.get(endpoint);
        return res.data.data as PanelSettings;
      } catch (error: any) {
        // Se erro 401 e não for endpoint público, tenta endpoint público
        if (!publicEndpoint && error?.response?.status === 401) {
          try {
            let hostname = '';
            try {
              hostname = window.location.hostname || '';
            } catch {
              hostname = '';
            }
            const reseller = getSubdomainReseller(hostname);
            const qs = reseller ? `?reseller=${encodeURIComponent(reseller)}` : '';
            const publicRes = await api.get(`/settings/panel/public${qs}`);
            return publicRes.data.data as PanelSettings;
          } catch {
            return null;
          }
        }
        return null;
      }
    },
    staleTime: 1000 * 60 * 5, // 5 minutos
    retry: false,
  });
}
