import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export interface FinancialStats {
  totalRevenue: number;
  monthlyRevenue: number;
  potentialRevenue: number; // Receita potencial baseada nos pacotes dos clientes ativos
  pendingPayments: number;
  paidPayments: number;
  totalCustomers: number;
  activeSubscriptions: number;
  revenueByMonth: Array<{ month: string; revenue: number }>;
  revenueByPackage: Array<{ packageName: string; revenue: number; count: number }>;
}

interface FinancialResponse {
  success: boolean;
  data: FinancialStats;
}

export function useFinancial() {
  const { data, isLoading, error } = useQuery<FinancialStats>({
    queryKey: ['financial'],
    queryFn: async () => {
      const res = await api.get<FinancialResponse>('/financial');
      return res.data.data;
    },
    refetchInterval: 1000 * 60 * 5, // Refetch a cada 5 minutos
  });

  return {
    stats: data,
    isLoading,
    error,
  };
}

