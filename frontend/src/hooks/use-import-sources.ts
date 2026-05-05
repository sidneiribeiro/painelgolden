import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  listImportSources,
  getImportSource,
  createImportSource,
  updateImportSource,
  deleteImportSource,
  importFromSource,
  type CreateImportSourceData,
  type UpdateImportSourceData,
  type ImportFromSourceData,
} from '../api/import-sources';

// Query keys
export const importSourceKeys = {
  all: ['import-sources'] as const,
  lists: () => [...importSourceKeys.all, 'list'] as const,
  detail: (id: string) => [...importSourceKeys.all, 'detail', id] as const,
};

// Hook para listar todas as fontes
export function useImportSources() {
  return useQuery({
    queryKey: importSourceKeys.lists(),
    queryFn: listImportSources,
  });
}

// Hook para buscar fonte específica
export function useImportSource(id: string) {
  return useQuery({
    queryKey: importSourceKeys.detail(id),
    queryFn: () => getImportSource(id),
    enabled: !!id,
  });
}

// Hook para criar fonte
export function useCreateImportSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateImportSourceData) => createImportSource(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: importSourceKeys.lists() });
      toast.success('Fonte criada com sucesso!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao criar fonte');
    },
  });
}

// Hook para atualizar fonte
export function useUpdateImportSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateImportSourceData }) =>
      updateImportSource(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: importSourceKeys.lists() });
      queryClient.invalidateQueries({ queryKey: importSourceKeys.detail(variables.id) });
      toast.success('Fonte atualizada com sucesso!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao atualizar fonte');
    },
  });
}

// Hook para deletar fonte
export function useDeleteImportSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteImportSource(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: importSourceKeys.lists() });
      toast.success('Fonte deletada com sucesso!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao deletar fonte');
    },
  });
}

// Hook para importar de uma fonte
export function useImportFromSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ImportFromSourceData }) =>
      importFromSource(id, data),
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: importSourceKeys.lists() });
      queryClient.invalidateQueries({ queryKey: importSourceKeys.detail(variables.id) });
      
      if (result.success && result.result) {
        toast.success(
          `Importação concluída! ${result.result.added} adicionados, ${result.result.skipped} ignorados`
        );
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao importar de fonte');
    },
  });
}
