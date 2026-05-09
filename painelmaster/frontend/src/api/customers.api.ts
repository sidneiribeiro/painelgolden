import { api } from './client';
import type { 
  Customer, 
  CustomerFilters, 
  CreateCustomerData, 
  PaginatedResponse,
  ApiResponse,
  LiveConnection 
} from '@/types';

export const customersApi = {
  async list(filters: CustomerFilters = {}): Promise<PaginatedResponse<Customer>> {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        params.append(key, String(value));
      }
    });
    const response = await api.get<PaginatedResponse<Customer>>(`/customers?${params.toString()}`);
    return response.data;
  },

  async get(id: string): Promise<Customer> {
    const response = await api.get<ApiResponse<Customer>>(`/customers/${id}`);
    return response.data.data;
  },

  async create(data: CreateCustomerData): Promise<Customer> {
    const response = await api.post<ApiResponse<Customer>>('/customers', data);
    return response.data.data;
  },

  async update(id: string, data: Partial<Customer>): Promise<Customer> {
    const response = await api.put<ApiResponse<Customer>>(`/customers/${id}`, data);
    return response.data.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/customers/${id}`);
  },

  async getExpiring(): Promise<Customer[]> {
    const response = await api.get<ApiResponse<Customer[]>>('/customers/expiring');
    return response.data.data;
  },

  async getPlaylist(id: string): Promise<Array<{ key: string; template: string }>> {
    const response = await api.get<Array<{ key: string; template: string }>>(`/customers/${id}/playlist`);
    return response.data;
  },

  async renew(id: string, data: { package_id: string; connections?: number }): Promise<Customer> {
    const response = await api.post<{ data: Customer }>(`/customers/${id}/renew`, data);
    return response.data.data;
  },

  async block(id: string): Promise<Customer> {
    const response = await api.post<{ data: Customer }>(`/customers/${id}/block`);
    return response.data.data;
  },

  async unblock(id: string): Promise<Customer> {
    const response = await api.post<{ data: Customer }>(`/customers/${id}/unblock`);
    return response.data.data;
  },

  async getLiveConnections(
    serverId: string, 
    page = 1, 
    keyword = '', 
    perPage = 50
  ): Promise<PaginatedResponse<LiveConnection>> {
    const params = new URLSearchParams({
      page: String(page),
      keyword,
      perPage: String(perPage),
    });
    const response = await api.get<PaginatedResponse<LiveConnection>>(
      `/customers/live-connections/${serverId}?${params.toString()}`
    );
    return response.data;
  },

  async calculatePlanPrice(serverId: string, packageId: string, connections: number): Promise<number> {
    const response = await api.post<{ data: { plan_price: number } }>('/customers/calculate-plan-price', {
      server_id: serverId,
      package_id: packageId,
      connections,
    });
    return response.data.data.plan_price;
  },

  async calculateCredits(
    serverId: string, 
    packageId: string, 
    connections: number
  ): Promise<{
    credits_required: number;
    connections: number;
    duration_in_days: number;
    package_name: string;
  }> {
    const response = await api.post('/customers/calculate-customer-credits', {
      server_id: serverId,
      package_id: packageId,
      connections,
    });
    return response.data;
  },

  async syncToXui(data: { serverId: string; dryRun?: boolean; source?: 'xui' | 'panel' }): Promise<any> {
    const response = await api.post('/customers/sync-to-xui', data);
    return response.data;
  },
};
