import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Badge, Spinner, Button, Modal } from '../components/ui';
import { api } from '../api/client';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';
import { Activity, AlertTriangle, Clock, LayoutDashboard, Server, UserCheck, Users } from 'lucide-react';

interface DashboardData {
  stats: {
    total_lines: number;
    active_lines: number;
    expired_lines: number;
    trials_today: number;
    expiring_soon: number;
  };
  recentCustomers: Array<{
    id: string;
    username: string;
    status: string;
    expires_at: string;
    days_until_expiry: number;
  }>;
  expiringCustomers: Array<{
    id: string;
    username: string;
    expires_at: string;
    days_until_expiry: number;
  }>;
  core?: {
    balances: Array<{
      id: string;
      name: string;
      host: string | null;
      httpPort: number;
      httpsPort: number;
      installedAt: string | null;
      createdAt: string;
      isActive: boolean;
    }>;
    liveConnections: Array<{
      id: string;
      username: string | null;
      contentType: string;
      contentPublicId: number | null;
      contentName: string | null;
      serverHost: string | null;
      ipAddress: string | null;
      userAgent: string | null;
      startedAt: string;
      lastSeenAt: string;
    }>;
  };
}

type CoreBouquet = {
  id: string;
  name: string;
  isActive: boolean;
  _count?: { streams: number };
};

type CoreEdgeServersMetricsResponse = {
  data: {
    checkedAt: string;
    total: number;
    results: Array<{
      serverId: string;
      serverName?: string;
      ok: boolean;
      ms: number;
      status: number | null;
      url: string | null;
      error: string | null;
      metrics: {
        timestamp?: string;
        uptimeSeconds?: number | null;
        cpuPercent?: number | null;
        memPercent?: number | null;
        net?: { rxBytes: string; txBytes: string } | null;
        activeConnections?: number | null;
        activeUsers?: number | null;
        flowsOn?: number | null;
        flowsOff?: number | null;
        host?: string | null;
      } | null;
    }>;
  };
};

