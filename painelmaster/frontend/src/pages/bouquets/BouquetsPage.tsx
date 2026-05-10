import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Badge, Spinner, Select } from '../../components/ui';
import { api } from '../../api/client';
import toast from 'react-hot-toast';

interface Bouquet {
  id: string;
  serverId: string;
  externalId: string;
  name: string;
  packagesCount?: number;
  server?: {
    id: string;
    name: string;
  };
}

interface Server {
  id: string;
  name: string;
}

export function BouquetsPage() {
  const queryClient = useQueryClient();
  const [filterServerId, setFilterServerId] = useState('');
  const [orderServerId, setOrderServerId] = useState('');
  const [orderBouquetId, setOrderBouquetId] = useState('');
  const [orderType, setOrderType] = useState<'live' | 'movie' | 'series'>('live');
  const [orderedItems, setOrderedItems] = useState<Array<{ id: number; name: string }>>([]);

  // Busca servidores
  const { data: serversData } = useQuery({
    queryKey: ['xui-servers'],
    queryFn: async () => {
      const res = await api.get('/settings/xui');
      return res.data.data as Server[];
    },
  });

  // Busca bouquets
  const { data: bouquetsData, isLoading } = useQuery({
    queryKey: ['bouquets', filterServerId],
    queryFn: async () => {
      const params = filterServerId ? `?serverId=${filterServerId}` : '';
      const res = await api.get(`/bouquets${params}`);
      return res.data.data as Bouquet[];
    },
  });

  const bouquetsForOrder = useMemo(() => {
    if (!Array.isArray(bouquetsData) || !orderServerId) return [];
    return bouquetsData.filter((b) => b.serverId === orderServerId);
  }, [bouquetsData, orderServerId]);

  // Sincronizar
  const syncMutation = useMutation({
    mutationFn: async (serverId: string) => {
      const res = await api.post(`/bouquets/sync/${serverId}`);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['bouquets'] });
      toast.success(`${data.count} bouquets sincronizados!`);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro na sincronização');
    },
  });

  const itemsQuery = useQuery({
    queryKey: ['bouquet-items', orderServerId, orderBouquetId, orderType],
    queryFn: async () => {
      const res = await api.get(`/bouquets/xui/${orderServerId}/${orderBouquetId}/items`, {
        params: { type: orderType },
      });
      return res.data?.data?.items as Array<{ id: number; name: string }>;
    },
    enabled: !!orderServerId && !!orderBouquetId,
  });

  useEffect(() => {
    if (Array.isArray(itemsQuery.data) && orderedItems.length === 0) {
      setOrderedItems(itemsQuery.data);
    }
  }, [itemsQuery.data, orderedItems.length]);

  const saveOrderMutation = useMutation({
    mutationFn: async () => {
      const orderedIds = orderedItems.map((i) => i.id);
      const res = await api.put(`/bouquets/xui/${orderServerId}/${orderBouquetId}/order`, {
        type: orderType,
        orderedIds,
      });
      return res.data;
    },
    onSuccess: () => {
      toast.success('Ordem atualizada!');
      queryClient.invalidateQueries({ queryKey: ['bouquet-items', orderServerId, orderBouquetId, orderType] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || error.response?.data?.message || 'Erro ao atualizar ordem');
    },
  });

  const moveItem = (from: number, to: number) => {
    setOrderedItems((prev) => {
      if (from < 0 || from >= prev.length) return prev;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const resetOrderFromServer = () => {
    if (Array.isArray(itemsQuery.data)) {
      setOrderedItems(itemsQuery.data);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  // Agrupa por servidor
  const groupedBouquets = bouquetsData?.reduce((acc, b) => {
    const serverName = b.server?.name || 'Sem servidor';
    if (!acc[serverName]) acc[serverName] = [];
    acc[serverName].push(b);
    return acc;
  }, {} as Record<string, Bouquet[]>);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">🏷️ Bouquets</h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-1">Grupos de canais sincronizados do XUI</p>
        </div>
        <div className="flex gap-2">
          {serversData && serversData.length > 0 && (
            <Select
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  syncMutation.mutate(e.target.value);
                }
              }}
              className="w-48"
            >
              <option value="">🔄 Sincronizar...</option>
              {serversData.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </div>
      </div>

      <div className="h-1 w-full bg-gradient-to-r from-sky-500 to-cyan-600 rounded-full opacity-80" />

      {/* Alerta informativo */}
      <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg p-4 flex items-start gap-3">
        <span className="text-blue-600 dark:text-blue-400 text-xl">ℹ️</span>
        <div className="text-sm">
          <p className="text-blue-700 dark:text-blue-300 font-medium">Informação</p>
          <p className="text-blue-600 dark:text-blue-200/80">
            Aqui você pode sincronizar a lista local de bouquets e também ordenar a ordem interna dos itens dentro de cada bouquet.
          </p>
        </div>
      </div>

      {/* Filtro por servidor */}
      <div className="flex gap-4">
        <Select
          value={filterServerId}
          onChange={(e) => setFilterServerId(e.target.value)}
          className="w-48"
        >
          <option value="">Todos os servidores</option>
          {serversData?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>

      <Card className="p-5 relative overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-sky-500 to-cyan-600 rounded-full mb-4 opacity-80" />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">🧩 Ordenar itens do Bouquet</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Altera a ordem interna dos itens dentro do bouquet no XUI</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={resetOrderFromServer}
              disabled={!itemsQuery.data || saveOrderMutation.isPending}
            >
              Recarregar
            </Button>
            <Button
              onClick={() => saveOrderMutation.mutate()}
              loading={saveOrderMutation.isPending}
              disabled={!orderServerId || !orderBouquetId || orderedItems.length === 0}
            >
              Salvar ordem
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Servidor</label>
            <Select
              value={orderServerId}
              onChange={(e) => {
                setOrderServerId(e.target.value);
                setOrderBouquetId('');
                setOrderedItems([]);
              }}
            >
              <option value="">Selecione...</option>
              {serversData?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Bouquet</label>
            <Select
              value={orderBouquetId}
              onChange={(e) => {
                setOrderBouquetId(e.target.value);
                setOrderedItems([]);
              }}
              disabled={!orderServerId}
            >
              <option value="">Selecione...</option>
              {bouquetsForOrder.map((b) => (
                <option key={b.id} value={b.externalId}>
                  {b.name} (ID {b.externalId})
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Tipo</label>
            <Select
              value={orderType}
              onChange={(e) => {
                setOrderType(e.target.value as any);
                setOrderedItems([]);
              }}
              disabled={!orderServerId || !orderBouquetId}
            >
              <option value="live">Streams (Live)</option>
              <option value="movie">Filmes</option>
              <option value="series">Séries</option>
            </Select>
          </div>
        </div>

        <div className="mt-4">
          {itemsQuery.isLoading && (
            <div className="flex items-center justify-center py-8">
              <Spinner size="lg" />
            </div>
          )}

          {itemsQuery.isError && (
            <div className="text-sm text-red-600 dark:text-red-400 py-2">
              Erro ao carregar itens do bouquet.
            </div>
          )}

          {itemsQuery.data && orderedItems.length === 0 && (
            <div className="flex gap-2 items-center py-2">
              <Button variant="outline" onClick={resetOrderFromServer}>
                Carregar itens
              </Button>
              <span className="text-sm text-zinc-500">({itemsQuery.data.length} itens)</span>
            </div>
          )}

          {orderedItems.length > 0 && (
            <div className="max-h-[420px] overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              {orderedItems.map((it, idx) => (
                <div key={it.id} className="flex items-center gap-3 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 last:border-b-0">
                  <div className="w-10 text-xs text-zinc-500">{idx + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-zinc-900 dark:text-white truncate">{it.name || `ID ${it.id}`}</div>
                    <div className="text-xs text-zinc-500">ID: {it.id}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => moveItem(idx, idx - 1)}
                      disabled={idx === 0 || saveOrderMutation.isPending}
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => moveItem(idx, idx + 1)}
                      disabled={idx === orderedItems.length - 1 || saveOrderMutation.isPending}
                    >
                      ↓
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Grid de Bouquets */}
      {groupedBouquets && Object.keys(groupedBouquets).length > 0 ? (
        Object.entries(groupedBouquets).map(([serverName, bouquets]) => (
          <div key={serverName} className="space-y-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">{serverName}</h2>
              <Badge variant="default">{bouquets.length} bouquets</Badge>
            </div>

            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {bouquets.map((bouquet) => (
                <Card
                  key={bouquet.id}
                  className="p-4 relative overflow-hidden hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors"
                >
                  <div className="h-1 w-full bg-gradient-to-r from-sky-500 to-cyan-600 rounded-full mb-3 opacity-80" />
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-zinc-900 dark:text-white font-medium">{bouquet.name}</h3>
                      <p className="text-xs text-zinc-500">ID: {bouquet.externalId}</p>
                    </div>
                    {bouquet.packagesCount !== undefined && bouquet.packagesCount > 0 && (
                      <Badge variant="success" className="text-xs">
                        {bouquet.packagesCount} pacotes
                      </Badge>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))
      ) : (
        <Card className="p-8 text-center relative overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-sky-500 to-cyan-600 rounded-full mb-4 opacity-80" />
          <div className="text-4xl mb-4">📭</div>
          <p className="text-zinc-600 dark:text-zinc-400mb-2">Nenhum bouquet encontrado</p>
          <p className="text-sm text-zinc-500 mb-4">
            Sincronize os bouquets de um servidor XUI para vê-los aqui
          </p>
          {serversData && serversData.length > 0 && (
            <Button
              onClick={() => syncMutation.mutate(serversData[0].id)}
              loading={syncMutation.isPending}
            >
              🔄 Sincronizar de {serversData[0].name}
            </Button>
          )}
        </Card>
      )}
    </div>
  );
}

export default BouquetsPage;
