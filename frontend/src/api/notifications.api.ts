import { api } from './client';
import type { NotificationSettings, NotificationLog, NotificationStats, PaginatedResponse, ApiResponse } from '@/types';

export const notificationsApi = {
  async getSettings(): Promise<NotificationSettings> {
    const response = await api.get<ApiResponse<NotificationSettings>>('/notifications/settings');
    return response.data.data;
  },

  async updateSettings(data: Partial<NotificationSettings>): Promise<NotificationSettings> {
    const response = await api.put<ApiResponse<NotificationSettings>>('/notifications/settings', data);
    return response.data.data;
  },

  async getLogs(params: {
    page?: number;
    perPage?: number;
    type?: string;
    status?: string;
  } = {}): Promise<{ data: NotificationLog[]; meta: { current_page: number; last_page: number; total: number; per_page: number } }> {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        searchParams.append(key, String(value));
      }
    });
    const response = await api.get(`/notifications/logs?${searchParams.toString()}`);
    return response.data;
  },

  async getStats(): Promise<NotificationStats> {
    const response = await api.get<NotificationStats>('/notifications/stats');
    return response.data;
  },

  async testWhatsApp(data: { phone: string; appKey: string; authKey: string }): Promise<{ success: boolean; message: string }> {
    const response = await api.post('/notifications/test-whatsapp', data);
    return response.data;
  },

  async testTelegram(data: { botToken: string; chatId: string }): Promise<{ success: boolean; message: string; botUsername?: string }> {
    const response = await api.post('/notifications/test-telegram', data);
    return response.data;
  },

  async runNow(): Promise<{ message: string; result: { sent: number; failed: number; skipped: number } }> {
    const response = await api.post('/notifications/run-now');
    return response.data;
  },
};

