/**
 * Lista de Itens VOD (Filmes e Séries)
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Spinner, Button, Select, Modal } from '../../components/ui';
import { api } from '../../api/client';
import { Film, Tv, Search, AlertCircle } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Input } from '../../components/ui/Input';
import toast from 'react-hot-toast';
import { useDebounce } from '../../hooks/useDebounce';

export function VODItemsPage() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const debouncedSearch = useDebounce(search, 500); // Debounce de 500ms
  const [page, setPage] = useState(parseInt(searchParams.get('page') || '1', 10));
  const [vodType, setVodType] = useState<'movie' | 'series' | ''>(searchParams.get('vodType') as any || '');
  const [serverId, setServerId] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState({
    categoryId: '',
    cover: '',
  });

  // Buscar servidores XUI
  const { data: serversData } = useQuery({
    queryKey: ['servers'],
    queryFn: async () => {
      const res = await api.get('/servers');
      return res.data.data || [];
    },
  });

  // Selecionar primeiro servidor por padrão
  useEffect(() => {
    if (Array.isArray(serversData) && serversData.length > 0 && !serverId) {
      setServerId(serversData[0].id);
    }
  }, [serversData, serverId]);

  // Atualizar URL quando debouncedSearch mudar
  useEffect(() => {
    const newParams = new URLSearchParams();
    if (debouncedSearch) newParams.set('search', debouncedSearch);
    if (vodType) newParams.set('vodType', vodType);
    newParams.set('page', '1');
    setSearchParams(newParams);
    setPage(1);
  }, [debouncedSearch, vodType, setSearchParams]);

  useEffect(() => {
    if (vodType) return;
    const p = location.pathname || '';
    if (p.endsWith('/vod/movies')) setVodType('movie');
    if (p.endsWith('/vod/series')) setVodType('series');
  }, [location.pathname, vodType]);

  const { data, isLoading } = useQuery({
    queryKey: ['vod-items', serverId, page, debouncedSearch, vodType],
    queryFn: async () => {
      if (!serverId) {
        return { data: [], pagination: { page: 1, perPage: 20, total: 0, totalPages: 0 } };
      }

      const params: any = {
        serverId,
        page: page.toString(),
        perPage: '20',
      };
      if (debouncedSearch) params.search = debouncedSearch;
      if (vodType) params.vodType = vodType;

      const res = await api.get('/vod/items', { params });
      return res.data;
    },
    enabled: !!serverId,
  });

  const items = Array.isArray(data?.data) ? data.data : [];
  const pagination = data?.pagination || { page: 1, perPage: 20, total: 0, totalPages: 0 };

  const effectiveVodType = vodType || 'movie';
  const bulkCategoryTypeParam = effectiveVodType === 'movie' ? 'vod' : 'series';

  const { data: categoriesData } = useQuery({
    queryKey: ['vod-categories', serverId, bulkCategoryTypeParam],
    queryFn: async () => {
      if (!serverId) return [];
      const res = await api.get('/vod/categories', { params: { serverId, type: bulkCategoryTypeParam } });
      return res.data.data || res.data || [];
    },
    enabled: !!serverId && (effectiveVodType === 'movie' || effectiveVodType === 'series'),
  });

  const categories: Array<{ id: number; category_name: string }> = Array.isArray(categoriesData) ? categoriesData : [];

  const toggleSelectOne = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const selectAllPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const it of items) {
        if (it?.id) next.add(Number(it.id));
      }
      return next;
    });
  };

  const bulkUpdateMutation = useMutation({
    mutationFn: async (payload: { serverId: string; vodType: 'movie' | 'series'; ids: number[]; categoryId?: number; cover?: string }) => {
      const res = await api.put('/vod/items/bulk', payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vod-items'] });
      toast.success('Atualização em massa concluída');
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Erro ao atualizar em massa'),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (payload: { serverId: string; vodType: 'movie' | 'series'; ids: number[] }) => {
      const res = await api.delete('/vod/items/bulk', { data: payload });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vod-items'] });
      toast.success('Itens removidos');
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Erro ao remover em massa'),
  });

  const openBulkEdit = () => {
    setBulkForm({ categoryId: '', cover: '' });
    setBulkOpen(true);
  };

  const applyBulkEdit = async () => {
    const ids = Array.from(selectedIds);
    if (!serverId || ids.length === 0) return;
    const categoryIdNum = bulkForm.categoryId ? parseInt(bulkForm.categoryId, 10) : undefined;
    const cover = bulkForm.cover.trim() ? bulkForm.cover.trim() : undefined;

    await bulkUpdateMutation.mutateAsync({
      serverId,
      vodType: effectiveVodType as 'movie' | 'series',
      ids,
      categoryId: categoryIdNum,
      cover,
    });
    setBulkOpen(false);
    clearSelection();
  };

  const confirmBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (!serverId || ids.length === 0) return;
    await bulkDeleteMutation.mutateAsync({
      serverId,
      vodType: effectiveVodType as 'movie' | 'series',
      ids,
    });
    setBulkDeleteOpen(false);
    clearSelection();
  };

  const handleSearch = () => {
    // A busca agora é automática via debounce, mas mantemos para compatibilidade com Enter
    setPage(1);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner size="lg" />
      </div>
    );
  }

  // Mensagem se não houver servidor
  if (!serverId && Array.isArray(serversData) && serversData.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="p-8 text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-orange-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
            Nenhum Servidor Cadastrado
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Cadastre um servidor XUI para visualizar filmes e séries.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white">
            Filmes e Séries
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Filmes e Séries sincronizados
          </p>
        </div>
      </div>

      {selectedIds.size > 0 ? (
        <Card className="p-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Selecionados: <span className="font-semibold text-gray-900 dark:text-white">{selectedIds.size}</span>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={openBulkEdit} disabled={!serverId}>
                Editar em massa
              </Button>
              <Button variant="danger" onClick={() => setBulkDeleteOpen(true)} disabled={!serverId || bulkDeleteMutation.isPending}>
                Apagar em massa
              </Button>
              <Button variant="secondary" onClick={clearSelection}>
                Limpar seleção
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {/* Filtros */}
      <Card className="p-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                Servidor XUI
              </label>
              <Select
                value={serverId}
                onChange={(e) => {
                  setServerId(e.target.value);
                  setPage(1);
                  clearSelection();
                }}
              >
                <option value="">Selecione um servidor</option>
                {Array.isArray(serversData) && serversData.map((server: any) => (
                  <option key={server.id} value={server.id}>
                    {server.name || server.url}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                Buscar
              </label>
              <Input
                placeholder="Buscar por título..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant={vodType === '' ? 'primary' : 'outline'}
              onClick={() => {
                setVodType('');
                setPage(1);
                clearSelection();
                handleSearch();
              }}
            >
              Todos
            </Button>
            <Button
              variant={vodType === 'movie' ? 'primary' : 'outline'}
              onClick={() => {
                setVodType('movie');
                setPage(1);
                clearSelection();
                handleSearch();
              }}
            >
              <Film className="w-4 h-4 mr-2" />
              Filmes
            </Button>
            <Button
              variant={vodType === 'series' ? 'primary' : 'outline'}
              onClick={() => {
                setVodType('series');
                setPage(1);
                clearSelection();
                handleSearch();
              }}
            >
              <Tv className="w-4 h-4 mr-2" />
              Séries
            </Button>
            <Button onClick={handleSearch}>
              <Search className="w-4 h-4 mr-2" />
              Buscar
            </Button>
            <Button variant="secondary" onClick={selectAllPage} disabled={!serverId || items.length === 0}>
              Selecionar página
            </Button>
          </div>
        </div>
      </Card>

      {/* Info */}
      {serverId && (
        <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
          <span>
            {pagination.total > 0 ? (
              <>
                Mostrando {items.length} de {pagination.total.toLocaleString('pt-BR')} {vodType === 'movie' ? 'filmes' : vodType === 'series' ? 'séries' : 'itens'}
              </>
            ) : (
              'Nenhum item encontrado'
            )}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPage(1);
              handleSearch();
            }}
          >
            Atualizar
          </Button>
        </div>
      )}

      {/* Lista */}
      {items.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Nenhum item encontrado{serverId ? ' neste servidor' : ''}
          </p>
          {serverId && (
            <p className="text-sm text-gray-500 dark:text-gray-500">
              Verifique se você já importou filmes/séries ou ajuste os filtros de busca.
            </p>
          )}
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map((item: any) => (
              <Card key={item.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="pt-1">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(Number(item.id))}
                      onChange={() => toggleSelectOne(Number(item.id))}
                    />
                  </div>
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                    item.vodType === 'movie' 
                      ? 'bg-blue-100 dark:bg-blue-500/20' 
                      : 'bg-purple-100 dark:bg-purple-500/20'
                  }`}>
                    {item.vodType === 'movie' ? (
                      <Film className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <Tv className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                      {item.title || item.streamName}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                      {item.categoryName || 'Sem categoria'}
                    </p>
                    {item.year && (
                      <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                        {item.year}
                      </p>
                    )}
                    {item.hasMetadata && (
                      <span className="inline-block mt-2 px-2 py-1 text-xs bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 rounded">
                        Com metadados
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Paginação */}
          {pagination.totalPages > 1 && (
            <div className="flex justify-center items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Anterior
              </Button>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Página {pagination.page} de {pagination.totalPages}
              </span>
              <Button
                variant="outline"
                onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                disabled={page === pagination.totalPages}
              >
                Próxima
              </Button>
            </div>
          )}
        </>
      )}

      <Modal isOpen={bulkOpen} onClose={() => setBulkOpen(false)} title="Editar em Massa">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Categoria</label>
            <Select
              value={bulkForm.categoryId}
              onChange={(e) => setBulkForm({ ...bulkForm, categoryId: e.target.value })}
              disabled={!serverId}
            >
              <option value="">Não alterar</option>
              <option value="0">Sem categoria</option>
              {categories.map((c) => (
                <option key={c.id} value={String(c.id)}>{c.category_name}</option>
              ))}
            </Select>
          </div>
          <Input
            label={effectiveVodType === 'series' ? 'Cover URL' : 'Poster URL'}
            placeholder="http://..."
            value={bulkForm.cover}
            onChange={(e) => setBulkForm({ ...bulkForm, cover: e.target.value })}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setBulkOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={applyBulkEdit} disabled={bulkUpdateMutation.isPending}>
              Aplicar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={bulkDeleteOpen} onClose={() => setBulkDeleteOpen(false)} title="Apagar em Massa">
        <div className="space-y-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            Remover <span className="font-semibold text-gray-900 dark:text-white">{selectedIds.size}</span> item(ns).
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setBulkDeleteOpen(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirmBulkDelete} disabled={bulkDeleteMutation.isPending}>
              Apagar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
