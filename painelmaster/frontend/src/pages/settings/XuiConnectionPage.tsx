import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, Modal, Badge, Spinner, Select } from '../../components/ui';
import { api } from '../../api/client';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';

interface XuiServer {
  id: string;
  name: string;
  baseUrl: string;
  serverType: 'XUIONE' | 'XTREAMUI';
  accessCode: string;
  isActive: boolean;
  isDefault: boolean;
  status: 'ONLINE' | 'OFFLINE' | 'ERROR' | 'UNKNOWN';
  lastSync: string | null;
  dnsPrimary?: string | null;
  dnsList?: string | null;
  dbHost?: string | null;
  dbPort?: number | null;
  dbName?: string | null;
  dbUser?: string | null;
  xuiResellerId?: number | null;
  _count?: {
    packages: number;
    customers: number;
  };
}

interface ServerForm {
  name: string;
  baseUrl: string;
  serverType: 'XUIONE' | 'XTREAMUI';
  accessCode: string;
  apiKey: string;
  apiUsername: string;
  apiPassword: string;
  isDefault: boolean;
  // DNS
  dnsPrimary?: string;
  dnsList?: string;
  // Banco de dados
  dbHost?: string;
  dbPort?: number;
  dbName?: string;
  dbUser?: string;
  dbPassword?: string;
  // SSH
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;
  sshPassword?: string;
  sshKey?: string;
}

const initialForm: ServerForm = {
  name: '',
  baseUrl: '',
  serverType: 'XTREAMUI',
  accessCode: '',
  apiKey: '',
  apiUsername: '',
  apiPassword: '',
  isDefault: false,
  dnsPrimary: '',
  dnsList: '',
  dbHost: '',
  dbPort: 7999,
  dbName: 'xtream_iptvpro',
  dbUser: 'user_iptvpro',
  dbPassword: '',
  sshHost: '',
  sshPort: 22,
  sshUser: '',
  sshPassword: '',
  sshKey: '',
};

function defaultsForServerType(serverType: 'XUIONE' | 'XTREAMUI'): Pick<ServerForm, 'dbPort' | 'dbName' | 'dbUser'> {
  if (serverType === 'XTREAMUI') {
    return { dbPort: 7999, dbName: 'xtream_iptvpro', dbUser: 'user_iptvpro' };
  }
  return { dbPort: 3306, dbName: 'xui', dbUser: '' };
}