export function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [quickTestModalOpen, setQuickTestModalOpen] = useState(false);
  const [testResultModalOpen, setTestResultModalOpen] = useState(false);
  const [selectedTemplateType, setSelectedTemplateType] = useState<'complete' | 'xciptv' | 'simple' | null>(null);
  const [testHours, setTestHours] = useState(6);
  const [testResult, setTestResult] = useState<any>(null);
  const [selectedQuickTestPkgId, setSelectedQuickTestPkgId] = useState<string>('');
  const prevServerNetRef = useRef<Record<string, { rxBytes: bigint; txBytes: bigint; tsMs: number }>>({});
  const [serverNetRates, setServerNetRates] = useState<Record<string, { rxMbps: number; txMbps: number }>>({});

  // Busca dados do dashboard
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const res = await api.get('/dashboard');
      return res.data.data as DashboardData;
    },
    refetchInterval: 60000, // Atualiza a cada 1 minuto
  });

  const { data: coreBouquets = [] } = useQuery({
    queryKey: ['core-bouquets-dashboard'],
    queryFn: async () => {
      const res = await api.get('/core/bouquets');
      return (res.data.data || []) as CoreBouquet[];
    },
  });

  const {
    data: serversMetrics,
    refetch: refetchServersMetrics,
    isFetching: serversMetricsLoading,
  } = useQuery({
    queryKey: ['core-servers-metrics-dashboard'],
    queryFn: async () => {
      const res = await api.get('/core/servers/metrics');
      return res.data as CoreEdgeServersMetricsResponse;
    },
    refetchInterval: 15000,
    onSuccess: (payload: CoreEdgeServersMetricsResponse) => {
      const now = Date.now();
      const nextPrev: Record<string, { rxBytes: bigint; txBytes: bigint; tsMs: number }> = { ...prevServerNetRef.current };
      const computedRates: Record<string, { rxMbps: number; txMbps: number }> = {};

      for (const r of payload.data.results || []) {
        if (!r?.serverId) continue;
        const rxStr = r.metrics?.net?.rxBytes;
        const txStr = r.metrics?.net?.txBytes;
        if (!rxStr || !txStr) continue;

        let rxBytes = 0n;
        let txBytes = 0n;
        try { rxBytes = BigInt(String(rxStr)); } catch {}
        try { txBytes = BigInt(String(txStr)); } catch {}

        const prev = prevServerNetRef.current[r.serverId];
        if (prev && now > prev.tsMs) {
          const dtSec = Math.max(0.5, (now - prev.tsMs) / 1000);
          const drx = rxBytes >= prev.rxBytes ? rxBytes - prev.rxBytes : 0n;
          const dtx = txBytes >= prev.txBytes ? txBytes - prev.txBytes : 0n;
          const rxMbps = Number(drx) * 8 / dtSec / 1_000_000;
          const txMbps = Number(dtx) * 8 / dtSec / 1_000_000;
          computedRates[r.serverId] = {
            rxMbps: Number.isFinite(rxMbps) ? Math.max(0, rxMbps) : 0,
            txMbps: Number.isFinite(txMbps) ? Math.max(0, txMbps) : 0,
          };
        }

        nextPrev[r.serverId] = { rxBytes, txBytes, tsMs: now };
      }

      prevServerNetRef.current = nextPrev;
      setServerNetRates((prev) => ({ ...prev, ...computedRates }));
    },
  });

  // Busca pacotes marcados para exibir no dashboard (para teste rápido)
  const { data: trialPackagesData } = useQuery({
    queryKey: ['dashboard-packages'],
    queryFn: async () => {
      const res = await api.get('/packages-local?showOnDashboard=true&isActive=true');
      return res.data.data as Array<{
        id: string;
        name: string;
        serverId: string;
        isTrial: boolean;
        template?: string;
        templateXciptv?: string;
        templateSimple?: string;
        server?: { id: string; name: string };
      }>;
    },
  });

  // Criar teste rápido
  const quickTestMutation = useMutation({
    mutationFn: async ({ hours, templateType, packageId }: { hours: number; templateType: 'complete' | 'xciptv' | 'simple'; packageId?: string }) => {
      if (!trialPackagesData || trialPackagesData.length === 0) {
        throw new Error('Nenhum pacote disponível para teste. Marque "Exibir no Dashboard" em um pacote.');
      }
      
      const pkg = packageId 
        ? trialPackagesData.find(p => p.id === packageId) || trialPackagesData[0]
        : trialPackagesData[0];
      const payload: any = {
        server_id: pkg.serverId,
        package_id: pkg.id,
        trial_hours: hours,
        connections: 1,
        template_type: templateType,
      };
      
      const res = await api.post('/customers', payload);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Teste criado com sucesso!');
      setQuickTestModalOpen(false);
      setSelectedTemplateType(null);
      // Mostrar modal com resultado
      setTestResult(data.data);
      setTestResultModalOpen(true);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao criar teste');
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card className="p-8 text-center">
          <p className="text-red-400">Erro ao carregar dados do dashboard</p>
          <p className="text-sm text-zinc-500 mt-2">
            Verifique se o servidor XUI está configurado corretamente.
          </p>
        </Card>
      </div>
    );
  }

  const stats = data?.stats || {
    total_lines: 0,
    active_lines: 0,
    expired_lines: 0,
    trials_today: 0,
    expiring_soon: 0,
  };

  const coreBalances = data?.core?.balances || [];
  const coreLiveConnections = data?.core?.liveConnections || [];

  const formatElapsed = (iso: string) => {
    const started = new Date(iso).getTime();
    const totalSec = Math.max(0, Math.floor((Date.now() - started) / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const formatMbps = (val?: number | null) => {
    const n = typeof val === 'number' ? val : 0;
    if (!Number.isFinite(n) || n <= 0) return '0 Mbps';
    if (n < 1) return `${n.toFixed(2)} Mbps`;
    if (n < 10) return `${n.toFixed(2)} Mbps`;
    return `${n.toFixed(1)} Mbps`;
  };

  const formatUptime = (seconds?: number | null) => {
    if (seconds === null || seconds === undefined) return '-';
    const total = Math.max(0, Math.floor(seconds));
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const installedServers = coreBalances.filter((s) => s.isActive && !!s.installedAt);

  const serverMetricsById = useMemo(() => {
    const map: Record<string, CoreEdgeServersMetricsResponse['data']['results'][number]> = {};
    for (const r of serversMetrics?.data?.results || []) {
      if (r?.serverId) map[r.serverId] = r;
    }
    return map;
  }, [serversMetrics]);

  const totalsByServers = useMemo(() => {
    let rx = 0;
    let tx = 0;
    let flowsOn = 0;
    let flowsOff = 0;
    for (const s of installedServers) {
      const rate = serverNetRates[s.id];
      if (rate) {
        rx += rate.rxMbps || 0;
        tx += rate.txMbps || 0;
      }
      const mt = serverMetricsById[s.id];
      const fOn = mt?.metrics?.flowsOn;
      const fOff = mt?.metrics?.flowsOff;
      flowsOn += typeof fOn === 'number' ? fOn : 0;
      flowsOff += typeof fOff === 'number' ? fOff : 0;
    }
    return { rx, tx, flowsOn, flowsOff };
  }, [installedServers, serverMetricsById, serverNetRates]);

  const serversOnlineCount = useMemo(() => {
    let ok = 0;
    for (const s of installedServers) {
      const mt = serverMetricsById[s.id];
      if (mt?.ok) ok++;
    }
    return ok;
  }, [installedServers, serverMetricsById]);

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-zinc-900 dark:text-white">Dashboard</h1>
          <p className="text-zinc-600 dark:text-zinc-400 text-sm lg:text-base mt-1">Bem-vindo, {user?.name || user?.username}!</p>
        </div>
        <div className="bg-zinc-100 dark:bg-zinc-800/50 rounded-lg px-4 py-2 flex items-center gap-3 self-start">
          {user?.billingType === 'POSTPAID' ? (
            <>
              <span className="text-zinc-600 dark:text-zinc-400 text-sm">Vencimento:</span>
              <span className="text-blue-600 dark:text-cyan-400 text-xl font-bold">
                {user?.dueDate 
                  ? new Date(user.dueDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
                  : 'Não definido'}
              </span>
            </>
          ) : (
            <>
              <span className="text-zinc-600 dark:text-zinc-400 text-sm">Créditos:</span>
              <span className="text-blue-600 dark:text-cyan-400 text-xl font-bold">{user?.credits || 0}</span>
            </>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3 lg:gap-4 lg:grid-cols-4">
        <StatCard
          title="Total de Clientes"
          value={stats.total_lines}
          icon={<Users className="w-6 h-6 text-cyan-300" />}
          color="cyan"
        />
        <StatCard
          title="Clientes Ativos"
          value={stats.active_lines}
          icon={<UserCheck className="w-6 h-6 text-green-300" />}
          color="green"
        />
        <StatCard
          title="Expirados"
          value={stats.expired_lines}
          icon={<Clock className="w-6 h-6 text-red-300" />}
          color="red"
        />
        <StatCard
          title="Vencendo em 7 dias"
          value={stats.expiring_soon}
          icon={<AlertTriangle className="w-6 h-6 text-yellow-300" />}
          color="yellow"
        />
      </div>

      {/* Gerar Testes Rápidos - MOVIDO PARA AQUI */}
      {trialPackagesData && trialPackagesData.length > 0 && (
        <Card className="p-4 lg:p-5">
          <h3 className="text-base lg:text-lg font-semibold text-zinc-900 dark:text-white mb-3 lg:mb-4">🚀 Gerar Teste Rápido</h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
            Crie testes automaticamente usando os templates configurados nos pacotes
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Button
              onClick={() => {
                setSelectedTemplateType('complete');
                setQuickTestModalOpen(true);
              }}
              className="bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-600 hover:to-purple-600"
            >
              📺 Teste Completo
            </Button>
            <Button
              onClick={() => {
                setSelectedTemplateType('xciptv');
                setQuickTestModalOpen(true);
              }}
              className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600"
            >
              📱 Teste XCIPTV
            </Button>
            <Button
              onClick={() => {
                setSelectedTemplateType('simple');
                setQuickTestModalOpen(true);
              }}
              className="bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600"
            >
              🎬 Teste App Parceiro
            </Button>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
              <LayoutDashboard className="w-5 h-5 text-cyan-400" />
              Últimos Clientes
            </h3>
            <Badge variant="default">{data?.recentCustomers?.length || 0}</Badge>
          </div>

          {data?.recentCustomers && data.recentCustomers.length > 0 ? (
            <div className="space-y-3">
              {data.recentCustomers.slice(0, 5).map((customer) => (
                <div
                  key={customer.id}
                  className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700"
                >
                  <div>
                    <p className="text-zinc-900 dark:text-white font-mono">{customer.username}</p>
                    <p className="text-xs text-zinc-600 dark:text-zinc-500">
                      Expira:{' '}
                      {new Date(customer.expires_at).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        timeZone: 'America/Sao_Paulo',
                      })}
                    </p>
                  </div>
                  <Badge variant={customer.status === 'ACTIVE' ? 'default' : customer.status === 'EXPIRED' ? 'error' : 'warning'}>
                    {customer.status}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-zinc-600 dark:text-zinc-500 text-center py-6">Nenhum cliente cadastrado ainda</p>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
              <Server className="w-5 h-5 text-blue-400" />
              Balances (Xtream Novo)
            </h3>
            <Badge variant="default">{coreBalances.length}</Badge>
          </div>

          {coreBalances.length > 0 ? (
            <div className="space-y-3">
              {coreBalances.slice(0, 5).map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700"
                >
                  <div>
                    <p className="text-zinc-900 dark:text-white">{s.name}</p>
                    <p className="text-xs text-zinc-600 dark:text-zinc-500">
                      {s.host ? `${s.host}:${s.httpPort}` : 'Sem host'}
                    </p>
                  </div>
                  <Badge variant={s.installedAt ? 'default' : 'warning'}>{s.installedAt ? 'INSTALADO' : 'PENDENTE'}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-zinc-600 dark:text-zinc-500 text-center py-6">Nenhum balance cadastrado</p>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-400" />
              Conexões (Xtream Novo)
            </h3>
            <Badge variant="default">{coreLiveConnections.length}</Badge>
          </div>

          {coreLiveConnections.length > 0 ? (
            <div className="space-y-3">
              {coreLiveConnections.slice(0, 5).map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700"
                >
                  <div className="min-w-0">
                    <p className="text-zinc-900 dark:text-white truncate">
                      {c.username || '—'} • {c.contentName || c.contentType}
                    </p>
                    <p className="text-xs text-zinc-600 dark:text-zinc-500 truncate">
                      {c.serverHost || '—'}
                    </p>
                  </div>
                  <Badge variant="default">{formatElapsed(c.startedAt)}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-zinc-600 dark:text-zinc-500 text-center py-6">Nenhuma conexão ao vivo agora</p>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Servidores (Balances)</h3>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchServersMetrics()}
              disabled={serversMetricsLoading}
            >
              Refrescar
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
            <div className="text-xs text-zinc-600 dark:text-zinc-400">TOTAL ENTRADAS</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-white">{formatMbps(totalsByServers.rx)}</div>
          </div>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
            <div className="text-xs text-zinc-600 dark:text-zinc-400">TOTAL SAÍDAS</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-white">{formatMbps(totalsByServers.tx)}</div>
          </div>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
            <div className="text-xs text-zinc-600 dark:text-zinc-400">FLUXOS ON</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-white">{totalsByServers.flowsOn}</div>
          </div>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
            <div className="text-xs text-zinc-600 dark:text-zinc-400">SERVIDORES ONLINE</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-white">{serversOnlineCount}/{installedServers.length}</div>
            <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">OFF: {totalsByServers.flowsOff}</div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {installedServers.map((s) => {
            const mt = serverMetricsById[s.id];
            const rates = serverNetRates[s.id];
            const cpu = mt?.metrics?.cpuPercent;
            const mem = mt?.metrics?.memPercent;
            const uptimeSeconds = mt?.metrics?.uptimeSeconds;
            const conns = mt?.metrics?.activeConnections;
            const users = mt?.metrics?.activeUsers;
            const flowsOn = mt?.metrics?.flowsOn;
            const flowsOff = mt?.metrics?.flowsOff;

            return (
              <div key={s.id} className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-zinc-900 dark:text-white truncate">{s.name}</div>
                  <div className="flex items-center gap-2">
                    <Badge variant={mt ? (mt.ok ? 'success' : 'warning') : 'info'}>{mt ? (mt.ok ? 'ONLINE' : 'OFFLINE') : '...'}</Badge>
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">{mt?.ok ? `${mt.ms} ms` : '-'}</span>
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div className="text-zinc-700 dark:text-zinc-300">Conexões: <span className="font-medium text-zinc-900 dark:text-white">{typeof conns === 'number' ? conns : '-'}</span></div>
                  <div className="text-zinc-700 dark:text-zinc-300">Utilizadores: <span className="font-medium text-zinc-900 dark:text-white">{typeof users === 'number' ? users : '-'}</span></div>
                  <div className="text-zinc-700 dark:text-zinc-300">Fluxos ON: <span className="font-medium text-zinc-900 dark:text-white">{typeof flowsOn === 'number' ? flowsOn : '-'}</span></div>
                  <div className="text-zinc-700 dark:text-zinc-300">Fluxos OFF: <span className="font-medium text-zinc-900 dark:text-white">{typeof flowsOff === 'number' ? flowsOff : '-'}</span></div>
                  <div className="text-zinc-700 dark:text-zinc-300">Entrada: <span className="font-medium text-zinc-900 dark:text-white">{formatMbps(rates?.rxMbps)}</span></div>
                  <div className="text-zinc-700 dark:text-zinc-300">Saída: <span className="font-medium text-zinc-900 dark:text-white">{formatMbps(rates?.txMbps)}</span></div>
                  <div className="text-zinc-700 dark:text-zinc-300">CPU: <span className="font-medium text-zinc-900 dark:text-white">{cpu === null || cpu === undefined ? '-' : `${cpu.toFixed(1)}%`}</span></div>
                  <div className="text-zinc-700 dark:text-zinc-300">MEM: <span className="font-medium text-zinc-900 dark:text-white">{mem === null || mem === undefined ? '-' : `${mem.toFixed(1)}%`}</span></div>
                  <div className="text-zinc-700 dark:text-zinc-300">Uptime: <span className="font-medium text-zinc-900 dark:text-white">{formatUptime(uptimeSeconds)}</span></div>
                  <div className="text-zinc-700 dark:text-zinc-300">Host: <span className="font-medium text-zinc-900 dark:text-white">{s.host || '-'}</span></div>
                </div>

                {!mt?.ok && mt?.error ? (
                  <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400 truncate">{mt.error}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Grid de conteúdo */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Clientes vencendo */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">⚠️ Vencendo em Breve</h3>
            <Badge variant="warning">{data?.expiringCustomers?.length || 0}</Badge>
          </div>

          {data?.expiringCustomers && data.expiringCustomers.length > 0 ? (
            <div className="space-y-3">
              {data.expiringCustomers.slice(0, 5).map((customer) => (
                <div
                  key={customer.id}
                  className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700"
                >
                  <div>
                    <p className="text-zinc-900 dark:text-white font-mono">{customer.username}</p>
                    <p className="text-xs text-zinc-600 dark:text-zinc-500">
                      {new Date(customer.expires_at).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        timeZone: 'America/Sao_Paulo',
                      })}
                    </p>
                  </div>
                  <Badge
                    variant={
                      customer.days_until_expiry <= 1
                        ? 'error'
                        : customer.days_until_expiry <= 3
                        ? 'warning'
                        : 'default'
                    }
                  >
                    {customer.days_until_expiry}d
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-zinc-600 dark:text-zinc-500 text-center py-6">
              Nenhum cliente vencendo nos próximos 7 dias 🎉
            </p>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Bouquets (Xtream Novo)</h3>
            <Badge variant="default">{coreBouquets.length}</Badge>
          </div>

          {coreBouquets.length > 0 ? (
            <div className="space-y-3">
              {coreBouquets.slice(0, 5).map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700"
                >
                  <div className="min-w-0">
                    <p className="text-zinc-900 dark:text-white truncate">{b.name}</p>
                    <p className="text-xs text-zinc-600 dark:text-zinc-500">
                      Streams: {typeof b._count?.streams === 'number' ? b._count.streams : 0}
                    </p>
                  </div>
                  <Badge variant={b.isActive ? 'default' : 'warning'}>{b.isActive ? 'ATIVO' : 'INATIVO'}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-zinc-600 dark:text-zinc-500 text-center py-6">
              Nenhum bouquet criado no Xtream Novo
            </p>
          )}
        </Card>
      </div>

      {/* Modal Gerar Teste Rápido */}
      <Modal
        isOpen={quickTestModalOpen}
        onClose={() => {
          setQuickTestModalOpen(false);
          setSelectedTemplateType(null);
        }}
        title={`🧪 Gerar Teste ${selectedTemplateType === 'complete' ? 'Completo' : selectedTemplateType === 'xciptv' ? 'XCIPTV' : 'Simples'}`}
      >
        <div className="space-y-4">
          {/* Selecionar pacote */}
          {trialPackagesData && trialPackagesData.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Pacote</label>
              <select
                value={selectedQuickTestPkgId || trialPackagesData[0]?.id || ''}
                onChange={(e) => setSelectedQuickTestPkgId(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white text-sm"
              >
                {trialPackagesData.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.name} {pkg.server?.name ? `(${pkg.server.name})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Duração do Teste</label>
            <div className="flex gap-2 flex-wrap">
              {[3, 6, 12, 24].map((hours) => (
                <button
                  key={hours}
                  type="button"
                  onClick={() => setTestHours(hours)}
                  className={`flex-1 py-3 rounded-lg text-sm font-medium transition-colors ${
                    testHours === hours
                      ? 'bg-blue-600 dark:bg-cyan-500 text-white'
                      : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-700'
                  }`}
                >
                  {hours}h
                </button>
              ))}
            </div>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <p className="text-sm text-blue-700 dark:text-blue-300">
              <strong>Template usado:</strong>{' '}
              {selectedTemplateType === 'complete'
                ? 'Template Completo do pacote'
                : selectedTemplateType === 'xciptv'
                ? 'Template XCIPTV do pacote'
                : 'Template Aplicativo Parceiro do pacote'}
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
            <Button
              variant="ghost"
              onClick={() => {
                setQuickTestModalOpen(false);
                setSelectedTemplateType(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (selectedTemplateType) {
                  quickTestMutation.mutate({ 
                    hours: testHours, 
                    templateType: selectedTemplateType,
                    packageId: selectedQuickTestPkgId || trialPackagesData?.[0]?.id,
                  });
                }
              }}
              loading={quickTestMutation.isPending}
            >
              🚀 Gerar Teste
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal Resultado do Teste */}
      {testResult && (
        <Modal
          isOpen={testResultModalOpen}
          onClose={() => {
            setTestResultModalOpen(false);
            setTestResult(null);
          }}
          title="✅ Teste Criado com Sucesso!"
          size="lg"
        >
          <TestResultContent
            testResult={testResult}
            onClose={() => {
              setTestResultModalOpen(false);
              setTestResult(null);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

// Componente para exibir resultado do teste
function TestResultContent({ testResult, onClose }: { testResult: any; onClose: () => void }) {
  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiado!`);
    } catch (err) {
      // Fallback para navegadores antigos
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        toast.success(`${label} copiado!`);
      } catch {
        toast.error('Erro ao copiar');
      }
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo',
      });
    } catch (e) {
      return '-';
    }
  };

  const template = testResult.playlist || `📺 *ACESSO IPTV CRIADO COM SUCESSO!*

👤 *Usuário:* ${testResult.username}
🔑 *Senha:* ${testResult.password}

📱 *Para XCIPTV/Smarters:*
🌐 DNS: ${testResult.dns || 'Não configurado'}
👤 Usuário: ${testResult.username}
🔑 Senha: ${testResult.password}

${testResult.urls?.m3u_ts ? `🔗 *Link M3U:*
${testResult.urls.m3u_ts}

` : ''}📅 *Vencimento:* ${formatDate(testResult.expiresAt)}
📶 *Conexões:* ${testResult.connections || 1}

⚠️ *Importante:* Não compartilhe suas credenciais!`;

  return (
    <div className="space-y-4">
      {/* Banner de Sucesso */}
      <div className="bg-gradient-to-r from-green-500/20 to-cyan-500/20 rounded-lg p-4 border border-green-500/30">
        <p className="text-center text-green-400 font-semibold">
          🎉 Teste criado com sucesso!
        </p>
      </div>

      {/* Dados de Acesso */}
      <div className="bg-zinc-100 dark:bg-zinc-800/50 rounded-lg p-4 border border-zinc-300 dark:border-zinc-700">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-3 flex items-center gap-2">
          📺 Dados de Acesso
        </h3>
        <div className="space-y-3">
          <div className="bg-gradient-to-r from-cyan-500/20 to-purple-500/20 rounded-lg p-4 text-center">
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-1">👤 Usuário</p>
            <p className="text-2xl font-mono font-bold text-zinc-900 dark:text-white mb-3">
              {testResult.username}
            </p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-1">🔑 Senha</p>
            <p className="text-xl font-mono text-zinc-700 dark:text-zinc-300">{testResult.password}</p>
          </div>
        </div>
      </div>

      {/* Botões de Ação */}
      <div className="flex flex-col gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
        <Button
          className="w-full bg-green-600 hover:bg-green-700 text-white"
          onClick={() => {
            copyToClipboard(template, 'Template completo');
            // Tentar abrir WhatsApp nativo primeiro, depois WhatsApp Web
            const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(template)}`;
            const whatsappNativeUrl = `whatsapp://send?text=${encodeURIComponent(template)}`;
            
            // Criar link temporário para tentar abrir WhatsApp nativo
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
            } catch (e) {
              // Fallback para WhatsApp Web
              window.open(whatsappUrl, '_blank');
            } finally {
              document.body.removeChild(link);
            }
          }}
        >
          📱 Copiar Template e Abrir WhatsApp
        </Button>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={() => {
              copyToClipboard(template, 'Template completo');
            }}
          >
            📋 Copiar Template
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const text = `👤 Usuário: ${testResult.username}\n🔑 Senha: ${testResult.password}`;
              copyToClipboard(text, 'Credenciais');
            }}
          >
            🔑 Copiar Credenciais
          </Button>
        </div>

        <Button
          variant="ghost"
          className="w-full"
          onClick={onClose}
        >
          Fechar
        </Button>
      </div>
    </div>
  );
}

// Componente de estatística
function StatCard({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: 'cyan' | 'green' | 'red' | 'yellow';
}) {
  const colorClasses = {
    cyan: 'from-cyan-500/20 to-cyan-500/5 border-cyan-500/30',
    green: 'from-green-500/20 to-green-500/5 border-green-500/30',
    red: 'from-red-500/20 to-red-500/5 border-red-500/30',
    yellow: 'from-yellow-500/20 to-yellow-500/5 border-yellow-500/30',
  };

  const textClasses = {
    cyan: 'text-cyan-400',
    green: 'text-green-400',
    red: 'text-red-400',
    yellow: 'text-yellow-400',
  };

  return (
    <Card
      className={`p-3 lg:p-5 bg-gradient-to-br ${colorClasses[color]} border ${colorClasses[color]}`}
    >
      <div className="flex items-center justify-between mb-2 lg:mb-3">
        <span className="text-xl lg:text-2xl">{icon}</span>
        <span className={`text-2xl lg:text-3xl font-bold ${textClasses[color]}`}>{value}</span>
      </div>
      <p className="text-xs lg:text-sm text-zinc-400 truncate">{title}</p>
    </Card>
  );
}

export default DashboardPage;
