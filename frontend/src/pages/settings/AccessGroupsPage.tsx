import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, Modal, Spinner } from '../../components/ui';
import { api } from '../../api/client';
import toast from 'react-hot-toast';

type AccessGroup = {
  id: string;
  name: string;
  description?: string | null;
  menuPermissions?: string | null;
  _count?: { users: number };
  createdAt?: string;
  updatedAt?: string;
};

const MENU_ITEMS: Array<{ key: string; label: string }> = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'customers', label: 'Clientes' },
  { key: 'financial', label: 'Financeiro' },
  { key: 'billing_report', label: 'Relatório Cobrança' },
  { key: 'billing_hierarchy', label: 'Hierarquia' },
  { key: 'users', label: 'Usuários' },
  { key: 'resellers', label: 'Revendedores' },
  { key: 'packages', label: 'Pacotes' },
  { key: 'bouquets', label: 'Bouquets' },
  { key: 'core', label: 'Xtream Novo' },
  { key: 'vod', label: 'VOD' },
  { key: 'live', label: 'LIVE TV' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'premium', label: 'Premium' },
  { key: 'notifications', label: 'Notificações' },
  { key: 'panel_settings', label: 'Config. Painel' },
  { key: 'asaas', label: 'Pagamentos Asaas' },
  { key: 'backups', label: 'Backups' },
  { key: 'import_sigma', label: 'Importar SIGMA' },
  { key: 'xui_connection', label: 'Conexão XUI' },
];

function parseMenuPermissions(raw: unknown): string[] {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function AccessGroupsPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AccessGroup | null>(null);
  const [form, setForm] = useState<{ name: string; description: string; menuPermissions: string[] }>({
    name: '',
    description: '',
    menuPermissions: [],
  });

  const { data, isLoading } = useQuery({
    queryKey: ['access-groups-page'],
    queryFn: async () => (await api.get('/users/access-groups')).data,
  });

  const groups: AccessGroup[] = data?.data || [];

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', description: '', menuPermissions: [] });
    setModalOpen(true);
  };

  const openEdit = (g: AccessGroup) => {
    setEditing(g);
    setForm({
      name: g.name || '',
      description: g.description || '',
      menuPermissions: parseMenuPermissions(g.menuPermissions),
    });
    setModalOpen(true);
  };

  const close = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() ? form.description.trim() : null,
        menuPermissions: form.menuPermissions,
      };
      if (editing?.id) {
        return (await api.put(`/users/access-groups/${editing.id}`, payload)).data;
      }
      return (await api.post('/users/access-groups', payload)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['access-groups-page'] });
      queryClient.invalidateQueries({ queryKey: ['users-access-groups'] });
      toast.success(editing ? 'Grupo atualizado!' : 'Grupo criado!');
      close();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao salvar grupo');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/users/access-groups/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['access-groups-page'] });
      queryClient.invalidateQueries({ queryKey: ['users-access-groups'] });
      toast.success('Grupo removido!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao remover grupo');
    },
  });

  const permissionsLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of MENU_ITEMS) map.set(item.key, item.label);
    return map;
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">🔐 Grupos de Acesso</h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-1">Crie e gerencie perfis de permissões para usuários</p>
        </div>
        <Button onClick={openCreate}>➕ Novo Grupo</Button>
      </div>

      <Card className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-10 flex items-center justify-center">
            <Spinner size="lg" />
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Descrição</th>
                  <th>Usuários</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {groups.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-10 text-zinc-500">
                      Nenhum grupo cadastrado
                    </td>
                  </tr>
                ) : (
                  groups.map((g) => (
                    <tr key={g.id}>
                      <td className="font-medium text-zinc-900 dark:text-white">{g.name}</td>
                      <td className="text-zinc-700 dark:text-zinc-200">{g.description || '-'}</td>
                      <td className="text-zinc-700 dark:text-zinc-200">{g._count?.users ?? '-'}</td>
                      <td className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(g)}>
                            ✏️
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (confirm(`Remover o grupo "${g.name}"?`)) {
                                deleteMutation.mutate(g.id);
                              }
                            }}
                          >
                            🗑️
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal isOpen={modalOpen} onClose={close} title={editing ? 'Editar Grupo' : 'Novo Grupo'} size="lg">
        <div className="space-y-4">
          <Input
            label="Nome do grupo"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="Ex: Revenda Básica"
          />
          <Input
            label="Descrição (opcional)"
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            placeholder="Ex: Acesso somente a Clientes e Financeiro"
          />

          <div className="pt-2 border-t border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div>
                <h4 className="text-sm font-semibold text-zinc-900 dark:text-white">Permissões do Grupo</h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Defina quais menus os usuários deste grupo poderão acessar.</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, menuPermissions: MENU_ITEMS.map((x) => x.key) }))}
                  className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded"
                >
                  Marcar Todos
                </button>
                <button
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, menuPermissions: [] }))}
                  className="text-xs px-2 py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded"
                >
                  Limpar
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {MENU_ITEMS.map(({ key, label }) => (
                <label
                  key={key}
                  className="flex items-center gap-2 p-2 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={form.menuPermissions.includes(key)}
                    onChange={(e) => {
                      setForm((prev) => {
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
            <Button variant="ghost" onClick={close}>
              Cancelar
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              loading={saveMutation.isPending}
              disabled={!form.name.trim()}
            >
              💾 Salvar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default AccessGroupsPage;