export function XuiConnectionPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<XuiServer | null>(null);
  const [form, setForm] = useState<ServerForm>(initialForm);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showDbSection, setShowDbSection] = useState(false);
  const [showSshSection, setShowSshSection] = useState(false);

  const enableXuiOne = import.meta.env.VITE_ENABLE_XUIONE === 'true';
  const allowXuiOne = enableXuiOne || editingServer?.serverType === 'XUIONE';
  const isXtream = form.serverType === 'XTREAMUI';

  const activeTab = useMemo(() => {
    const tab = String(searchParams.get('tab') || 'manage');
    if (tab === 'add' || tab === 'manage') return tab;
    return 'manage';
  }, [searchParams]);

  const setTab = (tab: 'manage' | 'add') => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    });
  };

  // Busca servidores
  const { data: servers, isLoading } = useQuery({
    queryKey: ['xui-servers'],
    queryFn: async () => {
      const res = await api.get('/settings/xui');
      return res.data.data as XuiServer[];
    },
  });

  // Criar servidor
  const createMutation = useMutation({
    mutationFn: async (data: ServerForm) => {
      const res = await api.post('/settings/xui', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['xui-servers'] });
      toast.success('Servidor adicionado com sucesso!');
      closeModal();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao adicionar servidor');
    },
  });

  // Atualizar servidor
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ServerForm> }) => {
      const res = await api.put(`/settings/xui/${id}`, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['xui-servers'] });
      toast.success('Servidor atualizado!');
      closeModal();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao atualizar');
    },
  });

  // Deletar servidor
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete(`/settings/xui/${id}`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['xui-servers'] });
      toast.success('Servidor removido com sucesso!');
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.error || error.response?.data?.message || 'Erro ao remover servidor';
      toast.error(errorMsg);
      console.error('[DeleteServer] Erro:', error.response?.data || error);
    },
  });

  // Sincronizar
  const syncMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/settings/xui/${id}/sync`);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['xui-servers'] });
      toast.success(`Sincronizado: ${data.synced.packages} pacotes, ${data.synced.bouquets} bouquets`);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro na sincronização');
    },
  });

  // Toggle ativo
  const toggleMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/settings/xui/${id}/toggle`);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['xui-servers'] });
      toast.success(data.message);
    },
  });

  // Testar conexão
  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post('/settings/xui/test-connection', {
        baseUrl: form.baseUrl,
        serverType: form.serverType,
        accessCode: form.accessCode,
        apiKey: form.apiKey,
        apiUsername: form.apiUsername,
        apiPassword: form.apiPassword,
      });
      setTestResult({
        success: true,
        message: `✅ Conectado! Usuário: ${res.data.data.username}, Créditos: ${res.data.data.credits}`,
      });
    } catch (error: any) {
      setTestResult({
        success: false,
        message: `❌ ${error.response?.data?.error || 'Falha na conexão'}`,
      });
    } finally {
      setTesting(false);
    }
  };

  const openCreateModal = () => {
    const defaultType: 'XUIONE' | 'XTREAMUI' = enableXuiOne ? 'XUIONE' : 'XTREAMUI';
    const defaults = defaultsForServerType(defaultType);
    setForm({
      ...initialForm,
      serverType: defaultType,
      dbPort: defaults.dbPort,
      dbName: defaults.dbName,
      dbUser: defaults.dbUser,
    });
    setEditingServer(null);
    setTestResult(null);
    setShowDbSection(defaultType === 'XTREAMUI');
    setShowSshSection(defaultType === 'XTREAMUI');
    setModalOpen(true);
  };

  useEffect(() => {
    if (activeTab === 'add' && !modalOpen) {
      openCreateModal();
    }
  }, [activeTab, modalOpen]);

  const openEditModal = (server: XuiServer) => {
    setEditingServer(server);
    setForm({
      name: server.name,
      baseUrl: server.baseUrl,
      serverType: server.serverType || 'XUIONE',
      accessCode: server.accessCode,
      apiKey: '',
      apiUsername: '',
      apiPassword: '',
      isDefault: server.isDefault,
      dnsPrimary: server.dnsPrimary || '',
      dnsList: server.dnsList || '',
      dbHost: server.dbHost || '',
      dbPort: server.dbPort || defaultsForServerType(server.serverType || 'XUIONE').dbPort,
      dbName: server.dbName || defaultsForServerType(server.serverType || 'XUIONE').dbName,
      dbUser: server.dbUser || defaultsForServerType(server.serverType || 'XUIONE').dbUser,
      dbPassword: '',
      sshHost: '',
      sshPort: 22,
      sshUser: '',
      sshPassword: '',
      sshKey: '',
    });
    setTestResult(null);
    setShowDbSection(false);
    setShowSshSection(false);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingServer(null);
    setForm(initialForm);
    setTestResult(null);
    setShowDbSection(false);
    setShowSshSection(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanForm: any = { ...form };

    if (cleanForm.serverType === 'XTREAMUI') {
      cleanForm.dbPort = 7999;
      cleanForm.dbName = 'xtream_iptvpro';
      cleanForm.dbUser = 'user_iptvpro';
      if (!cleanForm.sshHost && cleanForm.baseUrl) {
        try {
          cleanForm.sshHost = new URL(cleanForm.baseUrl).hostname;
        } catch {}
      }
      if (!cleanForm.dbHost) {
        if (cleanForm.sshHost) {
          cleanForm.dbHost = cleanForm.sshHost;
        } else if (cleanForm.baseUrl) {
          try {
            cleanForm.dbHost = new URL(cleanForm.baseUrl).hostname;
          } catch {}
        }
      }
    }
    
    if (!cleanForm.dnsPrimary) delete cleanForm.dnsPrimary;
    if (!cleanForm.dnsList) delete cleanForm.dnsList;
    
    if (!cleanForm.dbHost) delete cleanForm.dbHost;
    if (!cleanForm.dbUser) delete cleanForm.dbUser;
    if (!cleanForm.dbPassword) delete cleanForm.dbPassword;
    if (cleanForm.dbName === 'xui' && !form.dbHost) delete cleanForm.dbName;
    if (cleanForm.dbPort === 3306 && !form.dbHost) delete cleanForm.dbPort;
    
    if (!cleanForm.sshHost) {
      delete cleanForm.sshHost;
      delete cleanForm.sshPort;
      delete cleanForm.sshUser;
      delete cleanForm.sshPassword;
      delete cleanForm.sshKey;
    } else {
      if (!cleanForm.sshUser) delete cleanForm.sshUser;
      if (!cleanForm.sshPassword && !cleanForm.sshKey) {
        delete cleanForm.sshPassword;
        delete cleanForm.sshKey;
      }
      if (cleanForm.sshPort === 22) delete cleanForm.sshPort;
    }
    
    if (editingServer) {
      const updateData: Partial<ServerForm> = cleanForm;
      if (!form.apiKey) delete updateData.apiKey;
      updateMutation.mutate({ id: editingServer.id, data: updateData });
    } else {
      createMutation.mutate(cleanForm);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
      ONLINE: 'success',
      OFFLINE: 'error',
      ERROR: 'error',
      UNKNOWN: 'warning',
    };
    return <Badge variant={variants[status] || 'default'}>{status}</Badge>;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start md:items-center justify-between gap-3 flex-col md:flex-row">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Servidores</h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-1">
            {activeTab === 'add'
              ? 'Adicionar um novo servidor XUI ONE ou Xtream UI'
              : 'Gerenciar servidores XUI ONE / Xtream UI'}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant={activeTab === 'manage' ? 'default' : 'outline'} onClick={() => setTab('manage')}>
            Gerir Servidores
          </Button>
          <Button variant={activeTab === 'add' ? 'default' : 'outline'} onClick={() => setTab('add')}>
            Adicionar Servidor
          </Button>
        </div>
      </div>

      <>
        {activeTab === 'manage' && (
          <div className="flex justify-end">
            <Button onClick={openCreateModal}>➕ Novo Servidor</Button>
          </div>
        )}

        {/* Lista de servidores */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {servers?.map((server) => (
            <Card key={server.id} className="p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">{server.name}</h3>
                    <Badge variant={server.serverType === 'XTREAMUI' ? 'warning' : 'default'} className="text-xs">
                      {server.serverType === 'XTREAMUI' ? 'Xtream UI' : 'XUI ONE'}
                    </Badge>
                    {server.isDefault && (
                      <Badge variant="default" className="text-xs">Padrão</Badge>
                    )}
                  </div>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1 break-all">{server.baseUrl}</p>
                </div>
                {getStatusBadge(server.status)}
              </div>

              <div className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                <div className="flex justify-between">
                  <span>Access Code:</span>
                  <span className="font-mono text-zinc-700 dark:text-zinc-300">{server.accessCode}</span>
                </div>
                <div className="flex justify-between">
                  <span>Pacotes:</span>
                  <span className="text-zinc-700 dark:text-zinc-300">{server._count?.packages || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span>Clientes:</span>
                  <span className="text-zinc-700 dark:text-zinc-300">{server._count?.customers || 0}</span>
                </div>
                {server.lastSync && (
                  <div className="flex justify-between">
                    <span>Última Sinc:</span>
                    <span className="text-zinc-700 dark:text-zinc-300">
                      {new Date(server.lastSync).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        timeZone: 'America/Sao_Paulo',
                      })}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => syncMutation.mutate(server.id)}
                  loading={syncMutation.isPending}
                >
                  🔄 Sincronizar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openEditModal(server)}
                >
                  ✏️ Editar
                </Button>
                <Button
                  size="sm"
                  variant={server.isActive ? 'ghost' : 'default'}
                  onClick={() => toggleMutation.mutate(server.id)}
                >
                  {server.isActive ? '🔴 Desativar' : '🟢 Ativar'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-400"
                  onClick={() => {
                    if (confirm('Remover este servidor?')) {
                      deleteMutation.mutate(server.id);
                    }
                  }}
                >
                  🗑️
                </Button>
              </div>
            </Card>
          ))}

          {servers?.length === 0 && (
            <Card className="p-8 col-span-full text-center">
              <p className="text-zinc-600 dark:text-zinc-400 mb-4">Nenhum servidor configurado</p>
              <Button onClick={openCreateModal}>
                Adicionar Servidor
              </Button>
            </Card>
          )}
        </div>

        {/* Instruções */}
        <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">📘 Guia de Configuração</h3>
          <div className="flex bg-zinc-100 dark:bg-zinc-800 p-1 rounded-lg">
            <button
              onClick={() => setForm({ ...form, serverType: 'XUIONE' })}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                form.serverType === 'XUIONE'
                  ? 'bg-white dark:bg-zinc-700 text-cyan-600 dark:text-cyan-400 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              XUI ONE
            </button>
            <button
              onClick={() => setForm({ ...form, serverType: 'XTREAMUI' })}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                form.serverType === 'XTREAMUI'
                  ? 'bg-white dark:bg-zinc-700 text-amber-600 dark:text-amber-400 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              Xtream UI
            </button>
          </div>
        </div>
        
        {form.serverType === 'XUIONE' ? (
          <div className="space-y-6 text-sm text-zinc-700 dark:text-zinc-300">
            {/* Passo 1 - XUI ONE */}
            <div className="flex gap-4">
              <span className="bg-blue-100 dark:bg-cyan-500/20 text-blue-700 dark:text-cyan-400 rounded-full w-8 h-8 flex items-center justify-center font-bold shrink-0">
                1
              </span>
              <div className="flex-1">
                <p className="font-semibold text-zinc-900 dark:text-white mb-2">Acessar seu XUI.ONE</p>
                <p className="text-zinc-600 dark:text-zinc-400 mb-2">
                  Acesse o painel XUI.ONE pelo navegador:
                </p>
                <code className="block bg-zinc-200 dark:bg-zinc-800 px-3 py-2 rounded text-zinc-900 dark:text-white mb-2 font-mono">
                  https://seu-servidor.com:9000/SEU_ACCESS_CODE/
                </code>
                <p className="text-xs text-zinc-500 dark:text-zinc-500">
                  ⚠️ Porta 9000 para HTTPS ou 8000 para HTTP.
                </p>
              </div>
            </div>

            {/* Passo 2 - XUI ONE */}
            <div className="flex gap-4">
              <span className="bg-blue-100 dark:bg-cyan-500/20 text-blue-700 dark:text-cyan-400 rounded-full w-8 h-8 flex items-center justify-center font-bold shrink-0">
                2
              </span>
              <div className="flex-1">
                <p className="font-semibold text-zinc-900 dark:text-white mb-2">Criar Access Code para API</p>
                <p className="text-zinc-600 dark:text-zinc-400 mb-2">
                  No painel XUI, navegue até <strong>MANAGEMENT → ACCESS CONTROL → ACCESS CODES</strong>.
                  Crie um código do tipo <strong>Admin API</strong>.
                </p>
              </div>
            </div>

            {/* Passo 3 - XUI ONE */}
            <div className="flex gap-4">
              <span className="bg-blue-100 dark:bg-cyan-500/20 text-blue-700 dark:text-cyan-400 rounded-full w-8 h-8 flex items-center justify-center font-bold shrink-0">
                3
              </span>
              <div className="flex-1">
                <p className="font-semibold text-zinc-900 dark:text-white mb-2">Obter API Key</p>
                <p className="text-zinc-600 dark:text-zinc-400">
                  Vá em <strong>User Profile</strong> e copie a sua <strong>API Key</strong>.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6 text-sm text-zinc-700 dark:text-zinc-300">
            {/* Passo 1 - Xtream UI */}
            <div className="flex gap-4">
              <span className="bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 rounded-full w-8 h-8 flex items-center justify-center font-bold shrink-0">
                1
              </span>
              <div className="flex-1">
                <p className="font-semibold text-zinc-900 dark:text-white mb-2">Acessar seu Xtream UI</p>
                <p className="text-zinc-600 dark:text-zinc-400 mb-2">
                  Acesse o painel Xtream UI. A URL da API geralmente é a mesma do painel:
                </p>
                <code className="block bg-zinc-200 dark:bg-zinc-800 px-3 py-2 rounded text-zinc-900 dark:text-white mb-2 font-mono">
                  http://seu-servidor.com:25461/api.php
                </code>
              </div>
            </div>

            {/* Passo 2 - Xtream UI */}
            <div className="flex gap-4">
              <span className="bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 rounded-full w-8 h-8 flex items-center justify-center font-bold shrink-0">
                2
              </span>
              <div className="flex-1">
                <p className="font-semibold text-zinc-900 dark:text-white mb-2">Credenciais de Admin</p>
                <p className="text-zinc-600 dark:text-zinc-400">
                  Use o <strong>usuário</strong> e a <strong>senha</strong> que você utiliza para entrar no painel administrativo do Xtream UI.
                </p>
              </div>
            </div>

            {/* Passo 3 - Xtream UI */}
            <div className="flex gap-4">
              <span className="bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 rounded-full w-8 h-8 flex items-center justify-center font-bold shrink-0">
                3
              </span>
              <div className="flex-1">
                <p className="font-semibold text-zinc-900 dark:text-white mb-2">Porta do Banco (7999)</p>
                <p className="text-zinc-600 dark:text-zinc-400">
                  O Xtream UI usa por padrão a porta <strong>7999</strong> para o MySQL. Certifique-se de que esta porta está aberta no firewall do seu servidor.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Seção Banco de Dados (Comum) */}
        <div className="mt-8 pt-6 border-t border-zinc-200 dark:border-zinc-700">
          <div className="flex gap-4">
            <span className="bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-full w-8 h-8 flex items-center justify-center font-bold shrink-0">
              💾
            </span>
            <div className="flex-1">
              <p className="font-semibold text-zinc-900 dark:text-white mb-2">Configuração de Banco de Dados</p>
              <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-4 text-xs space-y-3">
                <p>O PainelMaster precisa de acesso direto ao MySQL para:</p>
                <ul className="list-disc ml-4 space-y-1 text-zinc-600 dark:text-zinc-400">
                  <li>Gerenciar Bouquets corretamente</li>
                  <li>Ativar o modo Trial (Teste) de forma confiável</li>
                  <li>Garantir que as datas de expiração sejam aplicadas</li>
                </ul>
                <div className="p-3 bg-zinc-900 text-zinc-300 rounded font-mono">
                  # Xtream UI: Porta 7999, Banco: xtream_iptvpro<br/>
                  # XUI ONE: Porta 3306, Banco: xui
                </div>
              </div>
            </div>
          </div>
        </div>
        </Card>
      </>

      {/* Modal de Criar/Editar */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editingServer ? `Editar ${form.serverType === 'XTREAMUI' ? 'Xtream UI' : 'XUI ONE'}` : 'Novo Servidor'}
        size="xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Nome do Servidor"
              placeholder="Ex: NeoTV"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Tipo de Sistema
              </label>
              <select
                value={form.serverType}
                onChange={(e) => {
                  const type = e.target.value as 'XUIONE' | 'XTREAMUI';
                  const defaults = defaultsForServerType(type);
                  setForm({
                    ...form,
                    serverType: type,
                    dbPort: defaults.dbPort,
                    dbName: defaults.dbName,
                    dbUser: defaults.dbUser,
                  });
                  if (type === 'XTREAMUI') {
                    setShowDbSection(true);
                    setShowSshSection(true);
                  }
                }}
                disabled={!allowXuiOne}
                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                {allowXuiOne && <option value="XUIONE">XUI ONE</option>}
                <option value="XTREAMUI">Xtream UI</option>
              </select>
            </div>
          </div>

          <Input
            label="URL da API"
            placeholder={form.serverType === 'XTREAMUI' ? 'http://seu-servidor.com:25461' : 'https://seu-servidor.com:9000'}
            value={form.baseUrl}
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            helperText={form.serverType === 'XTREAMUI' ? 'URL onde o Xtream UI está instalado' : 'URL com porta (ex: :9000)'}
            required
          />

          <div className="bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-4">
            <h4 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">Credenciais da API</h4>
            
            {form.serverType === 'XUIONE' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Access Code"
                  placeholder="rnVKrSLe"
                  value={form.accessCode}
                  onChange={(e) => setForm({ ...form, accessCode: e.target.value })}
                  required
                />
                <Input
                  label="API Key"
                  type="password"
                  placeholder={editingServer ? '••••••••' : 'Chave da API'}
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  required={!editingServer}
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Usuário Admin"
                  placeholder="admin"
                  value={form.apiUsername}
                  onChange={(e) => setForm({ ...form, apiUsername: e.target.value })}
                  required
                />
                <Input
                  label="Senha Admin"
                  type="password"
                  placeholder={editingServer ? '••••••••' : 'Senha do painel'}
                  value={form.apiPassword}
                  onChange={(e) => setForm({ ...form, apiPassword: e.target.value })}
                  required={!editingServer}
                />
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
              className="rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
            />
            Definir como servidor padrão
          </label>

          {/* Seção Banco de Dados */}
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setShowDbSection(!showDbSection)}
              className="flex items-center gap-2 text-sm font-semibold text-cyan-500 hover:text-cyan-400 transition-colors"
            >
              {showDbSection ? '▼' : '▶'} 💾 Banco de Dados
            </button>

            {showDbSection && (
              <div className="mt-4 p-4 bg-zinc-50 dark:bg-zinc-900/30 rounded-lg border border-zinc-200 dark:border-zinc-800">
                {isXtream ? (
                  <div className="space-y-3">
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">
                      Padrão Xtream: host = SSH host, porta 7999, banco xtream_iptvpro, usuário user_iptvpro
                    </div>
                    <Input
                      label="Senha MySQL (user_iptvpro)"
                      type="password"
                      placeholder="••••••••"
                      value={form.dbPassword || ''}
                      onChange={(e) => setForm({ ...form, dbPassword: e.target.value })}
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="Host MySQL"
                      placeholder="IP do servidor"
                      value={form.dbHost || ''}
                      onChange={(e) => setForm({ ...form, dbHost: e.target.value })}
                    />
                    <Input
                      label="Porta MySQL"
                      type="number"
                      value={form.dbPort || 3306}
                      onChange={(e) => setForm({ ...form, dbPort: parseInt(e.target.value) })}
                    />
                    <Input
                      label="Nome do Banco"
                      value={form.dbName || ''}
                      onChange={(e) => setForm({ ...form, dbName: e.target.value })}
                    />
                    <Input
                      label="Usuário MySQL"
                      value={form.dbUser || ''}
                      onChange={(e) => setForm({ ...form, dbUser: e.target.value })}
                    />
                    <div className="md:col-span-2">
                      <Input
                        label="Senha MySQL"
                        type="password"
                        placeholder="••••••••"
                        value={form.dbPassword || ''}
                        onChange={(e) => setForm({ ...form, dbPassword: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Seção SSH */}
          <div className="pt-2">
            {isXtream ? (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-zinc-50 dark:bg-zinc-900/30 rounded-lg border border-zinc-200 dark:border-zinc-800">
                <div className="md:col-span-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  🔐 SSH (para instalar e ver logs)
                </div>
                <Input
                  label="Host SSH"
                  placeholder="IP do servidor"
                  value={form.sshHost || ''}
                  onChange={(e) => setForm({ ...form, sshHost: e.target.value })}
                />
                <Input
                  label="Porta SSH"
                  type="number"
                  value={form.sshPort || 22}
                  onChange={(e) => setForm({ ...form, sshPort: parseInt(e.target.value) })}
                />
                <Input
                  label="Usuário SSH"
                  placeholder="root"
                  value={form.sshUser || ''}
                  onChange={(e) => setForm({ ...form, sshUser: e.target.value })}
                />
                <Input
                  label="Senha SSH"
                  type="password"
                  placeholder="••••••••"
                  value={form.sshPassword || ''}
                  onChange={(e) => setForm({ ...form, sshPassword: e.target.value })}
                />
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setShowSshSection(!showSshSection)}
                  className="flex items-center gap-2 text-sm font-semibold text-cyan-500 hover:text-cyan-400 transition-colors"
                >
                  {showSshSection ? '▼' : '▶'} 🔐 SSH
                </button>
                {showSshSection && (
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-zinc-50 dark:bg-zinc-900/30 rounded-lg border border-zinc-200 dark:border-zinc-800">
                    <Input
                      label="Host SSH"
                      placeholder="IP do servidor"
                      value={form.sshHost || ''}
                      onChange={(e) => setForm({ ...form, sshHost: e.target.value })}
                    />
                    <Input
                      label="Porta SSH"
                      type="number"
                      value={form.sshPort || 22}
                      onChange={(e) => setForm({ ...form, sshPort: parseInt(e.target.value) })}
                    />
                    <Input
                      label="Usuário SSH"
                      placeholder="root"
                      value={form.sshUser || ''}
                      onChange={(e) => setForm({ ...form, sshUser: e.target.value })}
                    />
                    <Input
                      label="Senha SSH"
                      type="password"
                      placeholder="••••••••"
                      value={form.sshPassword || ''}
                      onChange={(e) => setForm({ ...form, sshPassword: e.target.value })}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Resultado do teste */}
          {testResult && (
            <div
              className={`p-3 rounded-lg text-sm font-medium ${
                testResult.success ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'
              }`}
            >
              {testResult.message}
            </div>
          )}

          <div className="flex gap-3 pt-6 border-t border-zinc-200 dark:border-zinc-700">
            <Button
              type="button"
              variant="outline"
              onClick={testConnection}
              loading={testing}
              disabled={!form.baseUrl || (form.serverType === 'XUIONE' ? (!form.accessCode || !form.apiKey) : (!form.apiUsername || !form.apiPassword))}
            >
              🔍 Testar Conexão
            </Button>
            <div className="flex-1" />
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

export default XuiConnectionPage;
