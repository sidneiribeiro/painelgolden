import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export interface Backup {
  filename: string;
  size: number;
  sizeFormatted: string;
  createdAt: string;
  createdAtFormatted: string;
}

interface BackupResponse {
  success: boolean;
  data: Backup[];
}

interface CreateBackupResponse {
  success: boolean;
  message: string;
  data: {
    filename: string;
    size: number;
    sizeFormatted: string;
    createdAt: string;
  };
}

export function useBackups() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<Backup[]>({
    queryKey: ['backups'],
    queryFn: async () => {
      const res = await api.get<BackupResponse>('/backups');
      return res.data.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<CreateBackupResponse>('/backups');
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups'] });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (filename: string) => {
      const res = await api.post(`/backups/restore/${filename}`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (filename: string) => {
      const res = await api.delete(`/backups/${filename}`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups'] });
    },
  });

  return {
    backups: data || [],
    isLoading,
    error,
    createBackup: createMutation.mutate,
    restoreBackup: restoreMutation.mutate,
    deleteBackup: deleteMutation.mutate,
    isCreating: createMutation.isPending,
    isRestoring: restoreMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}

