import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, Modal, Badge, Spinner, Select } from '../../components/ui';
import { Pagination } from '../../components/ui/Pagination';
import { ResellerTreeDropdown } from '../../components/ResellerTreeDropdown';
import { api } from '../../api/client';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore';
import { useDebounce } from '../../hooks/useDebounce';

interface User {
  id: string;
  username: string;
  email: string;
  name?: string;
  whatsapp?: string;
  telegram?: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'MASTER_RESELLER' | 'RESELLER';
  status: 'ACTIVE' | 'INACTIVE' | 'BANNED';
  credits: number;
  creditsReadonly?: boolean;
  parentId?: string;
  accessGroupId?: string | null;
  accessGroup?: { id: string; name: string } | null;
  canCreateResellers?: boolean;
  maxSubResellers?: number;
  commissionPercent?: number;
  maxTrialsPerDay?: number;
  maxCustomers?: number;
  trialHoursAllowed?: string;
  lastLoginAt?: string;
  createdAt: string;
  _count?: {
    customers: number;
    children: number;
  };
  parent?: {
    username: string;
  };
}

interface UserForm {
  username: string;
  email: string;
  password: string;
  name: string;
  whatsapp: string;
  telegram: string;
  role: string;
  status: string;
  credits: number;
  accessGroupId?: string;
  canCreateResellers: boolean;
  maxSubResellers?: number;
  commissionPercent: number;
  maxTrialsPerDay?: number;
  maxCustomers?: number;
  trialHoursAllowed: number[];
  // Campos de cobrança pós-pago
  billingType?: 'PREPAID' | 'POSTPAID';
  dueDate?: string;
  customerPrice?: number;
  billingCycleDays?: number;
  menuPermissions?: string[];
}

const initialForm: UserForm = {
  username: '',
  email: '',
  password: '',
  name: '',
  whatsapp: '',
  telegram: '',
  role: 'RESELLER',
  status: 'ACTIVE',
  credits: 0,
  accessGroupId: '',
  canCreateResellers: false,
  commissionPercent: 0,
  trialHoursAllowed: [3, 6, 12, 24],
  // Campos de cobrança pós-pago
  billingType: 'PREPAID',
  dueDate: '',
  customerPrice: 0,
  billingCycleDays: 30,
  menuPermissions: [],
};

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  MASTER_RESELLER: 'Master Revenda',
  RESELLER: 'Revenda',
};

const statusLabels: Record<string, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  BANNED: 'Banido',
};

const defaultResellerWelcomeTemplate = `🎉 Bem-vindo(a)!

Seu acesso ao painel foi criado:

🌐 Painel: {panel_url}
👤 Usuário: {username}
🔑 Senha: {password}
🏷️ Perfil: {role}

⚙️ Próximos passos:
1) Entre no painel e vá em Configurações
2) Coloque seu logo e sua URL pública (sua DNS/domínio)

Se precisar de ajuda, fale conosco.`;

