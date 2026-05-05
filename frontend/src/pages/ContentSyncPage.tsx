/**
 * Página de Sincronização de Conteúdo
 * Gerencia fontes de conteúdo e sincronizações
 */

import { useState } from 'react';
import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, Modal, Badge, Spinner, Select } from '../components/ui';
import { api } from '../api/client';
import toast from 'react-hot-toast';
import { Plus, RefreshCw, Play, Eye, Trash2, Edit, CheckCircle, XCircle } from 'lucide-react';

interface ContentSource {
  id: string;
  serverId: string;
  name: string;
  description?: string;
  sourceType: 'XTREAM_API' | 'M3U_URL' | 'M3U_FILE';
  config: string;
  sourceCategory?: string;
  destCategory: string;
  contentType: string;
  isActive: boolean;
  autoSync: boolean;
  syncSchedule?: string;
  lastSync?: string;
  lastSyncStatus?: 'SUCCESS' | 'FAILED' | 'RUNNING';
  lastSyncMessage?: string;
  createdAt: string;
  updatedAt: string;
  server: {
    id: string;
    name: string;
    baseUrl: string;
  };
  syncLogs?: Array<{
    id: string;
    syncType: string;
    status: string;
    itemsAdded: number;
    itemsRemoved: number;
    itemsUpdated: number;
    bouquetsUpdated: number;
    message?: string;
    error?: string;
    createdAt: string;
    durationMs?: number;
  }>;
}

