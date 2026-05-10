import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, Modal, Badge, Spinner, Select } from '../../components/ui';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';

const RESELLER_MAX_CONNECTIONS = 2;

interface Package {
  id: string;
  serverId: string;
  externalId: string;
  name: string;
  description?: string;
  duration: number;
  durationUnit: 'HOURS' | 'DAYS' | 'MONTHS' | 'YEARS';
  credits: number;
  planPrice: number;
  isTrial: boolean;
  isActive: boolean;
  connections: number;
  maxConnections?: number;
  bouquets?: number[];
  sortOrder: number;
  showOnDashboard: boolean;
  ownerId?: string | null;
  canEdit?: boolean;
  server?: {
    id: string;
    name: string;
  };
  _count?: {
    customers: number;
  };
}

interface Server {
  id: string;
  name: string;
}

interface Bouquet {
  value: number;
  label: string;
}

interface PackageForm {
  serverId: string;
  externalId: string;
  name: string;
  description: string;
  duration: number;
  durationUnit: string;
  credits: number;
  planPrice: number;
  isTrial: boolean;
  isActive: boolean;
  connections: number;
  maxConnections?: number;
  bouquets: number[];
  sortOrder: number;
  showOnDashboard: boolean;
  template?: string; // Template completo
  templateXciptv?: string; // Template XCIPTV/Smarters
  templateSimple?: string; // Template simples
}

const defaultTemplate = `📺 *ACESSO IPTV CRIADO COM SUCESSO!*

👤 *Usuário:* {username}
🔑 *Senha:* {password}

📱 *Para XCIPTV/Smarters:*
🌐 DNS: {dns}
👤 Usuário: {username}
🔑 Senha: {password}

🔗 *Link M3U:*
{m3uUrl}

📅 *Vencimento:* {expiresAt}
📶 *Conexões:* {connections}

⚠️ *Importante:* Não compartilhe suas credenciais!`;

const defaultTemplateXciptv = `📺 *DADOS DE ACESSO - IPTV*

👤 *Usuário:* {username}
🔑 *Senha:* {password}

📱 *Configuração para XCIPTV:*
🌐 DNS: {dns}
👤 Usuário: {username}
🔑 Senha: {password}

🔗 *Link M3U:*
{m3uUrl}

📅 Vencimento: {expiresAt}
📶 Conexões: {connections}`;

const defaultTemplateSimple = `🎬 *SEU ACESSO FOI CRIADO!*

📱 *DADOS PARA O APLICATIVO*
🌐 Servidor: {dns}
👤 Login: {username}
🔑 Senha: {password}

📅 Válido até: {expiresAt}
📶 Dispositivos: {connections}`;

const initialForm: PackageForm = {
  serverId: '',
  externalId: '',
  name: '',
  description: '',
  duration: 30,
  durationUnit: 'DAYS',
  credits: 0,
  planPrice: 0,
  isTrial: false,
  isActive: true,
  connections: 1,
  bouquets: [],
  sortOrder: 0,
  showOnDashboard: true,
  template: defaultTemplate,
  templateXciptv: defaultTemplateXciptv,
  templateSimple: defaultTemplateSimple,
};

const durationLabels: Record<string, string> = {
  HOURS: 'Horas',
  DAYS: 'Dias',
  MONTHS: 'Meses',
  YEARS: 'Anos',
};

