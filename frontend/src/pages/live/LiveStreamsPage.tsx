import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Card, Button, Input, Select, Modal } from '../../components/ui';
import { api } from '../../api/client';
import { TvMinimalPlay, Edit2, ToggleLeft, ToggleRight, RefreshCw } from 'lucide-react';

interface XuiServer {
  id: string;
  name: string;
  baseUrl: string;
}

interface LiveCategory {
  id: number;
  category_name: string;
}

interface LiveStreamItem {
  id: number;
  name: string;
  icon: string;
  categoryId: number | null;
  categoryName: string | null;
  sourceUrl: string;
  enabled: boolean;
}

interface LiveStreamsResponse {
  page: number;
  perPage: number;
  total: number;
  items: LiveStreamItem[];
}

export function LiveStreamsPage() {
  const queryClient = useQueryClient();
  const [serverId, setServerId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<LiveStreamItem | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    sourceUrl: '',
    icon: '',
    categoryId: '',
    enabled: true,
  });

  const { data: serversData, isLoading: isLoadingServers } = useQuery({
    queryKey: ['xui-servers'],
    queryFn: async () => {
      const res = await api.get('/servers');
      return res.data;
    },
  });

  const servers: XuiServer[] = Array.isArray(serversData) ? serversData : [];

  const { data: categoriesData } = useQuery({
    queryKey: ['live-categories', serverId],
    queryFn: async () => {
      const res = await api.get(`/live/categories?serverId=${serverId}`);
      return res.data;
    },
    enabled: !!serverId,
  });

  const categories: LiveCategory[] = Array.isArray(categoriesData) ? categoriesData : [];

  const streamsQueryKey = useMemo(
    () => ['live-streams', serverId, page, keyword, categoryId],
    [serverId, page, keyword, categoryId]
  );

  const { data: streamsData, isLoading: isLoadingStreams, refetch } = useQuery({
    queryKey: streamsQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        serverId,
        page: String(page),
        perPage: '50',
        keyword,
      });
      if (categoryId) params.set('categoryId', categoryId);
      const res = await api.get<LiveStreamsResponse>(`/live/streams?${params.toString()}`);
      return res.data;
    },
    enabled: !!serverId,
    keepPreviousData: true,
  });

  const streams: LiveStreamItem[] = streamsData?.items || [];
  const total = streamsData?.total || 0;
  const perPage = streamsData?.perPage || 50;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const updateMutation = useMutation({
    mutationFn: async (payload: {
      id: number;
      name?: string;
      sourceUrl?: string;
      icon?: string;
      categoryId?: number;
      enabled?: boolean;
    }) => {
      const params = new URLSearchParams({ serverId });
      const res = await api.put(`/live/streams/${payload.id}?${params.toString()}`, {
        name: payload.name,
        sourceUrl: payload.sourceUrl,
        icon: payload.icon,
        categoryId: payload.categoryId,
        enabled: payload.enabled,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['live-streams'] });
      toast.success('Canal atualizado');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Erro ao atualizar canal');
    },
  });

  const openEdit = (item: LiveStreamItem) => {
    setEditing(item);
    setEditForm({
      name: item.name || '',
      sourceUrl: item.sourceUrl || '',
      icon: item.icon || '',
      categoryId: item.categoryId !== null && item.categoryId !== undefined ? String(item.categoryId) : '',
      enabled: !!item.enabled,
    });
    setEditOpen(true);
  };

  const closeEdit = () => {
    setEditOpen(false);
    setEditing(null);
  };

  const applyEdit = async () => {
    if (!editing) return;
    const catIdNum = editForm.categoryId ? parseInt(editForm.categoryId, 10) : undefined;
    await updateMutation.mutateAsync({
      id: editing.id,
      name: editForm.name,
      sourceUrl: editForm.sourceUrl,
      icon: editForm.icon,
      categoryId: catIdNum,
      enabled: editForm.enabled,
    });
    closeEdit();
  };

  const toggleEnabled = async (item: LiveStreamItem) => {
    await updateMutation.mutateAsync({
      id: item.id,
      enabled: !item.enabled,
    });
  };

  return (
    <div className="container mx-auto py-6 px-4 lg:px-6 space-y-6">
      <div className="flex items-center gap-3">
        <TvMinimalPlay className="h-8 w-8 text-cyan-500" />
        <div>
          <h1 className="text-3xl font-bold">Streams (Live)</h1>
          <p className="text-zinc-600 dark:text-zinc-400">Listar e editar canais LIVE no Xtream UI</p>
        </div>
      </div>

      <Card className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium mb-2">Servidor</label>
            <Select value={serverId} onChange={(e) => { setServerId(e.target.value); setPage(1); }}>
              <option value="">{isLoadingServers ? 'Carregando...' : 'Selecione'}</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Buscar</label>
            <Input
              placeholder="Nome do canal"
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
              disabled={!serverId}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Categoria</label>
            <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }} disabled={!serverId}>
              <option value="">Todas</option>
              {categories.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.category_name}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              variant="secondary"
              onClick={() => refetch()}
              disabled={!serverId || isLoadingStreams}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Atualizar
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        {!serverId ? (
          <div className="text-sm text-zinc-500">Selecione um servidor para listar os canais.</div>
        ) : isLoadingStreams ? (
          <div className="text-sm text-zinc-500">Carregando canais...</div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                Total: <span className="font-semibold text-zinc-900 dark:text-zinc-100">{total}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  Anterior
                </Button>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  Página {page} / {totalPages}
                </div>
                <Button
                  variant="secondary"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Próxima
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-600 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-2 pr-3">ID</th>
                    <th className="py-2 pr-3">Nome</th>
                    <th className="py-2 pr-3">Categoria</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Source</th>
                    <th className="py-2 pr-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {streams.map((s) => (
                    <tr key={s.id} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className="py-2 pr-3 text-zinc-500">{s.id}</td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          {s.icon ? (
                            <img src={s.icon} alt="" className="w-6 h-6 rounded object-cover" onError={(e) => { (e.currentTarget as any).style.display = 'none'; }} />
                          ) : null}
                          <div className="font-medium text-zinc-900 dark:text-zinc-100">{s.name}</div>
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-400">{s.categoryName || '-'}</td>
                      <td className="py-2 pr-3">
                        <span className={s.enabled ? 'text-green-600' : 'text-zinc-500'}>
                          {s.enabled ? 'Ativo' : 'Desativado'}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-400">
                        {s.sourceUrl ? (
                          <span title={s.sourceUrl}>{s.sourceUrl.length > 45 ? s.sourceUrl.slice(0, 45) + '…' : s.sourceUrl}</span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex gap-2 justify-end">
                          <Button variant="secondary" onClick={() => openEdit(s)} className="gap-2">
                            <Edit2 className="h-4 w-4" />
                            Editar
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => toggleEnabled(s)}
                            disabled={updateMutation.isPending}
                            className="gap-2"
                          >
                            {s.enabled ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                            {s.enabled ? 'Desativar' : 'Ativar'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {streams.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-zinc-500">
                        Nenhum canal encontrado
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <Modal isOpen={editOpen} onClose={closeEdit} title="Editar Canal">
        <div className="space-y-4">
          <Input
            label="Nome"
            value={editForm.name}
            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
          />
          <Input
            label="Source URL"
            placeholder="http://..."
            value={editForm.sourceUrl}
            onChange={(e) => setEditForm({ ...editForm, sourceUrl: e.target.value })}
          />
          <Input
            label="Icon URL"
            placeholder="http://..."
            value={editForm.icon}
            onChange={(e) => setEditForm({ ...editForm, icon: e.target.value })}
          />
          <div>
            <label className="block text-sm font-medium mb-2">Categoria</label>
            <Select value={editForm.categoryId} onChange={(e) => setEditForm({ ...editForm, categoryId: e.target.value })}>
              <option value="">Sem categoria</option>
              {categories.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.category_name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editForm.enabled}
                onChange={(e) => setEditForm({ ...editForm, enabled: e.target.checked })}
              />
              Ativo
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={closeEdit}>
              Cancelar
            </Button>
            <Button onClick={applyEdit} disabled={updateMutation.isPending}>
              Salvar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

