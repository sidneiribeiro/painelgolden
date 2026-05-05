import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { toast } from 'sonner';

interface PremiumPlan {
  id: string;
  name: string;
  description: string | null;
  maxConnections: number;
  credits: number;
  isActive: boolean;
}

interface XuiServer {
  id: string;
  name: string;
  baseUrl: string;
}

interface Bouquet {
  id: string;
  name: string;
  externalId: string;
  serverId: string;
}

interface PremiumSource {
  id: string;
  username: string;
  password: string;
  status: string;
  expiresAt: string;
  plan: PremiumPlan;
  server: { id: string; name: string; baseUrl: string; dnsPrimary?: string };
}

interface CreatedSource {
  credentials: { username: string; password: string; expiresAt: string };
  urls: { m3u_ts: string; m3u_hls: string; ssiptv?: string };
  data: PremiumSource;
}

export function PremiumSourcesPage() {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [createdSource, setCreatedSource] = useState<CreatedSource | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [selectedServerId, setSelectedServerId] = useState('');
  const [selectedBouquetId, setSelectedBouquetId] = useState('');
  const [durationDays, setDurationDays] = useState(30);
  const [isCreating, setIsCreating] = useState(false);

  // Buscar fontes do usuario
  const { data: sources = [], isLoading: loadingSources } = useQuery<PremiumSource[]>({
    queryKey: ['premium-sources'],
    queryFn: async () => {
      const res = await api.get('/premium/sources');
      return res.data.data || [];
    },
  });

  // Buscar dados para criacao
  const { data: createData, isLoading: loadingCreateData } = useQuery({
    queryKey: ['premium-sources-create-data'],
    queryFn: async () => {
      const res = await api.get('/premium/sources/create-data');
      return res.data.data;
    },
  });

  const plans: PremiumPlan[] = createData?.plans || [];
  const servers: XuiServer[] = createData?.servers || [];
  const allBouquets: Bouquet[] = createData?.bouquets || [];

  const filteredBouquets = useMemo(() => {
    if (!selectedServerId) return [];
    return allBouquets.filter(b => b.serverId === selectedServerId);
  }, [allBouquets, selectedServerId]);

  const handleServerChange = (serverId: string) => {
    setSelectedServerId(serverId);
    setSelectedBouquetId('');
  };

  const createMutation = useMutation({
    mutationFn: async (data: { planId: string; serverId: string; bouquetId: string; durationDays: number }) => {
      const res = await api.post('/premium/sources', data);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['premium-sources'] });
      setShowCreateModal(false);
      setSelectedPlanId('');
      setSelectedServerId('');
      setSelectedBouquetId('');
      setCreatedSource(data);
      setShowSuccessModal(true);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || error.response?.data?.message || 'Erro ao criar fonte');
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.patch(`/premium/sources/${id}/toggle`);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Status alterado!');
      queryClient.invalidateQueries({ queryKey: ['premium-sources'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao alterar status');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/premium/sources/${id}`);
    },
    onSuccess: () => {
      toast.success('Fonte deletada!');
      queryClient.invalidateQueries({ queryKey: ['premium-sources'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao deletar');
    },
  });

  const handleCreate = async () => {
    if (!selectedPlanId) { toast.error('Selecione um plano'); return; }
    if (!selectedServerId) { toast.error('Selecione um servidor'); return; }
    if (!selectedBouquetId) { toast.error('Selecione um bouquet'); return; }
    setIsCreating(true);
    try {
      await createMutation.mutateAsync({ planId: selectedPlanId, serverId: selectedServerId, bouquetId: selectedBouquetId, durationDays });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = (id: string) => {
    if (confirm('Tem certeza que deseja deletar esta fonte?')) {
      deleteMutation.mutate(id);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado!`);
  };

  const generateM3uUrl = (source: PremiumSource) => {
    const dns = source.server.dnsPrimary || source.server.baseUrl;
    return `${dns}/get.php?username=${source.username}&password=${source.password}&type=m3u_plus&output=mpegts`;
  };

  const selectedPlan = plans.find(p => p.id === selectedPlanId);
  const selectedServer = servers.find(s => s.id === selectedServerId);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Fontes Premium</h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-1">Gerencie suas linhas premium</p>
        </div>
        <button onClick={() => setShowCreateModal(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          + Nova Fonte
        </button>
      </div>

      {loadingSources ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div></div>
      ) : sources.length === 0 ? (
        <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-12 text-center">
          <p className="text-zinc-500 dark:text-zinc-400 mb-4">Nenhuma fonte premium criada</p>
          <button onClick={() => setShowCreateModal(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Criar Primeira Fonte</button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sources.map((source) => (
            <div key={source.id} className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-zinc-900 dark:text-white">{source.plan.name}</h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">{source.server.name}</p>
                </div>
                <span className={`px-2 py-1 text-xs font-medium rounded ${source.status === 'ACTIVE' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'}`}>
                  {source.status === 'ACTIVE' ? 'Ativo' : 'Pausado'}
                </span>
              </div>
              <div className="space-y-2 text-sm mb-4">
                <div className="flex justify-between"><span className="text-zinc-500 dark:text-zinc-400">Usuario:</span><span className="font-mono text-zinc-900 dark:text-white">{source.username}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500 dark:text-zinc-400">Senha:</span><span className="font-mono text-zinc-900 dark:text-white">{source.password}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500 dark:text-zinc-400">Conexoes:</span><span className="text-zinc-900 dark:text-white">{source.plan.maxConnections}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500 dark:text-zinc-400">Expira:</span><span className="text-zinc-900 dark:text-white">{new Date(source.expiresAt).toLocaleDateString('pt-BR')}</span></div>
              </div>
              <div className="mb-4">
                <button onClick={() => copyToClipboard(generateM3uUrl(source), 'Link M3U')} className="w-full px-3 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">Copiar Link M3U</button>
              </div>
              <div className="flex gap-2">
                <button onClick={() => toggleMutation.mutate(source.id)} className="flex-1 px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded hover:bg-zinc-50 dark:hover:bg-zinc-700">{source.status === 'ACTIVE' ? 'Pausar' : 'Ativar'}</button>
                <button onClick={() => handleDelete(source.id)} className="px-3 py-2 text-sm text-red-600 border border-red-200 dark:border-red-800 rounded hover:bg-red-50 dark:hover:bg-red-900/30">Excluir</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-zinc-800 rounded-lg p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold text-zinc-900 dark:text-white mb-4">Nova Fonte Premium</h2>
            {loadingCreateData ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div></div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Plano *</label>
                  <select value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)} className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white">
                    <option value="">Selecione um plano</option>
                    {plans.map((plan) => (<option key={plan.id} value={plan.id}>{plan.name} - {plan.maxConnections} conexoes</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Servidor XUI *</label>
                  <select value={selectedServerId} onChange={(e) => handleServerChange(e.target.value)} className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white">
                    <option value="">Selecione um servidor</option>
                    {servers.map((server) => (<option key={server.id} value={server.id}>{server.name}</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Bouquet *</label>
                  <select value={selectedBouquetId} onChange={(e) => setSelectedBouquetId(e.target.value)} disabled={!selectedServerId} className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white disabled:opacity-50">
                    <option value="">{selectedServerId ? 'Selecione um bouquet' : 'Selecione servidor primeiro'}</option>
                    {filteredBouquets.map((bouquet) => (<option key={bouquet.id} value={bouquet.id}>{bouquet.name}</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Duracao (dias)</label>
                  <input type="number" value={durationDays} onChange={(e) => setDurationDays(parseInt(e.target.value) || 30)} min={1} max={365} className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                </div>
                {selectedPlan && selectedServer && (
                  <div className="bg-zinc-100 dark:bg-zinc-700 rounded-lg p-4">
                    <h4 className="font-medium text-zinc-900 dark:text-white mb-2">Resumo</h4>
                    <div className="text-sm space-y-1 text-zinc-700 dark:text-zinc-300">
                      <p><strong>Plano:</strong> {selectedPlan.name}</p>
                      <p><strong>Conexoes:</strong> {selectedPlan.maxConnections}</p>
                      <p><strong>Servidor:</strong> {selectedServer.name}</p>
                      <p><strong>Duracao:</strong> {durationDays} dias</p>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-3 mt-6">
              <button onClick={() => { setShowCreateModal(false); setSelectedPlanId(''); setSelectedServerId(''); setSelectedBouquetId(''); }} className="flex-1 px-4 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white">Cancelar</button>
              <button onClick={handleCreate} disabled={isCreating || !selectedPlanId || !selectedServerId || !selectedBouquetId} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">{isCreating ? 'Criando...' : 'Criar Fonte'}</button>
            </div>
          </div>
        </div>
      )}

      {showSuccessModal && createdSource && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-zinc-800 rounded-lg p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">OK</div>
              <h2 className="text-xl font-bold text-zinc-900 dark:text-white">Fonte Criada com Sucesso!</h2>
            </div>
            <div className="space-y-4">
              <div className="bg-zinc-100 dark:bg-zinc-700 rounded-lg p-4">
                <h4 className="font-medium text-zinc-900 dark:text-white mb-3">Credenciais</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-600 dark:text-zinc-400">Usuario:</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-zinc-900 dark:text-white">{createdSource.credentials.username}</span>
                      <button onClick={() => copyToClipboard(createdSource.credentials.username, 'Usuario')} className="text-blue-600 hover:text-blue-700">Copiar</button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-600 dark:text-zinc-400">Senha:</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-zinc-900 dark:text-white">{createdSource.credentials.password}</span>
                      <button onClick={() => copyToClipboard(createdSource.credentials.password, 'Senha')} className="text-blue-600 hover:text-blue-700">Copiar</button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
                <h4 className="font-medium text-green-800 dark:text-green-300 mb-3">Links M3U</h4>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-green-600 dark:text-green-400 mb-1">M3U (MPEGTS):</p>
                    <div className="flex items-center gap-2">
                      <input type="text" readOnly value={createdSource.urls.m3u_ts} className="flex-1 px-2 py-1 text-xs bg-white dark:bg-zinc-800 border border-green-300 dark:border-green-700 rounded" />
                      <button onClick={() => copyToClipboard(createdSource.urls.m3u_ts, 'Link M3U TS')} className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700">Copiar</button>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-green-600 dark:text-green-400 mb-1">M3U (HLS):</p>
                    <div className="flex items-center gap-2">
                      <input type="text" readOnly value={createdSource.urls.m3u_hls} className="flex-1 px-2 py-1 text-xs bg-white dark:bg-zinc-800 border border-green-300 dark:border-green-700 rounded" />
                      <button onClick={() => copyToClipboard(createdSource.urls.m3u_hls, 'Link M3U HLS')} className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700">Copiar</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <button onClick={() => { setShowSuccessModal(false); setCreatedSource(null); }} className="w-full mt-6 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Fechar</button>
          </div>
        </div>
      )}
    </div>
  );
}