export function UsersPage() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const canManageUserPermissions = ['SUPER_ADMIN', 'ADMIN'].includes(currentUser?.role || '');
  const canCreateUsers = ['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER', 'RESELLER'].includes(currentUser?.role || '');
  const [modalOpen, setModalOpen] = useState(false);
  const [creditsModalOpen, setCreditsModalOpen] = useState(false);
  const [accessGroupModalOpen, setAccessGroupModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState<UserForm>(initialForm);
  const [activeTab, setActiveTab] = useState<'basic' | 'billing' | 'permissions' | 'limits'>('basic');
  const [creditsAmount, setCreditsAmount] = useState(0);
  const [accessGroupForm, setAccessGroupForm] = useState<{ name: string; description: string; menuPermissions: string[] }>({
    name: '',
    description: '',
    menuPermissions: [],
  });
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 500); // Debounce de 500ms
  const [filters, setFilters] = useState({ role: '', status: '', search: '' });
  const [currentPage, setCurrentPage] = useState(1);
  const perPage = 25;
  const [selectedResellerId, setSelectedResellerId] = useState('');
  const [selectedResellerName, setSelectedResellerName] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const resellerWelcomeStorageKey = useMemo(() => {
    const id = currentUser?.id || 'default';
    return `reseller_welcome_template:${id}`;
  }, [currentUser?.id]);

  const [resellerWelcomeModalOpen, setResellerWelcomeModalOpen] = useState(false);
  const [resellerWelcomeTemplate, setResellerWelcomeTemplate] = useState(defaultResellerWelcomeTemplate);
  const [resellerWelcomeTarget, setResellerWelcomeTarget] = useState<{ username: string; password: string; role: string; panelUrl: string; whatsapp?: string } | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(resellerWelcomeStorageKey);
      if (saved && saved.trim()) setResellerWelcomeTemplate(saved);
      else setResellerWelcomeTemplate(defaultResellerWelcomeTemplate);
    } catch {
      setResellerWelcomeTemplate(defaultResellerWelcomeTemplate);
    }
  }, [resellerWelcomeStorageKey]);

  const resellerWelcomeMessage = useMemo(() => {
    if (!resellerWelcomeTarget) return '';
    const vars: Record<string, string> = {
      panel_url: resellerWelcomeTarget.panelUrl,
      username: resellerWelcomeTarget.username,
      password: resellerWelcomeTarget.password,
      role: resellerWelcomeTarget.role,
    };
    let out = resellerWelcomeTemplate || '';
    for (const [k, v] of Object.entries(vars)) {
      out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
    return out;
  }, [resellerWelcomeTemplate, resellerWelcomeTarget]);

  // Atualizar filtro quando debouncedSearch mudar
  useEffect(() => {
    setFilters(prev => ({ ...prev, search: debouncedSearch }));
    setCurrentPage(1);
  }, [debouncedSearch]);

  const toggleSort = (field: string) => {
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
    setCurrentPage(1);
  };

  const SortIcon = ({ field }: { field: string }) => (
    <span className="ml-1 inline-block w-3 text-[10px] leading-none">
      {sortBy === field ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
    </span>
  );

  const handleRenew = async (user: User) => {
    const days = prompt(`Quantos dias deseja renovar o acesso de ${user.username}?`, '30');
    if (!days || isNaN(Number(days))) return;
    try {
      await api.post(`/billing/users/${user.id}/renew`, { days: Number(days) });
      toast.success(`Acesso de ${user.username} renovado por ${days} dias`);
      queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Erro ao renovar');
    }
  };

  // Busca usuários
  const { data, isLoading } = useQuery({
    queryKey: ['users', filters, currentPage, selectedResellerId, sortBy, sortDir],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', currentPage.toString());
      params.set('perPage', perPage.toString());
      params.set('sortBy', sortBy);
      params.set('sortDir', sortDir);
      if (filters.role) params.set('role', filters.role);
      if (filters.status) params.set('status', filters.status);
      if (filters.search) params.set('search', filters.search);
      if (selectedResellerId) params.set('parentId', selectedResellerId);
      const res = await api.get(`/users?${params.toString()}`);
      return res.data;
    },
  });

  const meta = data?.meta;
  const totalPages = meta?.last_page || 1;
  const totalItems = meta?.total || 0;

  // Criar
  const createMutation = useMutation({
    mutationFn: async (data: UserForm) => {
      const res = await api.post('/users', {
        ...data,
        trialHoursAllowed: data.trialHoursAllowed,
        accessGroupId: data.accessGroupId ? data.accessGroupId : null,
        menuPermissions: data.accessGroupId ? null : data.menuPermissions,
      });
      return res.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Usuário criado!');
      const origin = (() => {
        try {
          return window.location.origin || '';
        } catch {
          return '';
        }
      })();
      setResellerWelcomeTarget({
        username: variables.username,
        password: variables.password,
        role: roleLabels[variables.role] || String(variables.role),
        panelUrl: origin || '',
        whatsapp: variables.whatsapp || undefined,
      });
      setResellerWelcomeModalOpen(true);
      closeModal();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao criar');
    },
  });

  // Atualizar
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<UserForm> }) => {
      const payload: any = { ...data };
      if (!data.password) delete payload.password;
      if ('accessGroupId' in payload) {
        payload.accessGroupId = payload.accessGroupId ? payload.accessGroupId : null;
        if (payload.accessGroupId) payload.menuPermissions = null;
      }
      const res = await api.put(`/users/${id}`, payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Usuário atualizado!');
      closeModal();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao atualizar');
    },
  });

  // Deletar
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Usuário removido');
    },
  });

  // Modificar créditos
  const creditsMutation = useMutation({
    mutationFn: async ({ id, amount }: { id: string; amount: number }) => {
      const res = await api.post(`/users/${id}/credits`, { amount });
      return res.data;
    },
    onSuccess: async (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      
      // Se for o próprio usuário logado, atualizar o store de autenticação
      if (currentUser && variables.id === currentUser.id) {
        // Buscar dados atualizados do usuário
        try {
          const meRes = await api.get('/auth/me');
          const updatedUser = meRes.data.data;
          useAuthStore.getState().setUser({
            id: updatedUser.id,
            username: updatedUser.username,
            email: updatedUser.email,
            role: updatedUser.role,
            credits: updatedUser.credits,
            name: updatedUser.name,
          });
        } catch (error) {
          console.error('Erro ao atualizar dados do usuário:', error);
        }
      }
      
      toast.success('Créditos atualizados!');
      setCreditsModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro');
    },
  });

  const openCreateModal = () => {
    setForm(initialForm);
    setEditingUser(null);
    setActiveTab('basic');
    setModalOpen(true);
  };

  const openEditModal = (user: User) => {
    setEditingUser(user);
    setForm({
      username: user.username,
      email: user.email,
      password: '',
      name: user.name || '',
      whatsapp: user.whatsapp || '',
      telegram: user.telegram || '',
      role: user.role,
      status: user.status,
      credits: user.credits,
      accessGroupId: ((user as any).accessGroupId as string) || '',
      canCreateResellers: !!(user as any).canCreateResellers,
      maxSubResellers: user.maxSubResellers,
      commissionPercent: (user as any).commissionPercent ?? 0,
      maxTrialsPerDay: user.maxTrialsPerDay,
      maxCustomers: user.maxCustomers,
      trialHoursAllowed: user.trialHoursAllowed?.split(',').map(Number) || [3, 6, 12, 24],
      // Campos de cobrança pós-pago (se existirem no user)
      billingType: (user as any).billingType || 'PREPAID',
      dueDate: (user as any).dueDate ? new Date((user as any).dueDate).toISOString().split('T')[0] : '',
      customerPrice: (user as any).customerPrice || 0,
      billingCycleDays: (user as any).billingCycleDays || 30,
      menuPermissions: (() => {
        try {
          const mp = (user as any).menuPermissions;
          if (!mp) return [];
          const parsed = typeof mp === 'string' ? JSON.parse(mp) : mp;
          return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
      })(),
    });
    setActiveTab('basic');
    setModalOpen(true);
  };

  const openCreditsModal = (user: User) => {
    setEditingUser(user);
    setCreditsAmount(0);
    setCreditsModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingUser(null);
  };

  const { data: accessGroupsResponse } = useQuery({
    queryKey: ['users-access-groups'],
    queryFn: async () => (await api.get('/users/access-groups')).data,
    enabled: canManageUserPermissions,
  });

  const accessGroups: Array<{ id: string; name: string; description?: string | null }> =
    accessGroupsResponse?.data || [];

  const createAccessGroupMutation = useMutation({
    mutationFn: async (payload: { name: string; description?: string | null; menuPermissions: string[] }) => {
      return (await api.post('/users/access-groups', payload)).data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['users-access-groups'] });
      const newId = data?.data?.id as string | undefined;
      if (newId) {
        setForm((prev) => ({ ...prev, accessGroupId: newId, menuPermissions: [] }));
      }
      toast.success('Grupo criado!');
      setAccessGroupModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao criar grupo');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingUser) {
      updateMutation.mutate({ id: editingUser.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const getRoleBadge = (role: string) => {
    const variants: Record<string, 'default' | 'success' | 'warning' | 'error'> = {
      SUPER_ADMIN: 'error',
      ADMIN: 'warning',
      MASTER_RESELLER: 'success',
      RESELLER: 'default',
    };
    return <Badge variant={variants[role] || 'default'}>{roleLabels[role] || role}</Badge>;
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'success' | 'warning' | 'error'> = {
      ACTIVE: 'success',
      INACTIVE: 'warning',
      BANNED: 'error',
    };
    return <Badge variant={variants[status] || 'default'}>{statusLabels[status] || status}</Badge>;
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
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">👥 Revendedores</h1>
            <p className="text-zinc-600 dark:text-zinc-400 mt-1">Gerencie revendedores e administradores</p>
        </div>
        {canCreateUsers && (
          <Button onClick={openCreateModal}>
            {currentUser?.role === 'MASTER_RESELLER' ? '➕ Nova Revenda' : '➕ Novo Revendedor'}
          </Button>
        )}
      </div>

      {['SUPER_ADMIN', 'ADMIN'].includes(currentUser?.role || '') ? (
        <div className="mb-2">
          <ResellerTreeDropdown
            value={selectedResellerId}
            onChange={(id, name) => {
              setSelectedResellerId(id);
              setSelectedResellerName(name);
              setCurrentPage(1);
            }}
            placeholder="Todos os revendedores"
            allOptionLabel="Todos os revendedores"
          />
        </div>
      ) : null}

      {/* Filtros */}
      <div className="grid grid-cols-2 sm:flex gap-2 lg:gap-4">
        <Input
          placeholder="🔍 Buscar..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="col-span-2 sm:w-48 lg:w-64"
        />
        <Select
          value={filters.role}
          onChange={(e) => { setFilters({ ...filters, role: e.target.value }); setCurrentPage(1); }}
          className="sm:w-40"
        >
          <option value="">Todos os tipos</option>
          {['SUPER_ADMIN'].includes(currentUser?.role || '') ? <option value="ADMIN">Admin</option> : null}
          {['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'].includes(currentUser?.role || '') ? <option value="MASTER_RESELLER">Master Revenda</option> : null}
          <option value="RESELLER">Revenda</option>
        </Select>
        <Select
          value={filters.status}
          onChange={(e) => { setFilters({ ...filters, status: e.target.value }); setCurrentPage(1); }}
          className="sm:w-40"
        >
          <option value="">Todos os status</option>
          <option value="ACTIVE">Ativo</option>
          <option value="INACTIVE">Inativo</option>
          <option value="BANNED">Banido</option>
        </Select>
      </div>

      {/* Tabela */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/50">
                <tr className="text-zinc-700 dark:text-zinc-400">
                <th className="text-left py-3 px-4 cursor-pointer select-none hover:text-zinc-900 dark:hover:text-white" onClick={() => toggleSort('username')}>Usuário<SortIcon field="username" /></th>
                <th className="text-left py-3 px-4 cursor-pointer select-none hover:text-zinc-900 dark:hover:text-white" onClick={() => toggleSort('name')}>Nome<SortIcon field="name" /></th>
                <th className="text-left py-3 px-4 cursor-pointer select-none hover:text-zinc-900 dark:hover:text-white" onClick={() => toggleSort('role')}>Tipo<SortIcon field="role" /></th>
                <th className="text-left py-3 px-4">Grupo</th>
                <th className="text-right py-3 px-4 cursor-pointer select-none hover:text-zinc-900 dark:hover:text-white" onClick={() => toggleSort('credits')}>Créditos<SortIcon field="credits" /></th>
                <th className="text-right py-3 px-4">Clientes</th>
                <th className="text-left py-3 px-4 cursor-pointer select-none hover:text-zinc-900 dark:hover:text-white" onClick={() => toggleSort('status')}>Status<SortIcon field="status" /></th>
                <th className="text-left py-3 px-4 cursor-pointer select-none hover:text-zinc-900 dark:hover:text-white" onClick={() => toggleSort('dueDate')}>Vencimento<SortIcon field="dueDate" /></th>
                <th className="text-left py-3 px-4 cursor-pointer select-none hover:text-zinc-900 dark:hover:text-white" onClick={() => toggleSort('lastLoginAt')}>Último Acesso<SortIcon field="lastLoginAt" /></th>
                <th className="text-right py-3 px-4">Ações</th>
              </tr>
            </thead>
            <tbody>
              {data?.data?.map((user: User) => (
                <tr key={user.id} className="border-t border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                  <td className="py-3 px-4">
                    <div>
                      <span className="text-zinc-900 dark:text-white font-medium">{user.username}</span>
                      <p className="text-xs text-zinc-500">{user.email}</p>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-zinc-700 dark:text-zinc-300">{user.name || '-'}</td>
                  <td className="py-3 px-4">
                    {getRoleBadge(user.role)}
                    {user.parent && (
                      <span className="text-xs text-zinc-600 dark:text-zinc-500 ml-1">({user.parent.username})</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {(user as any).accessGroup?.name ? (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-200/50 dark:border-violet-500/30">
                        {(user as any).accessGroup.name}
                      </span>
                    ) : (
                      <span className="text-zinc-500 text-xs">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className="text-cyan-400 font-medium">{user.credits}</span>
                  </td>
                  <td className="py-3 px-4 text-right text-zinc-700 dark:text-zinc-300">{user._count?.customers || 0}</td>
                  <td className="py-3 px-4">{getStatusBadge(user.status)}</td>
                  <td className="py-3 px-4 text-xs">
                    {(user as any).dueDate ? (() => {
                      const due = new Date((user as any).dueDate);
                      const now = new Date();
                      const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                      return (
                        <div>
                          <span className="text-zinc-600 dark:text-zinc-300">
                            {due.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' })}
                          </span>
                          <span className={`ml-1 font-medium ${
                            diffDays <= 0 ? 'text-red-400' : diffDays <= 3 ? 'text-yellow-400' : 'text-green-400'
                          }`}>
                            {diffDays <= 0 ? '❌ Vencido' : `⏱️ ${diffDays}d`}
                          </span>
                        </div>
                      );
                    })() : <span className="text-zinc-500">—</span>}
                  </td>
                  <td className="py-3 px-4 text-zinc-600 dark:text-zinc-400 text-xs">
                    {user.lastLoginAt
                      ? new Date(user.lastLoginAt).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'America/Sao_Paulo',
                        })
                      : 'Nunca'}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => openCreditsModal(user)} title="Créditos">
                        💰
                      </Button>
                      {user.role !== 'SUPER_ADMIN' && user.id !== currentUser?.id && (user as any).billingType === 'POSTPAID' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-blue-500"
                          title="Renovar acesso"
                          onClick={() => handleRenew(user)}
                        >
                          🔄
                        </Button>
                      )}
                      {user.role !== 'SUPER_ADMIN' && user.id !== currentUser?.id && (
                        user.status === 'ACTIVE' ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-orange-500"
                            title="Bloquear revendedor"
                            onClick={() => {
                              if (confirm(`Bloquear ${user.username}?`)) {
                                updateMutation.mutate({ id: user.id, data: { status: 'INACTIVE' } as any });
                              }
                            }}
                          >
                            🚫
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-green-500"
                            title="Desbloquear revendedor"
                            onClick={() => {
                              if (confirm(`Desbloquear ${user.username}?`)) {
                                updateMutation.mutate({ id: user.id, data: { status: 'ACTIVE' } as any });
                              }
                            }}
                          >
                            ✅
                          </Button>
                        )
                      )}
                      <Button size="sm" variant="ghost" onClick={() => openEditModal(user)} title="Editar">
                        ✏️
                      </Button>
                      {user.role !== 'SUPER_ADMIN' && user.id !== currentUser?.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-400"
                          title="Remover"
                          onClick={() => {
                            if (confirm('Remover este usuário?')) {
                              deleteMutation.mutate(user.id);
                            }
                          }}
                        >
                          🗑️
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {(!data?.data || data.data.length === 0) && (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-zinc-600 dark:text-zinc-400">
                    Nenhum usuário encontrado
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Paginação */}
      {totalPages > 1 && (
        <Pagination
          currentPage={currentPage}
          lastPage={totalPages}
          total={totalItems}
          from={((currentPage - 1) * perPage) + 1}
          to={Math.min(currentPage * perPage, totalItems)}
          onPageChange={(page) => {
            setCurrentPage(page);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      )}

      {/* Modal Criar/Editar */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editingUser ? 'Editar Usuário' : 'Novo Usuário'}
        size="lg"
      >
        <form onSubmit={handleSubmit}>
          {/* Tabs */}
          <div className="flex gap-2 mb-4 border-b border-zinc-200 dark:border-zinc-700pb-2">
            {(['basic', 'billing', ...(canManageUserPermissions ? (['permissions'] as const) : ([] as const)), 'limits'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${
                  activeTab === tab
                    ? 'bg-blue-600 dark:bg-cyan-500 text-white'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                {tab === 'basic' && '📝 Dados Básicos'}
                {tab === 'billing' && '💰 Cobrança'}
                {tab === 'permissions' && '🔐 Permissões'}
                {tab === 'limits' && '📊 Limites'}
              </button>
            ))}
          </div>

          {/* Tab: Dados Básicos */}
          {activeTab === 'basic' && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Input
                  label="Usuário"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  disabled={!!editingUser}
                  required
                />
                <Input
                  label="Email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>

              <Input
                label="Senha"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={editingUser ? '(deixe vazio para manter)' : ''}
                required={!editingUser}
              />

              <Input
                label="Nome Completo"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />

              <div className="grid gap-4 md:grid-cols-2">
                <Input
                  label="WhatsApp"
                  value={form.whatsapp}
                  onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                  placeholder="5524999999999"
                />
                <Input
                  label="Telegram"
                  value={form.telegram}
                  onChange={(e) => setForm({ ...form, telegram: e.target.value })}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Select
                  label="Tipo de Usuário"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                >
                  {currentUser?.role === 'SUPER_ADMIN' && <option value="ADMIN">Admin</option>}
                  {['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'].includes(currentUser?.role || '') && (
                    <option value="MASTER_RESELLER">Master Revenda</option>
                  )}
                  <option value="RESELLER">Revenda</option>
                </Select>

                <Select
                  label="Status"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  <option value="ACTIVE">Ativo</option>
                  <option value="INACTIVE">Inativo</option>
                  <option value="BANNED">Banido</option>
                </Select>
              </div>
            </div>
          )}

          {/* Tab: Cobrança */}
          {activeTab === 'billing' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  Tipo de Cobrança
                </label>
                <div className="space-y-2">
                  <label className="flex items-center p-3 border rounded-md cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800">
                    <input
                      type="radio"
                      name="billingType"
                      value="PREPAID"
                      checked={form.billingType === 'PREPAID'}
                      onChange={(e) => setForm({ ...form, billingType: e.target.value as any })}
                      className="mr-3"
                    />
                    <div>
                      <div className="font-medium">Pré-Pago</div>
                      <div className="text-sm text-zinc-500">Compra de créditos antecipados</div>
                    </div>
                  </label>

                  <label className="flex items-center p-3 border rounded-md cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800">
                    <input
                      type="radio"
                      name="billingType"
                      value="POSTPAID"
                      checked={form.billingType === 'POSTPAID'}
                      onChange={(e) => setForm({ ...form, billingType: e.target.value as any })}
                      className="mr-3"
                    />
                    <div>
                      <div className="font-medium">Pós-Pago (Mensalista)</div>
                      <div className="text-sm text-zinc-500">Pagamento por cliente ativo</div>
                    </div>
                  </label>
                </div>
              </div>

              {form.billingType === 'PREPAID' ? (
                <Input
                  label="Créditos Iniciais"
                  type="number"
                  min="0"
                  value={form.credits}
                  onChange={(e) => setForm({ ...form, credits: parseInt(e.target.value) || 0 })}
                  placeholder="0"
                />
              ) : (
                <div className="space-y-4">
                  <Input
                    label="Data de Vencimento"
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                  />

                  <Input
                    label="Preço por Cliente (R$)"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.customerPrice}
                    onChange={(e) => setForm({ ...form, customerPrice: parseFloat(e.target.value) || 0 })}
                    placeholder="10.00"
                  />

                  <Input
                    label="Ciclo de Cobrança (dias)"
                    type="number"
                    min="1"
                    value={form.billingCycleDays}
                    onChange={(e) => setForm({ ...form, billingCycleDays: parseInt(e.target.value) || 30 })}
                    placeholder="30"
                  />

                  <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-md">
                    <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
                      💡 Simulação de Cobrança
                    </h4>
                    <div className="text-sm text-blue-800 dark:text-blue-200">
                      <div>Clientes ativos (simulação): 10</div>
                      <div>Total a pagar: R$ {((form.customerPrice || 0) * 10).toFixed(2)}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab: Permissões */}
          {activeTab === 'permissions' && canManageUserPermissions && (
            <div className="space-y-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={form.canCreateResellers}
                  onChange={(e) => setForm({ ...form, canCreateResellers: e.target.checked })}
                  className="w-5 h-5 rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
                />
                <span className="text-zinc-900 dark:text-white">Pode criar sub-revendas</span>
              </label>

              {form.canCreateResellers && (
                <Input
                  label="Máximo de sub-revendas"
                  type="number"
                  value={form.maxSubResellers || ''}
                  onChange={(e) =>
                    setForm({ ...form, maxSubResellers: parseInt(e.target.value) || undefined })
                  }
                  placeholder="Ilimitado"
                />
              )}

              <Input
                label="Comissão sobre sub-revendas (%)"
                type="number"
                min={0}
                max={100}
                value={form.commissionPercent}
                onChange={(e) =>
                  setForm({ ...form, commissionPercent: parseFloat(e.target.value) || 0 })
                }
              />

              <div className="mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-700 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-900 dark:text-white mb-1">Grupo de Acesso</h4>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Defina permissões por grupo (recomendado). As permissões manuais ficam desativadas quando um grupo é selecionado.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAccessGroupForm({ name: '', description: '', menuPermissions: [] });
                      setAccessGroupModalOpen(true);
                    }}
                    className="text-xs px-3 py-1.5 bg-cyan-100 dark:bg-cyan-900/30 text-cyan-800 dark:text-cyan-300 rounded-lg"
                  >
                    ➕ Adicionar grupo
                  </button>
                </div>

                <Select
                  value={form.accessGroupId || ''}
                  onChange={(e) => setForm({ ...form, accessGroupId: e.target.value, menuPermissions: [] })}
                >
                  <option value="">Sem grupo (permissões manuais)</option>
                  {accessGroups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </Select>
              </div>

              {!form.accessGroupId && (
                <div className="mt-4">
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-white mb-1">Permissões de Menu</h4>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
                    Selecione quais menus este usuário pode acessar. Se nenhum for selecionado, o padrão do role será usado.
                  </p>
                  <div className="flex gap-2 mb-3">
                    <button type="button" onClick={() => setForm({ ...form, menuPermissions: ['dashboard','customers','financial','billing_report','billing_hierarchy','packages','bouquets','users','vod','live','marketing','premium','notifications','panel_settings','asaas','backups','import_sigma','xui_connection'] })} className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">Marcar Todos</button>
                    <button type="button" onClick={() => setForm({ ...form, menuPermissions: [] })} className="text-xs px-2 py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded">Desmarcar Todos</button>
                    <button type="button" onClick={() => setForm({ ...form, menuPermissions: ['dashboard','customers','financial','billing_report','notifications','panel_settings'] })} className="text-xs px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded">Padrão Revenda</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { key: 'dashboard', label: 'Dashboard' },
                      { key: 'customers', label: 'Clientes' },
                      { key: 'financial', label: 'Financeiro' },
                      { key: 'billing_report', label: 'Relatório Cobrança' },
                      { key: 'billing_hierarchy', label: 'Hierarquia' },
                      { key: 'users', label: 'Usuários' },
                      { key: 'resellers', label: 'Revendedores' },
                      { key: 'packages', label: 'Pacotes' },
                      { key: 'bouquets', label: 'Bouquets' },
                      { key: 'vod', label: 'Filmes' },
                      { key: 'live', label: 'LIVE TV' },
                      { key: 'marketing', label: 'Marketing' },
                      { key: 'premium', label: 'Premium' },
                      { key: 'notifications', label: 'Notificações' },
                      { key: 'panel_settings', label: 'Config. Painel' },
                      { key: 'asaas', label: 'Pagamentos Asaas' },
                      { key: 'backups', label: 'Backups' },
                      { key: 'import_sigma', label: 'Importar SIGMA' },
                      { key: 'xui_connection', label: 'Conexão XUI' },
                    ].map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 p-2 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.menuPermissions?.includes(key) || false}
                          onChange={(e) => {
                            const current = form.menuPermissions || [];
                            setForm({
                              ...form,
                              menuPermissions: e.target.checked
                                ? [...current, key]
                                : current.filter(k => k !== key)
                            });
                          }}
                          className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-600"
                        />
                        <span className="text-sm text-zinc-700 dark:text-zinc-300">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab: Limites */}
          {activeTab === 'limits' && (
            <div className="space-y-4">
              <Input
                label="Máximo de testes por dia"
                type="number"
                value={form.maxTrialsPerDay || ''}
                onChange={(e) =>
                  setForm({ ...form, maxTrialsPerDay: parseInt(e.target.value) || undefined })
                }
                placeholder="Ilimitado"
              />

              <Input
                label="Máximo de clientes"
                type="number"
                value={form.maxCustomers || ''}
                onChange={(e) =>
                  setForm({ ...form, maxCustomers: parseInt(e.target.value) || undefined })
                }
                placeholder="Ilimitado"
              />

              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300mb-2">
                  Durações de teste permitidas
                </label>
                <div className="flex gap-2 flex-wrap">
                  {[3, 6, 12, 24].map((hours) => {
                    const isSelected = form.trialHoursAllowed.includes(hours);
                    return (
                      <button
                        key={hours}
                        type="button"
                        onClick={() => {
                          const newHours = isSelected
                            ? form.trialHoursAllowed.filter((h) => h !== hours)
                            : [...form.trialHoursAllowed, hours].sort((a, b) => a - b);
                          setForm({ ...form, trialHoursAllowed: newHours });
                        }}
                        className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                          isSelected
                            ? 'bg-blue-600 dark:bg-cyan-500 text-white'
                            : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-700'
                        }`}
                      >
                        {hours}h
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-700">
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

      <Modal
        isOpen={accessGroupModalOpen}
        onClose={() => setAccessGroupModalOpen(false)}
        title="➕ Novo Grupo de Acesso"
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label="Nome do grupo"
            value={accessGroupForm.name}
            onChange={(e) => setAccessGroupForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Ex: Revenda Básica"
          />
          <Input
            label="Descrição (opcional)"
            value={accessGroupForm.description}
            onChange={(e) => setAccessGroupForm((prev) => ({ ...prev, description: e.target.value }))}
            placeholder="Ex: Acesso somente a Clientes e Financeiro"
          />

          <div className="pt-2 border-t border-zinc-200 dark:border-zinc-700">
            <h4 className="text-sm font-semibold text-zinc-900 dark:text-white mb-1">Permissões do Grupo</h4>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
              Defina quais menus os usuários deste grupo poderão acessar.
            </p>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setAccessGroupForm((prev) => ({ ...prev, menuPermissions: ['dashboard','customers','financial','billing_report','billing_hierarchy','packages','bouquets','users','vod','live','marketing','premium','notifications','panel_settings','asaas','backups','import_sigma','xui_connection'] }))}
                className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded"
              >
                Marcar Todos
              </button>
              <button
                type="button"
                onClick={() => setAccessGroupForm((prev) => ({ ...prev, menuPermissions: [] }))}
                className="text-xs px-2 py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded"
              >
                Desmarcar Todos
              </button>
              <button
                type="button"
                onClick={() => setAccessGroupForm((prev) => ({ ...prev, menuPermissions: ['dashboard','customers','financial','billing_report','notifications','panel_settings'] }))}
                className="text-xs px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded"
              >
                Padrão Revenda
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: 'dashboard', label: 'Dashboard' },
                { key: 'customers', label: 'Clientes' },
                { key: 'financial', label: 'Financeiro' },
                { key: 'billing_report', label: 'Relatório Cobrança' },
                { key: 'billing_hierarchy', label: 'Hierarquia' },
                { key: 'users', label: 'Usuários' },
                { key: 'resellers', label: 'Revendedores' },
                { key: 'packages', label: 'Pacotes' },
                { key: 'bouquets', label: 'Bouquets' },
                { key: 'vod', label: 'Filmes' },
                { key: 'live', label: 'LIVE TV' },
                { key: 'marketing', label: 'Marketing' },
                { key: 'premium', label: 'Premium' },
                { key: 'notifications', label: 'Notificações' },
                { key: 'panel_settings', label: 'Config. Painel' },
                { key: 'asaas', label: 'Pagamentos Asaas' },
                { key: 'backups', label: 'Backups' },
                { key: 'import_sigma', label: 'Importar SIGMA' },
                { key: 'xui_connection', label: 'Conexão XUI' },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 p-2 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={accessGroupForm.menuPermissions.includes(key)}
                    onChange={(e) => {
                      setAccessGroupForm((prev) => {
                        const current = prev.menuPermissions;
                        return {
                          ...prev,
                          menuPermissions: e.target.checked ? [...current, key] : current.filter((k) => k !== key),
                        };
                      });
                    }}
                    className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-600"
                  />
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
            <Button variant="ghost" onClick={() => setAccessGroupModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                createAccessGroupMutation.mutate({
                  name: accessGroupForm.name.trim(),
                  description: accessGroupForm.description.trim() ? accessGroupForm.description.trim() : null,
                  menuPermissions: accessGroupForm.menuPermissions,
                });
              }}
              loading={createAccessGroupMutation.isPending}
              disabled={!accessGroupForm.name.trim()}
            >
              Salvar Grupo
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={resellerWelcomeModalOpen}
        onClose={() => {
          setResellerWelcomeModalOpen(false);
          setResellerWelcomeTarget(null);
        }}
        title="🎉 Boas-vindas da Revenda"
        size="lg"
      >
        <div className="space-y-4">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Ajuste o texto e copie para enviar no WhatsApp/Telegram para a revenda.
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium text-zinc-900 dark:text-white">Template</div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">
              Variáveis: {'{panel_url}'} {'{username}'} {'{password}'} {'{role}'}
            </div>
            <textarea
              value={resellerWelcomeTemplate}
              onChange={(e) => setResellerWelcomeTemplate(e.target.value)}
              className="w-full min-h-[180px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-white"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  try {
                    window.localStorage.setItem(resellerWelcomeStorageKey, resellerWelcomeTemplate || '');
                    toast.success('Template salvo');
                  } catch {
                    toast.error('Não foi possível salvar o template');
                  }
                }}
              >
                Salvar template
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setResellerWelcomeTemplate(defaultResellerWelcomeTemplate);
                  try {
                    window.localStorage.setItem(resellerWelcomeStorageKey, defaultResellerWelcomeTemplate);
                  } catch {}
                }}
              >
                Restaurar padrão
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium text-zinc-900 dark:text-white">Mensagem pronta</div>
            <textarea
              value={resellerWelcomeMessage}
              readOnly
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              className="w-full min-h-[180px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-white"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(resellerWelcomeMessage);
                    toast.success('Mensagem copiada!');
                  } catch {
                    toast.error('Erro ao copiar. Copie manualmente.');
                  }
                }}
                disabled={!resellerWelcomeMessage}
              >
                Copiar
              </Button>
              <Button
                onClick={() => {
                  const raw = resellerWelcomeTarget?.whatsapp || '';
                  const phone = String(raw).replace(/[^\d]/g, '');
                  if (!phone) {
                    toast.error('Informe o WhatsApp do revendedor no cadastro');
                    return;
                  }
                  const url = `https://wa.me/${phone}?text=${encodeURIComponent(resellerWelcomeMessage)}`;
                  window.open(url, '_blank', 'noopener,noreferrer');
                }}
                disabled={!resellerWelcomeMessage}
              >
                Enviar WhatsApp
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Modal de Créditos */}
      <Modal
        isOpen={creditsModalOpen}
        onClose={() => setCreditsModalOpen(false)}
        title={`💰 Créditos - ${editingUser?.username}`}
      >
        <div className="space-y-4">
          <div className="text-center p-4 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Saldo Atual</p>
            <p className="text-3xl font-bold text-cyan-400">{editingUser?.credits || 0}</p>
          </div>

          <Input
            label="Adicionar/Remover Créditos"
            type="number"
            value={creditsAmount}
            onChange={(e) => setCreditsAmount(parseInt(e.target.value) || 0)}
            placeholder="Ex: 100 ou -50"
          />

          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Novo saldo:{' '}
            <span className="text-zinc-900 dark:text-white font-medium">
              {(editingUser?.credits || 0) + creditsAmount}
            </span>
          </p>

          <div className="flex justify-end gap-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
            <Button variant="ghost" onClick={() => setCreditsModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (editingUser && creditsAmount !== 0) {
                  creditsMutation.mutate({ id: editingUser.id, amount: creditsAmount });
                }
              }}
              loading={creditsMutation.isPending}
              disabled={creditsAmount === 0}
            >
              Confirmar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default UsersPage;
