import { api } from './client';
import type { Package, ApiResponse } from '@/types';

export const packagesApi = {
  async list(): Promise<Package[]> {
    const response = await api.get<ApiResponse<Package[]>>('/packages');
    return response.data.data;
  },

  async getPrice(): Promise<Package[]> {
    const response = await api.get<ApiResponse<Package[]>>('/packages/price');
    return response.data.data;
  },

  async getTrials(): Promise<Package[]> {
    const response = await api.get<ApiResponse<Package[]>>('/packages/trials');
    return response.data.data;
  },

  async getByServer(serverId: string): Promise<Package[]> {
    const response = await api.get<ApiResponse<Package[]>>(`/packages/by-server/${serverId}`);
    return response.data.data;
  },
};