export function ContentSyncPage() {
  const queryClient = useQueryClient();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isLogsModalOpen, setIsLogsModalOpen] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState<ContentSource | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Buscar servidores para o select
  const { data: serversData } = useQuery({
    queryKey: ['servers'],
    queryFn: async () => {
      const res = await api.get('/servers');
      return res.data.data || [];
    },
  });

  // Buscar fontes de conteúdo
  const { data: sourcesData, isLoading } = useQuery({
    queryKey: ['content-sync'],
    queryFn: async () => {
      const res = await api.get('/content-sync');
      return res.data.data || [];
    },
    retry: 1,
  });

  // Criar fonte
  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await api.post('/content-sync', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content-sync'] });
      toast.success('Fonte de conteúdo criada com sucesso!');
      setIsCreateModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao criar fonte');
    },
  });

  // Atualizar fonte
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await api.put(`/content-sync/${id}`, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content-sync'] });
      toast.success('Fonte atualizada com sucesso!');
      setIsEditModalOpen(false);
      setSelectedSource(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao atualizar fonte');
    },
  });

  // Deletar fonte
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete(`/content-sync/${id}`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content-sync'] });
      toast.success('Fonte deletada com sucesso!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao deletar fonte');
    },
  });

  // Sincronizar
  const syncMutation = useMutation({
    mutationFn: async ({ id, dryRun }: { id: string; dryRun?: boolean }) => {
      const res = await api.post(`/content-sync/${id}/sync`, { dryRun });
      return res.data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['content-sync'] });
      if (variables.dryRun) {
        toast.success(`Dry-run concluído: ${data.data?.itemsAdded || 0} itens seriam adicionados`);
      } else {
        toast.success(`Sincronização concluída: ${data.data?.itemsAdded || 0} itens adicionados`);
      }
      setIsSyncModalOpen(false);
      setIsSyncing(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao sincronizar');
      setIsSyncing(false);
    },
  });

  const handleCreate = (formData: any) => {
    createMutation.mutate(formData);
  };

  const handleEdit = (formData: any) => {
    if (!selectedSource) return;
    updateMutation.mutate({ id: selectedSource.id, data: formData });
  };

  const handleDelete = (source: ContentSource) => {
    if (window.confirm(`Tem certeza que deseja deletar "${source.name}"?`)) {
      deleteMutation.mutate(source.id);
    }
  };

  const handleSync = (source: ContentSource, dryRun = false) => {
    setSelectedSource(source);
    setIsSyncModalOpen(true);
    setIsSyncing(true);
    syncMutation.mutate({ id: source.id, dryRun });
  };

  const handleViewLogs = async (source: ContentSource) => {
    try {
      const res = await api.get(`/content-sync/${source.id}`);
      setSelectedSource(res.data.data);
      setIsLogsModalOpen(true);
    } catch (error: any) {
      toast.error('Erro ao carregar logs');
    }
  };

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'SUCCESS':
        return <Badge variant="success">Sucesso</Badge>;
      case 'FAILED':
        return <Badge variant="danger">Falhou</Badge>;
      case 'RUNNING':
        return <Badge variant="warning">Executando</Badge>;
      default:
        return <Badge variant="secondary">Nunca executado</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner size="lg" />
      </div>
    );
  }

  const sources: ContentSource[] = sourcesData || [];

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white">
            Sincronização de Conteúdo
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Gerencie fontes de conteúdo e sincronize canais, VODs e séries
          </p>
        </div>
        <Button
          onClick={() => setIsCreateModalOpen(true)}
          className="flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Nova Fonte
        </Button>
      </div>

      {/* Lista de Fontes */}
      {sources.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Nenhuma fonte de conteúdo configurada
          </p>
          <Button onClick={() => setIsCreateModalOpen(true)}>
            Criar Primeira Fonte
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4">
          {sources.map((source) => (
            <Card key={source.id} className="p-4 lg:p-6">
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                      {source.name}
                    </h3>
                    {getStatusBadge(source.lastSyncStatus)}
                    {source.isActive ? (
                      <Badge variant="success">Ativa</Badge>
                    ) : (
                      <Badge variant="secondary">Inativa</Badge>
                    )}
                  </div>
                  {source.description && (
                    <p className="text-gray-600 dark:text-gray-400 text-sm mb-2">
                      {source.description}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-4 text-sm text-gray-500 dark:text-gray-400">
                    <span>Servidor: {source.server.name}</span>
                    <span>Tipo: {source.sourceType}</span>
                    {source.sourceCategory && (
                      <span>Origem: {source.sourceCategory}</span>
                    )}
                    <span>Destino: {source.destCategory}</span>
                    {source.lastSync && (
                      <span>
                        Última sync: {new Date(source.lastSync).toLocaleString('pt-BR')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSync(source, true)}
                    disabled={!source.isActive || isSyncing}
                  >
                    <Eye className="w-4 h-4 mr-1" />
                    Testar
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => handleSync(source, false)}
                    disabled={!source.isActive || isSyncing}
                  >
                    <Play className="w-4 h-4 mr-1" />
                    Sincronizar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleViewLogs(source)}
                  >
                    <RefreshCw className="w-4 h-4 mr-1" />
                    Logs
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedSource(source);
                      setIsEditModalOpen(true);
                    }}
                  >
                    <Edit className="w-4 h-4 mr-1" />
                    Editar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(source)}
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Deletar
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Modal de Criação */}
      <CreateSourceModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSave={handleCreate}
        servers={serversData || []}
      />

      {/* Modal de Edição */}
      {selectedSource && (
        <EditSourceModal
          isOpen={isEditModalOpen}
          onClose={() => {
            setIsEditModalOpen(false);
            setSelectedSource(null);
          }}
          onSave={handleEdit}
          source={selectedSource}
          servers={serversData || []}
        />
      )}

      {/* Modal de Logs */}
      {selectedSource && (
        <LogsModal
          isOpen={isLogsModalOpen}
          onClose={() => {
            setIsLogsModalOpen(false);
            setSelectedSource(null);
          }}
          source={selectedSource}
        />
      )}

      {/* Modal de Sincronização */}
      {selectedSource && (
        <SyncModal
          isOpen={isSyncModalOpen}
          onClose={() => {
            setIsSyncModalOpen(false);
            setSelectedSource(null);
            setIsSyncing(false);
          }}
          source={selectedSource}
          isSyncing={isSyncing}
          syncResult={syncMutation.data}
        />
      )}
    </div>
  );
}

