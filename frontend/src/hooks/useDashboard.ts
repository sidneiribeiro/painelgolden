import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '@/api';

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: dashboardApi.getStats,
    staleTime: 1000 * 60 * 2, // 2 minutos
    refetchInterval: 1000 * 60 * 2, // Atualiza a cada 2 minutos
  });
}

export function useCustomersCount() {
  return useQuery({
    queryKey: ['dashboard', 'customers-count'],
    queryFn: dashboardApi.getCustomersCount,
    staleTime: 1000 * 60 * 2,
  });
}

export function useOnlineCount() {
  return useQuery({
    queryKey: ['dashboard', 'online-count'],
    queryFn: dashboardApi.getOnlineCount,
    staleTime: 1000 * 30, // 30 segundos
    refetchInterval: 1000 * 30,
  });
}

export function useDashboardCharts() {
  return useQuery({
    queryKey: ['dashboard', 'charts'],
    queryFn: dashboardApi.getAllCharts,
    staleTime: 1000 * 60 * 5, // 5 minutos
  });
}

export function useNewCustomersChart() {
  return useQuery({
    queryKey: ['dashboard', 'charts', 'new-customers'],
    queryFn: dashboardApi.getNewCustomersChart,
    staleTime: 1000 * 60 * 5,
  });
}

export function useRevenueForecastChart() {
  return useQuery({
    queryKey: ['dashboard', 'charts', 'revenue-forecast'],
    queryFn: dashboardApi.getRevenueForecastChart,
    staleTime: 1000 * 60 * 5,
  });
}

