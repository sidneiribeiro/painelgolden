import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, Modal, Badge, Spinner, Select } from '../components/ui';
import { Pagination } from '../components/ui/Pagination';
import { ResellerTreeDropdown } from '../components/ResellerTreeDropdown';
import { api } from '../api/client';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';
import { useDebounce } from '../hooks/useDebounce';

interface Customer {
  id: string;
  externalId: string; // ID do XUI para chamadas de API
  username: string;
  password: string;
  status: 'ACTIVE' | 'EXPIRED' | 'BANNED' | 'INACTIVE';
  is_trial: boolean;
  connections: number;
  expires_at: string;
  created_at?: string;
  days_until_expiry?: number;
  hours_until_expiry?: number;
  name?: string;
  whatsapp?: string;
  email?: string;
  telegram?: string;
  admin_notes?: string;
  m3u_url?: string;
  dns?: string; // DNS do servidor
  playlist?: string; // Template processado
}

interface Package {
  value: string;
  label: string;
  serverName: string;
  credits: number;
  planPrice: number;
  isTrial: boolean;
  connections: number;
  externalId: string;
}

interface Server {
  id: string;
  name: string;
  isDefault: boolean;
}

interface CustomerForm {
  serverId: string;
  packageId: string;
  name: string;
  whatsapp: string;
  email: string;
  telegram: string;
  connections: number;
  username: string;
  password: string;
  expires_at?: string; // Data de vencimento (opcional)
}

interface TrialForm {
  serverId: string;
  hours: number;
  name: string;
  whatsapp: string;
}

const initialCustomerForm: CustomerForm = {
  serverId: '',
  packageId: '',
  name: '',
  whatsapp: '',
  email: '',
  telegram: '',
  connections: 1,
  username: '',
  password: '',
};

const initialTrialForm: TrialForm = {
  serverId: '',
  hours: 6,
  name: '',
  whatsapp: '',
};

