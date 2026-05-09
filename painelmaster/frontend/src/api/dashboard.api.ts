import { api } from './client';
import type { DashboardStats, ChartData } from '@/types';

export const dashboardApi = {
  async getStats(): Promise<DashboardStats> {
    const response = await api.get<DashboardStats>('/dashboard/stats');
    return response.data;
  },

  async getCustomersCount(): Promise<DashboardStats['customers']> {
    const response = await api.get<DashboardStats['customers']>('/dashboard/customers-count');
    return response.data;
  },

  async getOnlineCount(): Promise<{ count: number }> {
    const response = await api.get<{ count: number }>('/dashboard/online-count');
    return response.data;
  },

  async getAllCharts(): Promise<{
    newCustomers: ChartData;
    revenueForecast: ChartData;
    creditsConsumed: ChartData;
    lostRevenue: ChartData;
  }> {
    const response = await api.get('/dashboard/charts/all');
    return response.data;
  },

  async getNewCustomersChart(): Promise<ChartData> {
    const response = await api.get<ChartData>('/dashboard/charts/new-customers');
    return response.data;
  },

  async getRevenueForecastChart(): Promise<ChartData> {
    const response = await api.get<ChartData>('/dashboard/charts/revenue-forecast');
    return response.data;
  },

  async getCreditsConsumedChart(): Promise<ChartData> {
    const response = await api.get<ChartData>('/dashboard/charts/credits-consumed');
    return response.data;
  },
};
