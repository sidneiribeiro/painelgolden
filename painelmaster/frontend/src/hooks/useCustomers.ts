import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customersApi, getErrorMessage } from '@/api';
import toast from 'react-hot-toast';
import type { CustomerFilters, CreateCustomerData } from '@/types';

export function useCustomers(filters: CustomerFilters = {}) {
  return useQuery({
    queryKey: ['customers', filters],
    queryFn: () => customersApi.list(filters),
    staleTime: 1000 * 60, // 1 minuto
  });
}

export function useCustomer(id: string) {
  return useQuery({
    queryKey: ['customers', id],
    queryFn: () => customersApi.get(id),
    enabled: !!id,
  });
}

export function useExpiringCustomers() {
  return useQuery({
    queryKey: ['customers', 'expiring'],
    queryFn: customersApi.getExpiring,
    staleTime: 1000 * 60 * 5, // 5 minutos
  });
}

export function useCustomerPlaylist(id: string) {
  return useQuery({
    queryKey: ['customers', id, 'playlist'],
    queryFn: () => customersApi.getPlaylist(id),
    enabled: !!id,
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateCustomerData) => customersApi.create(data),
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(`Cliente ${customer.username} criado com sucesso!`);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}

export function useUpdateCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateCustomerData> }) =>
      customersApi.update(id, data),
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(`Cliente ${customer.username} atualizado!`);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}

export function useDeleteCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => customersApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Cliente removido com sucesso!');
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}

export function useRenewCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { package_id: string; connections?: number } }) =>
      customersApi.renew(id, data),
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(`Cliente ${customer.username} renovado!`);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}

export function useBlockCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => customersApi.block(id),
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(`Cliente ${customer.username} bloqueado!`);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}

export function useUnblockCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => customersApi.unblock(id),
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(`Cliente ${customer.username} desbloqueado!`);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}

export function useLiveConnections(serverId: string, page = 1, keyword = '') {
  return useQuery({
    queryKey: ['customers', 'live-connections', serverId, page, keyword],
    queryFn: () => customersApi.getLiveConnections(serverId, page, keyword),
    enabled: !!serverId,
    refetchInterval: 30000, // Atualiza a cada 30 segundos
  });
}