export function CustomersPage() {
  const queryClient = useQueryClient();
  const updateCredits = useAuthStore((state) => state.updateCredits);
  const setUser = useAuthStore((state) => state.setUser);
  const userRole = useAuthStore((state) => state.user?.role);
  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(userRole || '');
  const isResellerFamily = ['RESELLER', 'MASTER_RESELLER'].includes(userRole || '');

  /** Teto de conexões na UI para revenda (igual regra de pacotes: máx. 2 e respeita o pacote). */
  const connectionsCapForPackage = (pkg?: Package | null) => {
    if (!isResellerFamily) return null;
    const c = pkg?.connections;
    return Math.min(2, c != null && c > 0 ? c : 2);
  };
  const defaultResellerCap = isResellerFamily ? 2 : null;
  const connectionsCapForPackage_DUMMY = (pkg?: Package | null) => {
    return null;
  };

  // Modais
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [trialModalOpen, setTrialModalOpen] = useState(false);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [renewModalOpen, setRenewModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    whatsapp: '',
    email: '',
    telegram: '',
    username: '',
    password: '',
    expires_at: '',
    connections: 1,
    packageId: '',
  });
  
  // Forms
  const [customerForm, setCustomerForm] = useState<CustomerForm>(initialCustomerForm);
  const [trialForm, setTrialForm] = useState<TrialForm>(initialTrialForm);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [renewDays, setRenewDays] = useState(30);
  const [generatedCredentials, setGeneratedCredentials] = useState<{ username: string; password: string } | null>(null);
  const [telegramTestLoading, setTelegramTestLoading] = useState(false);
  
  // Filtros
  const [filters, setFilters] = useState({
    search: '',
    serverId: '',
    status: '',
    isTrial: '',
  });
  const [selectedResellerId, setSelectedResellerId] = useState('');
  const [selectedResellerName, setSelectedResellerName] = useState('');
  // Estado separado para o input de busca (com debounce)
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 500); // Debounce de 500ms
  const [currentPage, setCurrentPage] = useState(1);
  const [custSortBy, setCustSortBy] = useState('');
  const [custSortDir, setCustSortDir] = useState<'asc' | 'desc'>('asc');

  const toggleCustSort = (field: string) => {
    if (custSortBy === field) {
      setCustSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setCustSortBy(field);
      setCustSortDir('asc');
    }
  };

  const CustSortIcon = ({ field }: { field: string }) => (
    <span className="ml-1 inline-block w-3 text-[10px] leading-none">
      {custSortBy === field ? (custSortDir === 'asc' ? '▲' : '▼') : '⇅'}
    </span>
  );

  // Atualizar filtro quando debouncedSearch mudar
  useEffect(() => {
    setFilters(prev => ({ ...prev, search: debouncedSearch }));
    setCurrentPage(1);
  }, [debouncedSearch]);

  // Resetar página quando filtros mudarem (exceto search que já faz isso no debounce)
  const handleFilterChange = (newFilters: typeof filters) => {
    setFilters(newFilters);
    setCurrentPage(1);
  };

  // Busca servidores
  const { data: serversData } = useQuery({
    queryKey: ['xui-servers'],
    queryFn: async () => {
      const res = await api.get('/settings/xui');
      return res.data.data as Server[];
    },
  });

  // Servidor ativo
  const activeServerId = filters.serverId || serversData?.find(s => s.isDefault)?.id || serversData?.[0]?.id || '';

  // Busca pacotes para o select
  const { data: packagesData } = useQuery({
    queryKey: ['packages-for-select'],
    queryFn: async () => {
      const res = await api.get('/packages-local/for-select');
      return res.data.data as Package[];
    },
  });

  const openEditCustomer = (customer: Customer) => {
    setSelectedCustomer(customer);
    const pkgId = (customer as any).packageId || (customer as any).package?.id || '';
    const pkg = packagesData?.find((p) => p.value === pkgId);
    const cap = connectionsCapForPackage(pkg ?? null);
    let conn = customer.connections || 1;
    if (cap != null) conn = Math.min(conn, cap);
    setEditForm({
      name: customer.name || '',
      whatsapp: customer.whatsapp || '',
      email: customer.email || '',
      telegram: customer.telegram || '',
      username: customer.username || '',
      password: customer.password || '',
      expires_at: customer.expires_at ? new Date(customer.expires_at).toISOString().slice(0, 16) : '',
      connections: conn,
      packageId: pkgId,
    });
    setEditModalOpen(true);
  };

  const sendTelegramTest = async (chatIdRaw: string) => {
    const chatId = (chatIdRaw || '').trim();
    if (!chatId) {
      toast.error('Informe o chat_id do Telegram');
      return;
    }
    setTelegramTestLoading(true);
    try {
      await api.post('/notifications/test-telegram', { chatId });
      toast.success('✅ Teste enviado no Telegram!');
    } catch (error: any) {
      toast.error(error.response?.data?.error || '❌ Erro ao enviar teste no Telegram');
    } finally {
      setTelegramTestLoading(false);
    }
  };

  // Busca clientes
  const { data: customersData, isLoading, refetch } = useQuery({
    queryKey: ['customers', activeServerId, filters, currentPage, selectedResellerId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeServerId) params.set('serverId', activeServerId);
      if (filters.search) params.set('search', filters.search);
      if (filters.status) params.set('status', filters.status);
      if (filters.isTrial) params.set('isTrial', filters.isTrial);
      if (selectedResellerId) params.set('resellerId', selectedResellerId);
      params.set('page', currentPage.toString());
      params.set('perPage', '20');
      const res = await api.get(`/customers?${params.toString()}`);
      return res.data;
    },
    enabled: !!activeServerId,
  });

  // Criar cliente
  const createMutation = useMutation({
    mutationFn: async (data: CustomerForm) => {
      // Converter para formato snake_case (PainelNeo)
      const payload: any = {
        server_id: data.serverId,
        package_id: data.packageId,
        connections: data.connections,
      };
      
      // Campos opcionais
      if (data.name) payload.name = data.name;
      if (data.whatsapp) payload.whatsapp = data.whatsapp;
      if (data.email) payload.email = data.email;
      if (data.telegram) payload.telegram = data.telegram;
      // IMPORTANTE: Sempre enviar username e password se foram gerados ou preenchidos
      // Para garantir que os valores gerados sejam usados
      if (data.username) payload.username = data.username;
      if (data.password) payload.password = data.password;
      if (data.expires_at) payload.expires_at = data.expires_at;
      
      const res = await api.post('/customers', payload);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(`Cliente criado! Usuário: ${data.data.username}`);
      setCreateModalOpen(false);
      setCustomerForm(initialCustomerForm);
      setGeneratedCredentials(null); // Limpar credenciais geradas
      // Mostra os dados - mapear camelCase para snake_case
      setSelectedCustomer({
        ...data.data,
        expires_at: data.data.expiresAt || data.data.expiresAtTz,
        is_trial: data.data.isTrial,
        m3u_url: data.data.urls?.m3u_ts,
        dns: data.data.dns, // DNS do servidor
        connections: data.data.connections || 1,
        playlist: data.data.playlist, // Template processado
      });
      setDetailsModalOpen(true);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao criar cliente');
    },
  });

  // Criar teste
  const trialMutation = useMutation({
    mutationFn: async (data: TrialForm) => {
      // Buscar pacotes do servidor selecionado
      const serversData = await api.get('/servers');
      const server = serversData.data.data?.find((s: any) => s.id === data.serverId);
      
      if (!server) {
        throw new Error('Servidor não encontrado');
      }
      
      if (!server.packages || server.packages.length === 0) {
        throw new Error('Nenhum pacote disponível neste servidor. Sincronize os pacotes primeiro.');
      }
      
      // Priorizar pacote de teste, senão usar primeiro disponível
      const trialPkg = server.packages.find((p: any) => p.is_trial === 'YES') 
        || server.packages[0];
      
      const payload: any = {
        server_id: data.serverId,
        package_id: trialPkg.id,
        trial_hours: data.hours,
        connections: 1,
      };
      
      // Campos opcionais
      if (data.name) payload.name = data.name;
      if (data.whatsapp) payload.whatsapp = data.whatsapp;
      
      const res = await api.post('/customers', payload);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(`Teste criado!`);
      setTrialModalOpen(false);
      setTrialForm(initialTrialForm);
      // Mostra os dados - mapear camelCase para snake_case
      setSelectedCustomer({
        ...data.data,
        expires_at: data.data.expiresAt || data.data.expiresAtTz,
        is_trial: true,
        status: 'ACTIVE',
        m3u_url: data.data.urls?.m3u_ts,
        dns: data.data.dns, // DNS do servidor
        connections: data.data.connections || 1,
        playlist: data.data.playlist, // Template processado
      });
      setDetailsModalOpen(true);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao criar teste');
    },
  });

  // Renovar
  const renewMutation = useMutation({
    mutationFn: async ({ id, days, isTrial }: { id: string; days: number; isTrial?: boolean }) => {
      // ⚠️ CORREÇÃO MOBILE: Refetch dos clientes ANTES de renovar para garantir externalId atualizado
      // Isso resolve o problema de cache desatualizado no mobile
      await queryClient.refetchQueries({ queryKey: ['customers'] });
      
      // Se for teste, converter para ativo ao renovar
      const payload: any = { days };
      if (isTrial) {
        payload.convert_to_official = true;
      }
      const res = await api.post(`/customers/${activeServerId}/${id}/renew`, payload);
      return res.data;
    },
    onSuccess: async (data) => {
      // Invalidar cache após sucesso
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      
      // Sempre buscar dados atualizados do usuário para garantir sincronização
      try {
        const meRes = await api.get('/auth/me');
        if (meRes.data?.data) {
          setUser(meRes.data.data); // Atualiza todos os dados do usuário, incluindo créditos
        }
      } catch (error) {
        console.error('Erro ao buscar dados atualizados do usuário:', error);
        // Fallback: se retornou userCredits na resposta, usar isso
        if (data.userCredits !== undefined && data.userCredits !== null) {
          updateCredits(data.userCredits);
        }
      }
      
      const message = data.convertedToOfficial 
        ? '✅ Cliente renovado e convertido para ativo!' 
        : '✅ Cliente renovado!';
      toast.success(message);
      setRenewModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao renovar');
    },
  });

  // Bloquear/Desbloquear
  const toggleBlockMutation = useMutation({
    mutationFn: async ({ id, block }: { id: string; block: boolean }) => {
      const res = await api.post(`/customers/${activeServerId}/${id}/${block ? 'block' : 'unblock'}`);
      return res.data;
    },
    onSuccess: (_, { block }) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      // Mensagem correta baseada na ação realizada
      const message = block ? '✅ Cliente bloqueado com sucesso' : '✅ Cliente desbloqueado com sucesso';
      toast.success(message);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || error.response?.data?.message || '❌ Erro ao alterar status do cliente');
    },
  });

  // Deletar
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/customers/${activeServerId}/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Cliente removido');
    },
  });

  // Exportar clientes
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [syncDryRun, setSyncDryRun] = useState(true);
  const [syncTargetServerId, setSyncTargetServerId] = useState('');

  const exportMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {};
      if (activeServerId) payload.serverId = activeServerId;
      if (filters.status) payload.status = filters.status;
      
      const res = await api.post('/customers/export', payload, {
        responseType: 'blob',
      });
      
      // Download do arquivo
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `clientes_export_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      return res;
    },
    onSuccess: () => {
      toast.success('✅ Clientes exportados com sucesso!');
      setExportModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '❌ Erro ao exportar clientes');
    },
  });

  // Importar clientes
  const importMutation = useMutation({
    mutationFn: async () => {
      if (!csvFile) throw new Error('Nenhum arquivo selecionado');
      if (!activeServerId) throw new Error('Servidor não selecionado');
      
      const text = await csvFile.text();
      const res = await api.post('/customers/import', {
        serverId: activeServerId,
        csvContent: text,
      });
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(`✅ Importação concluída!\n✓ Sucesso: ${data.data.success}\n⚠ Pulados: ${data.data.skipped}\n❌ Erros: ${data.data.errors}`);
      setImportModalOpen(false);
      setCsvFile(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '❌ Erro ao importar clientes');
    },
  });

  // Sincronizar clientes para novo XUI
  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!syncTargetServerId) throw new Error('Servidor destino não selecionado');
      
      const res = await api.post('/customers/sync-to-xui', {
        serverId: syncTargetServerId,
        dryRun: syncDryRun,
        source: 'panel', // Modo desastre: usar apenas dados do painel (XUI antigo pode estar fora do ar)
      });
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      const mode = syncDryRun ? '(Teste - não executado)' : '';
      toast.success(`✅ Sincronização concluída! ${mode}\n✓ Criados: ${data.data.created}\n⚠ Pulados: ${data.data.skipped}\n❌ Erros: ${data.data.errors}`);
      if (!syncDryRun) {
        setSyncModalOpen(false);
        setSyncDryRun(true);
        setSyncTargetServerId('');
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '❌ Erro ao sincronizar clientes');
    },
  });

  // Editar cliente
  const updateMutation = useMutation({
    mutationFn: async (data: typeof editForm) => {
      if (!selectedCustomer) throw new Error('Cliente não selecionado');
      const payload: any = {};
      if (data.name) payload.name = data.name;
      if (data.whatsapp) payload.whatsapp = data.whatsapp;
      if (data.email) payload.email = data.email;
      if (data.telegram) payload.telegram = data.telegram;
      if (data.username) payload.username = data.username;
      if (data.password) payload.password = data.password;
      if (data.expires_at) payload.expires_at = new Date(data.expires_at).toISOString();
      if (data.connections) payload.max_connections = data.connections;
      
      const res = await api.put(`/customers/${activeServerId}/${selectedCustomer.externalId}`, payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('✅ Cliente atualizado com sucesso!');
      setEditModalOpen(false);
      setEditForm({
        name: '',
        whatsapp: '',
        email: '',
        telegram: '',
        username: '',
        password: '',
        expires_at: '',
        connections: 1,
        packageId: '',
      });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '❌ Erro ao atualizar cliente');
    },
  });

  // Gera username/senha aleatório (mantém valores gerados)
  const generateCredentials = () => {
    const generateNumber = (length: number) => {
      let result = '';
      for (let i = 0; i < length; i++) {
        result += Math.floor(Math.random() * 10).toString();
      }
      return result;
    };
    const newUsername = generateNumber(9);
    const newPassword = generateNumber(9); // Mesmo tamanho: 9 dígitos
    const creds = { username: newUsername, password: newPassword };
    setGeneratedCredentials(creds);
    setCustomerForm({
      ...customerForm,
      username: newUsername,
      password: newPassword,
    });
  };

  // Ao mudar package, manter credenciais geradas se existirem
  const handlePackageChange = (packageId: string) => {
    const pkg = packagesData?.find((p) => p.value === packageId);
    const cap = connectionsCapForPackage(pkg ?? null);
    setCustomerForm((prev) => ({
      ...prev,
      packageId,
      username: generatedCredentials?.username || prev.username,
      password: generatedCredentials?.password || prev.password,
      connections: cap != null ? Math.min(prev.connections, cap) : prev.connections,
    }));
  };

  // Copia para clipboard com fallback
  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiado!`);
    } catch (err) {
      // Fallback para navegadores antigos ou contexto inseguro (HTTP)
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        toast.success(`${label} copiado!`);
      } catch (fallbackErr) {
        toast.error('Erro ao copiar. Copie manualmente.');
        console.error('Clipboard error:', fallbackErr);
      }
    }
  };

  // Status badge
  const getStatusBadge = (status: string, isTrial: boolean) => {
    if (isTrial) return <Badge variant="warning">Teste</Badge>;
    const variants: Record<string, 'success' | 'error' | 'warning'> = {
      ACTIVE: 'success',
      EXPIRED: 'error',
      BANNED: 'error',
      INACTIVE: 'error',
    };
    const labels: Record<string, string> = {
      ACTIVE: 'Ativo',
      EXPIRED: 'Expirado',
      BANNED: 'Bloqueado',
      INACTIVE: 'Bloqueado',
    };
    return <Badge variant={variants[status] || 'default'}>{labels[status] || status}</Badge>;
  };

  // Format date
  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'America/Sao_Paulo',
      });
    } catch (e) {
      return '-';
    }
  };

  // Open create modal
  const openCreateModal = () => {
    setGeneratedCredentials(null); // Limpar credenciais geradas
    setCustomerForm({
      ...initialCustomerForm,
      serverId: activeServerId,
    });
    setCreateModalOpen(true);
  };

  // Open trial modal
  const openTrialModal = () => {
    setTrialForm({
      ...initialTrialForm,
      serverId: activeServerId,
    });
    setTrialModalOpen(true);
  };

  if (isLoading && !customersData) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  const selectedPackage = packagesData?.find(p => p.value === customerForm.packageId);
  const createConnCap = connectionsCapForPackage(selectedPackage ?? null) ?? defaultResellerCap;
  const selectedPackageForEdit = packagesData?.find((p) => p.value === editForm.packageId);
  const editConnCap = connectionsCapForPackage(selectedPackageForEdit ?? null) ?? defaultResellerCap;

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-zinc-900 dark:text-white">👥 Clientes</h1>
          <p className="text-zinc-600 dark:text-zinc-400 text-sm lg:text-base mt-1">Gerencie os clientes IPTV</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && <Button variant="ghost" onClick={() => setExportModalOpen(true)} className="flex-1 sm:flex-none text-sm" title="Exportar clientes">
            💾 <span className="hidden sm:inline">Exportar</span>
          </Button>}
          {isAdmin && <Button variant="ghost" onClick={() => setImportModalOpen(true)} className="flex-1 sm:flex-none text-sm" title="Importar clientes">
            📂 <span className="hidden sm:inline">Importar</span>
          </Button>}
          {isAdmin && <Button variant="ghost" onClick={() => setSyncModalOpen(true)} className="flex-1 sm:flex-none text-sm" title="Sincronizar para novo XUI">
            🔄 <span className="hidden sm:inline">Sincronizar</span>
          </Button>}
          <div className="w-px bg-zinc-300 dark:bg-zinc-700 hidden sm:block"></div>
          <Button variant="outline" onClick={openTrialModal} className="flex-1 sm:flex-none text-sm">
            🧪 <span className="hidden sm:inline">Criar</span> Teste
          </Button>
          <Button onClick={openCreateModal} className="flex-1 sm:flex-none text-sm">
            ➕ <span className="hidden sm:inline">Novo</span> Cliente
          </Button>
        </div>
      </div>

      <div className="h-1 w-full bg-gradient-to-r from-emerald-500 to-cyan-600 rounded-full opacity-80" />

      {/* Filtro por Revendedor */}
      <div className="mb-2">
        <ResellerTreeDropdown
          value={selectedResellerId}
          onChange={(id, name) => {
            setSelectedResellerId(id);
            setSelectedResellerName(name);
            setCurrentPage(1);
          }}
          placeholder="Todos os revendedores"
          allOptionLabel="Todos os revendedores (todos os clientes)"
        />
      </div>

      {/* Filtros */}
      <div className="grid grid-cols-2 sm:flex gap-2 lg:gap-4">
        <Input
          placeholder="🔍 Buscar..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="col-span-2 sm:w-48 lg:w-64"
        />
        <Select
          value={filters.serverId}
          onChange={(e) => handleFilterChange({ ...filters, serverId: e.target.value })}
          className="sm:w-40 lg:w-48"
        >
          <option value="">Servidor</option>
          {serversData?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select
          value={filters.status}
              onChange={(e) => handleFilterChange({ ...filters, status: e.target.value })}
          className="sm:w-28 lg:w-36"
        >
          <option value="">Status</option>
          <option value="ACTIVE">Ativos</option>
          <option value="EXPIRED">Expirados</option>
          <option value="INACTIVE">Bloqueados</option>
          <option value="BANNED">Bloqueados (legado)</option>
        </Select>
        <Select
          value={filters.isTrial}
              onChange={(e) => handleFilterChange({ ...filters, isTrial: e.target.value })}
          className="hidden sm:block sm:w-28 lg:w-36"
        >
          <option value="">Tipo</option>
          <option value="false">Regulares</option>
          <option value="true">Testes</option>
        </Select>
        <Button variant="ghost" onClick={() => refetch()} className="hidden sm:flex">
          🔄
        </Button>
      </div>

      {/* Lista de Clientes - Cards Mobile / Tabela Desktop */}
      <Card className="relative overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-emerald-500 to-cyan-600 opacity-80" />
        {/* Desktop: Tabela */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50">
              <tr className="text-zinc-700 dark:text-zinc-400 text-xs lg:text-sm font-medium">
                <th className="text-left py-3 px-4 cursor-pointer select-none hover:text-zinc-900 dark:hover:text-white" onClick={() => toggleCustSort('username')}>Usuário<CustSortIcon field="username" /></th>
                <th className="text-left py-3 px-4 cursor-pointer select-none hover:text-zinc-900 dark:hover:text-white" onClick={() => toggleCustSort('status')}>Status<CustSortIcon field="status" /></th>
                <th className="text-left py-3 px-4 cursor-pointer select-none hover:text-zinc-900 dark:hover:text-white" onClick={() => toggleCustSort('expires_at')}>Vencimento<CustSortIcon field="expires_at" /></th>
                <th className="text-left py-3 px-4 cursor-pointer select-none hover:text-zinc-900 dark:hover:text-white" onClick={() => toggleCustSort('days_until_expiry')}>Dias Restantes<CustSortIcon field="days_until_expiry" /></th>
                <th className="text-left py-3 px-4 hidden lg:table-cell cursor-pointer select-none hover:text-zinc-900 dark:hover:text-white" onClick={() => toggleCustSort('connections')}>Conexões<CustSortIcon field="connections" /></th>
                <th className="text-left py-3 px-4 hidden lg:table-cell cursor-pointer select-none hover:text-zinc-900 dark:hover:text-white" onClick={() => toggleCustSort('name')}>Contato<CustSortIcon field="name" /></th>
                <th className="text-right py-3 px-4">Ações</th>
              </tr>
            </thead>
            <tbody>
              {(custSortBy
                ? [...(customersData?.data || [])].sort((a: Customer, b: Customer) => {
                    const dir = custSortDir === 'asc' ? 1 : -1;
                    const field = custSortBy as keyof Customer;
                    const va = a[field] ?? '';
                    const vb = b[field] ?? '';
                    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
                    return String(va).localeCompare(String(vb), 'pt-BR') * dir;
                  })
                : customersData?.data
              )?.map((customer: Customer) => (
                <tr key={customer.id} className="border-t border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-900 dark:text-white font-mono text-sm">{customer.username}</span>
                      <button
                        onClick={() => copyToClipboard(customer.username, 'Usuário')}
                        className="text-zinc-500 hover:text-cyan-400 transition-colors shrink-0"
                      >
                        📋
                      </button>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    {getStatusBadge(customer.status, customer.is_trial)}
                  </td>
                  <td className="py-3 px-4 text-zinc-600 dark:text-zinc-300 text-xs">
                    {formatDate(customer.expires_at)}
                  </td>
                  <td className="py-3 px-4">
                    {customer.days_until_expiry !== undefined ? (
                      <span
                        className={`font-medium text-sm ${
                          customer.is_trial && (customer.hours_until_expiry > 0)
                            ? 'text-cyan-400'
                            : customer.days_until_expiry <= 0 && (customer.hours_until_expiry ?? 0) <= 0
                            ? 'text-red-400'
                            : customer.days_until_expiry <= 3
                            ? 'text-yellow-400'
                            : 'text-green-400'
                        }`}
                      >
                        {customer.is_trial && (customer.hours_until_expiry > 0)
                          ? `🧪 ${customer.hours_until_expiry}h`
                          : customer.days_until_expiry > 0
                          ? `⏱️ ${customer.days_until_expiry}d`
                          : (customer.hours_until_expiry ?? 0) > 0
                          ? `⏱️ ${customer.hours_until_expiry}h`
                          : '❌ Expirado'}
                      </span>
                    ) : (
                      <span className="text-zinc-500 text-xs">-</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-zinc-700 dark:text-zinc-300 hidden lg:table-cell">{customer.connections}</td>
                  <td className="py-3 px-4 hidden lg:table-cell">
                    {customer.name && <span className="text-zinc-700 dark:text-zinc-300 text-sm">{customer.name}</span>}
                    {customer.whatsapp && (
                      <span className="text-xs text-zinc-500 dark:text-zinc-500 ml-1">({customer.whatsapp})</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex gap-1 justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          try {
                            const serverId = (customer as any).serverId || (customer as any).server?.id;
                            if (!serverId) {
                              toast.error('Servidor não encontrado');
                              return;
                            }
                            const res = await api.get(`/customers/${serverId}/${customer.externalId}`);
                            setSelectedCustomer({
                              ...res.data.data,
                              // Garantir que username e password sempre existam
                              username: res.data.data.username || customer.username,
                              password: res.data.data.password || customer.password,
                              expires_at: res.data.data.expires_at || res.data.data.expiresAt,
                              is_trial: res.data.data.is_trial,
                              status: res.data.data.status,
                              m3u_url: res.data.data.urls?.m3u_ts || res.data.data.m3u_url,
                              dns: res.data.data.dns,
                              connections: res.data.data.connections || 1,
                            });
                            setDetailsModalOpen(true);
                          } catch (error: any) {
                            console.error('Erro ao buscar detalhes do cliente:', error);
                            // Usar dados locais mesmo com erro - priorizar campo dns direto, depois server.dnsPrimary
                            setSelectedCustomer({
                              ...customer,
                              dns: (customer as any).dns || (customer as any).server?.dnsPrimary || (customer as any).server?.baseUrl?.replace(/\/$/, '') || 'Não configurado',
                            });
                            setDetailsModalOpen(true);
                          }
                        }}
                        title="Ver detalhes"
                        className="p-2 hover:bg-blue-100 dark:hover:bg-cyan-500/10 hover:text-blue-600 dark:hover:text-cyan-400"
                      >
                        👁️
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setSelectedCustomer(customer);
                          setRenewDays(30);
                          setRenewModalOpen(true);
                        }}
                        title="Renovar"
                        className="p-2 hover:bg-green-100 dark:hover:bg-green-500/10 hover:text-green-600 dark:hover:text-green-400"
                      >
                        🔄
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditCustomer(customer)}
                        title="Editar"
                        className="p-2 hover:bg-blue-100 dark:hover:bg-blue-500/10 hover:text-blue-600 dark:hover:text-blue-400"
                      >
                        ✏️
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const isBlocked = customer.status === 'INACTIVE' || customer.status === 'BANNED';
                          if (isBlocked) {
                            if (confirm('Desbloquear este cliente?')) {
                              toggleBlockMutation.mutate({
                                id: customer.externalId,
                                block: false,
                              });
                            }
                          } else {
                            if (confirm('Bloquear este cliente?')) {
                              toggleBlockMutation.mutate({
                                id: customer.externalId,
                                block: true,
                              });
                            }
                          }
                        }}
                        title={customer.status === 'INACTIVE' || customer.status === 'BANNED' ? 'Desbloquear' : 'Bloquear'}
                        className={`p-2 ${
                          customer.status === 'INACTIVE' || customer.status === 'BANNED'
                            ? 'text-red-400 hover:text-red-300 hover:bg-red-500/10' 
                            : 'text-zinc-400 hover:text-orange-400 hover:bg-orange-500/10'
                        }`}
                        loading={toggleBlockMutation.isPending}
                      >
                        {customer.status === 'INACTIVE' || customer.status === 'BANNED' ? '🔒' : '🔓'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 dark:text-red-400 p-2 hover:bg-red-100 dark:hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-300"
                        onClick={() => {
                          if (confirm('Deletar este cliente?')) {
                            deleteMutation.mutate(customer.externalId);
                          }
                        }}
                        title="Deletar"
                      >
                        🗑️
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {(!customersData?.data || customersData.data.length === 0) && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-zinc-500 dark:text-zinc-400">
                    Nenhum cliente encontrado
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile: Cards */}
        <div className="md:hidden">
          {customersData?.data?.map((customer: Customer) => {
            const isBlocked = customer.status === 'INACTIVE' || customer.status === 'BANNED';
            return (
              <div
                key={customer.id}
                className="border-b border-zinc-200 dark:border-zinc-800 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-zinc-900 dark:text-white font-mono text-base font-semibold truncate">
                        {customer.username}
                      </span>
                      <button
                        onClick={() => copyToClipboard(customer.username, 'Usuário')}
                        className="text-zinc-500 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-cyan-400 shrink-0"
                      >
                        📋
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      {getStatusBadge(customer.status, customer.is_trial)}
                    </div>
                  </div>
                </div>

                {/* Informações principais */}
                <div className="space-y-2 mb-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-600 dark:text-zinc-400">📅 Vencimento:</span>
                    <span className="text-zinc-900 dark:text-white font-medium">{formatDate(customer.expires_at)}</span>
                  </div>
                  {customer.days_until_expiry !== undefined && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-600 dark:text-zinc-400">{customer.is_trial ? '🧪 Tempo restante:' : '⏱️ Dias restantes:'}</span>
                      <span
                        className={`font-semibold ${
                          customer.is_trial && (customer.hours_until_expiry > 0)
                            ? 'text-cyan-400'
                            : customer.days_until_expiry <= 0 && (customer.hours_until_expiry ?? 0) <= 0
                            ? 'text-red-400'
                            : customer.days_until_expiry <= 3
                            ? 'text-yellow-400'
                            : 'text-green-400'
                        }`}
                      >
                        {customer.is_trial && (customer.hours_until_expiry > 0)
                          ? `${customer.hours_until_expiry}h restantes`
                          : customer.days_until_expiry > 0
                          ? `${customer.days_until_expiry} ${customer.days_until_expiry === 1 ? 'dia' : 'dias'}`
                          : (customer.hours_until_expiry ?? 0) > 0
                          ? `${customer.hours_until_expiry}h restantes`
                          : '❌ Expirado'}
                      </span>
                    </div>
                  )}
                  {customer.name && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-600 dark:text-zinc-400">👤 Nome:</span>
                      <span className="text-zinc-900 dark:text-white">{customer.name}</span>
                    </div>
                  )}
                  {customer.whatsapp && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-600 dark:text-zinc-400">📱 WhatsApp:</span>
                      <span className="text-zinc-900 dark:text-white text-xs">{customer.whatsapp}</span>
                    </div>
                  )}
                  {customer.telegram && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-600 dark:text-zinc-400">✈️ Telegram:</span>
                      <span className="text-zinc-900 dark:text-white text-xs">{customer.telegram}</span>
                    </div>
                  )}
                </div>

                {/* Botões de ação */}
                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-zinc-200 dark:border-zinc-800">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        const serverId = (customer as any).serverId || (customer as any).server?.id;
                        if (!serverId) {
                          toast.error('Servidor não encontrado');
                          return;
                        }
                        const res = await api.get(`/customers/${serverId}/${customer.externalId}`);
                        setSelectedCustomer({
                          ...res.data.data,
                          // Garantir que username e password sempre existam
                          username: res.data.data.username || customer.username,
                          password: res.data.data.password || customer.password,
                          expires_at: res.data.data.expires_at,
                          is_trial: res.data.data.is_trial,
                          status: res.data.data.status,
                          m3u_url: res.data.data.urls?.m3u_ts || res.data.data.m3u_url,
                          dns: res.data.data.dns,
                          connections: res.data.data.connections || 1,
                        });
                        setDetailsModalOpen(true);
                      } catch (error: any) {
                        console.error('Erro ao buscar detalhes:', error);
                        setSelectedCustomer(customer);
                        setDetailsModalOpen(true);
                      }
                    }}
                    className="text-xs py-2 hover:bg-blue-100 dark:hover:bg-cyan-500/10 hover:text-blue-600 dark:hover:text-cyan-400"
                  >
                    👁️ Detalhes
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSelectedCustomer(customer);
                      setRenewDays(30);
                      setRenewModalOpen(true);
                    }}
                    className="text-xs py-2 hover:bg-green-100 dark:hover:bg-green-500/10 hover:text-green-600 dark:hover:text-green-400"
                  >
                    🔄 Renovar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openEditCustomer(customer)}
                    className="text-xs py-2 hover:bg-blue-100 dark:hover:bg-blue-500/10 hover:text-blue-600 dark:hover:text-blue-400"
                  >
                    ✏️ Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (isBlocked) {
                        if (confirm('Desbloquear este cliente?')) {
                          toggleBlockMutation.mutate({
                            id: customer.externalId,
                            block: false,
                          });
                        }
                      } else {
                        if (confirm('Bloquear este cliente?')) {
                          toggleBlockMutation.mutate({
                            id: customer.externalId,
                            block: true,
                          });
                        }
                      }
                    }}
                    className={`text-xs py-2 ${
                      isBlocked
                        ? 'text-red-400 hover:text-red-300 hover:bg-red-500/10' 
                        : 'text-orange-400 hover:text-orange-300 hover:bg-orange-500/10'
                    }`}
                    loading={toggleBlockMutation.isPending}
                  >
                    {isBlocked ? '🔒 Desbloquear' : '🔓 Bloquear'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-400 text-xs py-2 col-span-2 hover:bg-red-500/10 hover:text-red-300"
                    onClick={() => {
                      if (confirm('Deletar este cliente?')) {
                        deleteMutation.mutate(customer.externalId);
                      }
                    }}
                  >
                    🗑️ Deletar
                  </Button>
                </div>
              </div>
            );
          })}
          {(!customersData?.data || customersData.data.length === 0) && (
            <div className="py-12 text-center text-zinc-500 dark:text-zinc-400">
              Nenhum cliente encontrado
            </div>
          )}
        </div>

        {/* Paginação */}
        {customersData?.meta && customersData.meta.last_page > 1 && (
          <Pagination
            currentPage={customersData.meta.current_page}
            lastPage={customersData.meta.last_page}
            total={customersData.meta.total}
            from={customersData.meta.from}
            to={customersData.meta.to}
            onPageChange={(page) => {
              setCurrentPage(page);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        )}
      </Card>

      {/* Modal Criar Cliente */}
      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="➕ Novo Cliente"
        size="lg"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate(customerForm);
          }}
          className="space-y-4"
        >
          {/* Seleção de Pacote */}
          <Select
            label="📦 Selecione o Pacote *"
            value={customerForm.packageId}
            onChange={(e) => handlePackageChange(e.target.value)}
            required
          >
            <option value="">Selecione um pacote...</option>
            {packagesData
              ?.filter((p) => !p.isTrial)
              .map((pkg) => (
                <option key={pkg.value} value={pkg.value}>
                  {pkg.label} - {pkg.credits} créditos - R$ {(pkg.planPrice / 100).toFixed(2)}
                </option>
              ))}
          </Select>

          {selectedPackage && (
            <div className="bg-zinc-100 dark:bg-zinc-800/50 rounded-lg p-3 text-sm">
              <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                <span>Servidor:</span>
                <span className="text-zinc-900 dark:text-white">{selectedPackage.serverName}</span>
              </div>
              <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                <span>Custo:</span>
                <span className="text-blue-600 dark:text-cyan-400">{selectedPackage.credits} créditos</span>
              </div>
              <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                <span>Conexões:</span>
                <span className="text-zinc-900 dark:text-white">{selectedPackage.connections}</span>
              </div>
            </div>
          )}

          <Input
            label="Número de conexões"
            type="number"
            min={1}
            max={createConnCap ?? undefined}
            value={customerForm.connections}
            onChange={(e) => {
              const raw = parseInt(e.target.value, 10) || 1;
              const cap = createConnCap ?? Number.MAX_SAFE_INTEGER;
              const v = isResellerFamily ? Math.min(Math.max(1, raw), cap) : Math.max(1, raw);
              setCustomerForm({ ...customerForm, connections: v });
            }}
          />
          {isResellerFamily && createConnCap != null && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 -mt-2">
              Máximo permitido para sua conta: {createConnCap} (conforme pacote e política do painel).
            </p>
          )}

          {/* Data de Vencimento (Opcional) */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              📅 Data de Vencimento (Opcional)
            </label>
            <input
              type="datetime-local"
              value={customerForm.expires_at ? new Date(customerForm.expires_at).toISOString().slice(0, 16) : ''}
              onChange={(e) => {
                const value = e.target.value;
                setCustomerForm({ 
                  ...customerForm, 
                  expires_at: value ? new Date(value).toISOString() : undefined 
                });
              }}
              className="w-full px-4 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-cyan-500 focus:border-transparent"
            />
            <p className="mt-1 text-sm text-zinc-500">
              Se não informar, será calculado baseado na duração do pacote
            </p>
          </div>

          <div className="border-t border-zinc-700 pt-4">
            <h4 className="text-sm font-medium text-zinc-300 mb-3">Dados de Contato (opcional)</h4>
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="Nome do Cliente"
                value={customerForm.name}
                onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
              />
              <Input
                label="WhatsApp"
                value={customerForm.whatsapp}
                onChange={(e) => setCustomerForm({ ...customerForm, whatsapp: e.target.value })}
                placeholder="5524999999999"
              />
            </div>
            <Input
              label="Email"
              type="email"
              value={customerForm.email}
              onChange={(e) => setCustomerForm({ ...customerForm, email: e.target.value })}
              className="mt-4"
            />
            <Input
              label="Telegram (chat_id)"
              value={customerForm.telegram}
              onChange={(e) => setCustomerForm({ ...customerForm, telegram: e.target.value })}
              placeholder="123456789 ou -1001234567890"
              className="mt-4"
            />
            <div className="mt-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/40 p-3 space-y-2">
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Como pegar o chat_id</p>
              <ol className="text-xs text-zinc-600 dark:text-zinc-400 list-decimal list-inside space-y-1">
                <li>Configure o Token em Configurações → Notificações → Telegram.</li>
                <li>Abra seu bot no Telegram e envie qualquer mensagem (Start).</li>
                <li>Use o @userinfobot para ver seu chat_id e cole aqui.</li>
              </ol>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => window.open('https://t.me/userinfobot', '_blank', 'noopener,noreferrer')}
                >
                  Abrir @userinfobot
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => sendTelegramTest(customerForm.telegram)}
                  loading={telegramTestLoading}
                  disabled={!customerForm.telegram.trim()}
                >
                  Testar Telegram
                </Button>
              </div>
            </div>
          </div>

          <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Credenciais (opcional)</h4>
              <Button type="button" size="sm" variant="outline" onClick={generateCredentials}>
                🎲 Gerar Automático
              </Button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="Usuário"
                value={customerForm.username}
                onChange={(e) => setCustomerForm({ ...customerForm, username: e.target.value })}
                placeholder="Deixe vazio para gerar"
              />
              <Input
                label="Senha"
                value={customerForm.password}
                onChange={(e) => setCustomerForm({ ...customerForm, password: e.target.value })}
                placeholder="Deixe vazio para gerar"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-zinc-700">
            <Button type="button" variant="ghost" onClick={() => setCreateModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              loading={createMutation.isPending}
              disabled={!customerForm.packageId}
            >
              ✅ Criar Cliente
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Criar Teste */}
      <Modal
        isOpen={trialModalOpen}
        onClose={() => setTrialModalOpen(false)}
        title="🧪 Criar Teste Rápido"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            trialMutation.mutate(trialForm);
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Duração do Teste</label>
            <div className="flex gap-2">
              {[3, 6, 12, 24].map((hours) => (
                <button
                  key={hours}
                  type="button"
                  onClick={() => setTrialForm({ ...trialForm, hours })}
                  className={`flex-1 py-3 rounded-lg text-sm font-medium transition-colors ${
                    trialForm.hours === hours
                      ? 'bg-blue-600 dark:bg-cyan-500 text-white shadow-sm'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-300 dark:border-zinc-600'
                  }`}
                  >
                  {hours}h
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
            <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3">Dados do Cliente (opcional)</h4>
            <Input
              label="Nome"
              value={trialForm.name}
              onChange={(e) => setTrialForm({ ...trialForm, name: e.target.value })}
            />
            <Input
              label="WhatsApp"
              value={trialForm.whatsapp}
              onChange={(e) => setTrialForm({ ...trialForm, whatsapp: e.target.value })}
              placeholder="5524999999999"
              className="mt-4"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-zinc-700">
            <Button type="button" variant="ghost" onClick={() => setTrialModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={trialMutation.isPending}>
              🚀 Gerar Teste
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Detalhes do Cliente - Melhorado */}
      <Modal
        isOpen={detailsModalOpen}
        onClose={() => setDetailsModalOpen(false)}
        title="✅ Cliente Criado com Sucesso!"
        size="lg"
      >
        {selectedCustomer && (
          <div className="space-y-4">
            {/* Banner de Sucesso */}
            <div className="bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-500/20 dark:to-cyan-500/20 rounded-lg p-4 border border-green-200 dark:border-green-500/30">
              <p className="text-center text-green-700 dark:text-green-400 font-semibold">
                🎉 {selectedCustomer.is_trial ? 'Teste' : 'Cliente'} criado com sucesso!
              </p>
            </div>

            {/* Seção: Dados de Acesso */}
            <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-3 flex items-center gap-2">
                📺 Dados de Acesso
              </h3>
              <div className="space-y-3">
                <div className="bg-gradient-to-r from-cyan-500/20 to-purple-500/20 rounded-lg p-4 text-center">
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-1">👤 Usuário</p>
                  <p className="text-2xl font-mono font-bold text-zinc-900 dark:text-white mb-3">
                    {selectedCustomer.username}
                  </p>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-1">🔑 Senha</p>
                  <p className="text-xl font-mono text-zinc-700 dark:text-zinc-300">{selectedCustomer.password}</p>
                </div>
                
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-zinc-100 dark:bg-zinc-900/50 rounded p-2">
                    <p className="text-zinc-600 dark:text-zinc-400 text-xs">Status</p>
                    <div className="mt-1">{getStatusBadge(selectedCustomer.status, selectedCustomer.is_trial)}</div>
                  </div>
                  <div className="bg-zinc-100 dark:bg-zinc-900/50 rounded p-2">
                    <p className="text-zinc-600 dark:text-zinc-400 text-xs">Vencimento</p>
                    <p className="text-zinc-900 dark:text-white font-medium">{formatDate(selectedCustomer.expires_at)}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Seção: Configuração XCIPTV */}
            {selectedCustomer.m3u_url && (
              <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-3 flex items-center gap-2">
                  📱 Para XCIPTV / Smarters
                </h3>
                <div className="space-y-2">
                  <div className="bg-white dark:bg-zinc-900/50 rounded p-3 border border-zinc-200 dark:border-zinc-700">
                    <p className="text-zinc-600 dark:text-zinc-400 text-xs mb-1">🌐 DNS / Servidor</p>
                    <p className="text-blue-600 dark:text-cyan-400 text-sm font-mono break-all">
                      {selectedCustomer.dns || 'Não configurado'}
                    </p>
                  </div>
                  <div className="bg-white dark:bg-zinc-900/50 rounded p-3 border border-zinc-200 dark:border-zinc-700">
                    <p className="text-zinc-600 dark:text-zinc-400 text-xs mb-1">👤 Usuário</p>
                    <p className="text-zinc-900 dark:text-white text-sm font-mono">{selectedCustomer.username}</p>
                  </div>
                  <div className="bg-white dark:bg-zinc-900/50 rounded p-3 border border-zinc-200 dark:border-zinc-700">
                    <p className="text-zinc-600 dark:text-zinc-400 text-xs mb-1">🔑 Senha</p>
                    <p className="text-zinc-900 dark:text-white text-sm font-mono">{selectedCustomer.password}</p>
                  </div>
                  <div className="bg-white dark:bg-zinc-900/50 rounded p-3 border border-zinc-200 dark:border-zinc-700">
                    <p className="text-zinc-600 dark:text-zinc-400 text-xs mb-1">🔗 Link M3U</p>
                    <p className="text-blue-600 dark:text-cyan-400 text-xs font-mono break-all">{selectedCustomer.m3u_url}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Seção: Aplicativo Parceiro (se houver dados) */}
            {selectedCustomer.m3u_url && (
              <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-3 flex items-center gap-2">
                  🎬 Aplicativo Parceiro
                </h3>
                <div className="space-y-2">
                  <div className="bg-white dark:bg-zinc-900/50 rounded p-3 border border-zinc-200 dark:border-zinc-700">
                    <p className="text-zinc-600 dark:text-zinc-400 text-xs mb-1">🌐 Servidor</p>
                    <p className="text-blue-600 dark:text-cyan-400 text-sm font-mono break-all">
                      {selectedCustomer.dns || 'Não configurado'}
                    </p>
                  </div>
                  <div className="bg-white dark:bg-zinc-900/50 rounded p-3 border border-zinc-200 dark:border-zinc-700">
                    <p className="text-zinc-600 dark:text-zinc-400 text-xs mb-1">👤 Login</p>
                    <p className="text-zinc-900 dark:text-white text-sm font-mono">{selectedCustomer.username}</p>
                  </div>
                  <div className="bg-white dark:bg-zinc-900/50 rounded p-3 border border-zinc-200 dark:border-zinc-700">
                    <p className="text-zinc-600 dark:text-zinc-400 text-xs mb-1">🔑 Senha</p>
                    <p className="text-zinc-900 dark:text-white text-sm font-mono">{selectedCustomer.password}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Botões de Ação */}
            <div className="flex flex-col gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
              {/* Template Completo para WhatsApp */}
              <Button
                className="w-full bg-green-600 hover:bg-green-700 text-white"
                onClick={async () => {
                  const template = `📺 *ACESSO IPTV CRIADO COM SUCESSO!*

👤 *Usuário:* ${selectedCustomer.username}
🔑 *Senha:* ${selectedCustomer.password}

📱 *Para XCIPTV/Smarters:*
🌐 DNS: ${selectedCustomer.dns || 'Não configurado'}
👤 Usuário: ${selectedCustomer.username}
🔑 Senha: ${selectedCustomer.password}

${selectedCustomer.m3u_url ? `🔗 *Link M3U:*
${selectedCustomer.m3u_url}

` : ''}📅 *Vencimento:* ${formatDate(selectedCustomer.expires_at)}
📶 *Conexões:* ${selectedCustomer.connections || 1}

⚠️ *Importante:* Não compartilhe suas credenciais!`;

                  // Copiar para clipboard
                  copyToClipboard(template, 'Template completo');
                  
                  // Tentar abrir WhatsApp nativo primeiro, depois WhatsApp Web
                  const whatsappNumber = selectedCustomer.whatsapp?.replace(/\D/g, '') || '';
                  const whatsappUrl = whatsappNumber 
                    ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(template)}`
                    : `https://wa.me/?text=${encodeURIComponent(template)}`;
                  
                  // Tentar abrir WhatsApp nativo
                  const whatsappNativeUrl = `whatsapp://send?text=${encodeURIComponent(template)}`;
                  
                  const link = document.createElement('a');
                  link.href = whatsappNativeUrl;
                  link.style.display = 'none';
                  document.body.appendChild(link);
                  
                  try {
                    link.click();
                    // Se não abrir em 500ms, tenta WhatsApp Web
                    setTimeout(() => {
                      window.open(whatsappUrl, '_blank');
                    }, 500);
                    toast.success('Template copiado! WhatsApp aberto.');
                  } catch (e) {
                    // Fallback para WhatsApp Web
                    window.open(whatsappUrl, '_blank');
                    toast.success('Template copiado! WhatsApp aberto.');
                  } finally {
                    document.body.removeChild(link);
                  }
                }}
              >
                📱 Enviar para WhatsApp
              </Button>

              {/* Botões secundários */}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    const text = `👤 Usuário: ${selectedCustomer.username}\n🔑 Senha: ${selectedCustomer.password}`;
                    copyToClipboard(text, 'Credenciais');
                  }}
                >
                  📋 Copiar Credenciais
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    // Se tem template processado (playlist), usa ele, senão gera template padrão
                    const formatDate = (dateStr: string) => {
                      return new Date(dateStr).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'America/Sao_Paulo',
                      });
                    };
                    const templateToCopy = selectedCustomer.playlist || `📺 *ACESSO IPTV CRIADO COM SUCESSO!*

👤 *Usuário:* ${selectedCustomer.username}
🔑 *Senha:* ${selectedCustomer.password}

📱 *Para XCIPTV/Smarters:*
🌐 DNS: ${selectedCustomer.dns || 'Não configurado'}
👤 Usuário: ${selectedCustomer.username}
🔑 Senha: ${selectedCustomer.password}

${selectedCustomer.m3u_url ? `🔗 *Link M3U:*
${selectedCustomer.m3u_url}

` : ''}📅 *Vencimento:* ${formatDate(selectedCustomer.expires_at)}
📶 *Conexões:* ${selectedCustomer.connections || 1}

⚠️ *Importante:* Não compartilhe suas credenciais!`;
                    copyToClipboard(templateToCopy, 'Template completo');
                  }}
                >
                  📝 Copiar Template Completo
                </Button>
              </div>
              {selectedCustomer.m3u_url && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    copyToClipboard(selectedCustomer.m3u_url!, 'Link M3U');
                  }}
                >
                  🔗 Copiar Link M3U
                </Button>
              )}

              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setDetailsModalOpen(false)}
              >
                Fechar
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal Renovar */}
      <Modal
        isOpen={renewModalOpen}
        onClose={() => setRenewModalOpen(false)}
        title={`🔄 Renovar: ${selectedCustomer?.username}`}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Dias para renovar</label>
            <div className="flex gap-2 flex-wrap">
              {[7, 15, 30, 60, 90].map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setRenewDays(days)}
                  className={`px-4 py-2 rounded-lg text-sm ${
                    renewDays === days
                      ? 'bg-cyan-500 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                  }`}
                >
                  {days} dias
                </button>
              ))}
            </div>
          </div>

          <Input
            label="Ou digite a quantidade"
            type="number"
            min={1}
            value={renewDays}
            onChange={(e) => setRenewDays(parseInt(e.target.value) || 30)}
          />

          <div className="flex justify-end gap-3 pt-4 border-t border-zinc-700">
            <Button variant="ghost" onClick={() => setRenewModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (selectedCustomer) {
                  renewMutation.mutate({ 
                    id: selectedCustomer.externalId, 
                    days: renewDays,
                    isTrial: selectedCustomer.is_trial 
                  });
                }
              }}
              loading={renewMutation.isPending}
            >
              ✅ Renovar {renewDays} dias
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal Editar Cliente */}
      <Modal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title={`✏️ Editar: ${selectedCustomer?.username}`}
        size="lg"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateMutation.mutate(editForm);
          }}
          className="space-y-4"
        >
          {/* Seleção de Pacote */}
          <Select
            label="📦 Pacote"
            value={editForm.packageId}
            onChange={(e) => {
              const newPkgId = e.target.value;
              const pkg = packagesData?.find((p) => p.value === newPkgId);
              const cap = connectionsCapForPackage(pkg ?? null);
              setEditForm((prev) => ({
                ...prev,
                packageId: newPkgId,
                connections: cap != null ? Math.min(prev.connections, cap) : prev.connections,
              }));
            }}
          >
            <option value="">Selecione um pacote...</option>
            {packagesData?.map((pkg) => (
              <option key={pkg.value} value={pkg.value}>
                {pkg.label} - {pkg.credits} créditos - R$ {(pkg.planPrice / 100).toFixed(2)}
              </option>
            ))}
          </Select>

          <Input
            label="Nome"
            value={editForm.name}
            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            placeholder="Nome do cliente"
          />

          <Input
            label="WhatsApp"
            value={editForm.whatsapp}
            onChange={(e) => setEditForm({ ...editForm, whatsapp: e.target.value })}
            placeholder="5524999999999"
          />

          <Input
            label="Telegram (chat_id)"
            value={editForm.telegram}
            onChange={(e) => setEditForm({ ...editForm, telegram: e.target.value })}
            placeholder="123456789 ou -1001234567890"
          />

          <Input
            label="Email"
            type="email"
            value={editForm.email}
            onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
            placeholder="email@exemplo.com"
          />

          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/40 p-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => window.open('https://t.me/userinfobot', '_blank', 'noopener,noreferrer')}
              >
                Abrir @userinfobot
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => sendTelegramTest(editForm.telegram)}
                loading={telegramTestLoading}
                disabled={!editForm.telegram.trim()}
              >
                Testar Telegram
              </Button>
            </div>
          </div>

          <Input
            label="👤 Usuário (Login XUI)"
            value={editForm.username}
            onChange={(e) => setEditForm({ ...editForm, username: e.target.value })}
            placeholder="Usuário de acesso do cliente"
          />

          <Input
            label="🔑 Senha (Senha XUI)"
            type="text"
            value={editForm.password}
            onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
            placeholder="Senha de acesso do cliente"
          />

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              📅 Data de Vencimento
            </label>
            <input
              type="datetime-local"
              value={editForm.expires_at}
              onChange={(e) => setEditForm({ ...editForm, expires_at: e.target.value })}
              className="w-full px-4 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-cyan-500 focus:border-transparent"
            />
          </div>

          <Input
            label="Número de conexões"
            type="number"
            min={1}
            max={editConnCap ?? undefined}
            value={editForm.connections}
            onChange={(e) => {
              const raw = parseInt(e.target.value, 10) || 1;
              const cap = editConnCap ?? Number.MAX_SAFE_INTEGER;
              const v = isResellerFamily ? Math.min(Math.max(1, raw), cap) : Math.max(1, raw);
              setEditForm({ ...editForm, connections: v });
            }}
          />
          {isResellerFamily && editConnCap != null && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 -mt-2">
              Máximo permitido para sua conta: {editConnCap}.
            </p>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-zinc-700">
            <Button type="button" variant="ghost" onClick={() => setEditModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={updateMutation.isPending}>
              💾 Salvar Alterações
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Exportar */}
      <Modal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        title="💾 Exportar Clientes"
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Exportar todos os clientes do servidor atual para um arquivo CSV.
          </p>
          
          {filters.status && (
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <p className="text-sm text-blue-700 dark:text-blue-300">
                ℹ️ Filtro aplicado: Apenas clientes com status <strong>{filters.status}</strong> serão exportados.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-zinc-300 dark:border-zinc-700">
            <Button variant="ghost" onClick={() => setExportModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => exportMutation.mutate()}
              loading={exportMutation.isPending}
            >
              💾 Exportar CSV
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal Importar */}
      <Modal
        isOpen={importModalOpen}
        onClose={() => {
          setImportModalOpen(false);
          setCsvFile(null);
        }}
        title="📂 Importar Clientes"
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Importar clientes de um arquivo CSV para o servidor atual.
          </p>

          <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg space-y-2">
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
              ⚠️ Regras de Importação:
            </p>
            <ul className="text-sm text-yellow-700 dark:text-yellow-400 list-disc list-inside space-y-1">
              <li>Clientes que já existem serão <strong>pulados</strong></li>
              <li>Apenas novos clientes serão criados</li>
              <li>O arquivo deve estar no formato CSV correto</li>
            </ul>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              Selecione o arquivo CSV
            </label>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
              className="w-full px-4 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-cyan-900/50 dark:file:text-cyan-300 dark:hover:file:bg-cyan-900"
            />
            {csvFile && (
              <p className="mt-2 text-sm text-green-600 dark:text-green-400">
                ✅ Arquivo selecionado: {csvFile.name}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-zinc-300 dark:border-zinc-700">
            <Button 
              variant="ghost" 
              onClick={() => {
                setImportModalOpen(false);
                setCsvFile(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => importMutation.mutate()}
              loading={importMutation.isPending}
              disabled={!csvFile}
            >
              📂 Importar Clientes
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal Sincronizar */}
      <Modal
        isOpen={syncModalOpen}
        onClose={() => {
          setSyncModalOpen(false);
          setSyncDryRun(true);
          setSyncTargetServerId('');
        }}
        title="🔄 Sincronizar Clientes para Novo XUI"
        size="lg"
      >
        <div className="space-y-4">
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg space-y-2">
            <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
              🎯 Quando usar esta função?
            </p>
            <p className="text-sm text-blue-700 dark:text-blue-400">
              Use para recuperar todos os clientes em um novo servidor XUI (ex: após reinstalação ou migração).
              Neste modo, <strong>apenas os dados do painel</strong> são usados (username, senha, vencimento, conexões, pacote),
              sem depender do XUI antigo. Ideal para cenários de desastre.
            </p>
          </div>

          <Select
            label="Servidor Destino (Novo XUI)"
            value={syncTargetServerId}
            onChange={(e) => setSyncTargetServerId(e.target.value)}
          >
            <option value="">Selecione o servidor...</option>
            {serversData?.map((server) => (
              <option key={server.id} value={server.id}>
                {server.name}
              </option>
            ))}
          </Select>

          <div className="p-3 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={syncDryRun}
                onChange={(e) => setSyncDryRun(e.target.checked)}
                className="w-4 h-4 text-blue-600 bg-zinc-100 border-zinc-300 rounded focus:ring-blue-500 dark:focus:ring-cyan-500 dark:ring-offset-zinc-800 focus:ring-2 dark:bg-zinc-700 dark:border-zinc-600"
              />
              <div>
                <span className="text-sm font-medium text-zinc-900 dark:text-white">
                  🧪 Modo Teste (Dry Run)
                </span>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                  Simula a sincronização sem criar clientes (recomendado na primeira vez)
                </p>
              </div>
            </label>
          </div>

          <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg space-y-2">
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
              ⚠️ Importante:
            </p>
            <ul className="text-sm text-yellow-700 dark:text-yellow-400 list-disc list-inside space-y-1">
              <li>Clientes que já existem no servidor destino (mesmo usuário) serão <strong>pulados</strong></li>
              <li>Apenas clientes que não existem serão criados no novo XUI</li>
              <li>Usuário, senha, vencimento, conexões e pacote são lidos do painel e reaplicados no novo XUI</li>
              <li>O XUI antigo <strong>não é usado</strong> – basta o painel estar funcionando</li>
              <li>Use o modo teste primeiro para ver quantos seriam criados, pulados e se há erros</li>
            </ul>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-zinc-300 dark:border-zinc-700">
            <Button 
              variant="ghost" 
              onClick={() => {
                setSyncModalOpen(false);
                setSyncDryRun(true);
                setSyncTargetServerId('');
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => syncMutation.mutate()}
              loading={syncMutation.isPending}
              disabled={!syncTargetServerId}
              variant={syncDryRun ? 'outline' : 'default'}
            >
              {syncDryRun ? '🧪 Testar Sincronização' : '🔄 Sincronizar Agora'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default CustomersPage;