export function PackagesPage() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((state) => state.user);
  const userRole = currentUser?.role;
  // Revendas (MASTER_RESELLER / RESELLER) só podem criar pacotes com até 2 conexões
  const isReseller = userRole === 'MASTER_RESELLER' || userRole === 'RESELLER';
  const connectionsLimit = isReseller ? RESELLER_MAX_CONNECTIONS : 0; // 0 = sem limite
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState<Package | null>(null);
  const [form, setForm] = useState<PackageForm>(initialForm);
  const [filterServerId, setFilterServerId] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'regular' | 'trial'>('all');

  // Busca servidores
  const { data: serversData } = useQuery({
    queryKey: ['xui-servers'],
    queryFn: async () => {
      const res = await api.get('/settings/xui');
      return res.data.data as Server[];
    },
  });

  // Busca pacotes
  const { data: packagesData, isLoading } = useQuery({
    queryKey: ['packages-local', filterServerId, filterType],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterServerId) params.set('serverId', filterServerId);
      if (filterType === 'trial') params.set('isTrial', 'true');
      if (filterType === 'regular') params.set('isTrial', 'false');
      const res = await api.get(`/packages-local?${params.toString()}`);
      return res.data.data as Package[];
    },
  });

  // Busca bouquets do servidor selecionado
  const { data: bouquetsData } = useQuery({
    queryKey: ['bouquets-select', form.serverId],
    queryFn: async () => {
      if (!form.serverId) return [];
      const res = await api.get(`/bouquets/for-select/${form.serverId}`);
      return res.data.data as Bouquet[];
    },
    enabled: !!form.serverId,
  });

  // Sincronizar do XUI
  const syncMutation = useMutation({
    mutationFn: async (serverId: string) => {
      const res = await api.post(`/settings/xui/${serverId}/sync`);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['packages-local'] });
      toast.success(`Sincronizado: ${data.synced.packages} pacotes`);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro na sincronização');
    },
  });

  // Criar
  const createMutation = useMutation({
    mutationFn: async (data: PackageForm) => {
      const res = await api.post('/packages-local', {
        ...data,
        planPrice: Math.round(data.planPrice * 100), // Converte para centavos
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['packages-local'] });
      toast.success('Pacote criado!');
      closeModal();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao criar');
    },
  });

  // Atualizar
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<PackageForm> }) => {
      const payload: any = { ...data };
      if (data.planPrice !== undefined) {
        payload.planPrice = Math.round(data.planPrice * 100);
      }
      const res = await api.put(`/packages-local/${id}`, payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['packages-local'] });
      toast.success('Pacote atualizado!');
      closeModal();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao atualizar');
    },
  });

  // Deletar
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/packages-local/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['packages-local'] });
      toast.success('Pacote removido');
    },
  });

  const openCreateModal = () => {
    setForm({
      ...initialForm,
      serverId: serversData?.[0]?.id || '',
      template: defaultTemplate,
      templateXciptv: defaultTemplateXciptv,
      templateSimple: defaultTemplateSimple,
    });
    setEditingPackage(null);
    setModalOpen(true);
  };

  const openEditModal = (pkg: Package) => {
    setEditingPackage(pkg);
    setForm({
      serverId: pkg.serverId,
      externalId: pkg.externalId,
      name: pkg.name,
      description: pkg.description || '',
      duration: pkg.duration,
      durationUnit: pkg.durationUnit,
      credits: pkg.credits,
      planPrice: pkg.planPrice / 100, // Converte de centavos
      isTrial: pkg.isTrial,
      isActive: pkg.isActive,
      connections: pkg.connections,
      maxConnections: pkg.maxConnections,
      bouquets: pkg.bouquets || [],
      sortOrder: pkg.sortOrder,
      showOnDashboard: pkg.showOnDashboard,
      template: (pkg as any).template || defaultTemplate,
      templateXciptv: (pkg as any).templateXciptv || defaultTemplateXciptv,
      templateSimple: (pkg as any).templateSimple || defaultTemplateSimple,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingPackage(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingPackage) {
      updateMutation.mutate({ id: editingPackage.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const formatPrice = (cents: number) => {
    return (cents / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  };

  const formatDuration = (duration: number, unit: string) => {
    return `${duration} ${durationLabels[unit] || unit}`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">📦 Planos e Pacotes</h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-1">Gerencie os pacotes disponíveis para venda</p>
        </div>
        <div className="flex gap-2">
          {serversData && serversData.length > 0 && (
            <Select
              value={filterServerId || serversData[0].id}
              onChange={(e) => {
                setFilterServerId(e.target.value);
                syncMutation.mutate(e.target.value);
              }}
              className="w-48"
            >
              {serversData.map((s) => (
                <option key={s.id} value={s.id}>
                  🔄 Sync: {s.name}
                </option>
              ))}
            </Select>
          )}
          <Button onClick={openCreateModal}>➕ Novo Pacote</Button>
        </div>
      </div>

      <div className="h-1 w-full bg-gradient-to-r from-indigo-500 to-blue-600 rounded-full opacity-80" />

      {/* Filtros */}
      <div className="flex gap-4 flex-wrap">
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

        <div className="flex gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-1">
          {(['all', 'regular', 'trial'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-4 py-2 rounded text-sm transition-colors ${
                filterType === type
                  ? 'bg-blue-600 dark:bg-cyan-500 text-white'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              {type === 'all' && 'Todos'}
              {type === 'regular' && 'Regulares'}
              {type === 'trial' && 'Testes'}
            </button>
          ))}
        </div>
      </div>

      {/* Grid de Pacotes */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {packagesData?.map((pkg) => (
          <Card key={pkg.id} className={`p-5 relative overflow-hidden ${!pkg.isActive ? 'opacity-50' : ''}`}>
            <div
              className={`h-1 w-full rounded-full mb-4 opacity-80 bg-gradient-to-r ${
                pkg.isTrial ? 'from-amber-500 to-orange-600' : 'from-indigo-500 to-blue-600'
              }`}
            />
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">{pkg.name}</h3>
                <p className="text-xs text-zinc-600 dark:text-zinc-500">{pkg.server?.name}</p>
              </div>
              <div className="flex gap-1">
                {pkg.isTrial && <Badge variant="warning">Teste</Badge>}
                {!pkg.isActive && <Badge variant="error">Inativo</Badge>}
              </div>
            </div>

            <div className="space-y-2 text-sm mb-4">
              <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                <span>Duração:</span>
                <span className="text-zinc-900 dark:text-white">{formatDuration(pkg.duration, pkg.durationUnit)}</span>
              </div>
              <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                <span>Créditos:</span>
                <span className="text-blue-600 dark:text-cyan-400 font-medium">{pkg.credits}</span>
              </div>
              <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                <span>Preço:</span>
                <span className="text-green-600 dark:text-green-400 font-medium">{formatPrice(pkg.planPrice)}</span>
              </div>
              <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                <span>Conexões:</span>
                <span className="text-zinc-900 dark:text-white">{pkg.connections}</span>
              </div>
              <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                <span>Clientes:</span>
                <span className="text-zinc-900 dark:text-white">{pkg._count?.customers || 0}</span>
              </div>
            </div>

            <div className="flex gap-2">
              {pkg.canEdit === false ? (
                <div className="flex-1 text-center text-xs text-zinc-500 dark:text-zinc-500 py-2 border border-dashed border-zinc-300 dark:border-zinc-700 rounded">
                  🔒 Somente leitura
                </div>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={() => openEditModal(pkg)} className="flex-1">
                    ✏️ Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-400"
                    onClick={() => {
                      if (confirm('Remover este pacote?')) {
                        deleteMutation.mutate(pkg.id);
                      }
                    }}
                  >
                    🗑️
                  </Button>
                </>
              )}
            </div>
          </Card>
        ))}

        {(!packagesData || packagesData.length === 0) && (
          <Card className="p-8 col-span-full text-center relative overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-indigo-500 to-blue-600 rounded-full mb-4 opacity-80" />
          <p className="text-zinc-600 dark:text-zinc-400 mb-4">Nenhum pacote encontrado</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-500">
              Sincronize os pacotes do XUI ou crie um novo manualmente
            </p>
          </Card>
        )}
      </div>

      {/* Modal Criar/Editar */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editingPackage ? 'Editar Pacote' : 'Novo Pacote'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Select
              label="Servidor"
              value={form.serverId}
              onChange={(e) => setForm({ ...form, serverId: e.target.value })}
              required
            >
              <option value="">Selecione...</option>
              {serversData?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>

            <Input
              label="ID Externo (XUI)"
              value={form.externalId}
              onChange={(e) => setForm({ ...form, externalId: e.target.value })}
              required
            />
          </div>

          <Input
            label="Nome do Pacote"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />

          <Input
            label="Descrição"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />

          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label="Duração"
              type="number"
              min={1}
              value={form.duration}
              onChange={(e) => setForm({ ...form, duration: parseInt(e.target.value) || 1 })}
              required
            />
            <Select
              label="Unidade"
              value={form.durationUnit}
              onChange={(e) => setForm({ ...form, durationUnit: e.target.value })}
            >
              <option value="HOURS">Horas</option>
              <option value="DAYS">Dias</option>
              <option value="MONTHS">Meses</option>
              <option value="YEARS">Anos</option>
            </Select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label="Créditos (custo para revendedor)"
              type="number"
              min={0}
              value={form.credits}
              onChange={(e) => setForm({ ...form, credits: parseInt(e.target.value) || 0 })}
            />
            <Input
              label="Preço sugerido (R$)"
              type="number"
              min={0}
              step={0.01}
              value={form.planPrice}
              onChange={(e) => setForm({ ...form, planPrice: parseFloat(e.target.value) || 0 })}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label={`Conexões padrão${connectionsLimit ? ` (máx ${connectionsLimit})` : ''}`}
              type="number"
              min={1}
              max={connectionsLimit || undefined}
              value={form.connections}
              onChange={(e) => {
                let v = parseInt(e.target.value) || 1;
                if (connectionsLimit && v > connectionsLimit) v = connectionsLimit;
                setForm({ ...form, connections: v });
              }}
            />
            <Input
              label={`Máximo de conexões${connectionsLimit ? ` (máx ${connectionsLimit})` : ''}`}
              type="number"
              min={1}
              max={connectionsLimit || undefined}
              value={form.maxConnections || ''}
              onChange={(e) => {
                const raw = parseInt(e.target.value);
                if (isNaN(raw)) {
                  setForm({ ...form, maxConnections: undefined });
                  return;
                }
                const v = connectionsLimit && raw > connectionsLimit ? connectionsLimit : raw;
                setForm({ ...form, maxConnections: v });
              }}
              placeholder={connectionsLimit ? `Até ${connectionsLimit}` : 'Ilimitado'}
            />
          </div>

          {/* Bouquets */}
          {bouquetsData && bouquetsData.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                Bouquets inclusos
              </label>
              <div className="flex gap-2 flex-wrap max-h-32 overflow-y-auto p-2 bg-zinc-100 dark:bg-zinc-900 rounded-lg">
                {bouquetsData.map((b) => {
                  const isSelected = form.bouquets.includes(b.value);
                  return (
                    <button
                      key={b.value}
                      type="button"
                      onClick={() => {
                        const newBouquets = isSelected
                          ? form.bouquets.filter((id) => id !== b.value)
                          : [...form.bouquets, b.value];
                        setForm({ ...form, bouquets: newBouquets });
                      }}
                      className={`px-3 py-1 rounded text-xs transition-colors ${
                        isSelected
                          ? 'bg-blue-600 dark:bg-cyan-500 text-white'
                          : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-700'
                      }`}
                    >
                      {b.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex gap-4 flex-wrap">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isTrial}
                onChange={(e) => setForm({ ...form, isTrial: e.target.checked })}
                className="rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
              />
              <span className="text-sm text-zinc-700 dark:text-zinc-300">Pacote de Teste</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
              />
              <span className="text-sm text-zinc-700 dark:text-zinc-300">Ativo</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.showOnDashboard}
                onChange={(e) => setForm({ ...form, showOnDashboard: e.target.checked })}
                className="rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
              />
              <span className="text-sm text-zinc-700 dark:text-zinc-300">Exibir no Dashboard</span>
            </label>
          </div>

          {/* Templates */}
          <div className="space-y-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">📝 Templates de Mensagem</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
              Use variáveis: {'{username}'}, {'{password}'}, {'{dns}'}, {'{m3uUrl}'}, {'{expiresAt}'}, {'{connections}'}, {'{packageName}'}
            </p>
            
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                Template Completo
              </label>
              <textarea
                value={form.template || ''}
                onChange={(e) => setForm({ ...form, template: e.target.value })}
                rows={6}
                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-cyan-500 focus:border-transparent resize-y"
                placeholder="Template completo para envio de credenciais..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                Template XCIPTV / Smarters
              </label>
              <textarea
                value={form.templateXciptv || ''}
                onChange={(e) => setForm({ ...form, templateXciptv: e.target.value })}
                rows={6}
                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-cyan-500 focus:border-transparent resize-y"
                placeholder="Template específico para XCIPTV..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                Template Simples
              </label>
              <textarea
                value={form.templateSimple || ''}
                onChange={(e) => setForm({ ...form, templateSimple: e.target.value })}
                rows={4}
                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-cyan-500 focus:border-transparent resize-y"
                placeholder="Template simples (texto curto)..."
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
            <Button type="button" variant="ghost" onClick={closeModal}>
              Cancelar
            </Button>
            <Button
              type="submit"
              loading={createMutation.isPending || updateMutation.isPending}
            >
              💾 Salvar
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default PackagesPage;