// Modal de Criação
function CreateSourceModal({ isOpen, onClose, onSave, servers }: any) {
  const [formData, setFormData] = useState({
    serverId: '',
    name: '',
    description: '',
    sourceType: 'XTREAM_API' as const,
    config: JSON.stringify({ baseUrl: '', username: '', password: '' }, null, 2),
    sourceCategory: '',
    destCategory: '',
    contentType: 'LIVE',
    isActive: false,
    autoSync: false,
    syncSchedule: '',
    syncOptions: JSON.stringify({ addNew: true, updateExisting: false, removeOld: false, updateBouquets: false }, null, 2),
  });

  const [xtreamCategories, setXtreamCategories] = useState<Array<{category_id: string; category_name: string}>>([]);
  const [xuiCategories, setXuiCategories] = useState<Array<{id: number; name: string}>>([]);
  const [loadingXtreamCategories, setLoadingXtreamCategories] = useState(false);
  const [loadingXuiCategories, setLoadingXuiCategories] = useState(false);
  const [newSourceCategory, setNewSourceCategory] = useState('');
  const [newDestCategory, setNewDestCategory] = useState('');

  // Buscar categorias do XUI quando selecionar servidor
  const { refetch: fetchXuiCategories } = useQuery({
    queryKey: ['xui-categories', formData.serverId],
    queryFn: async () => {
      if (!formData.serverId) return [];
      const res = await api.get('/content-sync/test/xui/categories', {
        params: { serverId: formData.serverId },
      });
      return res.data.data || [];
    },
    enabled: false,
    onSuccess: (data) => {
      setXuiCategories(data);
    },
  });

  // Buscar categorias do Xtream quando preencher config
  const handleLoadXtreamCategories = async () => {
    try {
      const config = JSON.parse(formData.config);
      if (!config.baseUrl || !config.username || !config.password) {
        toast.error('Preencha URL, usuário e senha da API Xtream primeiro');
        return;
      }

      setLoadingXtreamCategories(true);
      const res = await api.get('/content-sync/test/xtream/categories', {
        params: {
          baseUrl: config.baseUrl,
          username: config.username,
          password: config.password,
        },
      });
      setXtreamCategories(res.data.data || []);
      toast.success(`${res.data.data?.length || 0} categorias carregadas`);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Erro ao carregar categorias Xtream');
      setXtreamCategories([]);
    } finally {
      setLoadingXtreamCategories(false);
    }
  };

  // Carregar categorias do XUI quando selecionar servidor
  const handleServerChange = async (serverId: string) => {
    setFormData({ ...formData, serverId });
    if (serverId) {
      setLoadingXuiCategories(true);
      try {
        const res = await api.get('/content-sync/test/xui/categories', {
          params: { serverId },
        });
        setXuiCategories(res.data.data || []);
      } catch (error: any) {
        toast.error(error.response?.data?.error || 'Erro ao carregar categorias do XUI');
        setXuiCategories([]);
      } finally {
        setLoadingXuiCategories(false);
      }
    } else {
      setXuiCategories([]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const config = JSON.parse(formData.config);
      const syncOptions = JSON.parse(formData.syncOptions);
      
      // Usar categoria nova se foi digitada, senão usar a selecionada
      const finalSourceCategory = newSourceCategory || formData.sourceCategory;
      const finalDestCategory = newDestCategory || formData.destCategory;

      if (!finalDestCategory) {
        toast.error('Categoria destino é obrigatória');
        return;
      }

      onSave({ 
        ...formData, 
        config, 
        syncOptions,
        sourceCategory: finalSourceCategory,
        destCategory: finalDestCategory,
      });
    } catch (error) {
      toast.error('JSON inválido no config ou syncOptions');
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nova Fonte de Conteúdo">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Servidor XUI *</label>
          <Select
            value={formData.serverId}
            onChange={(e) => setFormData({ ...formData, serverId: e.target.value })}
            required
          >
            <option value="">Selecione um servidor</option>
            {servers.map((s: any) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Nome *</label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
            placeholder="Ex: Jogos do Dia"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Descrição</label>
          <Input
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Descrição opcional"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Tipo de Fonte *</label>
          <Select
            value={formData.sourceType}
            onChange={(e) => setFormData({ ...formData, sourceType: e.target.value as any })}
            required
          >
            <option value="XTREAM_API">API Xtream</option>
            <option value="M3U_URL" disabled>M3U URL (em breve)</option>
            <option value="M3U_FILE" disabled>M3U Arquivo (em breve)</option>
          </Select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Configuração (JSON) *</label>
          <textarea
            className="w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700 font-mono text-sm"
            rows={6}
            value={formData.config}
            onChange={(e) => setFormData({ ...formData, config: e.target.value })}
            required
            placeholder='{"baseUrl": "http://...", "username": "...", "password": "..."}'
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleLoadXtreamCategories}
            disabled={loadingXtreamCategories}
            className="mt-2"
          >
            {loadingXtreamCategories ? 'Carregando...' : 'Carregar Categorias Xtream'}
          </Button>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Categoria Origem (Xtream)</label>
          <Select
            value={formData.sourceCategory}
            onChange={(e) => setFormData({ ...formData, sourceCategory: e.target.value })}
          >
            <option value="">Selecione ou digite abaixo</option>
            {xtreamCategories.map((cat) => (
              <option key={cat.category_id} value={cat.category_name}>
                {cat.category_name}
              </option>
            ))}
          </Select>
          <Input
            value={newSourceCategory}
            onChange={(e) => setNewSourceCategory(e.target.value)}
            placeholder="Ou digite o nome da categoria para criar"
            className="mt-2"
          />
          <p className="text-xs text-gray-500 mt-1">
            Selecione uma categoria existente ou digite para criar nova
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Categoria Destino (XUI) *</label>
          <Select
            value={formData.destCategory}
            onChange={(e) => setFormData({ ...formData, destCategory: e.target.value })}
            required
          >
            <option value="">Selecione ou digite abaixo</option>
            {xuiCategories.map((cat) => (
              <option key={cat.id} value={cat.name}>
                {cat.name}
              </option>
            ))}
          </Select>
          <Input
            value={newDestCategory}
            onChange={(e) => setNewDestCategory(e.target.value)}
            placeholder="Ou digite o nome da categoria para criar"
            className="mt-2"
            required={!formData.destCategory}
          />
          <p className="text-xs text-gray-500 mt-1">
            Selecione uma categoria existente ou digite para criar nova
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="isActive"
            checked={formData.isActive}
            onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
          />
          <label htmlFor="isActive" className="text-sm">Ativar fonte (pode sincronizar)</label>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit">Criar</Button>
        </div>
      </form>
    </Modal>
  );
}

// Modal de Edição
function EditSourceModal({ isOpen, onClose, onSave, source, servers }: any) {
  const [formData, setFormData] = useState({
    name: source.name || '',
    description: source.description || '',
    config: typeof source.config === 'string' ? source.config : JSON.stringify(source.config || {}, null, 2),
    sourceCategory: source.sourceCategory || '',
    destCategory: source.destCategory || '',
    contentType: source.contentType || 'LIVE',
    isActive: source.isActive || false,
    autoSync: source.autoSync || false,
    syncSchedule: source.syncSchedule || '',
    syncOptions: typeof source.syncOptions === 'string' ? source.syncOptions : JSON.stringify(source.syncOptions || {}, null, 2),
  });

  const [xtreamCategories, setXtreamCategories] = useState<Array<{category_id: string; category_name: string}>>([]);
  const [xuiCategories, setXuiCategories] = useState<Array<{id: number; name: string}>>([]);
  const [loadingXtreamCategories, setLoadingXtreamCategories] = useState(false);
  const [loadingXuiCategories, setLoadingXuiCategories] = useState(false);
  const [newSourceCategory, setNewSourceCategory] = useState('');
  const [newDestCategory, setNewDestCategory] = useState('');

  // Buscar categorias do Xtream quando preencher config
  const handleLoadXtreamCategories = async () => {
    try {
      const config = JSON.parse(formData.config);
      if (!config.baseUrl || !config.username || !config.password) {
        toast.error('Preencha URL, usuário e senha da API Xtream primeiro');
        return;
      }

      setLoadingXtreamCategories(true);
      const res = await api.get('/content-sync/test/xtream/categories', {
        params: {
          baseUrl: config.baseUrl,
          username: config.username,
          password: config.password,
        },
      });
      setXtreamCategories(res.data.data || []);
      toast.success(`${res.data.data?.length || 0} categorias carregadas`);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Erro ao carregar categorias Xtream');
      setXtreamCategories([]);
    } finally {
      setLoadingXtreamCategories(false);
    }
  };

  // Carregar categorias quando abrir modal
  React.useEffect(() => {
    if (isOpen && source.serverId) {
      setLoadingXuiCategories(true);
      api.get('/content-sync/test/xui/categories', {
        params: { serverId: source.serverId },
      })
        .then((res) => {
          setXuiCategories(res.data.data || []);
        })
        .catch((error: any) => {
          toast.error('Erro ao carregar categorias do XUI');
        })
        .finally(() => {
          setLoadingXuiCategories(false);
        });
    }
  }, [isOpen, source.serverId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const config = JSON.parse(formData.config);
      const syncOptions = JSON.parse(formData.syncOptions);
      
      // Usar categoria nova se foi digitada, senão usar a selecionada
      const finalSourceCategory = newSourceCategory || formData.sourceCategory;
      const finalDestCategory = newDestCategory || formData.destCategory;

      if (!finalDestCategory) {
        toast.error('Categoria destino é obrigatória');
        return;
      }

      onSave({ 
        ...formData, 
        config, 
        syncOptions,
        sourceCategory: finalSourceCategory,
        destCategory: finalDestCategory,
      });
    } catch (error) {
      toast.error('JSON inválido no config ou syncOptions');
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Editar Fonte de Conteúdo">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Nome *</label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Descrição</label>
          <Input
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Configuração (JSON) *</label>
          <textarea
            className="w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700 font-mono text-sm"
            rows={6}
            value={formData.config}
            onChange={(e) => setFormData({ ...formData, config: e.target.value })}
            required
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleLoadXtreamCategories}
            disabled={loadingXtreamCategories}
            className="mt-2"
          >
            {loadingXtreamCategories ? 'Carregando...' : 'Carregar Categorias Xtream'}
          </Button>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Categoria Origem (Xtream)</label>
          <Select
            value={formData.sourceCategory}
            onChange={(e) => setFormData({ ...formData, sourceCategory: e.target.value })}
          >
            <option value="">Selecione ou digite abaixo</option>
            {xtreamCategories.map((cat) => (
              <option key={cat.category_id} value={cat.category_name}>
                {cat.category_name}
              </option>
            ))}
          </Select>
          <Input
            value={newSourceCategory}
            onChange={(e) => setNewSourceCategory(e.target.value)}
            placeholder="Ou digite o nome da categoria para criar"
            className="mt-2"
          />
          <p className="text-xs text-gray-500 mt-1">
            Selecione uma categoria existente ou digite para criar nova
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Categoria Destino (XUI) *</label>
          <Select
            value={formData.destCategory}
            onChange={(e) => setFormData({ ...formData, destCategory: e.target.value })}
            required
          >
            <option value="">Selecione ou digite abaixo</option>
            {xuiCategories.map((cat) => (
              <option key={cat.id} value={cat.name}>
                {cat.name}
              </option>
            ))}
          </Select>
          <Input
            value={newDestCategory}
            onChange={(e) => setNewDestCategory(e.target.value)}
            placeholder="Ou digite o nome da categoria para criar"
            className="mt-2"
            required={!formData.destCategory}
          />
          <p className="text-xs text-gray-500 mt-1">
            Selecione uma categoria existente ou digite para criar nova
          </p>
          {loadingXuiCategories && (
            <p className="text-xs text-gray-500 mt-1">Carregando categorias do XUI...</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="editIsActive"
            checked={formData.isActive}
            onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
          />
          <label htmlFor="editIsActive" className="text-sm">Ativar fonte</label>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit">Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}

// Modal de Logs
function LogsModal({ isOpen, onClose, source }: any) {
  const logs = source.syncLogs || [];

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Logs - ${source.name}`}>
      <div className="space-y-4 max-h-96 overflow-y-auto">
        {logs.length === 0 ? (
          <p className="text-gray-600 dark:text-gray-400 text-center py-8">
            Nenhum log disponível
          </p>
        ) : (
          logs.map((log: any) => (
            <div key={log.id} className="border rounded-lg p-4 dark:border-gray-700">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    {log.status === 'SUCCESS' && <CheckCircle className="w-4 h-4 text-green-500" />}
                    {log.status === 'FAILED' && <XCircle className="w-4 h-4 text-red-500" />}
                    <span className="font-medium">{log.syncType}</span>
                    <Badge variant={log.status === 'SUCCESS' ? 'success' : 'danger'}>
                      {log.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {new Date(log.createdAt).toLocaleString('pt-BR')}
                  </p>
                </div>
                {log.durationMs && (
                  <span className="text-sm text-gray-500">
                    {log.durationMs}ms
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm mb-2">
                <div>Adicionados: {log.itemsAdded}</div>
                <div>Removidos: {log.itemsRemoved}</div>
                <div>Atualizados: {log.itemsUpdated}</div>
                <div>Bouquets: {log.bouquetsUpdated}</div>
              </div>
              {log.message && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">{log.message}</p>
              )}
              {log.error && (
                <p className="text-sm text-red-600 dark:text-red-400 mt-2">{log.error}</p>
              )}
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}

// Modal de Sincronização
function SyncModal({ isOpen, onClose, source, isSyncing, syncResult }: any) {
  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Sincronizando - ${source.name}`}>
      <div className="space-y-4">
        {isSyncing ? (
          <div className="text-center py-8">
            <Spinner size="lg" className="mx-auto mb-4" />
            <p className="text-gray-600 dark:text-gray-400">
              Sincronizando conteúdo...
            </p>
          </div>
        ) : syncResult ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {syncResult.data?.success ? (
                <CheckCircle className="w-5 h-5 text-green-500" />
              ) : (
                <XCircle className="w-5 h-5 text-red-500" />
              )}
              <span className="font-medium">
                {syncResult.data?.success ? 'Sincronização concluída' : 'Erro na sincronização'}
              </span>
            </div>
            {syncResult.data && (
              <div className="grid grid-cols-2 gap-2 text-sm mt-4">
                <div>Itens adicionados: {syncResult.data.itemsAdded || 0}</div>
                <div>Itens removidos: {syncResult.data.itemsRemoved || 0}</div>
                <div>Itens atualizados: {syncResult.data.itemsUpdated || 0}</div>
                <div>Bouquets atualizados: {syncResult.data.bouquetsUpdated || 0}</div>
              </div>
            )}
            {syncResult.data?.message && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                {syncResult.data.message}
              </p>
            )}
            {syncResult.data?.error && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                {syncResult.data.error}
              </p>
            )}
          </div>
        ) : null}
        <div className="flex justify-end pt-4">
          <Button onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </Modal>
  );
}

export default ContentSyncPage;

