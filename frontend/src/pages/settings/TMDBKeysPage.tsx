/**
 * Página de Gerenciamento de Chaves API TMDB
 * Permite cadastrar, editar, deletar e visualizar estatísticas de chaves TMDB
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, Modal, Spinner } from '../../components/ui';
import { api } from '../../api/client';
import toast from 'react-hot-toast';
import { Key, Plus, Edit, Trash2, RefreshCw, Activity, AlertCircle, CheckCircle2 } from 'lucide-react';

interface TMDBKey {
  id: string;
  keyName: string;
  isActive: boolean;
  priority: number;
  requestsToday: number;
  requestsLimit: number;
  lastUsedAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  createdAt: string;
  updatedAt: string;
}

interface TMDBKeyFormData {
  keyName: string;
  apiKey: string;
  priority: number;
  requestsLimit: number;
  isActive: boolean;
}

export function TMDBKeysPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingKey, setEditingKey] = useState<TMDBKey | null>(null);
  const [formData, setFormData] = useState<TMDBKeyFormData>({
    keyName: '',
    apiKey: '',
    priority: 0,
    requestsLimit: 40,
    isActive: true,
  });

  // Buscar chaves
  const { data: keys, isLoading } = useQuery({
    queryKey: ['tmdb-keys'],
    queryFn: async () => {
      const res = await api.get('/tmdb/keys');
      return res.data.data as TMDBKey[];
    },
  });

  // Criar chave
  const createMutation = useMutation({
    mutationFn: async (data: TMDBKeyFormData) => {
      const res = await api.post('/tmdb/keys', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tmdb-keys'] });
      toast.success('Chave criada com sucesso!');
      setShowModal(false);
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao criar chave');
    },
  });

  // Atualizar chave
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<TMDBKeyFormData> }) => {
      const res = await api.put(`/tmdb/keys/${id}`, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tmdb-keys'] });
      toast.success('Chave atualizada com sucesso!');
      setShowModal(false);
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao atualizar chave');
    },
  });

  // Deletar chave
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete(`/tmdb/keys/${id}`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tmdb-keys'] });
      toast.success('Chave removida com sucesso!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao remover chave');
    },
  });

  // Resetar contador
  const resetCounterMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/tmdb/keys/${id}/reset-counter`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tmdb-keys'] });
      toast.success('Contador resetado com sucesso!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao resetar contador');
    },
  });

  const resetForm = () => {
    setFormData({
      keyName: '',
      apiKey: '',
      priority: 0,
      requestsLimit: 40,
      isActive: true,
    });
    setEditingKey(null);
  };

  const handleOpenModal = (key?: TMDBKey) => {
    if (key) {
      setEditingKey(key);
      setFormData({
        keyName: key.keyName,
        apiKey: '', // Não preencher por segurança
        priority: key.priority,
        requestsLimit: key.requestsLimit,
        isActive: key.isActive,
      });
    } else {
      resetForm();
    }
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    resetForm();
  };

  const handleSubmit = () => {
    if (!formData.keyName.trim()) {
      toast.error('Nome da chave é obrigatório');
      return;
    }

    if (!editingKey && !formData.apiKey.trim()) {
      toast.error('Chave API é obrigatória');
      return;
    }

    // Validar formato da chave (32 caracteres hexadecimais)
    if (!editingKey && !/^[a-f0-9]{32}$/i.test(formData.apiKey)) {
      toast.error('Formato de chave API inválido (deve ter 32 caracteres hexadecimais)');
      return;
    }

    if (editingKey) {
      updateMutation.mutate({ id: editingKey.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (key: TMDBKey) => {
    if (confirm(`Tem certeza que deseja remover a chave "${key.keyName}"?`)) {
      deleteMutation.mutate(key.id);
    }
  };

  const handleResetCounter = (key: TMDBKey) => {
    if (confirm(`Deseja resetar o contador diário da chave "${key.keyName}"?`)) {
      resetCounterMutation.mutate(key.id);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Nunca';
    return new Date(dateString).toLocaleString('pt-BR');
  };

  const getUsagePercentage = (key: TMDBKey) => {
    if (key.requestsLimit === 0) return 0;
    return Math.round((key.requestsToday / key.requestsLimit) * 100);
  };

  const getStatusColor = (key: TMDBKey) => {
    if (!key.isActive) return 'text-zinc-500';
    const usage = getUsagePercentage(key);
    if (usage >= 100) return 'text-red-600 dark:text-red-400';
    if (usage >= 80) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-green-600 dark:text-green-400';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-zinc-900 dark:text-white flex items-center gap-2">
            <Key className="w-6 h-6" />
            Chaves API TMDB
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 text-sm lg:text-base mt-1">
            Gerencie suas chaves API do The Movie Database
          </p>
        </div>
        <Button onClick={() => handleOpenModal()} className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Nova Chave
        </Button>
      </div>

      {/* Estatísticas Gerais */}
      {keys && keys.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-4">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">Total de Chaves</div>
            <div className="text-2xl font-bold text-zinc-900 dark:text-white mt-1">{keys.length}</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">Chaves Ativas</div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">
              {keys.filter(k => k.isActive).length}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">Requisições Hoje</div>
            <div className="text-2xl font-bold text-zinc-900 dark:text-white mt-1">
              {keys.reduce((sum, k) => sum + k.requestsToday, 0)}
            </div>
          </Card>
        </div>
      )}

      {/* Lista de Chaves */}
      {keys && keys.length > 0 ? (
        <div className="space-y-4">
          {keys.map((key) => (
            <Card key={key.id} className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">{key.keyName}</h3>
                    {key.isActive ? (
                      <span className="px-2 py-1 text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
                        Ativa
                      </span>
                    ) : (
                      <span className="px-2 py-1 text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded">
                        Inativa
                      </span>
                    )}
                    {key.lastErrorAt && (
                      <span className="px-2 py-1 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        Erro recente
                      </span>
                    )}
                  </div>

                  {/* Estatísticas */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                    <div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-400">Prioridade</div>
                      <div className="text-sm font-semibold text-zinc-900 dark:text-white">{key.priority}</div>
                    </div>
                    <div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-400">Uso Hoje</div>
                      <div className={`text-sm font-semibold ${getStatusColor(key)}`}>
                        {key.requestsToday} / {key.requestsLimit} ({getUsagePercentage(key)}%)
                      </div>
                      <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-2 mt-1">
                        <div
                          className={`h-2 rounded-full ${
                            getUsagePercentage(key) >= 100
                              ? 'bg-red-600'
                              : getUsagePercentage(key) >= 80
                              ? 'bg-yellow-600'
                              : 'bg-green-600'
                          }`}
                          style={{ width: `${Math.min(getUsagePercentage(key), 100)}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-400">Total Requisições</div>
                      <div className="text-sm font-semibold text-zinc-900 dark:text-white">{key.totalRequests}</div>
                    </div>
                    <div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-400">Taxa de Sucesso</div>
                      <div className="text-sm font-semibold text-zinc-900 dark:text-white">
                        {key.totalRequests > 0
                          ? Math.round((key.successCount / key.totalRequests) * 100)
                          : 0}
                        %
                      </div>
                    </div>
                  </div>

                  {/* Última utilização */}
                  <div className="mt-4 text-xs text-zinc-600 dark:text-zinc-400">
                    <div>Última utilização: {formatDate(key.lastUsedAt)}</div>
                    {key.lastErrorAt && (
                      <div className="text-red-600 dark:text-red-400 mt-1">
                        Último erro: {formatDate(key.lastErrorAt)}
                        {key.lastError && ` - ${key.lastError}`}
                      </div>
                    )}
                  </div>
                </div>

                {/* Ações */}
                <div className="flex flex-col gap-2 ml-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenModal(key)}
                    className="flex items-center gap-2"
                  >
                    <Edit className="w-4 h-4" />
                    Editar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleResetCounter(key)}
                    loading={resetCounterMutation.isPending}
                    className="flex items-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Resetar
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleDelete(key)}
                    loading={deleteMutation.isPending}
                    className="flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Remover
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-12 text-center">
          <Key className="w-12 h-12 mx-auto text-zinc-400 mb-4" />
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-2">
            Nenhuma chave cadastrada
          </h3>
          <p className="text-zinc-600 dark:text-zinc-400 mb-4">
            Cadastre sua primeira chave API TMDB para começar a enriquecer seus conteúdos VOD
          </p>
          <Button onClick={() => handleOpenModal()}>
            <Plus className="w-4 h-4 mr-2" />
            Cadastrar Primeira Chave
          </Button>
        </Card>
      )}

      {/* Modal de Criar/Editar */}
      <Modal
        isOpen={showModal}
        onClose={handleCloseModal}
        title={editingKey ? 'Editar Chave TMDB' : 'Nova Chave TMDB'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Nome da Chave *
            </label>
            <Input
              value={formData.keyName}
              onChange={(e) => setFormData({ ...formData, keyName: e.target.value })}
              placeholder="Ex: Chave Principal, Chave Backup..."
              maxLength={100}
            />
          </div>

          {!editingKey && (
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Chave API TMDB * (32 caracteres hexadecimais)
              </label>
              <Input
                type="text"
                value={formData.apiKey}
                onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                placeholder="Sua chave TMDB aqui"
                maxLength={32}
                className="font-mono"
              />
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                A chave não será exibida novamente após salvar por segurança
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Prioridade
              </label>
              <Input
                type="number"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                placeholder="0"
                min={0}
              />
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                Menor número = maior prioridade
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Limite Diário
              </label>
              <Input
                type="number"
                value={formData.requestsLimit}
                onChange={(e) =>
                  setFormData({ ...formData, requestsLimit: parseInt(e.target.value) || 40 })
                }
                placeholder="40"
                min={1}
              />
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                Requisições por dia (padrão: 40)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isActive"
              checked={formData.isActive}
              onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
              className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="isActive" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Chave ativa
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={handleCloseModal}>
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              loading={createMutation.isPending || updateMutation.isPending}
            >
              {editingKey ? 'Salvar Alterações' : 'Cadastrar Chave'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default TMDBKeysPage;

