import { api } from './client';
import type { Server, ApiResponse } from '@/types';

export const serversApi = {
  async list(): Promise<Server[]> {
    const response = await api.get<ApiResponse<Server[]>>('/servers');
    return response.data.data;
  },

  async getStatus(): Promise<any> {
    const response = await api.get('/servers/status');
    return response.data;
  },

  async getBouquets(serverId: string, includeChildren = true): Promise<Array<{ id: string; name: string }>> {
    const response = await api.get(`/servers/${serverId}/bouquets?includeChildren=${includeChildren}`);
    return response.data;
  },

  async getContent(serverId: string): Promise<any> {
    const response = await api.get(`/servers/${serverId}/content`);
    return response.data;
  },
};

