import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { toast } from 'sonner';

interface PremiumPlan {
  id: string;
  name: string;
  description: string | null;
  maxConnections: number;
  serverId: string | null;
  bouquetIds: string;
  credits: number;
  isTrial: boolean; // NOVO: Se é plano de teste
  durationHours: number | null; // NOVO: Duração em horas (para testes)
  isActive: boolean;
  sortOrder: number;
}

interface Server {
  id: string;
  name: string;
  status: string;
}

interface Bouquet {
  id: string;
  externalId: string;
  name: string;
}

export function PremiumPlansPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PremiumPlan | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    maxConnections: 25,
    credits: 100,
    serverId: '',
    bouquetIds: '[]',
    isTrial: false, // NOVO
    durationHours: null as number | null, // NOVO
    isActive: true,
    sortOrder: 0,
  });
  const [selectedBouquets, setSelectedBouquets] = useState<string[]>([]);

  // Buscar servidores XUI
  const { data: servers = [] } = useQuery<Server[]>({
    queryKey: ['xui-servers'],
    queryFn: async () => {
      const res = await api.get('/settings/xui');
      return res.data.data || [];
    },
  });

  // Buscar bouquets do servidor selecionado
  const { data: bouquets = [] } = useQuery<Bouquet[]>({
    queryKey: ['bouquets-for-plan', formData.serverId],
    queryFn: async () => {
      if (!formData.serverId) return [];
      const res = await api.get(`/bouquets/server/${formData.serverId}`);
      return res.data.data || [];
    },
    enabled: !!formData.serverId,
  });

  // Atualizar bouquetIds quando selectedBouquets mudar
  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      bouquetIds: JSON.stringify(selectedBouquets),
    }));
  }, [selectedBouquets]);

  // Buscar planos
  const { data: plans = [], isLoading } = useQuery<PremiumPlan[]>({
    queryKey: ['premium-plans-admin'],
    queryFn: async () => {
      const res = await api.get('/premium/plans');
      return res.data.data || [];
    },
  });

  // Mutation para criar
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await api.post('/premium/plans', data);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Plano criado com sucesso!');
      queryClient.invalidateQueries({ queryKey: ['premium-plans-admin'] });
      closeModal();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao criar plano');
    },
  });

  // Mutation para atualizar
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      const res = await api.put(`/premium/plans/${id}`, data);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Plano atualizado!');
      queryClient.invalidateQueries({ queryKey: ['premium-plans-admin'] });
      closeModal();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao atualizar');
    },
  });

  // Mutation para deletar
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/premium/plans/${id}`);
    },
    onSuccess: () => {
      toast.success('Plano deletado!');
      queryClient.invalidateQueries({ queryKey: ['premium-plans-admin'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao deletar');
    },
  });

  const openCreateModal = () => {
    setEditingPlan(null);
    setFormData({
      name: '',
      description: '',
      maxConnections: 25,
      credits: 100,
      serverId: servers[0]?.id || '',
      bouquetIds: '[]',
      isTrial: false,
      durationHours: null,
      isActive: true,
      sortOrder: plans.length,
    });
    setSelectedBouquets([]);
    setShowModal(true);
  };

  const openEditModal = (plan: PremiumPlan) => {
    setEditingPlan(plan);
    // Parse bouquetIds para selectedBouquets
    let parsedBouquets: string[] = [];
    try {
      parsedBouquets = JSON.parse(plan.bouquetIds || '[]');
    } catch {
      parsedBouquets = [];
    }
    setSelectedBouquets(parsedBouquets);
    setFormData({
      name: plan.name,
      description: plan.description || '',
      maxConnections: plan.maxConnections,
      credits: plan.credits,
      serverId: plan.serverId || '',
      bouquetIds: plan.bouquetIds,
      isTrial: plan.isTrial || false,
      durationHours: plan.durationHours || null,
      isActive: plan.isActive,
      sortOrder: plan.sortOrder,
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingPlan(null);
    setSelectedBouquets([]);
  };

  const toggleBouquet = (bouquetId: string) => {
    setSelectedBouquets(prev => {
      if (prev.includes(bouquetId)) {
        return prev.filter(id => id !== bouquetId);
      } else {
        return [...prev, bouquetId];
      }
    });
  };

  // Quando trocar de servidor, limpar bouquets selecionados
  const handleServerChange = (serverId: string) => {
    setFormData(prev => ({ ...prev, serverId }));
    setSelectedBouquets([]);
  };

  const handleSubmit = () => {
    if (!formData.name) {
      toast.error('Nome é obrigatório');
      return;
    }

    if (formData.isTrial && !formData.durationHours) {
      toast.error('Planos de teste precisam ter duração em horas configurada');
      return;
    }

    if (editingPlan) {
      updateMutation.mutate({ id: editingPlan.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Deletar plano "${name}"?`)) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
            💎 Planos Premium
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-1">
            Gerencie os planos premium disponíveis para venda
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          + Novo Plano
        </button>
      </div>

      {/* Lista de Planos */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      ) : plans.length === 0 ? (
        <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-12 text-center">
          <p className="text-zinc-500 dark:text-zinc-400 mb-4">
            Nenhum plano cadastrado
          </p>
          <button
            onClick={openCreateModal}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Criar Primeiro Plano
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">
                    {plan.name}
                  </h3>
                  {plan.isTrial && (
                    <span className="inline-block mt-1 px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded">
                      🎁 Teste Gratuito ({plan.durationHours || 3}h)
                    </span>
                  )}
                </div>
                <span
                  className={`px-2 py-1 text-xs font-medium rounded ${
                    plan.isActive
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'
                  }`}
                >
                  {plan.isActive ? 'Ativo' : 'Inativo'}
                </span>
              </div>

              {plan.description && (
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4 whitespace-pre-line">
                  {plan.description}
                </p>
              )}

              <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                <div>
                  <p className="text-zinc-500 dark:text-zinc-400">Conexões</p>
                  <p className="font-semibold text-zinc-900 dark:text-white text-lg">
                    {plan.maxConnections}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500 dark:text-zinc-400">Valor</p>
                  <p className="font-semibold text-green-600 dark:text-green-400 text-lg">
                    R$ {plan.credits.toFixed(2)}
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => openEditModal(plan)}
                  className="flex-1 px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded hover:bg-zinc-50 dark:hover:bg-zinc-700"
                >
                  Editar
                </button>
                <button
                  onClick={() => handleDelete(plan.id, plan.name)}
                  className="px-3 py-2 text-sm text-red-600 border border-red-200 dark:border-red-800 rounded hover:bg-red-50 dark:hover:bg-red-900/30"
                >
                  Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de Criação/Edição */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-zinc-800 rounded-lg p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-zinc-900 dark:text-white mb-4">
              {editingPlan ? 'Editar Plano' : 'Novo Plano'}
            </h2>

            <div className="space-y-4">
              {/* Nome */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Nome *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ex: 50 Conexões"
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white"
                />
              </div>

              {/* Descrição */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Descrição
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Descrição do plano..."
                  rows={3}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white"
                />
              </div>

              {/* Conexões */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Máx. Conexões *
                </label>
                <input
                  type="number"
                  value={formData.maxConnections}
                  onChange={(e) => setFormData({ ...formData, maxConnections: parseInt(e.target.value) || 1 })}
                  min={1}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white"
                />
              </div>

              {/* Valor */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Valor (R$) *
                </label>
                <input
                  type="number"
                  value={formData.credits}
                  onChange={(e) => setFormData({ ...formData, credits: parseFloat(e.target.value) || 0 })}
                  min={0}
                  step={0.01}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white"
                />
              </div>

              {/* Servidor XUI */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Servidor XUI *
                </label>
                <select
                  value={formData.serverId}
                  onChange={(e) => handleServerChange(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white"
                >
                  <option value="">Selecione o servidor...</option>
                  {servers.map((server) => (
                    <option key={server.id} value={server.id}>
                      {server.name} {server.status === 'ONLINE' ? '✅' : '⚠️'}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-zinc-500 mt-1">
                  Servidor onde as linhas serão criadas
                </p>
              </div>

              {/* Bouquets */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Bouquets (Canais) *
                </label>
                {!formData.serverId ? (
                  <p className="text-sm text-zinc-500 italic">
                    Selecione um servidor primeiro
                  </p>
                ) : bouquets.length === 0 ? (
                  <p className="text-sm text-amber-500">
                    Nenhum bouquet encontrado. Sincronize o servidor primeiro.
                  </p>
                ) : (
                  <div className="max-h-40 overflow-y-auto border border-zinc-300 dark:border-zinc-600 rounded-lg p-2 space-y-1">
                    {bouquets.map((bouquet) => (
                      <label
                        key={bouquet.id}
                        className="flex items-center gap-2 p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-600 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedBouquets.includes(bouquet.externalId)}
                          onChange={() => toggleBouquet(bouquet.externalId)}
                          className="w-4 h-4 rounded"
                        />
                        <span className="text-sm text-zinc-700 dark:text-zinc-300">
                          {bouquet.name}
                        </span>
                        <span className="text-xs text-zinc-500">
                          (ID: {bouquet.externalId})
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {selectedBouquets.length > 0 && (
                  <p className="text-xs text-green-600 mt-1">
                    {selectedBouquets.length} bouquet(s) selecionado(s)
                  </p>
                )}
              </div>

              {/* Ordem */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Ordem de exibição
                </label>
                <input
                  type="number"
                  value={formData.sortOrder}
                  onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })}
                  min={0}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white"
                />
              </div>

              {/* NOVO: Plano de Teste */}
              <div className="border border-amber-300 dark:border-amber-700 rounded-lg p-4 bg-amber-50 dark:bg-amber-900/20">
                <div className="flex items-center gap-2 mb-3">
                  <input
                    type="checkbox"
                    id="isTrial"
                    checked={formData.isTrial}
                    onChange={(e) => setFormData({ ...formData, isTrial: e.target.checked, credits: e.target.checked ? 0 : formData.credits })}
                    className="w-4 h-4"
                  />
                  <label htmlFor="isTrial" className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    🎁 Plano de Teste (Gratuito)
                  </label>
                </div>
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
                  Planos de teste são gratuitos e usados no botão "Testar Fonte" do portal público.
                </p>
                {formData.isTrial && (
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Duração (horas) *
                    </label>
                    <input
                      type="number"
                      value={formData.durationHours || ''}
                      onChange={(e) => setFormData({ ...formData, durationHours: parseInt(e.target.value) || null })}
                      placeholder="Ex: 3"
                      min={1}
                      max={24}
                      className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white"
                    />
                    <p className="text-xs text-zinc-500 mt-1">
                      Recomendado: 3 a 6 horas
                    </p>
                  </div>
                )}
              </div>

              {/* Ativo */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="w-4 h-4"
                />
                <label htmlFor="isActive" className="text-sm text-zinc-700 dark:text-zinc-300">
                  Plano ativo (visível para venda)
                </label>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={closeModal}
                className="flex-1 px-4 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700"
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmit}
                disabled={createMutation.isPending || updateMutation.isPending}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {(createMutation.isPending || updateMutation.isPending) ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
