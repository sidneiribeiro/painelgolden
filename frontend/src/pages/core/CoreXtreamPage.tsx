import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { Badge, Button, Card, Input, Modal, Select, Spinner } from '../../components/ui';
import { useAuthStore } from '../../store/authStore';

function normalizeM3UUrlInput(raw: string) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const hashIndex = s.indexOf('#');
  const beforeHash = hashIndex >= 0 ? s.slice(0, hashIndex) : s;
  const hashPart = hashIndex >= 0 ? s.slice(hashIndex) : '';
  const firstQ = beforeHash.indexOf('?');
  const safeBeforeHash = (() => {
    if (firstQ < 0) return beforeHash.replace(/\s+/g, '%20');
    const head = beforeHash.slice(0, firstQ + 1);
    const query = beforeHash.slice(firstQ + 1).replace(/\?/g, '%3F').replace(/\s+/g, '%20');
    return `${head}${query}`;
  })();
  return `${safeBeforeHash}${hashPart}`;
}

type CoreStream = {
  id: string;
  name: string;
  streamUrl: string;
  logoUrl: string | null;
  epgChannelId?: string | null;
  tvArchive?: boolean;
  tvArchiveDuration?: number;
  isActive: boolean;
  bouquetIds?: string[];
  serverIds?: string[];
  createdAt: string;
};

type CoreEdgeServer = {
  id: string;
  name: string;
  domain: string | null;
  ip: string | null;
  vpnIp?: string | null;
  timezoneOffsetSeconds?: number;
  networkInterface?: string | null;
  networkSpeed?: number;
  httpPort: number;
  httpsPort: number;
  rtmpPort: number;
  maxClients?: number;
  onlyTimeshift?: boolean;
  duplex?: boolean;
  geoipEnabled?: boolean;
  geoipPriority?: string | null;
  geoipCountries?: string | null;
  ispEnabled?: boolean;
  ispPriority?: string | null;
  ispNames?: string | null;
  sshHost: string | null;
  sshPort: number;
  sshUser: string | null;
  os: string;
  isActive: boolean;
  hasEdgeToken?: boolean;
  hasSshPassword: boolean;
  hasSshKey: boolean;
  installedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

type CoreBouquet = {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  _count?: { streams: number };
};

type CorePackage = {
  id: string;
  name: string;
  durationDays: number;
  connections: number;
  priceCents: number;
  isActive: boolean;
  bouquetIds?: string[];
  _count?: { lines: number };
  createdAt: string;
};

type CoreLine = {
  id: string;
  username: string;
  status: 'ACTIVE' | 'DISABLED';
  connections: number;
  expiresAt: string;
  packageId: string | null;
  package?: { id: string; name: string } | null;
  createdAt: string;
};

type CoreLineResetPasswordResponse = {
  data: {
    id: string;
    username: string;
    password: string;
  };
};

type CoreVodItem = {
  id: string;
  name: string;
  streamUrl: string;
  posterUrl: string | null;
  isActive: boolean;
  bouquetIds?: string[];
  createdAt: string;
};

type CoreSeries = {
  id: string;
  name: string;
  coverUrl: string | null;
  isActive: boolean;
  bouquetIds?: string[];
  _count?: { episodes: number };
  createdAt: string;
};

type CoreSeriesEpisode = {
  id: string;
  season: number;
  episode: number;
  title: string;
  streamUrl: string;
  isActive: boolean;
  createdAt: string;
};

type CorePlaybackSession = {
  id: string;
  lineId: string;
  contentType: string;
  contentPublicId: number | null;
  serverHost?: string | null;
  contentName?: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  startedAt: string;
  lastSeenAt: string;
  endedAt: string | null;
  status: string;
  bytesSent: string;
  line?: { username: string };
};

type CoreStreamProbeResult = {
  url: string;
  ok: boolean;
  status: number | null;
  ms: number;
  error: string | null;
};

type CoreStreamProbeResponse = {
  data: {
    streamId: string;
    streamName: string;
    totalUrls: number;
    checkedUrls: number;
    truncated: number;
    results: CoreStreamProbeResult[];
  };
};

type CoreBulkApplyServersResponse = {
  ok: true;
  data: {
    mode: 'append' | 'replace' | string;
    serversUsed: number;
    total: number;
    updated: number;
    skipped: number;
    results: Array<{
      streamId: string;
      updated: boolean;
      added: number;
      totalUrls: number;
      error?: string;
    }>;
  };
};

type CoreEdgeJobResponse = {
  ok?: boolean;
  jobId: string;
};

type CoreEdgeJobStatusResponse = {
  jobId: string;
  status: 'processing' | 'completed' | 'failed' | 'canceled' | string;
  logs: string[];
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};

type CoreEdgeServersStatusResponse = {
  data: {
    checkedAt: string;
    total: number;
    results: Array<{
      serverId: string;
      ok: boolean;
      ms: number;
      status: number | null;
      url: string | null;
      error: string | null;
    }>;
  };
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

type CoreTerminateLineSessionsResponse = {
  ok: boolean;
  data: { lineId: string; count: number };
};

type CoreRenewPaymentResponse = {
  data: {
    id: string;
    status: string;
    asaasPaymentId: string | null;
    invoiceUrl: string | null;
    pixQrCode: string | null;
    pixCopyPaste: string | null;
    amountCents: number;
    daysToAdd: number;
    createdAt: string;
    lineId: string;
    packageId: string;
  };
  line: { id: string; username: string };
  package: { id: string; name: string; durationDays: number; priceCents: number; connections: number };
};

type CoreSalePaymentResponse = {
  data: {
    id: string;
    status: string;
    asaasPaymentId: string | null;
    invoiceUrl: string | null;
    pixQrCode: string | null;
    pixCopyPaste: string | null;
    amountCents: number;
    daysToAdd: number;
    createdAt: string;
    packageId: string;
    kind: string;
    newUsername: string | null;
  };
  checkoutToken: string;
  credentials: { username: string; password: string };
  package: { id: string; name: string; durationDays: number; priceCents: number; connections: number };
};

type CorePaymentRow = {
  id: string;
  ownerId?: string;
  lineId: string | null;
  packageId: string;
  daysToAdd: number;
  amountCents: number;
  kind?: string;
  createdLineId?: string | null;
  newUsername?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  dueDate?: string | null;
  remindersEnabled?: boolean;
  reminderCount?: number;
  lastReminderAt?: string | null;
  checkoutToken?: string;
  status: string;
  asaasPaymentId: string | null;
  invoiceUrl: string | null;
  pixQrCode: string | null;
  pixCopyPaste: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt?: string;
  owner?: { username: string; panelSettings?: { publicBaseUrl: string | null } | null };
  line?: { username: string };
  package?: { name: string };
};

type CorePaymentSyncResponse = {
  data: {
    payment: {
      id: string;
      status: string;
      asaasPaymentId: string | null;
      invoiceUrl: string | null;
      dueDate: string | null;
      paidAt: string | null;
      updatedAt: string;
    };
    asaas: {
      id: string;
      status: string | null;
      dueDate: string | null;
      invoiceUrl: string | null;
    };
  };
};

type CorePaymentHistoryItem = {
  id: string;
  kind: 'ACTION' | 'NOTIFICATION' | string;
  label: string;
  details: string | null;
  createdAt: string;
  user?: { username: string };
};

type CorePaymentStats = {
  totals: {
    todayCents: number;
    last7dCents: number;
    last30dCents: number;
    customRangeCents: number | null;
  };
  counts: {
    pending: number;
    overdue: number;
    confirmed: number;
  };
  topPackages: { packageId: string; name: string; totalCents: number; count: number }[];
  updatedAt: string;
};

type CoreEpgSource = {
  id: string;
  name: string;
  xmltvUrl: string;
  cronExpression: string;
  daysAhead: number;
  isActive: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastMessage: string | null;
  createdAt: string;
};

type CoreEpgChannel = {
  id: string;
  channelId: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
};

type CoreEpgAutoMapItem = {
  streamId: string;
  streamName: string;
  previousEpgChannelId: string | null;
  epgChannelId: string;
  epgDisplayName: string;
  score: number;
};

type CoreEpgAutoMapResponse = {
  ok: true;
  dryRun: boolean;
  mode: 'only-empty' | 'overwrite' | string;
  minScore: number;
  totalStreamsConsidered: number;
  totalChannels: number;
  matched: number;
  results: CoreEpgAutoMapItem[];
};

type CoreM3USchedule = {
  id: string;
  name: string;
  m3uUrl: string;
  cronExpression: string;
  type: 'all' | 'live' | 'movie' | 'series' | 'vod' | string;
  mode: 'append' | 'replace' | string;
  createPackage: boolean;
  packageName: string;
  isActive: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastMessage: string | null;
  createdAt: string;
};

type TabKey = 'streams' | 'servers' | 'connections' | 'bouquets' | 'packages' | 'lines' | 'payments' | 'vod' | 'series' | 'schedules' | 'epg';

const parseTabFromSearch = (search: string): TabKey => {
  const raw = new URLSearchParams(search || '').get('tab');
  const t = (raw || '').trim();
  const allowed: TabKey[] = ['streams', 'servers', 'connections', 'bouquets', 'packages', 'lines', 'payments', 'vod', 'series', 'schedules', 'epg'];
  return allowed.includes(t as TabKey) ? (t as TabKey) : 'lines';
};

const toDateInput = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const formatBytes = (bytes: string) => {
  try {
    const b = BigInt(bytes || '0');
    if (b < 1024n) return `${b} B`;
    const kb = b / 1024n;
    if (kb < 1024n) return `${kb} KB`;
    const mb = kb / 1024n;
    if (mb < 1024n) return `${mb} MB`;
    const gb = mb / 1024n;
    return `${gb} GB`;
  } catch {
    return bytes;
  }
};

const formatMbps = (v: number | null | undefined) => {
  if (v === null || v === undefined) return '-';
  if (!Number.isFinite(v)) return '-';
  if (v < 0.01) return '0 Mbps';
  if (v < 10) return `${v.toFixed(2)} Mbps`;
  if (v < 100) return `${v.toFixed(1)} Mbps`;
  return `${Math.round(v)} Mbps`;
};

const formatCurrency = (cents: number) => {
  const value = (cents || 0) / 100;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
};

const formatDuration = (startedAtIso: string) => {
  const startedAt = new Date(startedAtIso);
  const ms = Date.now() - startedAt.getTime();
  const total = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(total / 3600)).padStart(2, '0');
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
};

const formatUptime = (seconds?: number | null) => {
  const total = Math.max(0, Math.floor(seconds || 0));
  const d = Math.floor(total / 86400);
  const hh = String(Math.floor((total % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  return d > 0 ? `${d}d ${hh}:${mm}` : `${hh}:${mm}`;
};

const sumNumbers = (values: Array<number | null | undefined>) => {
  let sum = 0;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (!Number.isFinite(v)) continue;
    sum += v;
  }
  return sum;
};

export function CoreXtreamPage() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const location = useLocation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>(() => parseTabFromSearch(location.search));
  const [importModalOpen, setImportModalOpen] = useState(false);

  const [streamModalOpen, setStreamModalOpen] = useState(false);
  const [probeStreamModalOpen, setProbeStreamModalOpen] = useState(false);
  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [edgeJobModalOpen, setEdgeJobModalOpen] = useState(false);
  const [bouquetModalOpen, setBouquetModalOpen] = useState(false);
  const [packageModalOpen, setPackageModalOpen] = useState(false);
  const [lineModalOpen, setLineModalOpen] = useState(false);
  const [vodModalOpen, setVodModalOpen] = useState(false);
  const [seriesModalOpen, setSeriesModalOpen] = useState(false);
  const [episodeModalOpen, setEpisodeModalOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [sessionsModalOpen, setSessionsModalOpen] = useState(false);
  const [epgModalOpen, setEpgModalOpen] = useState(false);
  const [epgAutoMapModalOpen, setEpgAutoMapModalOpen] = useState(false);
  const [renewModalOpen, setRenewModalOpen] = useState(false);
  const [saleModalOpen, setSaleModalOpen] = useState(false);

  const [editingStream, setEditingStream] = useState<CoreStream | null>(null);
  const [probeStream, setProbeStream] = useState<CoreStream | null>(null);
  const [probeStreamData, setProbeStreamData] = useState<CoreStreamProbeResponse['data'] | null>(null);
  const [editingServer, setEditingServer] = useState<CoreEdgeServer | null>(null);
  const [editingBouquet, setEditingBouquet] = useState<CoreBouquet | null>(null);
  const [editingPackage, setEditingPackage] = useState<CorePackage | null>(null);
  const [editingLine, setEditingLine] = useState<CoreLine | null>(null);
  const [editingVod, setEditingVod] = useState<CoreVodItem | null>(null);
  const [editingSeries, setEditingSeries] = useState<CoreSeries | null>(null);
  const [editingEpisode, setEditingEpisode] = useState<CoreSeriesEpisode | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<CoreM3USchedule | null>(null);
  const [activeSeriesId, setActiveSeriesId] = useState<string>('');
  const [sessionsLine, setSessionsLine] = useState<CoreLine | null>(null);
  const [xcLinksModalOpen, setXcLinksModalOpen] = useState(false);
  const [xcLinksLine, setXcLinksLine] = useState<CoreLine | null>(null);
  const [xcLinksPassword, setXcLinksPassword] = useState<string>('');
  const linePasswordCacheRef = useRef<Map<string, string>>(new Map());
  const [editingEpg, setEditingEpg] = useState<CoreEpgSource | null>(null);
  const [epgAutoMapData, setEpgAutoMapData] = useState<CoreEpgAutoMapResponse | null>(null);
  const [renewLine, setRenewLine] = useState<CoreLine | null>(null);
  const [renewPackageId, setRenewPackageId] = useState<string>('');
  const [renewPayment, setRenewPayment] = useState<CoreRenewPaymentResponse | null>(null);
  const [renewCustomerName, setRenewCustomerName] = useState<string>('');
  const [renewCustomerPhone, setRenewCustomerPhone] = useState<string>('');
  const [salePackageId, setSalePackageId] = useState<string>('');
  const [salePayment, setSalePayment] = useState<CoreSalePaymentResponse | null>(null);
  const [saleCustomerName, setSaleCustomerName] = useState<string>('');
  const [saleCustomerPhone, setSaleCustomerPhone] = useState<string>('');
  const [paymentsStatusFilter, setPaymentsStatusFilter] = useState<string>('');
  const [paymentsKindFilter, setPaymentsKindFilter] = useState<string>('');
  const [paymentsSearch, setPaymentsSearch] = useState<string>('');
  const [paymentsFrom, setPaymentsFrom] = useState<string>('');
  const [paymentsTo, setPaymentsTo] = useState<string>('');
  const [paymentsExporting, setPaymentsExporting] = useState(false);
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<string[]>([]);
  const [paymentsBulkBusy, setPaymentsBulkBusy] = useState(false);
  const [paymentDetailsOpen, setPaymentDetailsOpen] = useState(false);
  const [paymentDetailsRow, setPaymentDetailsRow] = useState<CorePaymentRow | null>(null);
  const [paymentDetailsAsaas, setPaymentDetailsAsaas] = useState<CorePaymentSyncResponse['data']['asaas'] | null>(null);
  const [paymentCustomerName, setPaymentCustomerName] = useState('');
  const [paymentCustomerPhone, setPaymentCustomerPhone] = useState('');

  const [selectedStreamIds, setSelectedStreamIds] = useState<string[]>([]);
  const [bulkApplyServersModalOpen, setBulkApplyServersModalOpen] = useState(false);
  const [bulkApplyServersMode, setBulkApplyServersMode] = useState<'append' | 'replace'>('append');
  const [bulkApplyServersResult, setBulkApplyServersResult] = useState<CoreBulkApplyServersResponse['data'] | null>(null);

  const [edgeJobId, setEdgeJobId] = useState<string | null>(null);
  const [edgeJobStatus, setEdgeJobStatus] = useState<string | null>(null);
  const [edgeJobLogs, setEdgeJobLogs] = useState<string[]>([]);
  const [edgeJobError, setEdgeJobError] = useState<string | null>(null);

  useEffect(() => {
    const next = parseTabFromSearch(location.search);
    setTab((prev) => (prev === next ? prev : next));
  }, [location.search]);

  const setActiveTab = (next: TabKey) => {
    const params = new URLSearchParams(location.search || '');
    params.set('tab', next);
    navigate({ pathname: location.pathname, search: `?${params.toString()}` }, { replace: false });
  };

  const { data: billingInfoData } = useQuery<{ data: { isBlocked: boolean; dueDate?: string | null; totalToPay?: number; activeCustomers?: number } }>({
    queryKey: ['billing-info'],
    queryFn: async () => {
      const res = await api.get('/billing/info');
      return res.data;
    },
    retry: false,
  });

  const isBillingBlocked = !!billingInfoData?.data?.isBlocked;
  const isAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'ADMIN';

  const { data: panelSettingsData } = useQuery<{ data: { panelName: string; logoUrl: string | null; publicBaseUrl?: string | null } }>({
    queryKey: ['panelSettings'],
    queryFn: async () => {
      const res = await api.get('/settings/panel');
      return res.data;
    },
  });

  const publicBaseUrl = (panelSettingsData?.data?.publicBaseUrl || '').replace(/\/$/, '');

  const publicCoreCheckoutUrl = useMemo(() => {
    const username = currentUser?.username;
    if (!username) return '';
    let origin = '';
    try {
      origin = window.location.origin || '';
    } catch {
      origin = '';
    }
    const base = publicBaseUrl || origin;
    return `${base}/core/checkout/${encodeURIComponent(username)}`;
  }, [currentUser?.username, publicBaseUrl]);

  const publicXcDnsBaseUrl = useMemo(() => {
    let origin = '';
    try {
      origin = window.location.origin || '';
    } catch {
      origin = '';
    }
    const base = (publicBaseUrl || origin).replace(/\/$/, '');
    return base || '';
  }, [publicBaseUrl]);

  const saleClientCheckoutUrl = useMemo(() => {
    if (!salePayment?.checkoutToken) return '';
    if (!publicCoreCheckoutUrl) return '';
    return `${publicCoreCheckoutUrl}?t=${encodeURIComponent(salePayment.checkoutToken)}`;
  }, [salePayment?.checkoutToken, publicCoreCheckoutUrl]);

  const balanceHostsStorageKey = useMemo(() => {
    const uid = (currentUser as any)?.userId || currentUser?.username || 'default';
    return `core-balance-hosts:${String(uid)}`;
  }, [currentUser]);

  const [streamForm, setStreamForm] = useState({
    name: '',
    streamUrl: '',
    logoUrl: '',
    epgChannelId: '',
    tvArchive: false,
    tvArchiveDuration: 0,
    isActive: true,
    bouquetIds: [] as string[],
    serverIds: [] as string[],
  });

  const [serverForm, setServerForm] = useState({
    name: '',
    domain: '',
    ip: '',
    vpnIp: '',
    timezoneOffsetSeconds: 0,
    networkInterface: '',
    networkSpeed: 0,
    httpPort: 80,
    httpsPort: 443,
    rtmpPort: 0,
    maxClients: 100000,
    onlyTimeshift: false,
    duplex: false,
    geoipEnabled: false,
    geoipPriority: 'low',
    geoipCountries: '',
    ispEnabled: false,
    ispPriority: 'low',
    ispNames: '',
    edgeToken: '',
    sshHost: '',
    sshPort: 22,
    sshUser: 'root',
    sshPassword: '',
    sshKey: '',
    os: 'ubuntu',
    isActive: true,
  });

  const [balanceHostsRaw, setBalanceHostsRaw] = useState('');

  useEffect(() => {
    try {
      setBalanceHostsRaw(localStorage.getItem(balanceHostsStorageKey) || '');
    } catch {
    }
  }, [balanceHostsStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(balanceHostsStorageKey, balanceHostsRaw);
    } catch {
    }
  }, [balanceHostsStorageKey, balanceHostsRaw]);

  const [bouquetForm, setBouquetForm] = useState({
    name: '',
    isActive: true,
    streamIds: [] as string[],
  });

  const [packageForm, setPackageForm] = useState({
    name: '',
    durationDays: 30,
    connections: 1,
    priceCents: 0,
    isActive: true,
    bouquetIds: [] as string[],
  });

  const [lineForm, setLineForm] = useState({
    username: '',
    password: '',
    expiresAt: '',
    connections: 1,
    status: 'ACTIVE' as 'ACTIVE' | 'DISABLED',
    packageId: '',
  });

  const [vodForm, setVodForm] = useState({
    name: '',
    streamUrl: '',
    posterUrl: '',
    isActive: true,
    bouquetIds: [] as string[],
  });

  const [seriesForm, setSeriesForm] = useState({
    name: '',
    coverUrl: '',
    isActive: true,
    bouquetIds: [] as string[],
  });

  const [episodeForm, setEpisodeForm] = useState({
    season: 1,
    episode: 1,
    title: '',
    streamUrl: '',
    isActive: true,
  });

  const [importForm, setImportForm] = useState({
    url: '',
    mode: 'append' as 'append' | 'replace' | 'update',
    type: 'all' as 'all' | 'live' | 'movie' | 'series' | 'vod',
    createPackage: true,
    packageName: 'PACOTE PADRÃO',
    createLine: false,
    lineUsername: '',
    linePassword: '',
    lineExpiresDays: 30,
    background: true,
    enrichWithTMDB: true,
  });

  const [scheduleForm, setScheduleForm] = useState({
    name: '',
    m3uUrl: '',
    cronExpression: '0 5 * * *',
    type: 'all' as 'all' | 'live' | 'movie' | 'series' | 'vod',
    mode: 'replace' as 'append' | 'replace' | 'update',
    createPackage: true,
    packageName: 'PACOTE PADRÃO',
    isActive: true,
  });

  const [importJobId, setImportJobId] = useState<string>('');

  const [epgForm, setEpgForm] = useState({
    name: '',
    xmltvUrl: '',
    cronExpression: '0 5 * * *',
    daysAhead: 2,
    isActive: true,
  });

  const { data: streamsData, isLoading: streamsLoading } = useQuery<{ data: CoreStream[] }>({
    queryKey: ['core-streams'],
    queryFn: async () => {
      const res = await api.get('/core/streams');
      return res.data;
    },
  });

  const { data: serversData, isLoading: serversLoading } = useQuery<{ data: CoreEdgeServer[] }>({
    queryKey: ['core-servers'],
    queryFn: async () => {
      const res = await api.get('/core/servers');
      return res.data;
    },
  });

  const { data: serversStatusData, isLoading: serversStatusLoading, refetch: serversStatusRefetch } = useQuery<CoreEdgeServersStatusResponse>({
    queryKey: ['core-servers-status'],
    queryFn: async () => {
      const res = await api.get('/core/servers/status');
      return res.data;
    },
    enabled: tab === 'servers',
    refetchInterval: tab === 'servers' ? 10000 : false,
  });

  const { data: serversMetricsData, isLoading: serversMetricsLoading, refetch: serversMetricsRefetch } = useQuery<CoreEdgeServersMetricsResponse>({
    queryKey: ['core-servers-metrics'],
    queryFn: async () => {
      const res = await api.get('/core/servers/metrics');
      return res.data;
    },
    enabled: tab === 'servers',
    refetchInterval: tab === 'servers' ? 10000 : false,
  });

  const { data: bouquetsData, isLoading: bouquetsLoading } = useQuery<{ data: CoreBouquet[] }>({
    queryKey: ['core-bouquets'],
    queryFn: async () => {
      const res = await api.get('/core/bouquets');
      return res.data;
    },
  });

  const { data: packagesData, isLoading: packagesLoading } = useQuery<{ data: CorePackage[] }>({
    queryKey: ['core-packages'],
    queryFn: async () => {
      const res = await api.get('/core/packages');
      return res.data;
    },
  });

  const { data: linesData, isLoading: linesLoading } = useQuery<{ data: CoreLine[] }>({
    queryKey: ['core-lines'],
    queryFn: async () => {
      const res = await api.get('/core/lines');
      return res.data;
    },
  });

  const { data: vodData, isLoading: vodLoading } = useQuery<{ data: CoreVodItem[] }>({
    queryKey: ['core-vod'],
    queryFn: async () => {
      const res = await api.get('/core/vod');
      return res.data;
    },
  });

  const { data: seriesData, isLoading: seriesLoading } = useQuery<{ data: CoreSeries[] }>({
    queryKey: ['core-series'],
    queryFn: async () => {
      const res = await api.get('/core/series');
      return res.data;
    },
  });

  const { data: episodesData, isLoading: episodesLoading } = useQuery<{ data: CoreSeriesEpisode[] }>({
    queryKey: ['core-series-episodes', activeSeriesId],
    queryFn: async () => {
      const res = await api.get(`/core/series/${activeSeriesId}/episodes`);
      return res.data;
    },
    enabled: !!activeSeriesId,
  });

  const { data: schedulesData, isLoading: schedulesLoading } = useQuery<{ data: CoreM3USchedule[] }>({
    queryKey: ['core-m3u-schedules'],
    queryFn: async () => {
      const res = await api.get('/core/schedules');
      return res.data;
    },
  });

  const { data: epgSourcesData, isLoading: epgSourcesLoading } = useQuery<{ data: CoreEpgSource[] }>({
    queryKey: ['core-epg-sources'],
    queryFn: async () => {
      const res = await api.get('/core/epg/sources');
      return res.data;
    },
  });

  const { data: epgChannelsData, isLoading: epgChannelsLoading } = useQuery<{ data: CoreEpgChannel[] }>({
    queryKey: ['core-epg-channels'],
    queryFn: async () => {
      const res = await api.get('/core/epg/channels');
      return res.data;
    },
    enabled: streamModalOpen,
  });

  const { data: playbackSessionsData, isLoading: playbackSessionsLoading } = useQuery<{ data: CorePlaybackSession[] }>({
    queryKey: ['core-playback-sessions', sessionsLine?.id],
    queryFn: async () => {
      const res = await api.get(`/core/playback/sessions?lineId=${encodeURIComponent(sessionsLine!.id)}&activeOnly=true`);
      return res.data;
    },
    enabled: !!sessionsLine && sessionsModalOpen,
    refetchInterval: sessionsModalOpen ? 5000 : false,
  });

  const { data: liveConnectionsData, isLoading: liveConnectionsLoading, refetch: liveConnectionsRefetch } = useQuery<{ data: CorePlaybackSession[] }>({
    queryKey: ['core-live-connections'],
    queryFn: async () => {
      const res = await api.get('/core/playback/sessions?activeOnly=true&contentType=live');
      return res.data;
    },
    enabled: tab === 'connections',
    refetchInterval: tab === 'connections' ? 5000 : false,
  });

  const { data: corePaymentsData, isLoading: corePaymentsLoading } = useQuery<{ data: CorePaymentRow[] }>({
    queryKey: ['core-payments', renewLine?.id],
    queryFn: async () => {
      const res = await api.get(`/core/payments?lineId=${encodeURIComponent(renewLine!.id)}`);
      return res.data;
    },
    enabled: !!renewLine && renewModalOpen,
    refetchInterval: renewModalOpen && renewPayment ? 5000 : false,
  });

  const { data: salePaymentStatusData, isLoading: salePaymentStatusLoading } = useQuery<{ data: CorePaymentRow[] }>({
    queryKey: ['core-sale-payment', salePayment?.data?.id],
    queryFn: async () => {
      const res = await api.get(`/core/payments?id=${encodeURIComponent(salePayment!.data.id)}`);
      return res.data;
    },
    enabled: !!salePayment?.data?.id && saleModalOpen,
    refetchInterval: saleModalOpen && salePayment ? 5000 : false,
  });

  const paymentsTake = 50;
  const { data: paymentStatsData, isLoading: paymentStatsLoading } = useQuery<{ data: CorePaymentStats }>({
    queryKey: ['core-payments-stats', paymentsStatusFilter, paymentsKindFilter, paymentsFrom, paymentsTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (paymentsStatusFilter) params.set('status', paymentsStatusFilter);
      if (paymentsKindFilter) params.set('kind', paymentsKindFilter);
      if (paymentsFrom) params.set('from', paymentsFrom);
      if (paymentsTo) params.set('to', paymentsTo);
      const res = await api.get(`/core/payments/stats?${params.toString()}`);
      return res.data;
    },
    enabled: tab === 'payments',
    refetchInterval: tab === 'payments' ? 10000 : false,
  });

  const { data: paymentHistoryData, isLoading: paymentHistoryLoading } = useQuery<{ data: CorePaymentHistoryItem[] }>({
    queryKey: ['core-payment-history', paymentDetailsRow?.id],
    queryFn: async () => {
      const res = await api.get(`/core/payments/${paymentDetailsRow!.id}/history`);
      return res.data;
    },
    enabled: !!paymentDetailsRow?.id && paymentDetailsOpen,
  });

  const {
    data: paymentsInfiniteData,
    isLoading: paymentsListLoading,
    isFetchingNextPage: paymentsFetchingNextPage,
    hasNextPage: paymentsHasNextPage,
    fetchNextPage: paymentsFetchNextPage,
    refetch: paymentsRefetch,
    isRefetching: paymentsIsRefetching,
  } = useInfiniteQuery({
    queryKey: ['core-payments-list', paymentsStatusFilter, paymentsKindFilter, paymentsSearch, paymentsFrom, paymentsTo],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set('take', String(paymentsTake));
      if (paymentsStatusFilter) params.set('status', paymentsStatusFilter);
      if (paymentsKindFilter) params.set('kind', paymentsKindFilter);
      if (paymentsSearch) params.set('q', paymentsSearch);
      if (paymentsFrom) params.set('from', paymentsFrom);
      if (paymentsTo) params.set('to', paymentsTo);
      if (pageParam) params.set('cursor', pageParam);
      const res = await api.get(`/core/payments?${params.toString()}`);
      return res.data as { data: CorePaymentRow[]; nextCursor: string | null };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    enabled: tab === 'payments',
    refetchInterval: tab === 'payments' && !paymentsFetchingNextPage ? 5000 : false,
  });

  const streams = streamsData?.data || [];
  const servers = serversData?.data || [];
  const bouquets = bouquetsData?.data || [];
  const packages = packagesData?.data || [];
  const lines = linesData?.data || [];
  const vodItems = vodData?.data || [];
  const series = seriesData?.data || [];
  const episodes = episodesData?.data || [];
  const schedules = schedulesData?.data || [];
  const epgSources = epgSourcesData?.data || [];
  const epgChannels = epgChannelsData?.data || [];
  const playbackSessions = playbackSessionsData?.data || [];
  const corePayments = corePaymentsData?.data || [];
  const salePaymentRows = salePaymentStatusData?.data || [];
  const paymentsList = useMemo(() => paymentsInfiniteData?.pages.flatMap((p) => p.data) || [], [paymentsInfiniteData]);

  useEffect(() => {
    if (tab !== 'payments') setSelectedPaymentIds([]);
  }, [tab]);

  useEffect(() => {
    if (tab !== 'streams') setSelectedStreamIds([]);
  }, [tab]);

  useEffect(() => {
    setSelectedPaymentIds([]);
  }, [paymentsStatusFilter, paymentsKindFilter, paymentsSearch, paymentsFrom, paymentsTo]);

  const streamById = useMemo(() => {
    const map: Record<string, CoreStream> = {};
    for (const s of streams) map[s.id] = s;
    return map;
  }, [streams]);

  const bouquetById = useMemo(() => {
    const map: Record<string, CoreBouquet> = {};
    for (const b of bouquets) map[b.id] = b;
    return map;
  }, [bouquets]);

  const packageById = useMemo(() => {
    const map: Record<string, CorePackage> = {};
    for (const p of packages) map[p.id] = p;
    return map;
  }, [packages]);

  const activeServersCount = useMemo(() => {
    return servers.filter((s) => s.isActive && !!((s.domain || '').trim() || (s.ip || '').trim())).length;
  }, [servers]);

  const serverStatusById = useMemo(() => {
    const map: Record<string, CoreEdgeServersStatusResponse['data']['results'][number]> = {};
    for (const r of serversStatusData?.data?.results || []) map[r.serverId] = r;
    return map;
  }, [serversStatusData]);

  const serverMetricsById = useMemo(() => {
    const map: Record<string, CoreEdgeServersMetricsResponse['data']['results'][number]> = {};
    for (const r of serversMetricsData?.data?.results || []) map[r.serverId] = r;
    return map;
  }, [serversMetricsData]);

  const netPrevRef = useRef(new Map<string, { rx: bigint; tx: bigint; at: number }>());
  const [serverNetRates, setServerNetRates] = useState<Record<string, { rxMbps: number | null; txMbps: number | null }>>({});

  const serversInstalled = useMemo(() => {
    return servers.filter((s) => s.isActive && !!(s as any).installedAt);
  }, [servers]);

  const serversOnlineCount = useMemo(() => {
    let n = 0;
    for (const s of serversInstalled) {
      const mt = serverMetricsById[s.id];
      if (mt?.ok) n += 1;
    }
    return n;
  }, [serversInstalled, serverMetricsById]);

  const totalsByServers = useMemo(() => {
    const rx = sumNumbers(serversInstalled.map((s) => serverNetRates[s.id]?.rxMbps));
    const tx = sumNumbers(serversInstalled.map((s) => serverNetRates[s.id]?.txMbps));
    const flowsOn = serversInstalled.reduce((acc, s) => {
      const v = serverMetricsById[s.id]?.metrics?.flowsOn;
      return acc + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    }, 0);
    const flowsOff = serversInstalled.reduce((acc, s) => {
      const v = serverMetricsById[s.id]?.metrics?.flowsOff;
      return acc + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    }, 0);
    return { rx, tx, flowsOn, flowsOff };
  }, [serversInstalled, serverNetRates, serverMetricsById]);

  useEffect(() => {
    const checkedAt = serversMetricsData?.data?.checkedAt;
    if (!checkedAt) return;

    const nextRates: Record<string, { rxMbps: number | null; txMbps: number | null }> = {};
    const now = Date.now();

    for (const r of serversMetricsData?.data?.results || []) {
      if (!r.ok || !r.metrics?.net) continue;
      const rxStr = r.metrics.net.rxBytes;
      const txStr = r.metrics.net.txBytes;
      let rx = 0n;
      let tx = 0n;
      try { rx = BigInt(rxStr); } catch {}
      try { tx = BigInt(txStr); } catch {}

      const prev = netPrevRef.current.get(r.serverId);
      if (prev) {
        const dt = Math.max(0.001, (now - prev.at) / 1000);
        const rxDelta = rx >= prev.rx ? rx - prev.rx : 0n;
        const txDelta = tx >= prev.tx ? tx - prev.tx : 0n;
        const rxMbps = Number(rxDelta) * 8 / 1_000_000 / dt;
        const txMbps = Number(txDelta) * 8 / 1_000_000 / dt;
        nextRates[r.serverId] = {
          rxMbps: Number.isFinite(rxMbps) ? rxMbps : null,
          txMbps: Number.isFinite(txMbps) ? txMbps : null,
        };
      } else {
        nextRates[r.serverId] = { rxMbps: null, txMbps: null };
      }

      netPrevRef.current.set(r.serverId, { rx, tx, at: now });
    }

    setServerNetRates((prev) => ({ ...prev, ...nextRates }));
  }, [serversMetricsData?.data?.checkedAt]);

  useEffect(() => {
    if (!renewModalOpen || !renewLine) return;
    if (!corePayments.length) return;
    const latest = corePayments[0];
    if (latest.status === 'CONFIRMED') {
      toast.success('Pagamento confirmado. Linha renovada!');
      queryClient.invalidateQueries({ queryKey: ['core-lines'] });
      setRenewModalOpen(false);
      setRenewLine(null);
      setRenewPayment(null);
      setRenewPackageId('');
      setRenewCustomerName('');
      setRenewCustomerPhone('');
    }
  }, [corePayments, renewModalOpen, renewLine, queryClient]);

  useEffect(() => {
    if (!saleModalOpen || !salePayment?.data?.id) return;
    if (!salePaymentRows.length) return;
    const row = salePaymentRows[0];
    if (row.status === 'CONFIRMED') {
      toast.success('Pagamento confirmado. Linha criada!');
      queryClient.invalidateQueries({ queryKey: ['core-lines'] });
    }
  }, [salePaymentRows, saleModalOpen, salePayment, queryClient]);

  useEffect(() => {
    if (!edgeJobId) return;
    if (edgeJobStatus === 'completed' || edgeJobStatus === 'failed' || edgeJobStatus === 'canceled') return;

    const checkOnce = async () => {
      try {
        const res = await api.get(`/core/servers/jobs/${edgeJobId}`);
        const job = res.data as CoreEdgeJobStatusResponse;
        setEdgeJobStatus(job.status);
        if (Array.isArray(job.logs)) setEdgeJobLogs(job.logs);
        setEdgeJobError(job.error || null);

        if (job.status === 'completed') {
          toast.success('Job finalizado');
          setEdgeJobId(null);
        } else if (job.status === 'failed') {
          toast.error(job.error || 'Job falhou');
          setEdgeJobId(null);
        } else if (job.status === 'canceled') {
          toast('Job cancelado');
          setEdgeJobId(null);
        }
      } catch (e: any) {
        const status = e?.response?.status;
        if (status === 401 || status === 403 || status === 404) {
          setEdgeJobId(null);
          setEdgeJobStatus(null);
          return;
        }
      }
    };

    checkOnce();
    const interval = setInterval(checkOnce, 1500);
    return () => clearInterval(interval);
  }, [edgeJobId, edgeJobStatus]);

  const createStreamMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: streamForm.name,
        streamUrl: streamForm.streamUrl,
        logoUrl: streamForm.logoUrl ? streamForm.logoUrl : null,
        epgChannelId: streamForm.epgChannelId ? streamForm.epgChannelId : null,
        tvArchive: !!streamForm.tvArchive,
        tvArchiveDuration: streamForm.tvArchive ? Math.max(0, streamForm.tvArchiveDuration || 0) : 0,
        isActive: streamForm.isActive,
        bouquetIds: streamForm.bouquetIds,
        serverIds: streamForm.serverIds,
      };
      const res = await api.post('/core/streams', payload);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Stream criada');
      queryClient.invalidateQueries({ queryKey: ['core-streams'] });
      queryClient.invalidateQueries({ queryKey: ['core-bouquets'] });
      setStreamModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao criar stream');
    },
  });

  const updateStreamMutation = useMutation({
    mutationFn: async () => {
      if (!editingStream) return;
      const payload: any = {
        name: streamForm.name,
        streamUrl: streamForm.streamUrl,
        logoUrl: streamForm.logoUrl ? streamForm.logoUrl : null,
        epgChannelId: streamForm.epgChannelId ? streamForm.epgChannelId : null,
        tvArchive: !!streamForm.tvArchive,
        tvArchiveDuration: streamForm.tvArchive ? Math.max(0, streamForm.tvArchiveDuration || 0) : 0,
        isActive: streamForm.isActive,
        bouquetIds: streamForm.bouquetIds,
        serverIds: streamForm.serverIds,
      };
      const res = await api.put(`/core/streams/${editingStream.id}`, payload);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Stream atualizada');
      queryClient.invalidateQueries({ queryKey: ['core-streams'] });
      queryClient.invalidateQueries({ queryKey: ['core-bouquets'] });
      setStreamModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao atualizar stream');
    },
  });

  const deleteStreamMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/core/streams/${id}`);
    },
    onSuccess: () => {
      toast.success('Stream removida');
      queryClient.invalidateQueries({ queryKey: ['core-streams'] });
      queryClient.invalidateQueries({ queryKey: ['core-bouquets'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao remover stream');
    },
  });

  const probeStreamMutation = useMutation({
    mutationFn: async (streamId: string) => {
      const res = await api.get(`/core/streams/${streamId}/probe`);
      return res.data as CoreStreamProbeResponse;
    },
    onSuccess: (data) => {
      setProbeStreamData(data.data);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao testar URLs');
    },
  });

  const bulkApplyServersMutation = useMutation({
    mutationFn: async (payload: { streamIds: string[]; mode: 'append' | 'replace' }) => {
      const res = await api.post('/core/streams/bulk/apply-servers', payload);
      return res.data as CoreBulkApplyServersResponse;
    },
    onSuccess: (data) => {
      setBulkApplyServersResult(data.data);
      toast.success(`Servidores aplicados: ${data.data.updated} atualizada(s), ${data.data.skipped} ignorada(s).`);
      queryClient.invalidateQueries({ queryKey: ['core-streams'] });
      setSelectedStreamIds([]);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao aplicar servidores');
    },
  });

  const createServerMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        name: serverForm.name,
        domain: serverForm.domain ? serverForm.domain : null,
        ip: serverForm.ip ? serverForm.ip : null,
        vpnIp: serverForm.vpnIp ? serverForm.vpnIp : null,
        timezoneOffsetSeconds: serverForm.timezoneOffsetSeconds,
        networkInterface: serverForm.networkInterface ? serverForm.networkInterface : null,
        networkSpeed: serverForm.networkSpeed,
        httpPort: serverForm.httpPort,
        httpsPort: serverForm.httpsPort,
        rtmpPort: serverForm.rtmpPort,
        maxClients: serverForm.maxClients,
        onlyTimeshift: !!serverForm.onlyTimeshift,
        duplex: !!serverForm.duplex,
        geoipEnabled: !!serverForm.geoipEnabled,
        geoipPriority: serverForm.geoipPriority ? serverForm.geoipPriority : null,
        geoipCountries: serverForm.geoipCountries ? serverForm.geoipCountries : null,
        ispEnabled: !!serverForm.ispEnabled,
        ispPriority: serverForm.ispPriority ? serverForm.ispPriority : null,
        ispNames: serverForm.ispNames ? serverForm.ispNames : null,
        edgeToken: serverForm.edgeToken ? serverForm.edgeToken : null,
        sshHost: serverForm.sshHost ? serverForm.sshHost : null,
        sshPort: serverForm.sshPort,
        sshUser: serverForm.sshUser ? serverForm.sshUser : null,
        sshPassword: serverForm.sshPassword ? serverForm.sshPassword : null,
        sshKey: serverForm.sshKey ? serverForm.sshKey : null,
        os: serverForm.os ? serverForm.os : null,
        isActive: serverForm.isActive,
      };
      const res = await api.post('/core/servers', payload);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Servidor criado');
      queryClient.invalidateQueries({ queryKey: ['core-servers'] });
      setServerModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao criar servidor');
    },
  });

  const updateServerMutation = useMutation({
    mutationFn: async () => {
      if (!editingServer) return;
      const payload: any = {
        name: serverForm.name,
        domain: serverForm.domain ? serverForm.domain : null,
        ip: serverForm.ip ? serverForm.ip : null,
        vpnIp: serverForm.vpnIp ? serverForm.vpnIp : null,
        timezoneOffsetSeconds: serverForm.timezoneOffsetSeconds,
        networkInterface: serverForm.networkInterface ? serverForm.networkInterface : null,
        networkSpeed: serverForm.networkSpeed,
        httpPort: serverForm.httpPort,
        httpsPort: serverForm.httpsPort,
        rtmpPort: serverForm.rtmpPort,
        maxClients: serverForm.maxClients,
        onlyTimeshift: !!serverForm.onlyTimeshift,
        duplex: !!serverForm.duplex,
        geoipEnabled: !!serverForm.geoipEnabled,
        geoipPriority: serverForm.geoipPriority ? serverForm.geoipPriority : null,
        geoipCountries: serverForm.geoipCountries ? serverForm.geoipCountries : null,
        ispEnabled: !!serverForm.ispEnabled,
        ispPriority: serverForm.ispPriority ? serverForm.ispPriority : null,
        ispNames: serverForm.ispNames ? serverForm.ispNames : null,
        ...(serverForm.edgeToken ? { edgeToken: serverForm.edgeToken } : {}),
        sshHost: serverForm.sshHost ? serverForm.sshHost : null,
        sshPort: serverForm.sshPort,
        sshUser: serverForm.sshUser ? serverForm.sshUser : null,
        os: serverForm.os ? serverForm.os : null,
        isActive: serverForm.isActive,
      };
      if (serverForm.sshPassword) payload.sshPassword = serverForm.sshPassword;
      if (serverForm.sshKey) payload.sshKey = serverForm.sshKey;
      const res = await api.put(`/core/servers/${editingServer.id}`, payload);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Servidor atualizado');
      queryClient.invalidateQueries({ queryKey: ['core-servers'] });
      setServerModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao atualizar servidor');
    },
  });

  const deleteServerMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/core/servers/${id}`);
    },
    onSuccess: () => {
      toast.success('Servidor removido');
      queryClient.invalidateQueries({ queryKey: ['core-servers'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao remover servidor');
    },
  });

  const startServerSshTestMutation = useMutation({
    mutationFn: async (serverId: string) => {
      const res = await api.post(`/core/servers/${serverId}/ssh/test`);
      return res.data as CoreEdgeJobResponse;
    },
    onSuccess: (data) => {
      setEdgeJobId(data.jobId);
      setEdgeJobStatus('processing');
      setEdgeJobLogs([`[${new Date().toLocaleTimeString('pt-BR')}] Job iniciado...`]);
      setEdgeJobError(null);
      setEdgeJobModalOpen(true);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao iniciar teste SSH');
    },
  });

  const startServerInstallMutation = useMutation({
    mutationFn: async (serverId: string) => {
      const res = await api.post(`/core/servers/${serverId}/install`);
      return res.data as CoreEdgeJobResponse;
    },
    onSuccess: (data) => {
      setEdgeJobId(data.jobId);
      setEdgeJobStatus('processing');
      setEdgeJobLogs([`[${new Date().toLocaleTimeString('pt-BR')}] Job iniciado...`]);
      setEdgeJobError(null);
      setEdgeJobModalOpen(true);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao iniciar instalação');
    },
  });

  const cancelEdgeJobMutation = useMutation({
    mutationFn: async () => {
      if (!edgeJobId) return null;
      const res = await api.post(`/core/servers/jobs/${edgeJobId}/cancel`);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Cancelado');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao cancelar');
    },
  });

  const createBouquetMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: bouquetForm.name,
        isActive: bouquetForm.isActive,
        streamIds: bouquetForm.streamIds,
      };
      const res = await api.post('/core/bouquets', payload);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Categoria criada');
      queryClient.invalidateQueries({ queryKey: ['core-bouquets'] });
      queryClient.invalidateQueries({ queryKey: ['core-streams'] });
      setBouquetModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao criar categoria');
    },
  });

  const updateBouquetMutation = useMutation({
    mutationFn: async () => {
      if (!editingBouquet) return;
      const payload = {
        name: bouquetForm.name,
        isActive: bouquetForm.isActive,
        streamIds: bouquetForm.streamIds,
      };
      const res = await api.put(`/core/bouquets/${editingBouquet.id}`, payload);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Categoria atualizada');
      queryClient.invalidateQueries({ queryKey: ['core-bouquets'] });
      queryClient.invalidateQueries({ queryKey: ['core-streams'] });
      setBouquetModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao atualizar categoria');
    },
  });

  const deleteBouquetMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/core/bouquets/${id}`);
    },
    onSuccess: () => {
      toast.success('Categoria removida');
      queryClient.invalidateQueries({ queryKey: ['core-bouquets'] });
      queryClient.invalidateQueries({ queryKey: ['core-packages'] });
      queryClient.invalidateQueries({ queryKey: ['core-streams'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao remover categoria');
    },
  });

  const createPackageMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: packageForm.name,
        durationDays: packageForm.durationDays,
        connections: packageForm.connections,
        priceCents: packageForm.priceCents,
        isActive: packageForm.isActive,
        bouquetIds: packageForm.bouquetIds,
      };
      const res = await api.post('/core/packages', payload);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Pacote criado');
      queryClient.invalidateQueries({ queryKey: ['core-packages'] });
      setPackageModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao criar pacote');
    },
  });

  const updatePackageMutation = useMutation({
    mutationFn: async () => {
      if (!editingPackage) return;
      const payload = {
        name: packageForm.name,
        durationDays: packageForm.durationDays,
        connections: packageForm.connections,
        priceCents: packageForm.priceCents,
        isActive: packageForm.isActive,
        bouquetIds: packageForm.bouquetIds,
      };
      const res = await api.put(`/core/packages/${editingPackage.id}`, payload);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Pacote atualizado');
      queryClient.invalidateQueries({ queryKey: ['core-packages'] });
      setPackageModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao atualizar pacote');
    },
  });

  const deletePackageMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/core/packages/${id}`);
    },
    onSuccess: () => {
      toast.success('Pacote removido');
      queryClient.invalidateQueries({ queryKey: ['core-packages'] });
      queryClient.invalidateQueries({ queryKey: ['core-lines'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao remover pacote');
    },
  });

  const createLineMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        username: lineForm.username,
        password: lineForm.password,
        expiresAt: lineForm.expiresAt,
        connections: lineForm.connections,
        status: lineForm.status,
      };
      payload.packageId = lineForm.packageId ? lineForm.packageId : null;
      const res = await api.post('/core/lines', payload);
      return res.data;
    },
    onSuccess: (result: any) => {
      toast.success('Linha criada');
      queryClient.invalidateQueries({ queryKey: ['core-lines'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setLineModalOpen(false);

      const createdLine = (result?.data || null) as CoreLine | null;
      const createdPassword = String(lineForm.password || '');
      if (createdLine?.id && createdPassword) {
        linePasswordCacheRef.current.set(createdLine.id, createdPassword);
      }
      if (createdLine && createdPassword) {
        setXcLinksLine(createdLine);
        setXcLinksPassword(createdPassword);
        setXcLinksModalOpen(true);
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao criar linha');
    },
  });

  const updateLineMutation = useMutation({
    mutationFn: async () => {
      if (!editingLine) return;
      const payload: any = {
        username: lineForm.username,
        expiresAt: lineForm.expiresAt,
        connections: lineForm.connections,
        status: lineForm.status,
      };
      payload.packageId = lineForm.packageId ? lineForm.packageId : null;
      if (lineForm.password) payload.password = lineForm.password;
      const res = await api.put(`/core/lines/${editingLine.id}`, payload);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Linha atualizada');
      queryClient.invalidateQueries({ queryKey: ['core-lines'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setLineModalOpen(false);
      if (editingLine?.id && lineForm.password) {
        linePasswordCacheRef.current.set(editingLine.id, String(lineForm.password));
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao atualizar linha');
    },
  });

  const resetLinePasswordMutation = useMutation({
    mutationFn: async (line: CoreLine) => {
      const res = await api.post<CoreLineResetPasswordResponse>(`/core/lines/${line.id}/reset-password`);
      return { line, data: res.data };
    },
    onSuccess: ({ line, data }) => {
      toast.success('Senha resetada');
      if (line?.id && data?.data?.password) {
        linePasswordCacheRef.current.set(line.id, String(data.data.password));
      }
      setXcLinksLine(line);
      setXcLinksPassword(data.data.password);
      setXcLinksModalOpen(true);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao resetar senha');
    },
  });

  const deleteLineMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/core/lines/${id}`);
    },
    onSuccess: () => {
      toast.success('Linha removida');
      queryClient.invalidateQueries({ queryKey: ['core-lines'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao remover linha');
    },
  });

  const createVodMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        name: vodForm.name,
        streamUrl: vodForm.streamUrl,
        posterUrl: vodForm.posterUrl ? vodForm.posterUrl : null,
        isActive: vodForm.isActive,
        bouquetIds: vodForm.bouquetIds,
      };
      const res = await api.post('/core/vod', payload);
      return res.data;
    },
    onSuccess: () => {
      toast.success('VOD criado');
      queryClient.invalidateQueries({ queryKey: ['core-vod'] });
      setVodModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao criar VOD');
    },
  });

  const updateVodMutation = useMutation({
    mutationFn: async () => {
      if (!editingVod) return;
      const payload: any = {
        name: vodForm.name,
        streamUrl: vodForm.streamUrl,
        posterUrl: vodForm.posterUrl ? vodForm.posterUrl : null,
        isActive: vodForm.isActive,
        bouquetIds: vodForm.bouquetIds,
      };
      const res = await api.put(`/core/vod/${editingVod.id}`, payload);
      return res.data;
    },
    onSuccess: () => {
      toast.success('VOD atualizado');
      queryClient.invalidateQueries({ queryKey: ['core-vod'] });
      setVodModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao atualizar VOD');
    },
  });

  const deleteVodMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/core/vod/${id}`);
    },
    onSuccess: () => {
      toast.success('VOD removido');
      queryClient.invalidateQueries({ queryKey: ['core-vod'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao remover VOD');
    },
  });

  const createSeriesMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        name: seriesForm.name,
        coverUrl: seriesForm.coverUrl ? seriesForm.coverUrl : null,
        isActive: seriesForm.isActive,
        bouquetIds: seriesForm.bouquetIds,
      };
      const res = await api.post('/core/series', payload);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Série criada');
      queryClient.invalidateQueries({ queryKey: ['core-series'] });
      setSeriesModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao criar série');
    },
  });

  const updateSeriesMutation = useMutation({
    mutationFn: async () => {
      if (!editingSeries) return;
      const payload: any = {
        name: seriesForm.name,
        coverUrl: seriesForm.coverUrl ? seriesForm.coverUrl : null,
        isActive: seriesForm.isActive,
        bouquetIds: seriesForm.bouquetIds,
      };
      const res = await api.put(`/core/series/${editingSeries.id}`, payload);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Série atualizada');
      queryClient.invalidateQueries({ queryKey: ['core-series'] });
      setSeriesModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao atualizar série');
    },
  });

  const deleteSeriesMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/core/series/${id}`);
    },
    onSuccess: () => {
      toast.success('Série removida');
      queryClient.invalidateQueries({ queryKey: ['core-series'] });
      queryClient.invalidateQueries({ queryKey: ['core-series-episodes'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao remover série');
    },
  });

  const createEpisodeMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        season: episodeForm.season,
        episode: episodeForm.episode,
        title: episodeForm.title,
        streamUrl: episodeForm.streamUrl,
        isActive: episodeForm.isActive,
      };
      const res = await api.post(`/core/series/${activeSeriesId}/episodes`, payload);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Episódio criado');
      queryClient.invalidateQueries({ queryKey: ['core-series-episodes', activeSeriesId] });
      setEpisodeModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao criar episódio');
    },
  });

  const updateEpisodeMutation = useMutation({
    mutationFn: async () => {
      if (!editingEpisode) return;
      const payload: any = {
        season: episodeForm.season,
        episode: episodeForm.episode,
        title: episodeForm.title,
        streamUrl: episodeForm.streamUrl,
        isActive: episodeForm.isActive,
      };
      const res = await api.put(`/core/series/${activeSeriesId}/episodes/${editingEpisode.id}`, payload);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Episódio atualizado');
      queryClient.invalidateQueries({ queryKey: ['core-series-episodes', activeSeriesId] });
      setEpisodeModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao atualizar episódio');
    },
  });

  const deleteEpisodeMutation = useMutation({
    mutationFn: async (episodeId: string) => {
      await api.delete(`/core/series/${activeSeriesId}/episodes/${episodeId}`);
    },
    onSuccess: () => {
      toast.success('Episódio removido');
      queryClient.invalidateQueries({ queryKey: ['core-series-episodes', activeSeriesId] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao remover episódio');
    },
  });

  const importM3UMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        url: normalizeM3UUrlInput(importForm.url),
        mode: importForm.mode,
        type: importForm.type,
        createPackage: importForm.createPackage,
        packageName: importForm.createPackage ? importForm.packageName : undefined,
        createLine: importForm.createLine,
        lineUsername: importForm.createLine ? importForm.lineUsername : undefined,
        linePassword: importForm.createLine ? importForm.linePassword : undefined,
        lineExpiresDays: importForm.createLine ? importForm.lineExpiresDays : undefined,
        background: importForm.background,
        enrichWithTMDB: importForm.enrichWithTMDB,
      };
      const res = await api.post('/core/import/m3u', payload);
      return res.data;
    },
    onSuccess: (data: any) => {
      if (data?.jobId) {
        toast.success('Importação iniciada em segundo plano');
        setImportModalOpen(false);
        setImportJobId(String(data.jobId));
        return;
      }
      const imported = data?.imported;
      const msg = imported
        ? `Importado: bouquets ${imported.bouquetsCreated}, live ${imported.streamsCreated}, vod ${imported.vodCreated}, séries ${imported.seriesCreated}, eps ${imported.episodesCreated}, skip ${imported.skipped}`
        : 'Importação concluída';
      toast.success(msg);
      if (data?.createdLine?.username && data?.createdLine?.password) {
        toast.success(`Linha criada: ${data.createdLine.username} / ${data.createdLine.password}`);
      }
      queryClient.invalidateQueries({ queryKey: ['core-streams'] });
      queryClient.invalidateQueries({ queryKey: ['core-bouquets'] });
      queryClient.invalidateQueries({ queryKey: ['core-vod'] });
      queryClient.invalidateQueries({ queryKey: ['core-series'] });
      if (activeSeriesId) queryClient.invalidateQueries({ queryKey: ['core-series-episodes', activeSeriesId] });
      setImportModalOpen(false);
    },
    onError: (error: any) => {
      const msg = error.response?.data?.error || 'Erro ao importar M3U';
      const details = Array.isArray(error.response?.data?.details) ? error.response.data.details : null;
      if (details && details.length > 0 && details[0]?.message) {
        toast.error(`${msg}: ${details[0].message}`);
      } else {
        toast.error(msg);
      }
    },
  });

  useEffect(() => {
    if (!importJobId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await api.get(`/core/import/m3u/jobs/${importJobId}`);
        const job = res.data?.data;
        const status = String(job?.status || '');
        if (status === 'success') {
          if (cancelled) return;
          const imported = job?.result?.imported;
          const msg = imported
            ? `Importado: bouquets ${imported.bouquetsCreated}, live ${imported.streamsCreated}, vod ${imported.vodCreated}, séries ${imported.seriesCreated}, eps ${imported.episodesCreated}, skip ${imported.skipped}`
            : 'Importação concluída';
          toast.success(msg);
          if (job?.result?.createdLine?.username && job?.result?.createdLine?.password) {
            toast.success(`Linha criada: ${job.result.createdLine.username} / ${job.result.createdLine.password}`);
          }
          queryClient.invalidateQueries({ queryKey: ['core-streams'] });
          queryClient.invalidateQueries({ queryKey: ['core-bouquets'] });
          queryClient.invalidateQueries({ queryKey: ['core-vod'] });
          queryClient.invalidateQueries({ queryKey: ['core-series'] });
          if (activeSeriesId) queryClient.invalidateQueries({ queryKey: ['core-series-episodes', activeSeriesId] });
          setImportJobId('');
          return;
        }
        if (status === 'error') {
          if (cancelled) return;
          toast.error(job?.error || 'Erro ao importar M3U');
          setImportJobId('');
        }
      } catch (e: any) {
        if (cancelled) return;
      }
    };
    tick();
    const interval = window.setInterval(tick, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [importJobId, activeSeriesId, queryClient]);

  const createScheduleMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: scheduleForm.name,
        m3uUrl: scheduleForm.m3uUrl,
        cronExpression: scheduleForm.cronExpression,
        type: scheduleForm.type,
        mode: scheduleForm.mode,
        createPackage: scheduleForm.createPackage,
        packageName: scheduleForm.packageName,
        isActive: scheduleForm.isActive,
      };
      const res = await api.post('/core/schedules', payload);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Agendamento criado');
      queryClient.invalidateQueries({ queryKey: ['core-m3u-schedules'] });
      setScheduleModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao criar agendamento');
    },
  });

  const updateScheduleMutation = useMutation({
    mutationFn: async () => {
      if (!editingSchedule) return;
      const payload = {
        name: scheduleForm.name,
        m3uUrl: scheduleForm.m3uUrl,
        cronExpression: scheduleForm.cronExpression,
        type: scheduleForm.type,
        mode: scheduleForm.mode,
        createPackage: scheduleForm.createPackage,
        packageName: scheduleForm.packageName,
        isActive: scheduleForm.isActive,
      };
      const res = await api.put(`/core/schedules/${editingSchedule.id}`, payload);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Agendamento atualizado');
      queryClient.invalidateQueries({ queryKey: ['core-m3u-schedules'] });
      setScheduleModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao atualizar agendamento');
    },
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/core/schedules/${id}`);
    },
    onSuccess: () => {
      toast.success('Agendamento removido');
      queryClient.invalidateQueries({ queryKey: ['core-m3u-schedules'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao remover agendamento');
    },
  });

  const runScheduleMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/core/schedules/${id}/run`);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Execução iniciada');
      queryClient.invalidateQueries({ queryKey: ['core-m3u-schedules'] });
      queryClient.invalidateQueries({ queryKey: ['core-streams'] });
      queryClient.invalidateQueries({ queryKey: ['core-bouquets'] });
      queryClient.invalidateQueries({ queryKey: ['core-vod'] });
      queryClient.invalidateQueries({ queryKey: ['core-series'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao executar agendamento');
    },
  });

  const toggleScheduleActiveMutation = useMutation({
    mutationFn: async (params: { id: string; isActive: boolean }) => {
      const res = await api.put(`/core/schedules/${params.id}`, { isActive: params.isActive });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['core-m3u-schedules'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao alterar status');
    },
  });

  const createEpgSourceMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: epgForm.name,
        xmltvUrl: epgForm.xmltvUrl,
        cronExpression: epgForm.cronExpression,
        daysAhead: epgForm.daysAhead,
        isActive: epgForm.isActive,
      };
      const res = await api.post('/core/epg/sources', payload);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Fonte EPG criada');
      queryClient.invalidateQueries({ queryKey: ['core-epg-sources'] });
      setEpgModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao criar fonte EPG');
    },
  });

  const updateEpgSourceMutation = useMutation({
    mutationFn: async () => {
      if (!editingEpg) return;
      const payload = {
        name: epgForm.name,
        xmltvUrl: epgForm.xmltvUrl,
        cronExpression: epgForm.cronExpression,
        daysAhead: epgForm.daysAhead,
        isActive: epgForm.isActive,
      };
      const res = await api.put(`/core/epg/sources/${editingEpg.id}`, payload);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Fonte EPG atualizada');
      queryClient.invalidateQueries({ queryKey: ['core-epg-sources'] });
      setEpgModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao atualizar fonte EPG');
    },
  });

  const deleteEpgSourceMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/core/epg/sources/${id}`);
    },
    onSuccess: () => {
      toast.success('Fonte EPG removida');
      queryClient.invalidateQueries({ queryKey: ['core-epg-sources'] });
      queryClient.invalidateQueries({ queryKey: ['core-epg-channels'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao remover fonte EPG');
    },
  });

  const runEpgSourceMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/core/epg/sources/${id}/run`);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Execução iniciada');
      queryClient.invalidateQueries({ queryKey: ['core-epg-sources'] });
      queryClient.invalidateQueries({ queryKey: ['core-epg-channels'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao executar fonte EPG');
    },
  });

  const toggleEpgSourceActiveMutation = useMutation({
    mutationFn: async (params: { id: string; isActive: boolean }) => {
      const res = await api.put(`/core/epg/sources/${params.id}`, { isActive: params.isActive });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['core-epg-sources'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao alterar status');
    },
  });

  const runEpgAutoMapMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/core/epg/auto-map', { mode: 'only-empty', dryRun: false });
      return res.data as CoreEpgAutoMapResponse;
    },
    onSuccess: (data) => {
      setEpgAutoMapData(data);
      setEpgAutoMapModalOpen(true);
      toast.success(`EPG mapeado em ${data.matched} stream(s)`);
      queryClient.invalidateQueries({ queryKey: ['core-streams'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao auto-mapear EPG');
    },
  });

  const terminatePlaybackSessionMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/core/playback/sessions/${id}/terminate`);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Conexão derrubada');
      queryClient.invalidateQueries({ queryKey: ['core-playback-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['core-playback-sessions', sessionsLine?.id] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao derrubar conexão');
    },
  });

  const terminateLineSessionsMutation = useMutation({
    mutationFn: async (line: CoreLine) => {
      const res = await api.post<CoreTerminateLineSessionsResponse>(`/core/playback/lines/${line.id}/terminate`);
      return res.data;
    },
    onSuccess: (data) => {
      toast.success(`Conexões derrubadas: ${data.data.count}`);
      queryClient.invalidateQueries({ queryKey: ['core-playback-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['core-playback-sessions', sessionsLine?.id] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao derrubar conexões');
    },
  });

  const createRenewPaymentMutation = useMutation({
    mutationFn: async () => {
      if (!renewLine) throw new Error('Linha não selecionada');
      if (!renewPackageId) throw new Error('Pacote não selecionado');
      const res = await api.post('/core/payments/renew', {
        lineId: renewLine.id,
        packageId: renewPackageId,
        customerName: renewCustomerName || undefined,
        customerPhone: renewCustomerPhone || undefined,
      });
      return res.data as CoreRenewPaymentResponse;
    },
    onSuccess: (data) => {
      setRenewPayment(data);
      toast.success('PIX gerado');
      const paymentId = data?.data?.id;
      if (renewCustomerPhone && paymentId) {
        void (async () => {
          try {
            await api.post(`/core/payments/${paymentId}/send-whatsapp`);
            toast.success('WhatsApp enviado');
          } catch (error: any) {
            toast.error(error.response?.data?.error || error.message || 'Erro ao enviar WhatsApp');
          }
        })();
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || error.message || 'Erro ao gerar PIX');
    },
  });

  const sendRenewPaymentWhatsAppMutation = useMutation({
    mutationFn: async () => {
      const id = renewPayment?.data?.id;
      if (!id) throw new Error('Pagamento não encontrado');
      const res = await api.post(`/core/payments/${id}/send-whatsapp`);
      return res.data;
    },
    onSuccess: () => {
      toast.success('WhatsApp enviado');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || error.message || 'Erro ao enviar WhatsApp');
    },
  });

  const createSalePaymentMutation = useMutation({
    mutationFn: async () => {
      if (!salePackageId) throw new Error('Pacote não selecionado');
      const res = await api.post('/core/payments/sell', {
        packageId: salePackageId,
        customerName: saleCustomerName || undefined,
        customerPhone: saleCustomerPhone || undefined,
      });
      return res.data as CoreSalePaymentResponse;
    },
    onSuccess: (data) => {
      setSalePayment(data);
      toast.success('PIX gerado');
      const paymentId = data?.data?.id;
      if (saleCustomerPhone && paymentId) {
        void (async () => {
          try {
            await api.post(`/core/payments/${paymentId}/send-whatsapp`);
            toast.success('WhatsApp enviado');
          } catch (error: any) {
            toast.error(error.response?.data?.error || error.message || 'Erro ao enviar WhatsApp');
          }
        })();
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || error.message || 'Erro ao gerar PIX');
    },
  });

  const sendSalePaymentWhatsAppMutation = useMutation({
    mutationFn: async () => {
      const id = salePayment?.data?.id;
      if (!id) throw new Error('Pagamento não encontrado');
      const res = await api.post(`/core/payments/${id}/send-whatsapp`);
      return res.data;
    },
    onSuccess: () => {
      toast.success('WhatsApp enviado');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || error.message || 'Erro ao enviar WhatsApp');
    },
  });

  const sendPaymentWhatsAppMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/core/payments/${id}/send-whatsapp`);
      return res.data;
    },
    onSuccess: (_data, id) => {
      toast.success('WhatsApp enviado');
      queryClient.invalidateQueries({ queryKey: ['core-payment-history', id] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || error.message || 'Erro ao enviar WhatsApp');
    },
  });

  const sendPaymentConfirmedWhatsAppMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/core/payments/${id}/send-confirmed-whatsapp`);
      return res.data;
    },
    onSuccess: (_data, id) => {
      toast.success('Confirmação enviada');
      queryClient.invalidateQueries({ queryKey: ['core-payment-history', id] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || error.message || 'Erro ao enviar confirmação');
    },
  });

  const cancelPaymentMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/core/payments/${id}/cancel`);
      return res.data as { data: { id: string; status: string; asaasPaymentId: string | null; invoiceUrl: string | null; dueDate: string | null; paidAt: string | null; updatedAt: string } };
    },
    onSuccess: (data) => {
      if (paymentDetailsRow?.id === data.data.id) {
        setPaymentDetailsRow((prev) => (prev ? { ...prev, ...data.data } : prev));
      }
      paymentsRefetch();
      queryClient.invalidateQueries({ queryKey: ['core-payment-history', data.data.id] });
      toast.success('Cobrança cancelada');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || error.message || 'Erro ao cancelar cobrança');
    },
  });

  const recreatePaymentPixMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/core/payments/${id}/recreate-pix`);
      return res.data as { data: CorePaymentRow };
    },
    onSuccess: (data) => {
      toast.success('Novo PIX gerado');
      if (paymentDetailsRow?.id === data.data.id) {
        setPaymentDetailsRow(data.data);
      }
      paymentsRefetch();
      queryClient.invalidateQueries({ queryKey: ['core-payment-history', data.data.id] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || error.message || 'Erro ao gerar novo PIX');
    },
  });

  const recreatePixAndSendWhatsAppMutation = useMutation({
    mutationFn: async (id: string) => {
      const recreated = await api.post(`/core/payments/${id}/recreate-pix`);
      await api.post(`/core/payments/${id}/send-whatsapp`);
      return recreated.data as { data: CorePaymentRow };
    },
    onSuccess: (data) => {
      toast.success('Novo PIX gerado e WhatsApp enviado');
      if (paymentDetailsRow?.id === data.data.id) {
        setPaymentDetailsRow(data.data);
      }
      paymentsRefetch();
      queryClient.invalidateQueries({ queryKey: ['core-payment-history', data.data.id] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || error.message || 'Erro ao gerar novo PIX e enviar WhatsApp');
    },
  });

  const togglePaymentRemindersMutation = useMutation({
    mutationFn: async (params: { id: string; enabled: boolean }) => {
      const res = await api.patch(`/core/payments/${params.id}/reminders`, { enabled: params.enabled });
      return res.data as { data: { id: string; remindersEnabled: boolean; reminderCount: number; lastReminderAt: string | null } };
    },
    onSuccess: (data) => {
      const d = data.data;
      if (paymentDetailsRow?.id === d.id) {
        setPaymentDetailsRow((prev) => (prev ? { ...prev, remindersEnabled: d.remindersEnabled, reminderCount: d.reminderCount, lastReminderAt: d.lastReminderAt } : prev));
      }
      paymentsRefetch();
      queryClient.invalidateQueries({ queryKey: ['core-payment-history', d.id] });
      toast.success(d.remindersEnabled ? 'Lembretes ativados' : 'Lembretes desativados');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || error.message || 'Erro ao alterar lembretes');
    },
  });

  const syncPaymentNowMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/core/payments/${id}/sync`);
      return res.data as CorePaymentSyncResponse;
    },
    onSuccess: (data) => {
      setPaymentDetailsAsaas(data.data.asaas);
      setPaymentDetailsRow((prev) => {
        if (!prev) return prev;
        if (prev.id !== data.data.payment.id) return prev;
        return { ...prev, ...data.data.payment };
      });
      paymentsRefetch();
      queryClient.invalidateQueries({ queryKey: ['core-payment-history', data.data.payment.id] });
      toast.success('Sincronizado com Asaas');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || error.message || 'Erro ao sincronizar com Asaas');
    },
  });

  const updatePaymentCustomerMutation = useMutation({
    mutationFn: async (params: { id: string; customerName: string; customerPhone: string }) => {
      const res = await api.patch(`/core/payments/${params.id}/customer`, {
        customerName: params.customerName,
        customerPhone: params.customerPhone,
      });
      return res.data as { data: { id: string; customerName: string | null; customerPhone: string | null; updatedAt: string } };
    },
    onSuccess: (data) => {
      setPaymentDetailsRow((prev) => (prev && prev.id === data.data.id ? { ...prev, customerName: data.data.customerName, customerPhone: data.data.customerPhone, updatedAt: data.data.updatedAt } : prev));
      setPaymentCustomerName(data.data.customerName || '');
      setPaymentCustomerPhone(data.data.customerPhone || '');
      paymentsRefetch();
      queryClient.invalidateQueries({ queryKey: ['core-payment-history', data.data.id] });
      toast.success('Cliente atualizado');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || error.message || 'Erro ao atualizar cliente');
    },
  });

  const isFinalPaymentStatus = (status: string) => {
    const st = (status || '').toUpperCase();
    return st === 'CANCELLED' || st === 'REFUNDED' || st === 'CHARGEBACK';
  };

  const formatHistoryDetails = (raw: string | null) => {
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const err = (parsed as any).error;
        if (typeof err === 'string' && err.trim()) return `Erro: ${err}`;
        return JSON.stringify(parsed);
      }
    } catch {
    }
    return raw;
  };

  const openCreateSchedule = () => {
    setEditingSchedule(null);
    setScheduleForm({
      name: '',
      m3uUrl: '',
      cronExpression: '0 5 * * *',
      type: 'all',
      mode: 'replace',
      createPackage: true,
      packageName: 'PACOTE PADRÃO',
      isActive: true,
    });
    setScheduleModalOpen(true);
  };

  const openEditSchedule = (s: CoreM3USchedule) => {
    setEditingSchedule(s);
    setScheduleForm({
      name: s.name,
      m3uUrl: s.m3uUrl,
      cronExpression: s.cronExpression,
      type: (s.type as any) || 'all',
      mode: (s.mode as any) || 'replace',
      createPackage: !!s.createPackage,
      packageName: s.packageName || 'PACOTE PADRÃO',
      isActive: !!s.isActive,
    });
    setScheduleModalOpen(true);
  };

  const openCreateEpg = () => {
    setEditingEpg(null);
    setEpgForm({
      name: '',
      xmltvUrl: '',
      cronExpression: '0 5 * * *',
      daysAhead: 2,
      isActive: true,
    });
    setEpgModalOpen(true);
  };

  const openEditEpg = (s: CoreEpgSource) => {
    setEditingEpg(s);
    setEpgForm({
      name: s.name,
      xmltvUrl: s.xmltvUrl,
      cronExpression: s.cronExpression,
      daysAhead: s.daysAhead,
      isActive: s.isActive,
    });
    setEpgModalOpen(true);
  };

  const openCreateStream = () => {
    setEditingStream(null);
    setStreamForm({ name: '', streamUrl: '', logoUrl: '', epgChannelId: '', tvArchive: false, tvArchiveDuration: 0, isActive: true, bouquetIds: [], serverIds: [] });
    setStreamModalOpen(true);
  };

  const openEditStream = (s: CoreStream) => {
    setEditingStream(s);
    setStreamForm({
      name: s.name,
      streamUrl: s.streamUrl,
      logoUrl: s.logoUrl || '',
      epgChannelId: (s as any).epgChannelId || '',
      tvArchive: !!(s as any).tvArchive,
      tvArchiveDuration: (s as any).tvArchiveDuration ?? 0,
      isActive: s.isActive,
      bouquetIds: s.bouquetIds || [],
      serverIds: (s as any).serverIds || [],
    });
    setStreamModalOpen(true);
  };

  const openCreateServer = () => {
    setEditingServer(null);
    setServerForm({
      name: '',
      domain: '',
      ip: '',
      vpnIp: '',
      timezoneOffsetSeconds: 0,
      networkInterface: '',
      networkSpeed: 0,
      httpPort: 80,
      httpsPort: 443,
      rtmpPort: 0,
      maxClients: 100000,
      onlyTimeshift: false,
      duplex: false,
      geoipEnabled: false,
      geoipPriority: 'low',
      geoipCountries: '',
      ispEnabled: false,
      ispPriority: 'low',
      ispNames: '',
      edgeToken: '',
      sshHost: '',
      sshPort: 22,
      sshUser: 'root',
      sshPassword: '',
      sshKey: '',
      os: 'ubuntu',
      isActive: true,
    });
    setServerModalOpen(true);
  };

  const openEditServer = (s: CoreEdgeServer) => {
    setEditingServer(s);
    setServerForm({
      name: s.name,
      domain: s.domain || '',
      ip: s.ip || '',
      vpnIp: (s as any).vpnIp || '',
      timezoneOffsetSeconds: (s as any).timezoneOffsetSeconds ?? 0,
      networkInterface: String((s as any).networkInterface || ''),
      networkSpeed: (s as any).networkSpeed ?? 0,
      httpPort: s.httpPort || 80,
      httpsPort: s.httpsPort || 443,
      rtmpPort: s.rtmpPort || 0,
      maxClients: (s as any).maxClients ?? 100000,
      onlyTimeshift: !!(s as any).onlyTimeshift,
      duplex: !!(s as any).duplex,
      geoipEnabled: !!(s as any).geoipEnabled,
      geoipPriority: String((s as any).geoipPriority || 'low'),
      geoipCountries: String((s as any).geoipCountries || ''),
      ispEnabled: !!(s as any).ispEnabled,
      ispPriority: String((s as any).ispPriority || 'low'),
      ispNames: String((s as any).ispNames || ''),
      edgeToken: '',
      sshHost: s.sshHost || '',
      sshPort: s.sshPort || 22,
      sshUser: s.sshUser || 'root',
      sshPassword: '',
      sshKey: '',
      os: s.os || 'ubuntu',
      isActive: s.isActive,
    });
    setServerModalOpen(true);
  };

  const normalizeStreamUrls = () => {
    const urls = String(streamForm.streamUrl || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    const unique: string[] = [];
    const seen = new Set<string>();
    for (const u of urls) {
      if (seen.has(u)) continue;
      seen.add(u);
      unique.push(u);
    }

    setStreamForm((p) => ({ ...p, streamUrl: unique.join('\n') }));
    toast.success(`URLs normalizadas: ${unique.length}`);
  };

  const fillBalanceHostsFromServers = () => {
    if (!servers.length) {
      toast.error('Nenhum servidor cadastrado');
      return;
    }

    let scheme = 'http';
    const firstUrl = String(streamForm.streamUrl || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0] || '';
    try {
      if (firstUrl) scheme = new URL(firstUrl).protocol.replace(':', '') || 'http';
    } catch {
      scheme = 'http';
    }

    const portKey = scheme === 'https' ? 'httpsPort' : 'httpPort';
    const hosts = servers
      .filter(s => s.isActive)
      .map(s => {
        const host = s.domain || s.ip || '';
        if (!host) return '';
        const port = (s as any)[portKey] || (scheme === 'https' ? 443 : 80);
        return `${host}:${port}`;
      })
      .filter(Boolean);

    if (!hosts.length) {
      toast.error('Nenhum servidor ativo com domínio/IP');
      return;
    }

    setBalanceHostsRaw(hosts.join('\n'));
    toast.success(`Balances preenchidos: ${hosts.length}`);
  };

  const generateBalanceUrlsFromFirst = () => {
    const urls = String(streamForm.streamUrl || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const first = urls[0] || '';
    if (!first) {
      toast.error('Cole pelo menos 1 URL');
      return;
    }

    let base: URL;
    try {
      base = new URL(first);
    } catch {
      toast.error('1ª URL inválida');
      return;
    }

    const hosts = String(balanceHostsRaw || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!hosts.length) {
      toast.error('Preencha os balances (domínio/IP) antes de gerar');
      return;
    }

    const generated: string[] = [];
    for (const h of hosts) {
      try {
        const u = new URL(base.toString());
        if (/^https?:\/\//i.test(h)) {
          const parsed = new URL(h);
          u.protocol = parsed.protocol;
          u.host = parsed.host;
        } else {
          u.host = h;
        }
        generated.push(u.toString());
      } catch {
      }
    }

    const merged = [...urls, ...generated]
      .map((s) => s.trim())
      .filter(Boolean);

    const unique: string[] = [];
    const seen = new Set<string>();
    for (const u of merged) {
      if (seen.has(u)) continue;
      seen.add(u);
      unique.push(u);
    }

    setStreamForm((p) => ({ ...p, streamUrl: unique.join('\n') }));
    toast.success(`Balances gerados: +${Math.max(0, unique.length - urls.length)}`);
  };

  const openProbeStream = (s: CoreStream) => {
    setProbeStream(s);
    setProbeStreamData(null);
    setProbeStreamModalOpen(true);
    probeStreamMutation.mutate(s.id);
  };

  const openCreateBouquet = () => {
    setEditingBouquet(null);
    setBouquetForm({ name: '', isActive: true, streamIds: [] });
    setBouquetModalOpen(true);
  };

  const openEditBouquet = async (b: CoreBouquet) => {
    setEditingBouquet(b);
    const selectedIds = streams.filter(s => (s.bouquetIds || []).includes(b.id)).map(s => s.id);
    setBouquetForm({ name: b.name, isActive: b.isActive, streamIds: selectedIds });
    setBouquetModalOpen(true);
  };

  const openCreatePackage = () => {
    setEditingPackage(null);
    setPackageForm({ name: '', durationDays: 30, connections: 1, priceCents: 0, isActive: true, bouquetIds: [] });
    setPackageModalOpen(true);
  };

  const openEditPackage = (p: CorePackage) => {
    setEditingPackage(p);
    setPackageForm({
      name: p.name,
      durationDays: p.durationDays,
      connections: p.connections,
      priceCents: p.priceCents,
      isActive: p.isActive,
      bouquetIds: p.bouquetIds || [],
    });
    setPackageModalOpen(true);
  };

  const openCreateLine = () => {
    const defaultPackageId = packages.find((p) => p.isActive)?.id || '';
    setEditingLine(null);
    setLineForm({
      username: '',
      password: '',
      expiresAt: '',
      connections: 1,
      status: 'ACTIVE',
      packageId: defaultPackageId,
    });
    setLineModalOpen(true);
  };

  const openSale = () => {
    setSalePackageId(packages.find(p => p.isActive)?.id || '');
    setSalePayment(null);
    setSaleCustomerName('');
    setSaleCustomerPhone('');
    setSaleModalOpen(true);
  };

  const openEditLine = (l: CoreLine) => {
    setEditingLine(l);
    setLineForm({
      username: l.username,
      password: '',
      expiresAt: toDateInput(l.expiresAt),
      connections: l.connections,
      status: l.status,
      packageId: l.packageId || '',
    });
    setLineModalOpen(true);
  };

  const openRenewLine = (l: CoreLine) => {
    setRenewLine(l);
    const fallbackPkg = l.packageId || packages.find(p => p.isActive)?.id || '';
    setRenewPackageId(fallbackPkg);
    setRenewPayment(null);
    setRenewModalOpen(true);
  };

  const openLineSessions = (l: CoreLine) => {
    setSessionsLine(l);
    setSessionsModalOpen(true);
  };

  const openCreateVod = () => {
    setEditingVod(null);
    setVodForm({ name: '', streamUrl: '', posterUrl: '', isActive: true, bouquetIds: [] });
    setVodModalOpen(true);
  };

  const openEditVod = (v: CoreVodItem) => {
    setEditingVod(v);
    setVodForm({
      name: v.name,
      streamUrl: v.streamUrl,
      posterUrl: v.posterUrl || '',
      isActive: v.isActive,
      bouquetIds: v.bouquetIds || [],
    });
    setVodModalOpen(true);
  };

  const openCreateSeries = () => {
    setEditingSeries(null);
    setSeriesForm({ name: '', coverUrl: '', isActive: true, bouquetIds: [] });
    setSeriesModalOpen(true);
  };

  const openEditSeries = (s: CoreSeries) => {
    setEditingSeries(s);
    setSeriesForm({
      name: s.name,
      coverUrl: s.coverUrl || '',
      isActive: s.isActive,
      bouquetIds: s.bouquetIds || [],
    });
    setSeriesModalOpen(true);
  };

  const openEpisodes = (seriesId: string) => {
    setActiveSeriesId(seriesId);
    setEditingEpisode(null);
    setEpisodeForm({ season: 1, episode: 1, title: '', streamUrl: '', isActive: true });
    setEpisodeModalOpen(true);
  };

  const openCreateEpisode = () => {
    setEditingEpisode(null);
    setEpisodeForm({ season: 1, episode: 1, title: '', streamUrl: '', isActive: true });
  };

  const openEditEpisode = (e: CoreSeriesEpisode) => {
    setEditingEpisode(e);
    setEpisodeForm({
      season: e.season,
      episode: e.episode,
      title: e.title,
      streamUrl: e.streamUrl,
      isActive: e.isActive,
    });
  };

  const tabButtonClass = (key: TabKey) =>
    `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
      tab === key
        ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
        : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'
    }`;

  const isBusy =
    streamsLoading ||
    serversLoading ||
    bouquetsLoading ||
    packagesLoading ||
    linesLoading ||
    paymentsListLoading ||
    paymentStatsLoading ||
    vodLoading ||
    seriesLoading ||
    episodesLoading ||
    schedulesLoading ||
    epgSourcesLoading ||
    epgChannelsLoading ||
    playbackSessionsLoading ||
    corePaymentsLoading ||
    salePaymentStatusLoading ||
    createStreamMutation.isPending ||
    updateStreamMutation.isPending ||
    deleteStreamMutation.isPending ||
    createServerMutation.isPending ||
    updateServerMutation.isPending ||
    deleteServerMutation.isPending ||
    createBouquetMutation.isPending ||
    updateBouquetMutation.isPending ||
    deleteBouquetMutation.isPending ||
    createPackageMutation.isPending ||
    updatePackageMutation.isPending ||
    deletePackageMutation.isPending ||
    createLineMutation.isPending ||
    updateLineMutation.isPending ||
    deleteLineMutation.isPending ||
    createVodMutation.isPending ||
    updateVodMutation.isPending ||
    deleteVodMutation.isPending ||
    createSeriesMutation.isPending ||
    updateSeriesMutation.isPending ||
    deleteSeriesMutation.isPending ||
    createEpisodeMutation.isPending ||
    updateEpisodeMutation.isPending ||
    deleteEpisodeMutation.isPending ||
    importM3UMutation.isPending ||
    createScheduleMutation.isPending ||
    updateScheduleMutation.isPending ||
    deleteScheduleMutation.isPending ||
    runScheduleMutation.isPending ||
    toggleScheduleActiveMutation.isPending ||
    createEpgSourceMutation.isPending ||
    updateEpgSourceMutation.isPending ||
    deleteEpgSourceMutation.isPending ||
    runEpgSourceMutation.isPending ||
    toggleEpgSourceActiveMutation.isPending ||
    runEpgAutoMapMutation.isPending ||
    createRenewPaymentMutation.isPending ||
    createSalePaymentMutation.isPending ||
    terminatePlaybackSessionMutation.isPending ||
    startServerSshTestMutation.isPending ||
    startServerInstallMutation.isPending ||
    cancelEdgeJobMutation.isPending;

  return (
    <div className="space-y-6">
      {isBillingBlocked ? (
        <Card className="border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20">
          <div className="flex flex-col gap-1">
            <div className="text-sm font-semibold text-red-700 dark:text-red-300">SUSPENSO POR VENCIMENTO</div>
            <div className="text-sm text-red-700/90 dark:text-red-300/90">
              Acesso somente para visualização. Regularize seu pagamento para continuar operando.
            </div>
          </div>
        </Card>
      ) : null}
      <Card>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">Xtream Novo (Core)</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Streams/VOD/Séries → Categorias → Pacotes → Linhas (XC via /get.php, /player_api.php)
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <button className={tabButtonClass('lines')} onClick={() => setActiveTab('lines')}>Linhas</button>
            <button className={tabButtonClass('connections')} onClick={() => setActiveTab('connections')}>Conexões</button>
            <button className={tabButtonClass('payments')} onClick={() => setActiveTab('payments')}>Pagamentos</button>
            <button className={tabButtonClass('packages')} onClick={() => setActiveTab('packages')}>Pacotes</button>
            <button className={tabButtonClass('bouquets')} onClick={() => setActiveTab('bouquets')}>Categorias</button>
            <button className={tabButtonClass('vod')} onClick={() => setActiveTab('vod')}>VOD</button>
            <button className={tabButtonClass('series')} onClick={() => setActiveTab('series')}>Séries</button>
            <button className={tabButtonClass('streams')} onClick={() => setActiveTab('streams')}>Streams</button>
            <button className={tabButtonClass('servers')} onClick={() => setActiveTab('servers')}>Servidores</button>
            <button className={tabButtonClass('schedules')} onClick={() => setActiveTab('schedules')}>Agendas</button>
            <button className={tabButtonClass('epg')} onClick={() => setActiveTab('epg')}>EPG</button>
            <Button
              variant="outline"
              disabled={isBillingBlocked}
              onClick={() => {
                setImportForm({
                  url: '',
                  mode: 'append',
                  type: 'all',
                  createPackage: true,
                  packageName: 'PACOTE PADRÃO',
                  createLine: false,
                  lineUsername: '',
                  linePassword: '',
                  lineExpiresDays: 30,
                });
                setImportModalOpen(true);
              }}
            >
              Importar M3U
            </Button>
          </div>
        </div>
      </Card>

      {isBusy ? (
        <div className="flex items-center justify-center py-10">
          <Spinner />
        </div>
      ) : null}

      {tab === 'lines' ? (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Linhas</h3>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={openSale} disabled={isBillingBlocked}>Vender Linha</Button>
              <Button onClick={openCreateLine} disabled={isBillingBlocked}>Nova Linha</Button>
            </div>
          </div>
          {publicCoreCheckoutUrl ? (
            <div className="mt-4 flex flex-col md:flex-row gap-2 md:items-end">
              <Input
                label="Link do Checkout Público"
                value={publicCoreCheckoutUrl}
                readOnly
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(publicCoreCheckoutUrl);
                      toast.success('Link copiado!');
                    } catch {
                      toast.error('Erro ao copiar. Copie manualmente.');
                    }
                  }}
                >
                  Copiar link
                </Button>
                <Button variant="outline" onClick={() => window.open(publicCoreCheckoutUrl, '_blank', 'noopener,noreferrer')}>
                  Abrir
                </Button>
              </div>
            </div>
          ) : null}
          {publicXcDnsBaseUrl ? (
            <div className="mt-4 space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Input
                  label="XC Base (DNS)"
                  value={publicXcDnsBaseUrl}
                  readOnly
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <div className="flex items-end gap-2">
                  <Button
                    variant="outline"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(publicXcDnsBaseUrl);
                        toast.success('XC base copiada!');
                      } catch {
                        toast.error('Erro ao copiar. Copie manualmente.');
                      }
                    }}
                  >
                    Copiar
                  </Button>
                  <Button variant="outline" onClick={() => window.open(publicXcDnsBaseUrl, '_blank', 'noopener,noreferrer')}>
                    Abrir
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
                  <div className="text-sm font-medium text-zinc-900 dark:text-white">M3U (TS — modelo)</div>
                  <div className="text-xs text-zinc-600 dark:text-zinc-400">Troque {`{username}`} e {`{password}`} pela linha do cliente.</div>
                  <Input
                    value={`${publicXcDnsBaseUrl}/get.php?username={username}&password={password}&type=m3u_plus&output=ts`}
                    readOnly
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      const v = `${publicXcDnsBaseUrl}/get.php?username={username}&password={password}&type=m3u_plus&output=ts`;
                      try {
                        await navigator.clipboard.writeText(v);
                        toast.success('Modelo copiado!');
                      } catch {
                        toast.error('Erro ao copiar. Copie manualmente.');
                      }
                    }}
                  >
                    Copiar modelo
                  </Button>
                </div>
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
                  <div className="text-sm font-medium text-zinc-900 dark:text-white">M3U (HLS — modelo)</div>
                  <div className="text-xs text-zinc-600 dark:text-zinc-400">Troque {`{username}`} e {`{password}`} pela linha do cliente.</div>
                  <Input
                    value={`${publicXcDnsBaseUrl}/get.php?username={username}&password={password}&type=m3u_plus&output=m3u8`}
                    readOnly
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      const v = `${publicXcDnsBaseUrl}/get.php?username={username}&password={password}&type=m3u_plus&output=m3u8`;
                      try {
                        await navigator.clipboard.writeText(v);
                        toast.success('Modelo copiado!');
                      } catch {
                        toast.error('Erro ao copiar. Copie manualmente.');
                      }
                    }}
                  >
                    Copiar modelo
                  </Button>
                </div>
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
                  <div className="text-sm font-medium text-zinc-900 dark:text-white">XMLTV (modelo)</div>
                  <div className="text-xs text-zinc-600 dark:text-zinc-400">Troque {`{username}`} e {`{password}`} pela linha do cliente.</div>
                  <Input
                    value={`${publicXcDnsBaseUrl}/xmltv.php?username={username}&password={password}`}
                    readOnly
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      const v = `${publicXcDnsBaseUrl}/xmltv.php?username={username}&password={password}`;
                      try {
                        await navigator.clipboard.writeText(v);
                        toast.success('Modelo copiado!');
                      } catch {
                        toast.error('Erro ao copiar. Copie manualmente.');
                      }
                    }}
                  >
                    Copiar modelo
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-600 dark:text-zinc-400">
                  <th className="py-2 pr-4">Usuário</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Conexões</th>
                  <th className="py-2 pr-4">Expira</th>
                  <th className="py-2 pr-4">Pacote</th>
                  <th className="py-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-t border-zinc-200/70 dark:border-zinc-800/70">
                    <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-white">{l.username}</td>
                    <td className="py-3 pr-4">
                      <Badge variant={l.status === 'ACTIVE' ? 'success' : 'warning'}>
                        {l.status === 'ACTIVE' ? 'ATIVA' : 'DESATIVADA'}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{l.connections}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{toDateInput(l.expiresAt)}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                      {l.packageId ? (packageById[l.packageId]?.name || l.package?.name || '-') : '-'}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2 justify-end">
                        <Button variant="outline" size="sm" onClick={() => openRenewLine(l)} disabled={isBillingBlocked}>Renovar</Button>
                        <Button variant="outline" size="sm" onClick={() => openLineSessions(l)}>Conexões</Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!publicXcDnsBaseUrl}
                          onClick={() => {
                            setXcLinksLine(l);
                            setXcLinksPassword(linePasswordCacheRef.current.get(l.id) || '');
                            setXcLinksModalOpen(true);
                          }}
                        >
                          Links XC
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isBillingBlocked || resetLinePasswordMutation.isPending}
                          onClick={() => {
                            if (!confirm('Resetar a senha desta linha?')) return;
                            resetLinePasswordMutation.mutate(l);
                          }}
                        >
                          Resetar senha
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openEditLine(l)} disabled={isBillingBlocked}>Editar</Button>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={isBillingBlocked}
                          onClick={() => {
                            if (!confirm('Remover esta linha?')) return;
                            deleteLineMutation.mutate(l.id);
                          }}
                        >
                          Remover
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-zinc-600 dark:text-zinc-400">
                      Nenhuma linha criada ainda
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {tab === 'connections' ? (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Conexões ao Vivo</h3>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => liveConnectionsRefetch()}>
                Refrescar
              </Button>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-600 dark:text-zinc-400">
                  <th className="py-2 pr-4">Estado</th>
                  <th className="py-2 pr-4">Nome utilizador</th>
                  <th className="py-2 pr-4">Stream</th>
                  <th className="py-2 pr-4">Tipo</th>
                  <th className="py-2 pr-4">Servidor</th>
                  <th className="py-2 pr-4">Agente</th>
                  <th className="py-2 pr-4">Tempo</th>
                  <th className="py-2 pr-4">IP</th>
                </tr>
              </thead>
              <tbody>
                {liveConnectionsLoading ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-zinc-600 dark:text-zinc-400">
                      Carregando...
                    </td>
                  </tr>
                ) : null}
                {(liveConnectionsData?.data || []).map((s) => (
                  <tr key={s.id} className="border-t border-zinc-200/70 dark:border-zinc-800/70">
                    <td className="py-3 pr-4">
                      <Badge variant="success">ON</Badge>
                    </td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{s.line?.username || s.lineId}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{(s as any).contentName || s.contentPublicId || '-'}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{s.contentType}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{(s as any).serverHost || '-'}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300 max-w-[240px]">
                      <div className="truncate">{s.userAgent || '-'}</div>
                    </td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{formatDuration(s.startedAt)}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{s.ipAddress || '-'}</td>
                  </tr>
                ))}
                {!liveConnectionsLoading && (liveConnectionsData?.data || []).length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-zinc-600 dark:text-zinc-400">
                      Nenhuma conexão ao vivo
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {tab === 'payments' ? (
        <Card>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Pagamentos</h3>
            <div className="flex items-center gap-2">
              <div className="text-sm text-zinc-600 dark:text-zinc-400">{paymentsList.length} registro(s)</div>
              {selectedPaymentIds.length ? (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">{selectedPaymentIds.length} selecionado(s)</div>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                disabled={isBillingBlocked || paymentsBulkBusy || selectedPaymentIds.length === 0}
                loading={paymentsBulkBusy}
                onClick={async () => {
                  const selected = paymentsList.filter((p) => selectedPaymentIds.includes(p.id));
                  if (!selected.length) return;
                  let ok = 0;
                  let failed = 0;
                  let skipped = 0;
                  try {
                    setPaymentsBulkBusy(true);
                    for (const p of selected) {
                      if (!p.customerPhone || isFinalPaymentStatus(p.status)) {
                        skipped++;
                        continue;
                      }
                      try {
                        await api.post(`/core/payments/${p.id}/send-whatsapp`);
                        ok++;
                      } catch {
                        failed++;
                      }
                    }
                    toast.success(`Lembretes: ${ok} enviados, ${failed} falharam, ${skipped} ignorados.`);
                    setSelectedPaymentIds([]);
                    paymentsRefetch();
                  } finally {
                    setPaymentsBulkBusy(false);
                  }
                }}
              >
                Lembrete WhatsApp
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={paymentsBulkBusy || selectedPaymentIds.length === 0}
                loading={paymentsBulkBusy}
                onClick={async () => {
                  const selected = paymentsList.filter((p) => selectedPaymentIds.includes(p.id));
                  if (!selected.length) return;
                  let ok = 0;
                  let failed = 0;
                  let skipped = 0;
                  try {
                    setPaymentsBulkBusy(true);
                    for (const p of selected) {
                      if (!p.asaasPaymentId) {
                        skipped++;
                        continue;
                      }
                      try {
                        await api.post(`/core/payments/${p.id}/sync`);
                        ok++;
                      } catch {
                        failed++;
                      }
                    }
                    toast.success(`Sync Asaas: ${ok} ok, ${failed} falharam, ${skipped} ignorados.`);
                    setSelectedPaymentIds([]);
                    paymentsRefetch();
                  } finally {
                    setPaymentsBulkBusy(false);
                  }
                }}
              >
                Sincronizar (Asaas)
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={isBillingBlocked || paymentsBulkBusy || selectedPaymentIds.length === 0}
                loading={paymentsBulkBusy}
                onClick={async () => {
                  const selected = paymentsList.filter((p) => selectedPaymentIds.includes(p.id));
                  if (!selected.length) return;
                  let ok = 0;
                  let failed = 0;
                  let skipped = 0;
                  try {
                    setPaymentsBulkBusy(true);
                    for (const p of selected) {
                      if (!p.customerPhone || p.status === 'CONFIRMED' || isFinalPaymentStatus(p.status)) {
                        skipped++;
                        continue;
                      }
                      try {
                        await api.post(`/core/payments/${p.id}/recreate-pix`);
                        await api.post(`/core/payments/${p.id}/send-whatsapp`);
                        ok++;
                      } catch {
                        failed++;
                      }
                    }
                    toast.success(`Novo PIX: ${ok} enviados, ${failed} falharam, ${skipped} ignorados.`);
                    setSelectedPaymentIds([]);
                    paymentsRefetch();
                  } finally {
                    setPaymentsBulkBusy(false);
                  }
                }}
              >
                Novo PIX + WhatsApp
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={isBillingBlocked || paymentsBulkBusy || selectedPaymentIds.length === 0}
                loading={paymentsBulkBusy}
                onClick={async () => {
                  const selected = paymentsList.filter((p) => selectedPaymentIds.includes(p.id));
                  if (!selected.length) return;
                  let ok = 0;
                  let failed = 0;
                  let skipped = 0;
                  try {
                    setPaymentsBulkBusy(true);
                    for (const p of selected) {
                      const st = (p.status || '').toUpperCase();
                      if (st === 'CONFIRMED' || st === 'RECEIVED' || isFinalPaymentStatus(st)) {
                        skipped++;
                        continue;
                      }
                      try {
                        await api.post(`/core/payments/${p.id}/cancel`);
                        ok++;
                      } catch {
                        failed++;
                      }
                    }
                    toast.success(`Cancelamentos: ${ok} ok, ${failed} falharam, ${skipped} ignorados.`);
                    setSelectedPaymentIds([]);
                    paymentsRefetch();
                  } finally {
                    setPaymentsBulkBusy(false);
                  }
                }}
              >
                Cancelar
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={paymentsBulkBusy || selectedPaymentIds.length === 0}
                onClick={() => setSelectedPaymentIds([])}
              >
                Limpar
              </Button>
              <Button
                variant="outline"
                size="sm"
                loading={paymentsExporting}
                onClick={async () => {
                  try {
                    setPaymentsExporting(true);
                    const params = new URLSearchParams();
                    if (paymentsStatusFilter) params.set('status', paymentsStatusFilter);
                    if (paymentsKindFilter) params.set('kind', paymentsKindFilter);
                    if (paymentsSearch) params.set('q', paymentsSearch);
                    if (paymentsFrom) params.set('from', paymentsFrom);
                    if (paymentsTo) params.set('to', paymentsTo);
                    const res = await api.get(`/core/payments/export?${params.toString()}`, { responseType: 'blob' });
                    const url = window.URL.createObjectURL(new Blob([res.data]));
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `core_pagamentos_${new Date().toISOString().split('T')[0]}.csv`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                    toast.success('CSV exportado');
                  } catch (error: any) {
                    toast.error(error?.response?.data?.error || error?.message || 'Erro ao exportar CSV');
                  } finally {
                    setPaymentsExporting(false);
                  }
                }}
              >
                Exportar CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => paymentsRefetch()} loading={paymentsIsRefetching}>
                Atualizar
              </Button>
            </div>
          </div>

          {paymentStatsData?.data ? (
            <div className="mt-4 grid grid-cols-1 lg:grid-cols-4 gap-3">
              <Card className="p-4">
                <div className="text-xs text-zinc-600 dark:text-zinc-400">Vendas confirmadas (hoje)</div>
                <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-white">
                  {formatCurrency(paymentStatsData.data.totals.todayCents)}
                </div>
              </Card>
              <Card className="p-4">
                <div className="text-xs text-zinc-600 dark:text-zinc-400">Vendas confirmadas (7 dias)</div>
                <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-white">
                  {formatCurrency(paymentStatsData.data.totals.last7dCents)}
                </div>
              </Card>
              <Card className="p-4">
                <div className="text-xs text-zinc-600 dark:text-zinc-400">Vendas confirmadas (30 dias)</div>
                <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-white">
                  {formatCurrency(paymentStatsData.data.totals.last30dCents)}
                </div>
              </Card>
              <Card className="p-4">
                <div className="text-xs text-zinc-600 dark:text-zinc-400">Situação</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="warning">PENDENTE: {paymentStatsData.data.counts.pending}</Badge>
                  <Badge variant="success">CONFIRMADO: {paymentStatsData.data.counts.confirmed}</Badge>
                  <Badge variant="error">VENCIDO: {paymentStatsData.data.counts.overdue}</Badge>
                </div>
              </Card>
              {paymentStatsData.data.totals.customRangeCents !== null ? (
                <Card className="p-4 lg:col-span-2">
                  <div className="text-xs text-zinc-600 dark:text-zinc-400">Confirmado no período selecionado</div>
                  <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-white">
                    {formatCurrency(paymentStatsData.data.totals.customRangeCents)}
                  </div>
                </Card>
              ) : null}
              {paymentStatsData.data.topPackages?.length ? (
                <Card className={`p-4 ${paymentStatsData.data.totals.customRangeCents !== null ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
                  <div className="text-xs text-zinc-600 dark:text-zinc-400">Top pacotes (confirmados)</div>
                  <div className="mt-2 space-y-1">
                    {paymentStatsData.data.topPackages.map((t) => (
                      <div key={t.packageId} className="flex items-center justify-between gap-3 text-sm">
                        <div className="text-zinc-700 dark:text-zinc-300 truncate">{t.name}</div>
                        <div className="text-zinc-900 dark:text-white whitespace-nowrap">
                          {formatCurrency(t.totalCents)} ({t.count})
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-3">
            <Select label="Tipo" value={paymentsKindFilter} onChange={(e) => setPaymentsKindFilter(e.target.value)}>
              <option value="">Todos</option>
              <option value="NEW">Vendas</option>
              <option value="RENEW">Renovações</option>
            </Select>
            <Select label="Status" value={paymentsStatusFilter} onChange={(e) => setPaymentsStatusFilter(e.target.value)}>
              <option value="">Todos</option>
              <option value="PENDING">PENDING</option>
              <option value="CONFIRMED">CONFIRMED</option>
              <option value="RECEIVED">RECEIVED</option>
              <option value="OVERDUE">OVERDUE</option>
              <option value="CANCELLED">CANCELLED</option>
            </Select>
            <Input
              label="Buscar"
              value={paymentsSearch}
              onChange={(e) => setPaymentsSearch(e.target.value)}
              placeholder="linha, pacote, nome, whatsapp, id..."
            />
            <Input label="De" type="date" value={paymentsFrom} onChange={(e) => setPaymentsFrom(e.target.value)} />
            <Input label="Até" type="date" value={paymentsTo} onChange={(e) => setPaymentsTo(e.target.value)} />
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-600 dark:text-zinc-400">
                  <th className="py-2 pr-4">
                    <input
                      type="checkbox"
                      checked={paymentsList.length > 0 && paymentsList.every((p) => selectedPaymentIds.includes(p.id))}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        if (checked) {
                          setSelectedPaymentIds(paymentsList.map((p) => p.id));
                        } else {
                          setSelectedPaymentIds([]);
                        }
                      }}
                    />
                  </th>
                  <th className="py-2 pr-4">Tipo</th>
                  <th className="py-2 pr-4">Linha</th>
                  <th className="py-2 pr-4">Pacote</th>
                  <th className="py-2 pr-4">Valor</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Cliente</th>
                  <th className="py-2 pr-4">Vence</th>
                  <th className="py-2 pr-4">Criado</th>
                  <th className="py-2 pr-4">Pago</th>
                  <th className="py-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {paymentsList.map((p) => {
                  const kind = p.kind || '';
                  const kindLabel = kind === 'NEW' ? 'VENDA' : kind === 'RENEW' ? 'RENOVAÇÃO' : kind || '-';
                  const lineUser = p.line?.username || p.newUsername || '-';
                  const pkgName = p.package?.name || '-';
                  const statusVariant =
                    p.status === 'CONFIRMED' ? 'success' : p.status === 'PENDING' ? 'warning' : p.status === 'OVERDUE' ? 'error' : 'default';
                  const isFinal = isFinalPaymentStatus(p.status);

                  const ownerUsername = p.owner?.username || currentUser?.username || '';
                  let origin = '';
                  try {
                    origin = window.location.origin || '';
                  } catch {
                    origin = '';
                  }
                  const ownerPanelBase = (p.owner?.panelSettings?.publicBaseUrl || '').replace(/\/api\/?$/, '').replace(/\/$/, '');
                  const base = (ownerPanelBase || publicBaseUrl || origin).replace(/\/$/, '');
                  const checkoutBase = ownerUsername ? `${base}/core/checkout/${encodeURIComponent(ownerUsername)}` : '';
                  const checkoutUrl = p.checkoutToken && checkoutBase ? `${checkoutBase}?t=${encodeURIComponent(p.checkoutToken)}` : '';

                  return (
                    <tr key={p.id} className="border-t border-zinc-200/70 dark:border-zinc-800/70">
                      <td className="py-3 pr-4">
                        <input
                          type="checkbox"
                          checked={selectedPaymentIds.includes(p.id)}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setSelectedPaymentIds((prev) => {
                              if (checked) return prev.includes(p.id) ? prev : [...prev, p.id];
                              return prev.filter((id) => id !== p.id);
                            });
                          }}
                        />
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={kind === 'NEW' ? 'success' : kind === 'RENEW' ? 'info' : 'default'}>{kindLabel}</Badge>
                      </td>
                      <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-white">{lineUser}</td>
                      <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{pkgName}</td>
                      <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{formatCurrency(p.amountCents)}</td>
                      <td className="py-3 pr-4">
                        <Badge variant={statusVariant as any}>{p.status}</Badge>
                      </td>
                      <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                        <div className="flex flex-col">
                          <span>{p.customerName || '-'}</span>
                          <span className="text-xs text-zinc-600 dark:text-zinc-400">{p.customerPhone || ''}</span>
                          {p.remindersEnabled === false ? (
                            <span className="text-xs text-zinc-600 dark:text-zinc-400">Lembretes: OFF</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                        {p.dueDate ? new Date(p.dueDate).toLocaleDateString('pt-BR') : '-'}
                      </td>
                      <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                        {p.createdAt ? new Date(p.createdAt).toLocaleString('pt-BR') : '-'}
                      </td>
                      <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                        {p.paidAt ? new Date(p.paidAt).toLocaleString('pt-BR') : '-'}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2 justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setPaymentDetailsRow(p);
                              setPaymentDetailsAsaas(null);
                              setPaymentCustomerName(p.customerName || '');
                              setPaymentCustomerPhone(p.customerPhone || '');
                              setPaymentDetailsOpen(true);
                            }}
                          >
                            Detalhes
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!p.pixCopyPaste || isFinal}
                            onClick={async () => {
                              const text = p.pixCopyPaste || '';
                              try {
                                await navigator.clipboard.writeText(text);
                                toast.success('PIX copiado!');
                              } catch {
                                toast.error('Erro ao copiar. Copie manualmente.');
                              }
                            }}
                          >
                            Copiar PIX
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!p.invoiceUrl}
                            onClick={() => {
                              if (!p.invoiceUrl) return;
                              window.open(p.invoiceUrl, '_blank', 'noopener,noreferrer');
                            }}
                          >
                            Abrir
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!checkoutUrl}
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(checkoutUrl);
                                toast.success('Link copiado!');
                              } catch {
                                toast.error('Erro ao copiar. Copie manualmente.');
                              }
                            }}
                          >
                            Copiar link
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isFinal || isBillingBlocked || !p.customerPhone || sendPaymentWhatsAppMutation.isPending}
                            onClick={() => sendPaymentWhatsAppMutation.mutate(p.id)}
                          >
                            WhatsApp
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={isFinal || isBillingBlocked || p.status === 'CONFIRMED' || p.status === 'RECEIVED' || cancelPaymentMutation.isPending}
                            loading={cancelPaymentMutation.isPending}
                            onClick={() => {
                              if (!confirm('Cancelar esta cobrança?')) return;
                              cancelPaymentMutation.mutate(p.id);
                            }}
                          >
                            Cancelar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {paymentsList.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-10 text-center text-zinc-600 dark:text-zinc-400">
                      Nenhum pagamento encontrado
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-center gap-2">
            <Button
              variant="outline"
              onClick={() => paymentsFetchNextPage()}
              loading={paymentsFetchingNextPage}
              disabled={!paymentsHasNextPage}
            >
              Carregar mais
            </Button>
          </div>
        </Card>
      ) : null}

      <Modal
        isOpen={paymentDetailsOpen}
        onClose={() => {
          setPaymentDetailsOpen(false);
          setPaymentDetailsRow(null);
          setPaymentDetailsAsaas(null);
          setPaymentCustomerName('');
          setPaymentCustomerPhone('');
        }}
        title="Detalhes do Pagamento"
        size="xl"
      >
        {paymentDetailsRow ? (
          (() => {
            const p = paymentDetailsRow;
            const ownerUsername = p.owner?.username || currentUser?.username || '';
            let origin = '';
            try {
              origin = window.location.origin || '';
            } catch {
              origin = '';
            }
            const ownerPanelBase = (p.owner?.panelSettings?.publicBaseUrl || '').replace(/\/api\/?$/, '').replace(/\/$/, '');
            const base = (ownerPanelBase || publicBaseUrl || origin).replace(/\/$/, '');
            const checkoutBase = ownerUsername ? `${base}/core/checkout/${encodeURIComponent(ownerUsername)}` : '';
            const checkoutUrl = p.checkoutToken && checkoutBase ? `${checkoutBase}?t=${encodeURIComponent(p.checkoutToken)}` : '';
            const lineUser = p.line?.username || p.newUsername || '-';
            const pkgName = p.package?.name || '-';
            const kind = p.kind || '';
            const isFinal = isFinalPaymentStatus(p.status);
            const asaasDue = paymentDetailsAsaas?.dueDate || null;
            const asaasDueLabel = asaasDue && /^\d{4}-\d{2}-\d{2}$/.test(asaasDue) ? new Date(`${asaasDue}T00:00:00Z`).toLocaleDateString('pt-BR') : asaasDue ? asaasDue : '-';

            return (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-1">
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">Tipo</div>
                    <div className="text-sm font-medium text-zinc-900 dark:text-white">
                      {kind === 'NEW' ? 'VENDA' : kind === 'RENEW' ? 'RENOVAÇÃO' : kind || '-'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-1">
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">Status</div>
                    <div className="text-sm font-medium text-zinc-900 dark:text-white">{p.status}</div>
                    {isFinal ? (
                      <div className="text-xs text-zinc-600 dark:text-zinc-400">Status final — ações bloqueadas</div>
                    ) : null}
                  </div>
                </div>

                {p.asaasPaymentId ? (
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-zinc-900 dark:text-white">Asaas</div>
                      <Button
                        variant="outline"
                        size="sm"
                        loading={syncPaymentNowMutation.isPending}
                        disabled={!p.asaasPaymentId || syncPaymentNowMutation.isPending}
                        onClick={() => syncPaymentNowMutation.mutate(p.id)}
                      >
                        Sincronizar agora
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                      <div className="text-zinc-700 dark:text-zinc-300">
                        ID: <span className="text-zinc-900 dark:text-white">{p.asaasPaymentId}</span>
                      </div>
                      <div className="text-zinc-700 dark:text-zinc-300">
                        Status (último sync): <span className="text-zinc-900 dark:text-white">{paymentDetailsAsaas?.status || '-'}</span>
                      </div>
                      <div className="text-zinc-700 dark:text-zinc-300">
                        Vencimento (último sync): <span className="text-zinc-900 dark:text-white">{asaasDueLabel}</span>
                      </div>
                      <div className="text-zinc-700 dark:text-zinc-300">
                        Invoice (último sync):{' '}
                        <span className="text-zinc-900 dark:text-white">
                          {paymentDetailsAsaas?.invoiceUrl ? (
                            <button
                              type="button"
                              className="underline"
                              onClick={() => window.open(paymentDetailsAsaas.invoiceUrl || '', '_blank', 'noopener,noreferrer')}
                            >
                              abrir
                            </button>
                          ) : (
                            '-'
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
                  <div className="text-sm font-medium text-zinc-900 dark:text-white">Histórico</div>
                  {paymentHistoryLoading ? (
                    <div className="py-2 text-sm text-zinc-600 dark:text-zinc-400">Carregando...</div>
                  ) : (
                    <div className="space-y-2">
                      {(paymentHistoryData?.data || []).length ? (
                        (paymentHistoryData?.data || []).slice(0, 10).map((h) => (
                          <div key={h.id} className="flex items-start justify-between gap-3 text-sm">
                            <div className="text-zinc-700 dark:text-zinc-300">
                              <div className="flex items-center gap-2">
                                <Badge variant={h.kind === 'NOTIFICATION' ? 'info' : 'default'}>{h.kind === 'NOTIFICATION' ? 'NOTIF' : 'AÇÃO'}</Badge>
                                <span className="font-medium text-zinc-900 dark:text-white">{h.label}</span>
                              </div>
                              {h.user?.username ? <span className="text-zinc-600 dark:text-zinc-400">{` • ${h.user.username}`}</span> : null}
                              {h.details ? <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">{formatHistoryDetails(h.details)}</div> : null}
                            </div>
                            <div className="text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                              {h.createdAt ? new Date(h.createdAt).toLocaleString('pt-BR') : ''}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="py-2 text-sm text-zinc-600 dark:text-zinc-400">Sem eventos ainda</div>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-1">
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">Linha/Usuário</div>
                    <div className="text-sm font-medium text-zinc-900 dark:text-white">{lineUser}</div>
                  </div>
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-1">
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">Pacote</div>
                    <div className="text-sm font-medium text-zinc-900 dark:text-white">{pkgName}</div>
                  </div>
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-1">
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">Valor</div>
                    <div className="text-sm font-medium text-zinc-900 dark:text-white">{formatCurrency(p.amountCents)}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-1">
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">Vencimento</div>
                    <div className="text-sm font-medium text-zinc-900 dark:text-white">
                      {p.dueDate ? new Date(p.dueDate).toLocaleDateString('pt-BR') : '-'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-1">
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">Criado</div>
                    <div className="text-sm font-medium text-zinc-900 dark:text-white">
                      {p.createdAt ? new Date(p.createdAt).toLocaleString('pt-BR') : '-'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-1">
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">Pago</div>
                    <div className="text-sm font-medium text-zinc-900 dark:text-white">
                      {p.paidAt ? new Date(p.paidAt).toLocaleString('pt-BR') : '-'}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-zinc-900 dark:text-white">Cliente</div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isBillingBlocked || updatePaymentCustomerMutation.isPending}
                      loading={updatePaymentCustomerMutation.isPending}
                      onClick={() => updatePaymentCustomerMutation.mutate({ id: p.id, customerName: paymentCustomerName, customerPhone: paymentCustomerPhone })}
                    >
                      Salvar
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <Input
                      label="Nome"
                      value={paymentCustomerName}
                      disabled={isBillingBlocked || updatePaymentCustomerMutation.isPending}
                      onChange={(e) => setPaymentCustomerName(e.target.value)}
                    />
                    <Input
                      label="WhatsApp"
                      value={paymentCustomerPhone}
                      disabled={isBillingBlocked || updatePaymentCustomerMutation.isPending}
                      onChange={(e) => setPaymentCustomerPhone(e.target.value)}
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
                  <div className="text-sm font-medium text-zinc-900 dark:text-white">Lembretes</div>
                  <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 select-none">
                      <input
                        type="checkbox"
                        checked={p.remindersEnabled ?? true}
                        disabled={isBillingBlocked || togglePaymentRemindersMutation.isPending}
                        onChange={(e) => togglePaymentRemindersMutation.mutate({ id: p.id, enabled: e.target.checked })}
                      />
                      <span>Ativar lembretes automáticos</span>
                    </label>
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">
                      {(p.reminderCount ?? 0)}/3
                      {p.lastReminderAt ? ` • último: ${new Date(p.lastReminderAt).toLocaleString('pt-BR')}` : ''}
                    </div>
                  </div>
                </div>

                {checkoutUrl ? (
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
                    <Input
                      label="Link do cliente (acompanhar pagamento)"
                      value={checkoutUrl}
                      readOnly
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(checkoutUrl);
                            toast.success('Link copiado!');
                          } catch {
                            toast.error('Erro ao copiar. Copie manualmente.');
                          }
                        }}
                      >
                        Copiar link
                      </Button>
                      <Button variant="outline" onClick={() => window.open(checkoutUrl, '_blank', 'noopener,noreferrer')}>
                        Abrir
                      </Button>
                    </div>
                  </div>
                ) : null}

                {p.pixQrCode ? (
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-3">
                    <div className="text-sm font-medium text-zinc-900 dark:text-white">QR Code (PIX)</div>
                    <div className="flex justify-center">
                      <img
                        src={`data:image/png;base64,${p.pixQrCode}`}
                        alt="QR Code PIX"
                        className="max-w-xs border-2 border-zinc-200 dark:border-zinc-700 rounded-lg p-2 bg-white"
                      />
                    </div>
                  </div>
                ) : null}

                {p.pixCopyPaste ? (
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
                    <div className="text-sm font-medium text-zinc-900 dark:text-white">PIX copia e cola</div>
                    <textarea
                      readOnly
                      value={p.pixCopyPaste}
                      onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                      className="w-full p-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm font-mono text-zinc-900 dark:text-white resize-none cursor-pointer"
                      rows={4}
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(p.pixCopyPaste || '');
                            toast.success('PIX copiado!');
                          } catch {
                            toast.error('Erro ao copiar. Copie manualmente.');
                          }
                        }}
                      >
                        Copiar PIX
                      </Button>
                      <Button
                        variant="outline"
                        disabled={isFinal || isBillingBlocked || !p.customerPhone || sendPaymentWhatsAppMutation.isPending}
                        onClick={() => sendPaymentWhatsAppMutation.mutate(p.id)}
                      >
                        Enviar WhatsApp
                      </Button>
                      {p.status === 'CONFIRMED' || p.status === 'RECEIVED' ? (
                        <Button
                          variant="outline"
                          disabled={isBillingBlocked || !p.customerPhone || sendPaymentConfirmedWhatsAppMutation.isPending}
                          loading={sendPaymentConfirmedWhatsAppMutation.isPending}
                          onClick={() => sendPaymentConfirmedWhatsAppMutation.mutate(p.id)}
                        >
                          Enviar confirmação
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        disabled={isFinal || isBillingBlocked || !p.customerPhone || p.status === 'CONFIRMED' || recreatePixAndSendWhatsAppMutation.isPending}
                        onClick={() => recreatePixAndSendWhatsAppMutation.mutate(p.id)}
                      >
                        Novo PIX + WhatsApp
                      </Button>
                    </div>
                  </div>
                ) : null}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setPaymentDetailsOpen(false)}>
                    Fechar
                  </Button>
                  <Button
                    variant="outline"
                    disabled={isFinal || isBillingBlocked || p.status === 'CONFIRMED' || recreatePaymentPixMutation.isPending}
                    onClick={() => recreatePaymentPixMutation.mutate(p.id)}
                  >
                    Gerar novo PIX
                  </Button>
                      <Button
                        variant="danger"
                        disabled={isFinal || isBillingBlocked || p.status === 'CONFIRMED' || p.status === 'RECEIVED' || cancelPaymentMutation.isPending}
                        loading={cancelPaymentMutation.isPending}
                        onClick={() => {
                          if (!confirm('Cancelar esta cobrança?')) return;
                          cancelPaymentMutation.mutate(p.id);
                        }}
                      >
                        Cancelar cobrança
                      </Button>
                  <Button
                    variant="outline"
                    disabled={!p.invoiceUrl}
                    onClick={() => {
                      if (!p.invoiceUrl) return;
                      window.open(p.invoiceUrl, '_blank', 'noopener,noreferrer');
                    }}
                  >
                    Abrir invoice
                  </Button>
                </div>
              </div>
            );
          })()
        ) : null}
      </Modal>

      {tab === 'packages' ? (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Pacotes</h3>
            <Button onClick={openCreatePackage} disabled={isBillingBlocked}>Novo Pacote</Button>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-600 dark:text-zinc-400">
                  <th className="py-2 pr-4">Nome</th>
                  <th className="py-2 pr-4">Dias</th>
                  <th className="py-2 pr-4">Conexões</th>
                  <th className="py-2 pr-4">Preço (centavos)</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Categorias</th>
                  <th className="py-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {packages.map((p) => (
                  <tr key={p.id} className="border-t border-zinc-200/70 dark:border-zinc-800/70">
                    <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-white">{p.name}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{p.durationDays}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{p.connections}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{p.priceCents}</td>
                    <td className="py-3 pr-4">
                      <Badge variant={p.isActive ? 'success' : 'warning'}>{p.isActive ? 'ATIVO' : 'INATIVO'}</Badge>
                    </td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                      {(p.bouquetIds || []).map((id) => bouquetById[id]?.name).filter(Boolean).join(', ') || '-'}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2 justify-end">
                        <Button variant="outline" size="sm" onClick={() => openEditPackage(p)} disabled={isBillingBlocked}>Editar</Button>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={isBillingBlocked}
                          onClick={() => {
                            if (!confirm('Remover este pacote?')) return;
                            deletePackageMutation.mutate(p.id);
                          }}
                        >
                          Remover
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {packages.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-zinc-600 dark:text-zinc-400">
                      Nenhum pacote criado ainda
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {tab === 'bouquets' ? (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Categorias</h3>
            <Button onClick={openCreateBouquet} disabled={isBillingBlocked}>Nova Categoria</Button>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-600 dark:text-zinc-400">
                  <th className="py-2 pr-4">Nome</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Streams</th>
                  <th className="py-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {bouquets.map((b) => (
                  <tr key={b.id} className="border-t border-zinc-200/70 dark:border-zinc-800/70">
                    <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-white">{b.name}</td>
                    <td className="py-3 pr-4">
                      <Badge variant={b.isActive ? 'success' : 'warning'}>{b.isActive ? 'ATIVO' : 'INATIVO'}</Badge>
                    </td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{b._count?.streams ?? '-'}</td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2 justify-end">
                        <Button variant="outline" size="sm" onClick={() => openEditBouquet(b)} disabled={isBillingBlocked}>Editar</Button>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={isBillingBlocked}
                          onClick={() => {
                            if (!confirm('Remover esta categoria?')) return;
                            deleteBouquetMutation.mutate(b.id);
                          }}
                        >
                          Remover
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {bouquets.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-zinc-600 dark:text-zinc-400">
                      Nenhum bouquet criado ainda
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {tab === 'vod' ? (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">VOD</h3>
            <Button onClick={openCreateVod} disabled={isBillingBlocked}>Novo VOD</Button>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-600 dark:text-zinc-400">
                  <th className="py-2 pr-4">Nome</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">URL</th>
                  <th className="py-2 pr-4">Categorias</th>
                  <th className="py-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {vodItems.map((v) => (
                  <tr key={v.id} className="border-t border-zinc-200/70 dark:border-zinc-800/70">
                    <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-white">{v.name}</td>
                    <td className="py-3 pr-4">
                      <Badge variant={v.isActive ? 'success' : 'warning'}>{v.isActive ? 'ATIVO' : 'INATIVO'}</Badge>
                    </td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300 truncate max-w-[380px]">{v.streamUrl}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                      {(v.bouquetIds || []).map((id) => bouquetById[id]?.name).filter(Boolean).join(', ') || '-'}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2 justify-end">
                        <Button variant="outline" size="sm" onClick={() => openEditVod(v)} disabled={isBillingBlocked}>Editar</Button>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={isBillingBlocked}
                          onClick={() => {
                            if (!confirm('Remover este VOD?')) return;
                            deleteVodMutation.mutate(v.id);
                          }}
                        >
                          Remover
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {vodItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-zinc-600 dark:text-zinc-400">
                      Nenhum VOD criado ainda
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {tab === 'series' ? (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Séries</h3>
            <Button onClick={openCreateSeries} disabled={isBillingBlocked}>Nova Série</Button>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-600 dark:text-zinc-400">
                  <th className="py-2 pr-4">Nome</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Episódios</th>
                  <th className="py-2 pr-4">Categorias</th>
                  <th className="py-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {series.map((s) => (
                  <tr key={s.id} className="border-t border-zinc-200/70 dark:border-zinc-800/70">
                    <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-white">{s.name}</td>
                    <td className="py-3 pr-4">
                      <Badge variant={s.isActive ? 'success' : 'warning'}>{s.isActive ? 'ATIVO' : 'INATIVO'}</Badge>
                    </td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{s._count?.episodes ?? '-'}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                      {(s.bouquetIds || []).map((id) => bouquetById[id]?.name).filter(Boolean).join(', ') || '-'}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2 justify-end">
                        <Button variant="outline" size="sm" onClick={() => openEpisodes(s.id)}>Episódios</Button>
                        <Button variant="outline" size="sm" onClick={() => openEditSeries(s)} disabled={isBillingBlocked}>Editar</Button>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={isBillingBlocked}
                          onClick={() => {
                            if (!confirm('Remover esta série?')) return;
                            deleteSeriesMutation.mutate(s.id);
                          }}
                        >
                          Remover
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {series.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-zinc-600 dark:text-zinc-400">
                      Nenhuma série criada ainda
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {tab === 'streams' ? (
        <Card>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Streams</h3>
            <div className="flex items-center gap-2">
              <div className="text-sm text-zinc-600 dark:text-zinc-400">{streams.length} registro(s)</div>
              {selectedStreamIds.length ? (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">{selectedStreamIds.length} selecionado(s)</div>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                disabled={isBillingBlocked || selectedStreamIds.length === 0 || activeServersCount === 0}
                onClick={() => {
                  if (activeServersCount === 0) {
                    toast.error('Nenhum servidor ativo cadastrado');
                    return;
                  }
                  if (!selectedStreamIds.length) {
                    toast.error('Selecione pelo menos 1 stream');
                    return;
                  }
                  setBulkApplyServersResult(null);
                  setBulkApplyServersModalOpen(true);
                }}
              >
                Aplicar servidores
              </Button>
              <Button variant="outline" size="sm" disabled={selectedStreamIds.length === 0} onClick={() => setSelectedStreamIds([])}>
                Limpar
              </Button>
              <Button onClick={openCreateStream} disabled={isBillingBlocked}>Nova Stream</Button>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-600 dark:text-zinc-400">
                  <th className="py-2 pr-4">
                    <input
                      type="checkbox"
                      checked={streams.length > 0 && streams.every((s) => selectedStreamIds.includes(s.id))}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        if (checked) setSelectedStreamIds(streams.map((s) => s.id));
                        else setSelectedStreamIds([]);
                      }}
                    />
                  </th>
                  <th className="py-2 pr-4">Nome</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Catchup</th>
                  <th className="py-2 pr-4">URL</th>
                  <th className="py-2 pr-4">Categorias</th>
                  <th className="py-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {streams.map((s) => (
                  <tr key={s.id} className="border-t border-zinc-200/70 dark:border-zinc-800/70">
                    <td className="py-3 pr-4">
                      <input
                        type="checkbox"
                        checked={selectedStreamIds.includes(s.id)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSelectedStreamIds((prev) => {
                            if (checked) return prev.includes(s.id) ? prev : [...prev, s.id];
                            return prev.filter((id) => id !== s.id);
                          });
                        }}
                      />
                    </td>
                    <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-white">{s.name}</td>
                    <td className="py-3 pr-4">
                      <Badge variant={s.isActive ? 'success' : 'warning'}>{s.isActive ? 'ATIVA' : 'INATIVA'}</Badge>
                    </td>
                    <td className="py-3 pr-4">
                      {(s as any).tvArchive ? (
                        <Badge variant="success">SIM ({(s as any).tvArchiveDuration || 0}d)</Badge>
                      ) : (
                        <Badge variant="warning">NÃO</Badge>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300 max-w-[380px]">
                      {(() => {
                        const urls = String(s.streamUrl || '')
                          .split(/\r?\n/)
                          .map((x) => x.trim())
                          .filter(Boolean);
                        const first = urls[0] || '';
                        const extra = Math.max(0, urls.length - 1);
                        return (
                          <div className="flex items-center gap-2">
                            <div className="truncate">{first || '-'}</div>
                            {extra > 0 ? <Badge variant="info">+{extra}</Badge> : null}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                      {(s.bouquetIds || []).map((id) => bouquetById[id]?.name).filter(Boolean).join(', ') || '-'}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2 justify-end">
                        <Button variant="outline" size="sm" onClick={() => openProbeStream(s)} disabled={isBillingBlocked}>Testar URLs</Button>
                        <Button variant="outline" size="sm" onClick={() => openEditStream(s)} disabled={isBillingBlocked}>Editar</Button>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={isBillingBlocked}
                          onClick={() => {
                            if (!confirm('Remover esta stream?')) return;
                            deleteStreamMutation.mutate(s.id);
                          }}
                        >
                          Remover
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {streams.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-zinc-600 dark:text-zinc-400">
                      Nenhuma stream criada ainda
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {tab === 'servers' ? (
        <Card>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Servidores (Balances)</h3>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  serversStatusRefetch();
                  serversMetricsRefetch();
                }}
                disabled={isBillingBlocked || serversStatusLoading || serversMetricsLoading}
              >
                Refrescar
              </Button>
              <Button onClick={openCreateServer} disabled={isBillingBlocked}>Novo Servidor</Button>
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
              <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-white">{serversOnlineCount}/{serversInstalled.length}</div>
              <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">OFF: {totalsByServers.flowsOff}</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {servers.filter((s) => s.isActive && !!(s as any).installedAt).map((s) => {
              const st = serverStatusById[s.id];
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
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">{mt?.ok ? `${mt.ms} ms` : st?.ok ? `${st.ms} ms` : '-'}</span>
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
                    <div className="text-zinc-700 dark:text-zinc-300">Host: <span className="font-medium text-zinc-900 dark:text-white">{s.domain || s.ip || '-'}</span></div>
                  </div>

                  {!mt?.ok && mt?.error ? (
                    <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400 truncate">{mt.error}</div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-600 dark:text-zinc-400">
                  <th className="py-2 pr-4">Nome</th>
                  <th className="py-2 pr-4">Estado</th>
                  <th className="py-2 pr-4">Host</th>
                  <th className="py-2 pr-4">Portas</th>
                  <th className="py-2 pr-4">SSH</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {servers.map((s) => {
                  const host = s.domain || s.ip || '-';
                  const ssh = s.sshHost || s.ip || s.domain || '';
                  const st = serverStatusById[s.id];
                  return (
                    <tr key={s.id} className="border-t border-zinc-200/70 dark:border-zinc-800/70">
                      <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-white">{s.name}</td>
                      <td className="py-3 pr-4">
                        {st ? (
                          <div className="flex items-center gap-2">
                            <Badge variant={st.ok ? 'success' : 'warning'}>{st.ok ? 'ONLINE' : 'OFFLINE'}</Badge>
                            <span className="text-xs text-zinc-600 dark:text-zinc-400">{st.ok ? `${st.ms} ms` : '-'}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-600 dark:text-zinc-400">{serversStatusLoading ? '...' : '-'}</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{host}</td>
                      <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                        HTTP {s.httpPort} / HTTPS {s.httpsPort}{s.rtmpPort ? ` / RTMP ${s.rtmpPort}` : ''}
                      </td>
                      <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                        {ssh ? (
                          <div className="flex items-center gap-2">
                            <span>{ssh}:{s.sshPort}</span>
                            {s.hasSshPassword ? <Badge variant="info">Senha</Badge> : null}
                            {s.hasSshKey ? <Badge variant="info">Key</Badge> : null}
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={s.isActive ? 'success' : 'warning'}>{s.isActive ? 'ATIVO' : 'INATIVO'}</Badge>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2 justify-end">
                          {isAdmin ? (
                            <>
                              <Button variant="outline" size="sm" onClick={() => startServerSshTestMutation.mutate(s.id)} disabled={isBillingBlocked}>
                                Testar SSH
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => startServerInstallMutation.mutate(s.id)} disabled={isBillingBlocked}>
                                Instalar
                              </Button>
                            </>
                          ) : null}
                          <Button variant="outline" size="sm" onClick={() => openEditServer(s)} disabled={isBillingBlocked}>Editar</Button>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={isBillingBlocked}
                            onClick={() => {
                              if (!confirm('Remover este servidor?')) return;
                              deleteServerMutation.mutate(s.id);
                            }}
                          >
                            Remover
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {servers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-zinc-600 dark:text-zinc-400">
                      Nenhum servidor cadastrado ainda
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {tab === 'schedules' ? (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Agendas (Atualização M3U)</h3>
            <Button onClick={openCreateSchedule} disabled={isBillingBlocked}>Nova Agenda</Button>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-600 dark:text-zinc-400">
                  <th className="py-2 pr-4">Nome</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Cron</th>
                  <th className="py-2 pr-4">Tipo</th>
                  <th className="py-2 pr-4">Modo</th>
                  <th className="py-2 pr-4">Última</th>
                  <th className="py-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id} className="border-t border-zinc-200/70 dark:border-zinc-800/70">
                    <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-white">{s.name}</td>
                    <td className="py-3 pr-4">
                      <Badge variant={s.isActive ? 'success' : 'warning'}>{s.isActive ? 'ATIVA' : 'INATIVA'}</Badge>
                    </td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{s.cronExpression}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{String(s.type || 'all')}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{String(s.mode || 'replace')}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                      <div className="flex flex-col">
                        <span>{s.lastRunAt ? new Date(s.lastRunAt).toLocaleString('pt-BR') : '-'}</span>
                        <span className="text-xs text-zinc-600 dark:text-zinc-400">{s.lastStatus || ''}</span>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2 justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isBillingBlocked}
                          onClick={() => toggleScheduleActiveMutation.mutate({ id: s.id, isActive: !s.isActive })}
                        >
                          {s.isActive ? 'Desativar' : 'Ativar'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => runScheduleMutation.mutate(s.id)} disabled={isBillingBlocked}>Rodar agora</Button>
                        <Button variant="outline" size="sm" onClick={() => openEditSchedule(s)} disabled={isBillingBlocked}>Editar</Button>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={isBillingBlocked}
                          onClick={() => {
                            if (!confirm('Remover esta agenda?')) return;
                            deleteScheduleMutation.mutate(s.id);
                          }}
                        >
                          Remover
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {schedules.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-zinc-600 dark:text-zinc-400">
                      Nenhuma agenda criada ainda
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {tab === 'epg' ? (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">EPG (XMLTV)</h3>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => runEpgAutoMapMutation.mutate()} disabled={isBillingBlocked}>
                Auto-mapear Streams
              </Button>
              <Button onClick={openCreateEpg} disabled={isBillingBlocked}>Nova Fonte</Button>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-600 dark:text-zinc-400">
                  <th className="py-2 pr-4">Nome</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Cron</th>
                  <th className="py-2 pr-4">Dias</th>
                  <th className="py-2 pr-4">Última</th>
                  <th className="py-2 pr-4">URL</th>
                  <th className="py-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {epgSources.map((s) => (
                  <tr key={s.id} className="border-t border-zinc-200/70 dark:border-zinc-800/70">
                    <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-white">{s.name}</td>
                    <td className="py-3 pr-4">
                      <Badge variant={s.isActive ? 'success' : 'warning'}>{s.isActive ? 'ATIVA' : 'INATIVA'}</Badge>
                    </td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{s.cronExpression}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{s.daysAhead}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                      <div className="flex flex-col">
                        <span>{s.lastRunAt ? new Date(s.lastRunAt).toLocaleString('pt-BR') : '-'}</span>
                        <span className="text-xs text-zinc-600 dark:text-zinc-400">{s.lastStatus || ''}</span>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300 max-w-xs truncate" title={s.xmltvUrl}>
                      {s.xmltvUrl}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2 justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isBillingBlocked}
                          onClick={() => toggleEpgSourceActiveMutation.mutate({ id: s.id, isActive: !s.isActive })}
                        >
                          {s.isActive ? 'Desativar' : 'Ativar'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => runEpgSourceMutation.mutate(s.id)} disabled={isBillingBlocked}>Rodar agora</Button>
                        <Button variant="outline" size="sm" onClick={() => openEditEpg(s)} disabled={isBillingBlocked}>Editar</Button>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={isBillingBlocked}
                          onClick={() => {
                            if (!confirm('Remover esta fonte EPG?')) return;
                            deleteEpgSourceMutation.mutate(s.id);
                          }}
                        >
                          Remover
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {epgSources.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-zinc-600 dark:text-zinc-400">
                      Nenhuma fonte EPG criada ainda
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Modal
        isOpen={sessionsModalOpen}
        onClose={() => {
          setSessionsModalOpen(false);
          setSessionsLine(null);
        }}
        title={`Conexões ativas${sessionsLine ? ` — ${sessionsLine.username}` : ''}`}
        size="xl"
      >
        <div className="space-y-4">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Mostra as conexões ativas desta linha (atualiza automaticamente). IPs distintos:{' '}
            <span className="font-medium text-zinc-900 dark:text-white">
              {Array.from(new Set(playbackSessions.map((s) => s.ipAddress).filter(Boolean))).length}
            </span>
          </div>
          <div className="flex justify-end">
            <Button
              variant="danger"
              disabled={isBillingBlocked || !sessionsLine || terminateLineSessionsMutation.isPending || playbackSessions.length === 0}
              onClick={() => {
                if (!sessionsLine) return;
                if (!confirm('Derrubar todas as conexões ativas desta linha agora?')) return;
                terminateLineSessionsMutation.mutate(sessionsLine);
              }}
            >
              Derrubar todas
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-600 dark:text-zinc-400">
                  <th className="py-2 pr-4">Tipo</th>
                  <th className="py-2 pr-4">ID</th>
                  <th className="py-2 pr-4">IP</th>
                  <th className="py-2 pr-4">Servidor</th>
                  <th className="py-2 pr-4">Início</th>
                  <th className="py-2 pr-4">Último ping</th>
                  <th className="py-2 pr-4">Tráfego</th>
                  <th className="py-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {playbackSessions.map((s) => (
                  <tr key={s.id} className="border-t border-zinc-200/70 dark:border-zinc-800/70">
                    <td className="py-3 pr-4 text-zinc-900 dark:text-white">{s.contentType}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{s.contentPublicId ?? '-'}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{s.ipAddress || '-'}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{(s as any).serverHost || '-'}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{new Date(s.startedAt).toLocaleString('pt-BR')}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{new Date(s.lastSeenAt).toLocaleString('pt-BR')}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{formatBytes(s.bytesSent)}</td>
                    <td className="py-3 pr-4">
                      <div className="flex justify-end">
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={isBillingBlocked}
                          onClick={() => {
                            if (!confirm('Derrubar esta conexão agora?')) return;
                            terminatePlaybackSessionMutation.mutate(s.id);
                          }}
                        >
                          Derrubar
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {playbackSessions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-zinc-600 dark:text-zinc-400">
                      Nenhuma conexão ativa
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setSessionsModalOpen(false)}>Fechar</Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={xcLinksModalOpen}
        onClose={() => {
          setXcLinksModalOpen(false);
          setXcLinksLine(null);
          setXcLinksPassword('');
        }}
        title={`Links XC${xcLinksLine ? ` — ${xcLinksLine.username}` : ''}`}
        size="lg"
      >
        <div className="space-y-4">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Use estes links para configurar o app do cliente (IPTV). A senha não fica salva aqui.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="XC Base (DNS)" value={publicXcDnsBaseUrl || ''} readOnly onClick={(e) => (e.target as HTMLInputElement).select()} />
            <Input label="Usuário" value={xcLinksLine?.username || ''} readOnly onClick={(e) => (e.target as HTMLInputElement).select()} />
          </div>
          <Input
            label="Senha"
            type="password"
            value={xcLinksPassword}
            onChange={(e) => setXcLinksPassword(e.target.value)}
            placeholder="Digite a senha para gerar os links completos"
          />

          {publicXcDnsBaseUrl && xcLinksLine ? (
            (() => {
              const u = xcLinksLine.username;
              const uVal = u ? encodeURIComponent(u) : '{username}';
              const pVal = xcLinksPassword ? encodeURIComponent(xcLinksPassword) : '{password}';
              const m3uTs = `${publicXcDnsBaseUrl}/get.php?username=${uVal}&password=${pVal}&type=m3u_plus&output=ts`;
              const m3uHls = `${publicXcDnsBaseUrl}/get.php?username=${uVal}&password=${pVal}&type=m3u_plus&output=m3u8`;
              const xmltv = `${publicXcDnsBaseUrl}/xmltv.php?username=${uVal}&password=${pVal}`;
              const playerApi = `${publicXcDnsBaseUrl}/player_api.php?username=${uVal}&password=${pVal}`;
              const items = [
                { label: 'M3U (TS)', value: m3uTs },
                { label: 'M3U (HLS)', value: m3uHls },
                { label: 'XMLTV', value: xmltv },
                { label: 'XC API', value: playerApi },
              ];

              return (
                <div className="space-y-3">
                  {items.map((it) => (
                    <div key={it.label} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium text-zinc-900 dark:text-white">{it.label}</div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(it.value);
                                toast.success('Copiado!');
                              } catch {
                                toast.error('Erro ao copiar. Copie manualmente.');
                              }
                            }}
                          >
                            Copiar
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => window.open(it.value, '_blank', 'noopener,noreferrer')}>
                            Abrir
                          </Button>
                        </div>
                      </div>
                      <Input value={it.value} readOnly onClick={(e) => (e.target as HTMLInputElement).select()} />
                    </div>
                  ))}
                </div>
              );
            })()
          ) : (
            <div className="text-sm text-zinc-600 dark:text-zinc-400">XC base indisponível.</div>
          )}

          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setXcLinksModalOpen(false)}>Fechar</Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={renewModalOpen}
        onClose={() => {
          setRenewModalOpen(false);
          setRenewLine(null);
          setRenewPayment(null);
          setRenewPackageId('');
          setRenewCustomerName('');
          setRenewCustomerPhone('');
        }}
        title={`Renovar Linha${renewLine ? ` — ${renewLine.username}` : ''}`}
        size="xl"
      >
        <div className="space-y-4">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Gera um PIX pelo Asaas. Após o pagamento confirmado, a linha renova automaticamente.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="Nome do cliente (opcional)"
              value={renewCustomerName}
              onChange={(e) => setRenewCustomerName(e.target.value)}
            />
            <Input
              label="WhatsApp do cliente (opcional)"
              value={renewCustomerPhone}
              onChange={(e) => setRenewCustomerPhone(e.target.value)}
              placeholder="Ex: 11999999999"
            />
          </div>
          <Select
            label="Pacote"
            value={renewPackageId}
            onChange={(e) => setRenewPackageId(e.target.value)}
          >
            <option value="">Selecione</option>
            {packages
              .filter((p) => p.isActive)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.durationDays} dias — {formatCurrency(p.priceCents)}
                </option>
              ))}
          </Select>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRenewModalOpen(false)}>
              Fechar
            </Button>
            <Button
              disabled={isBillingBlocked}
              onClick={() => {
                if (!renewLine) {
                  toast.error('Selecione uma linha');
                  return;
                }
                if (!renewPackageId) {
                  toast.error('Selecione um pacote');
                  return;
                }
                createRenewPaymentMutation.mutate();
              }}
            >
              Gerar PIX
            </Button>
          </div>

          {renewPayment?.data?.pixQrCode ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Status</div>
                  {corePaymentsLoading ? (
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">Atualizando...</div>
                  ) : corePayments[0]?.status ? (
                    <Badge variant={corePayments[0].status === 'CONFIRMED' ? 'success' : 'warning'}>
                      {corePayments[0].status}
                    </Badge>
                  ) : (
                    <Badge variant="warning">PENDING</Badge>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-sm text-zinc-700 dark:text-zinc-300">
                  Valor: <span className="font-medium">{formatCurrency(renewPayment.data.amountCents)}</span>
                </div>
                <div className="text-sm text-zinc-700 dark:text-zinc-300">
                  Dias: <span className="font-medium">{renewPayment.data.daysToAdd}</span>
                </div>
              </div>
              <div className="flex justify-center">
                <img
                  src={`data:image/png;base64,${renewPayment.data.pixQrCode}`}
                  alt="QR Code PIX"
                  className="max-w-xs border-2 border-zinc-200 dark:border-zinc-700 rounded-lg p-2 bg-white"
                />
              </div>
              {renewPayment.data.pixCopyPaste ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Código PIX (copia e cola)</div>
                  <textarea
                    readOnly
                    value={renewPayment.data.pixCopyPaste}
                    onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                    className="w-full p-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm font-mono text-zinc-900 dark:text-white resize-none cursor-pointer"
                    rows={4}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={async () => {
                        const text = renewPayment.data.pixCopyPaste || '';
                        try {
                          await navigator.clipboard.writeText(text);
                          toast.success('Código PIX copiado!');
                        } catch {
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
                            toast.success('Código PIX copiado!');
                          } catch {
                            toast.error('Erro ao copiar. Copie manualmente.');
                          }
                        }
                      }}
                    >
                      Copiar código PIX
                    </Button>
                    <Button
                      variant="outline"
                      disabled={isBillingBlocked || !renewCustomerPhone || sendRenewPaymentWhatsAppMutation.isPending}
                      onClick={() => sendRenewPaymentWhatsAppMutation.mutate()}
                    >
                      Enviar WhatsApp
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        isOpen={saleModalOpen}
        onClose={() => {
          setSaleModalOpen(false);
          setSalePackageId('');
          setSalePayment(null);
        }}
        title="Vender Linha (PIX)"
        size="xl"
      >
        <div className="space-y-4">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Gera um PIX para venda. Após pagamento confirmado, a linha é criada automaticamente.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="Nome do cliente (opcional)"
              value={saleCustomerName}
              onChange={(e) => setSaleCustomerName(e.target.value)}
            />
            <Input
              label="WhatsApp do cliente (opcional)"
              value={saleCustomerPhone}
              onChange={(e) => setSaleCustomerPhone(e.target.value)}
              placeholder="Ex: 11999999999"
            />
          </div>
          <Select label="Pacote" value={salePackageId} onChange={(e) => setSalePackageId(e.target.value)}>
            <option value="">Selecione</option>
            {packages
              .filter((p) => p.isActive)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.durationDays} dias — {formatCurrency(p.priceCents)}
                </option>
              ))}
          </Select>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSaleModalOpen(false)}>
              Fechar
            </Button>
            <Button
              disabled={isBillingBlocked}
              onClick={() => {
                if (!salePackageId) {
                  toast.error('Selecione um pacote');
                  return;
                }
                createSalePaymentMutation.mutate();
              }}
            >
              Gerar PIX
            </Button>
          </div>

          {salePayment?.data?.pixQrCode ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Status</div>
                  {salePaymentStatusLoading ? (
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">Atualizando...</div>
                  ) : salePaymentRows[0]?.status ? (
                    <Badge variant={salePaymentRows[0].status === 'CONFIRMED' ? 'success' : 'warning'}>
                      {salePaymentRows[0].status}
                    </Badge>
                  ) : (
                    <Badge variant="warning">PENDING</Badge>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-sm text-zinc-700 dark:text-zinc-300">
                  Valor: <span className="font-medium">{formatCurrency(salePayment.data.amountCents)}</span>
                </div>
                <div className="text-sm text-zinc-700 dark:text-zinc-300">
                  Dias: <span className="font-medium">{salePayment.data.daysToAdd}</span>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
                <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Credenciais (serão ativadas após pagamento)</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                  <div className="text-zinc-700 dark:text-zinc-300">
                    Usuário: <span className="font-mono text-zinc-900 dark:text-white">{salePayment.credentials.username}</span>
                  </div>
                  <div className="text-zinc-700 dark:text-zinc-300">
                    Senha: <span className="font-mono text-zinc-900 dark:text-white">{salePayment.credentials.password}</span>
                  </div>
                </div>
              </div>
              {publicXcDnsBaseUrl ? (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-3">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Links Xtream (XC)</div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setXcLinksLine({ id: '', username: salePayment.credentials.username, status: 'ACTIVE', connections: 1, expiresAt: new Date().toISOString(), packageId: null } as any);
                        setXcLinksPassword(salePayment.credentials.password);
                        setXcLinksModalOpen(true);
                      }}
                    >
                      Abrir no modal
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <div className="text-xs text-zinc-600 dark:text-zinc-400">M3U</div>
                      <Input
                        value={`${publicXcDnsBaseUrl}/get.php?username=${encodeURIComponent(
                          salePayment.credentials.username
                        )}&password=${encodeURIComponent(salePayment.credentials.password)}&type=m3u_plus&output=ts`}
                        readOnly
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          const v = `${publicXcDnsBaseUrl}/get.php?username=${encodeURIComponent(
                            salePayment.credentials.username
                          )}&password=${encodeURIComponent(salePayment.credentials.password)}&type=m3u_plus&output=ts`;
                          try {
                            await navigator.clipboard.writeText(v);
                            toast.success('M3U copiado!');
                          } catch {
                            toast.error('Erro ao copiar. Copie manualmente.');
                          }
                        }}
                      >
                        Copiar
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs text-zinc-600 dark:text-zinc-400">XMLTV</div>
                      <Input
                        value={`${publicXcDnsBaseUrl}/xmltv.php?username=${encodeURIComponent(
                          salePayment.credentials.username
                        )}&password=${encodeURIComponent(salePayment.credentials.password)}`}
                        readOnly
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          const v = `${publicXcDnsBaseUrl}/xmltv.php?username=${encodeURIComponent(
                            salePayment.credentials.username
                          )}&password=${encodeURIComponent(salePayment.credentials.password)}`;
                          try {
                            await navigator.clipboard.writeText(v);
                            toast.success('XMLTV copiado!');
                          } catch {
                            toast.error('Erro ao copiar. Copie manualmente.');
                          }
                        }}
                      >
                        Copiar
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">XC API</div>
                    <Input
                      value={`${publicXcDnsBaseUrl}/player_api.php?username=${encodeURIComponent(
                        salePayment.credentials.username
                      )}&password=${encodeURIComponent(salePayment.credentials.password)}`}
                      readOnly
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        const v = `${publicXcDnsBaseUrl}/player_api.php?username=${encodeURIComponent(
                          salePayment.credentials.username
                        )}&password=${encodeURIComponent(salePayment.credentials.password)}`;
                        try {
                          await navigator.clipboard.writeText(v);
                          toast.success('XC API copiado!');
                        } catch {
                          toast.error('Erro ao copiar. Copie manualmente.');
                        }
                      }}
                    >
                      Copiar
                    </Button>
                  </div>
                </div>
              ) : null}
              {saleClientCheckoutUrl ? (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
                  <Input
                    label="Link do cliente (acompanhar pagamento)"
                    value={saleClientCheckoutUrl}
                    readOnly
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(saleClientCheckoutUrl);
                          toast.success('Link copiado!');
                        } catch {
                          toast.error('Erro ao copiar. Copie manualmente.');
                        }
                      }}
                    >
                      Copiar link
                    </Button>
                    <Button variant="outline" onClick={() => window.open(saleClientCheckoutUrl, '_blank', 'noopener,noreferrer')}>
                      Abrir
                    </Button>
                    <Button
                      variant="outline"
                      disabled={isBillingBlocked || !saleCustomerPhone || sendSalePaymentWhatsAppMutation.isPending}
                      onClick={() => sendSalePaymentWhatsAppMutation.mutate()}
                    >
                      Enviar WhatsApp
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="flex justify-center">
                <img
                  src={`data:image/png;base64,${salePayment.data.pixQrCode}`}
                  alt="QR Code PIX"
                  className="max-w-xs border-2 border-zinc-200 dark:border-zinc-700 rounded-lg p-2 bg-white"
                />
              </div>

              {salePayment.data.pixCopyPaste ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Código PIX (copia e cola)</div>
                  <textarea
                    readOnly
                    value={salePayment.data.pixCopyPaste}
                    onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                    className="w-full p-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm font-mono text-zinc-900 dark:text-white resize-none cursor-pointer"
                    rows={4}
                  />
                  <Button
                    variant="outline"
                    onClick={async () => {
                      const text = salePayment.data.pixCopyPaste || '';
                      try {
                        await navigator.clipboard.writeText(text);
                        toast.success('Código PIX copiado!');
                      } catch {
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
                          toast.success('Código PIX copiado!');
                        } catch {
                          toast.error('Erro ao copiar. Copie manualmente.');
                        }
                      }
                    }}
                  >
                    Copiar código PIX
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        isOpen={scheduleModalOpen}
        onClose={() => setScheduleModalOpen(false)}
        title={editingSchedule ? 'Editar Agenda' : 'Nova Agenda'}
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label="Nome"
            value={scheduleForm.name}
            onChange={(e) => setScheduleForm((p) => ({ ...p, name: e.target.value }))}
          />
          <Input
            label="URL do M3U"
            value={scheduleForm.m3uUrl}
            onChange={(e) => setScheduleForm((p) => ({ ...p, m3uUrl: e.target.value }))}
          />
          <Input
            label="Cron (ex: 0 5 * * *)"
            value={scheduleForm.cronExpression}
            onChange={(e) => setScheduleForm((p) => ({ ...p, cronExpression: e.target.value }))}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select
              label="Tipo"
              value={scheduleForm.type}
              onChange={(e) => setScheduleForm((p) => ({ ...p, type: e.target.value as any }))}
            >
              <option value="all">Tudo</option>
              <option value="live">Live</option>
              <option value="movie">Filmes</option>
              <option value="series">Séries</option>
              <option value="vod">VOD (filme+série)</option>
            </Select>
            <Select
              label="Modo"
              value={scheduleForm.mode}
              onChange={(e) => setScheduleForm((p) => ({ ...p, mode: e.target.value as any }))}
            >
              <option value="append">Adicionar (append)</option>
              <option value="update">Atualizar/Mesclar (update)</option>
              <option value="replace">Apagar e importar (replace)</option>
            </Select>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={scheduleForm.createPackage}
              onChange={(e) => setScheduleForm((p) => ({ ...p, createPackage: e.target.checked }))}
            />
            <span className="text-sm text-zinc-800 dark:text-zinc-200">Criar/Atualizar pacotes padrão (Completo + Completo sem adulto)</span>
          </label>
          <Select
            label="Ativo"
            value={scheduleForm.isActive ? 'true' : 'false'}
            onChange={(e) => setScheduleForm((p) => ({ ...p, isActive: e.target.value === 'true' }))}
          >
            <option value="true">Sim</option>
            <option value="false">Não</option>
          </Select>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setScheduleModalOpen(false)}>Cancelar</Button>
            <Button
              disabled={isBillingBlocked}
              onClick={() => {
                if (!scheduleForm.name || !scheduleForm.m3uUrl || !scheduleForm.cronExpression) {
                  toast.error('Preencha nome, URL e cron');
                  return;
                }
                if (editingSchedule) updateScheduleMutation.mutate();
                else createScheduleMutation.mutate();
              }}
            >
              Salvar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        title="Importar M3U (Core)"
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label="URL do M3U"
            value={importForm.url}
            onChange={(e) => setImportForm((p) => ({ ...p, url: e.target.value }))}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select
              label="Tipo"
              value={importForm.type}
              onChange={(e) => setImportForm((p) => ({ ...p, type: e.target.value as any }))}
            >
              <option value="all">Tudo</option>
              <option value="live">Live</option>
              <option value="movie">Filmes</option>
              <option value="series">Séries</option>
              <option value="vod">VOD (filme+série)</option>
            </Select>
            <Select
              label="Modo"
              value={importForm.mode}
              onChange={(e) => setImportForm((p) => ({ ...p, mode: e.target.value as any }))}
            >
              <option value="append">Adicionar (append)</option>
              <option value="update">Atualizar/Mesclar (update)</option>
              <option value="replace">Apagar e importar (replace)</option>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={importForm.createPackage}
                onChange={(e) => setImportForm((p) => ({ ...p, createPackage: e.target.checked }))}
              />
              <span className="text-sm text-zinc-800 dark:text-zinc-200">Criar/Atualizar pacotes padrão (Completo + Completo sem adulto)</span>
            </label>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={importForm.createLine}
                onChange={(e) => setImportForm((p) => ({ ...p, createLine: e.target.checked }))}
              />
              <span className="text-sm text-zinc-800 dark:text-zinc-200">Criar 1 linha junto</span>
            </label>
            {importForm.createLine ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input
                  label="Usuário (opcional)"
                  value={importForm.lineUsername}
                  onChange={(e) => setImportForm((p) => ({ ...p, lineUsername: e.target.value }))}
                />
                <Input
                  label="Senha (opcional)"
                  value={importForm.linePassword}
                  onChange={(e) => setImportForm((p) => ({ ...p, linePassword: e.target.value }))}
                />
                <Input
                  label="Expira (dias)"
                  type="number"
                  value={importForm.lineExpiresDays}
                  onChange={(e) => setImportForm((p) => ({ ...p, lineExpiresDays: parseInt(e.target.value || '30', 10) }))}
                />
              </div>
            ) : null}
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={importForm.background}
              onChange={(e) => setImportForm((p) => ({ ...p, background: e.target.checked }))}
            />
            <span className="text-sm text-zinc-800 dark:text-zinc-200">Rodar em segundo plano (continua mesmo se fechar a página)</span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={importForm.enrichWithTMDB}
              onChange={(e) => setImportForm((p) => ({ ...p, enrichWithTMDB: e.target.checked }))}
            />
            <span className="text-sm text-zinc-800 dark:text-zinc-200">Usar TMDB para capas (VOD e Séries)</span>
          </label>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setImportModalOpen(false)}>Cancelar</Button>
            <Button
              disabled={isBillingBlocked}
              onClick={() => {
                if (!importForm.url) {
                  toast.error('Preencha a URL');
                  return;
                }
                if (importForm.mode === 'replace') {
                  if (!confirm('Isso vai apagar os itens atuais do core (do tipo escolhido) e importar tudo de novo. Confirmar?')) return;
                }
                if (importForm.createLine && !importForm.createPackage) {
                  if (!confirm('Para a linha receber acesso, recomendo criar/atualizar um pacote junto. Continuar mesmo assim?')) return;
                }
                importM3UMutation.mutate();
              }}
            >
              Importar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={vodModalOpen}
        onClose={() => setVodModalOpen(false)}
        title={editingVod ? 'Editar VOD' : 'Novo VOD'}
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label="Nome"
            value={vodForm.name}
            onChange={(e) => setVodForm((p) => ({ ...p, name: e.target.value }))}
          />
          <Input
            label="URL"
            value={vodForm.streamUrl}
            onChange={(e) => setVodForm((p) => ({ ...p, streamUrl: e.target.value }))}
          />
          <Input
            label="Poster (opcional)"
            value={vodForm.posterUrl}
            onChange={(e) => setVodForm((p) => ({ ...p, posterUrl: e.target.value }))}
          />
          <Select
            label="Status"
            value={vodForm.isActive ? 'true' : 'false'}
            onChange={(e) => setVodForm((p) => ({ ...p, isActive: e.target.value === 'true' }))}
          >
            <option value="true">Ativo</option>
            <option value="false">Inativo</option>
          </Select>

          <div className="space-y-2">
            <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Categorias</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {bouquets.map((b) => {
                const checked = vodForm.bouquetIds.includes(b.id);
                return (
                  <label
                    key={b.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(vodForm.bouquetIds);
                        if (e.target.checked) next.add(b.id);
                        else next.delete(b.id);
                        setVodForm((p) => ({ ...p, bouquetIds: Array.from(next) }));
                      }}
                    />
                    <span className="text-sm text-zinc-800 dark:text-zinc-200">{b.name}</span>
                  </label>
                );
              })}
              {bouquets.length === 0 ? (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">Crie uma categoria primeiro</div>
              ) : null}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setVodModalOpen(false)}>Cancelar</Button>
            <Button
              disabled={isBillingBlocked}
              onClick={() => {
                if (!vodForm.name || !vodForm.streamUrl) {
                  toast.error('Preencha nome e URL');
                  return;
                }
                if (editingVod) updateVodMutation.mutate();
                else createVodMutation.mutate();
              }}
            >
              Salvar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={seriesModalOpen}
        onClose={() => setSeriesModalOpen(false)}
        title={editingSeries ? 'Editar Série' : 'Nova Série'}
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label="Nome"
            value={seriesForm.name}
            onChange={(e) => setSeriesForm((p) => ({ ...p, name: e.target.value }))}
          />
          <Input
            label="Capa (opcional)"
            value={seriesForm.coverUrl}
            onChange={(e) => setSeriesForm((p) => ({ ...p, coverUrl: e.target.value }))}
          />
          <Select
            label="Status"
            value={seriesForm.isActive ? 'true' : 'false'}
            onChange={(e) => setSeriesForm((p) => ({ ...p, isActive: e.target.value === 'true' }))}
          >
            <option value="true">Ativo</option>
            <option value="false">Inativo</option>
          </Select>

          <div className="space-y-2">
            <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Categorias</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {bouquets.map((b) => {
                const checked = seriesForm.bouquetIds.includes(b.id);
                return (
                  <label
                    key={b.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(seriesForm.bouquetIds);
                        if (e.target.checked) next.add(b.id);
                        else next.delete(b.id);
                        setSeriesForm((p) => ({ ...p, bouquetIds: Array.from(next) }));
                      }}
                    />
                    <span className="text-sm text-zinc-800 dark:text-zinc-200">{b.name}</span>
                  </label>
                );
              })}
              {bouquets.length === 0 ? (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">Crie uma categoria primeiro</div>
              ) : null}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSeriesModalOpen(false)}>Cancelar</Button>
            <Button
              disabled={isBillingBlocked}
              onClick={() => {
                if (!seriesForm.name) {
                  toast.error('Preencha o nome');
                  return;
                }
                if (editingSeries) updateSeriesMutation.mutate();
                else createSeriesMutation.mutate();
              }}
            >
              Salvar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={episodeModalOpen}
        onClose={() => {
          setEpisodeModalOpen(false);
          setActiveSeriesId('');
        }}
        title={`Episódios${activeSeriesId ? ` — ${series.find(s => s.id === activeSeriesId)?.name || ''}` : ''}`}
        size="xl"
      >
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-6 gap-3">
            <Input
              label="Temporada"
              type="number"
              value={episodeForm.season}
              onChange={(e) => setEpisodeForm((p) => ({ ...p, season: parseInt(e.target.value || '1', 10) }))}
            />
            <Input
              label="Episódio"
              type="number"
              value={episodeForm.episode}
              onChange={(e) => setEpisodeForm((p) => ({ ...p, episode: parseInt(e.target.value || '1', 10) }))}
            />
            <div className="lg:col-span-2">
              <Input
                label="Título"
                value={episodeForm.title}
                onChange={(e) => setEpisodeForm((p) => ({ ...p, title: e.target.value }))}
              />
            </div>
            <div className="lg:col-span-2">
              <Input
                label="URL"
                value={episodeForm.streamUrl}
                onChange={(e) => setEpisodeForm((p) => ({ ...p, streamUrl: e.target.value }))}
              />
            </div>
          </div>
          <Select
            label="Status"
            value={episodeForm.isActive ? 'true' : 'false'}
            onChange={(e) => setEpisodeForm((p) => ({ ...p, isActive: e.target.value === 'true' }))}
          >
            <option value="true">Ativo</option>
            <option value="false">Inativo</option>
          </Select>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={openCreateEpisode} disabled={isBillingBlocked}>Novo</Button>
            <Button
              disabled={isBillingBlocked}
              onClick={() => {
                if (!episodeForm.title || !episodeForm.streamUrl) {
                  toast.error('Preencha título e URL');
                  return;
                }
                if (!activeSeriesId) {
                  toast.error('Série inválida');
                  return;
                }
                if (editingEpisode) updateEpisodeMutation.mutate();
                else createEpisodeMutation.mutate();
              }}
            >
              Salvar
            </Button>
          </div>

          <div className="border-t border-zinc-200/70 dark:border-zinc-800/70 pt-4">
            {episodesLoading ? (
              <div className="flex items-center justify-center py-6">
                <Spinner />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-zinc-600 dark:text-zinc-400">
                      <th className="py-2 pr-4">S</th>
                      <th className="py-2 pr-4">E</th>
                      <th className="py-2 pr-4">Título</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {episodes.map((e) => (
                      <tr key={e.id} className="border-t border-zinc-200/70 dark:border-zinc-800/70">
                        <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{e.season}</td>
                        <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{e.episode}</td>
                        <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-white">{e.title}</td>
                        <td className="py-3 pr-4">
                          <Badge variant={e.isActive ? 'success' : 'warning'}>{e.isActive ? 'ATIVO' : 'INATIVO'}</Badge>
                        </td>
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2 justify-end">
                            <Button variant="outline" size="sm" onClick={() => openEditEpisode(e)} disabled={isBillingBlocked}>Editar</Button>
                            <Button
                              variant="danger"
                              size="sm"
                              disabled={isBillingBlocked}
                              onClick={() => {
                                if (!confirm('Remover este episódio?')) return;
                                deleteEpisodeMutation.mutate(e.id);
                              }}
                            >
                              Remover
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {episodes.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-10 text-center text-zinc-600 dark:text-zinc-400">
                          Nenhum episódio criado ainda
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={epgModalOpen}
        onClose={() => setEpgModalOpen(false)}
        title={editingEpg ? 'Editar Fonte EPG' : 'Nova Fonte EPG'}
        size="lg"
      >
        <div className="space-y-4">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Importe XMLTV (EPG) e ative para atualizar automaticamente.
          </div>
          <Input label="Nome" value={epgForm.name} onChange={(e) => setEpgForm((p) => ({ ...p, name: e.target.value }))} />
          <Input
            label="URL do XMLTV"
            value={epgForm.xmltvUrl}
            onChange={(e) => setEpgForm((p) => ({ ...p, xmltvUrl: e.target.value }))}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="Cron (ex: 0 5 * * *)"
              value={epgForm.cronExpression}
              onChange={(e) => setEpgForm((p) => ({ ...p, cronExpression: e.target.value }))}
            />
            <Input
              label="Dias adiante"
              type="number"
              value={epgForm.daysAhead}
              onChange={(e) => setEpgForm((p) => ({ ...p, daysAhead: parseInt(e.target.value || '0', 10) || 1 }))}
            />
          </div>
          <Select
            label="Status"
            value={epgForm.isActive ? 'true' : 'false'}
            onChange={(e) => setEpgForm((p) => ({ ...p, isActive: e.target.value === 'true' }))}
          >
            <option value="true">Ativa</option>
            <option value="false">Inativa</option>
          </Select>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEpgModalOpen(false)}>Cancelar</Button>
            <Button
              disabled={isBillingBlocked}
              onClick={() => {
                if (!epgForm.name || !epgForm.xmltvUrl || !epgForm.cronExpression) {
                  toast.error('Preencha nome, URL e cron');
                  return;
                }
                if (editingEpg) updateEpgSourceMutation.mutate();
                else createEpgSourceMutation.mutate();
              }}
            >
              Salvar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={epgAutoMapModalOpen}
        onClose={() => setEpgAutoMapModalOpen(false)}
        title="Auto-map de EPG"
        size="xl"
      >
        <div className="space-y-4">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            {epgAutoMapData
              ? `Mapeadas ${epgAutoMapData.matched} stream(s) (minScore ${epgAutoMapData.minScore}).`
              : 'Sem dados'}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-600 dark:text-zinc-400">
                  <th className="py-2 pr-4">Stream</th>
                  <th className="py-2 pr-4">Canal EPG</th>
                  <th className="py-2 pr-4">Score</th>
                </tr>
              </thead>
              <tbody>
                {(epgAutoMapData?.results || []).map((r) => (
                  <tr key={r.streamId} className="border-t border-zinc-200/70 dark:border-zinc-800/70">
                    <td className="py-3 pr-4 text-zinc-900 dark:text-white">{r.streamName}</td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                      {r.epgDisplayName} ({r.epgChannelId})
                    </td>
                    <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{r.score}</td>
                  </tr>
                ))}
                {(epgAutoMapData?.results || []).length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-10 text-center text-zinc-600 dark:text-zinc-400">
                      Nenhum match encontrado
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setEpgAutoMapModalOpen(false)}>
              Fechar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={serverModalOpen}
        onClose={() => setServerModalOpen(false)}
        title={editingServer ? 'Editar Servidor' : 'Novo Servidor'}
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label="Nome"
            value={serverForm.name}
            onChange={(e) => setServerForm((p) => ({ ...p, name: e.target.value }))}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="Domínio (opcional)"
              value={serverForm.domain}
              onChange={(e) => setServerForm((p) => ({ ...p, domain: e.target.value }))}
            />
            <Input
              label="IP (opcional)"
              value={serverForm.ip}
              onChange={(e) => setServerForm((p) => ({ ...p, ip: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="VPN IP (opcional)"
              value={serverForm.vpnIp}
              onChange={(e) => setServerForm((p) => ({ ...p, vpnIp: e.target.value }))}
            />
            <Input
              label="Máximo de clientes"
              type="number"
              value={serverForm.maxClients}
              onChange={(e) => setServerForm((p) => ({ ...p, maxClients: parseInt(e.target.value || '0', 10) || 0 }))}
            />
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!serverForm.onlyTimeshift}
                onChange={(e) => setServerForm((p) => ({ ...p, onlyTimeshift: e.target.checked }))}
              />
              <span className="text-sm text-zinc-800 dark:text-zinc-200">Apenas Timeshift</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!serverForm.duplex}
                onChange={(e) => setServerForm((p) => ({ ...p, duplex: e.target.checked }))}
              />
              <span className="text-sm text-zinc-800 dark:text-zinc-200">Duplex</span>
            </label>
          </div>
          <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Avançado</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="Diferença Horária (segundos)"
              type="number"
              value={serverForm.timezoneOffsetSeconds}
              onChange={(e) => setServerForm((p) => ({ ...p, timezoneOffsetSeconds: parseInt(e.target.value || '0', 10) || 0 }))}
            />
            <Input
              label="Velocidade da Rede"
              type="number"
              value={serverForm.networkSpeed}
              onChange={(e) => setServerForm((p) => ({ ...p, networkSpeed: parseInt(e.target.value || '0', 10) || 0 }))}
            />
          </div>
          <Input
            label="Interface de rede (opcional)"
            value={serverForm.networkInterface}
            onChange={(e) => setServerForm((p) => ({ ...p, networkInterface: e.target.value }))}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="Porta HTTP"
              type="number"
              value={serverForm.httpPort}
              onChange={(e) => setServerForm((p) => ({ ...p, httpPort: parseInt(e.target.value || '0', 10) || 0 }))}
            />
            <Input
              label="Porta HTTPS"
              type="number"
              value={serverForm.httpsPort}
              onChange={(e) => setServerForm((p) => ({ ...p, httpsPort: parseInt(e.target.value || '0', 10) || 0 }))}
            />
          </div>
          <Input
            label="Porta RTMP (opcional)"
            type="number"
            value={serverForm.rtmpPort}
            onChange={(e) => setServerForm((p) => ({ ...p, rtmpPort: parseInt(e.target.value || '0', 10) || 0 }))}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="SSH Host (opcional)"
              value={serverForm.sshHost}
              onChange={(e) => setServerForm((p) => ({ ...p, sshHost: e.target.value }))}
            />
            <Input
              label="SSH Porta"
              type="number"
              value={serverForm.sshPort}
              onChange={(e) => setServerForm((p) => ({ ...p, sshPort: parseInt(e.target.value || '0', 10) || 22 }))}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="SSH User (opcional)"
              value={serverForm.sshUser}
              onChange={(e) => setServerForm((p) => ({ ...p, sshUser: e.target.value }))}
            />
            <Input
              label="SSH Senha (opcional)"
              type="password"
              value={serverForm.sshPassword}
              onChange={(e) => setServerForm((p) => ({ ...p, sshPassword: e.target.value }))}
            />
          </div>
          <Input
            label="SSH Key (opcional)"
            value={serverForm.sshKey}
            onChange={(e) => setServerForm((p) => ({ ...p, sshKey: e.target.value }))}
          />

          <Input
            label="Token do Edge (opcional)"
            type="password"
            value={serverForm.edgeToken}
            onChange={(e) => setServerForm((p) => ({ ...p, edgeToken: e.target.value }))}
          />
          <div className="text-xs text-zinc-600 dark:text-zinc-400">
            Se você configurar EDGE_TOKEN no balance, use o mesmo valor aqui.
          </div>

          <Input
            label="Sistema (ex: ubuntu)"
            value={serverForm.os}
            onChange={(e) => setServerForm((p) => ({ ...p, os: e.target.value }))}
          />

          <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Equilíbrio de Carga (GeoIP)</div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!serverForm.geoipEnabled}
              onChange={(e) => setServerForm((p) => ({ ...p, geoipEnabled: e.target.checked }))}
            />
            <span className="text-sm text-zinc-800 dark:text-zinc-200">Equilíbrio de Carga GeoIP</span>
          </label>
          <Select
            label="Prioridade (GeoIP)"
            value={serverForm.geoipPriority}
            onChange={(e) => setServerForm((p) => ({ ...p, geoipPriority: e.target.value }))}
          >
            <option value="low">Low Priority</option>
            <option value="high">High Priority</option>
          </Select>
          <div className="w-full">
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Países GeoIP — 1 por linha</label>
            <textarea
              className="w-full px-4 py-2.5 rounded-lg border bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-cyan-500 focus:border-transparent transition-colors"
              rows={3}
              value={serverForm.geoipCountries}
              onChange={(e) => setServerForm((p) => ({ ...p, geoipCountries: e.target.value }))}
              placeholder={`BR\nPT`}
            />
          </div>

          <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Gestor ISP</div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!serverForm.ispEnabled}
              onChange={(e) => setServerForm((p) => ({ ...p, ispEnabled: e.target.checked }))}
            />
            <span className="text-sm text-zinc-800 dark:text-zinc-200">Permitir ISP</span>
          </label>
          <Select label="Prioridade" value={serverForm.ispPriority} onChange={(e) => setServerForm((p) => ({ ...p, ispPriority: e.target.value }))}>
            <option value="low">Low Priority</option>
            <option value="high">High Priority</option>
          </Select>
          <div className="w-full">
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Permitir nomes de ISP — 1 por linha</label>
            <textarea
              className="w-full px-4 py-2.5 rounded-lg border bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-cyan-500 focus:border-transparent transition-colors"
              rows={3}
              value={serverForm.ispNames}
              onChange={(e) => setServerForm((p) => ({ ...p, ispNames: e.target.value }))}
              placeholder={`Vivo\nClaro\nOi`}
            />
          </div>

          <Select
            label="Status"
            value={serverForm.isActive ? 'true' : 'false'}
            onChange={(e) => setServerForm((p) => ({ ...p, isActive: e.target.value === 'true' }))}
          >
            <option value="true">Ativo</option>
            <option value="false">Inativo</option>
          </Select>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setServerModalOpen(false)}>Cancelar</Button>
            <Button
              disabled={isBillingBlocked}
              onClick={() => {
                if (!serverForm.name.trim()) {
                  toast.error('Preencha o nome');
                  return;
                }
                if (!serverForm.domain.trim() && !serverForm.ip.trim()) {
                  toast.error('Preencha domínio ou IP');
                  return;
                }
                if (editingServer) updateServerMutation.mutate();
                else createServerMutation.mutate();
              }}
            >
              Salvar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={edgeJobModalOpen}
        onClose={() => {
          setEdgeJobModalOpen(false);
          setEdgeJobId(null);
          setEdgeJobStatus(null);
          setEdgeJobLogs([]);
          setEdgeJobError(null);
        }}
        title={edgeJobId ? `Job — ${edgeJobId}` : 'Job'}
        size="xl"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant={edgeJobStatus === 'completed' ? 'success' : edgeJobStatus === 'failed' ? 'warning' : 'info'}>
              {edgeJobStatus || '-'}
            </Badge>
            {edgeJobError ? <span className="text-sm text-red-600 dark:text-red-400">{edgeJobError}</span> : null}
          </div>

          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
            <div className="max-h-[420px] overflow-auto whitespace-pre-wrap text-xs text-zinc-800 dark:text-zinc-200">
              {(edgeJobLogs || []).join('\n') || 'Sem logs'}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            {edgeJobId && edgeJobStatus === 'processing' ? (
              <Button variant="outline" onClick={() => cancelEdgeJobMutation.mutate()} disabled={cancelEdgeJobMutation.isPending}>
                Cancelar
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setEdgeJobModalOpen(false)}>Fechar</Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={streamModalOpen}
        onClose={() => setStreamModalOpen(false)}
        title={editingStream ? 'Editar Stream' : 'Nova Stream'}
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label="Nome"
            value={streamForm.name}
            onChange={(e) => setStreamForm((p) => ({ ...p, name: e.target.value }))}
          />
          <div className="w-full">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">URLs (balance) — 1 por linha</label>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={normalizeStreamUrls}>Normalizar</Button>
                <Button variant="outline" size="sm" onClick={generateBalanceUrlsFromFirst}>Gerar balances</Button>
              </div>
            </div>
            <textarea
              className="w-full px-4 py-2.5 rounded-lg border bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-cyan-500 focus:border-transparent transition-colors"
              rows={4}
              value={streamForm.streamUrl}
              onChange={(e) => setStreamForm((p) => ({ ...p, streamUrl: e.target.value }))}
              placeholder={`https://UPSTREAM1/live/USER/PASS/ID.ts\nhttps://UPSTREAM2/live/USER/PASS/ID.ts`}
            />
          </div>
          <div className="w-full">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Balances (domínio/IP[:porta]) — 1 por linha</label>
              <Button variant="outline" size="sm" onClick={fillBalanceHostsFromServers}>Usar servidores</Button>
            </div>
            <textarea
              className="w-full px-4 py-2.5 rounded-lg border bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-cyan-500 focus:border-transparent transition-colors"
              rows={3}
              value={balanceHostsRaw}
              onChange={(e) => setBalanceHostsRaw(e.target.value)}
              placeholder={`balance01.seudominio.com\nbalance02.seudominio.com`}
            />
          </div>
          <Input
            label="Logo (opcional)"
            value={streamForm.logoUrl}
            onChange={(e) => setStreamForm((p) => ({ ...p, logoUrl: e.target.value }))}
          />
          <Select
            label="Canal EPG (opcional)"
            value={streamForm.epgChannelId || ''}
            onChange={(e) => setStreamForm((p) => ({ ...p, epgChannelId: e.target.value }))}
          >
            <option value="">Sem EPG</option>
            {epgChannels.map((c) => (
              <option key={c.id} value={c.channelId}>
                {c.displayName} ({c.channelId})
              </option>
            ))}
          </Select>
          <Input
            label="EPG Channel ID (tvg-id)"
            value={streamForm.epgChannelId}
            onChange={(e) => setStreamForm((p) => ({ ...p, epgChannelId: e.target.value }))}
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!streamForm.tvArchive}
              onChange={(e) => setStreamForm((p) => ({ ...p, tvArchive: e.target.checked }))}
            />
            <span className="text-sm text-zinc-800 dark:text-zinc-200">Ativar Catchup (TV Archive)</span>
          </label>
          {streamForm.tvArchive ? (
            <Input
              label="Duração do Catchup (dias)"
              type="number"
              value={streamForm.tvArchiveDuration}
              onChange={(e) =>
                setStreamForm((p) => ({ ...p, tvArchiveDuration: parseInt(e.target.value || '0', 10) || 0 }))
              }
            />
          ) : null}
          <Select
            label="Status"
            value={streamForm.isActive ? 'true' : 'false'}
            onChange={(e) => setStreamForm((p) => ({ ...p, isActive: e.target.value === 'true' }))}
          >
            <option value="true">Ativa</option>
            <option value="false">Inativa</option>
          </Select>

          <div className="space-y-2">
            <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Servidores (Balances)</div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">Se vazio, usa todos os servidores ativos</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {servers.filter((s) => s.isActive).map((sv) => {
                const checked = (streamForm.serverIds || []).includes(sv.id);
                const label = sv.name || sv.domain || sv.ip || sv.id;
                const host = sv.domain || sv.ip || '';
                return (
                  <label
                    key={sv.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(streamForm.serverIds || []);
                        if (e.target.checked) next.add(sv.id);
                        else next.delete(sv.id);
                        setStreamForm((p) => ({ ...p, serverIds: Array.from(next) }));
                      }}
                    />
                    <span className="text-sm text-zinc-800 dark:text-zinc-200">
                      {label}
                      {host ? <span className="text-xs text-zinc-600 dark:text-zinc-400"> — {host}</span> : null}
                    </span>
                  </label>
                );
              })}
              {servers.filter((s) => s.isActive).length === 0 ? (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">Nenhum servidor ativo cadastrado</div>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Categorias</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {bouquets.map((b) => {
                const checked = streamForm.bouquetIds.includes(b.id);
                return (
                  <label
                    key={b.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(streamForm.bouquetIds);
                        if (e.target.checked) next.add(b.id);
                        else next.delete(b.id);
                        setStreamForm((p) => ({ ...p, bouquetIds: Array.from(next) }));
                      }}
                    />
                    <span className="text-sm text-zinc-800 dark:text-zinc-200">{b.name}</span>
                  </label>
                );
              })}
              {bouquets.length === 0 ? (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">Crie uma categoria primeiro</div>
              ) : null}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setStreamModalOpen(false)}>Cancelar</Button>
            <Button
              disabled={isBillingBlocked}
              onClick={() => {
                const urls = (streamForm.streamUrl || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
                if (!streamForm.name || urls.length === 0) {
                  toast.error('Preencha nome e pelo menos 1 URL');
                  return;
                }
                if (editingStream) updateStreamMutation.mutate();
                else createStreamMutation.mutate();
              }}
            >
              Salvar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={probeStreamModalOpen}
        onClose={() => {
          setProbeStreamModalOpen(false);
          setProbeStream(null);
          setProbeStreamData(null);
        }}
        title={probeStream ? `Testar URLs — ${probeStream.name}` : 'Testar URLs'}
        size="lg"
      >
        <div className="space-y-4">
          {probeStreamMutation.isPending ? (
            <div className="flex items-center gap-3 text-zinc-700 dark:text-zinc-300">
              <Spinner />
              <span>Testando URLs...</span>
            </div>
          ) : null}

          {probeStreamData ? (
            <div className="space-y-3">
              <div className="text-sm text-zinc-700 dark:text-zinc-300">
                {probeStreamData.checkedUrls} de {probeStreamData.totalUrls} URLs testadas
                {probeStreamData.truncated > 0 ? ` (+${probeStreamData.truncated} não testadas)` : ''}
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-zinc-600 dark:text-zinc-400">
                      <th className="py-2 pr-4">URL</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">HTTP</th>
                      <th className="py-2 pr-4">Tempo</th>
                      <th className="py-2 pr-4">Erro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {probeStreamData.results.map((r) => (
                      <tr key={r.url} className="border-t border-zinc-200/70 dark:border-zinc-800/70">
                        <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300 max-w-[520px]">
                          <div className="truncate">{r.url}</div>
                        </td>
                        <td className="py-3 pr-4">
                          <Badge variant={r.ok ? 'success' : 'warning'}>{r.ok ? 'OK' : 'FALHA'}</Badge>
                        </td>
                        <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{r.status ?? '-'}</td>
                        <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{r.ms}ms</td>
                        <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{r.error || '-'}</td>
                      </tr>
                    ))}
                    {probeStreamData.results.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-10 text-center text-zinc-600 dark:text-zinc-400">
                          Nenhuma URL para testar
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {!probeStreamMutation.isPending && !probeStreamData ? (
            <div className="text-sm text-zinc-600 dark:text-zinc-400">Clique em “Testar URLs” na tabela para iniciar.</div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setProbeStreamModalOpen(false)}>Fechar</Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={bulkApplyServersModalOpen}
        onClose={() => {
          setBulkApplyServersModalOpen(false);
          setBulkApplyServersResult(null);
        }}
        title="Aplicar servidores em massa"
        size="lg"
      >
        <div className="space-y-4">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Streams selecionadas:{' '}
            <span className="font-medium text-zinc-900 dark:text-white">{bulkApplyServersResult ? bulkApplyServersResult.total : selectedStreamIds.length}</span>{' '}
            • Servidores ativos:{' '}
            <span className="font-medium text-zinc-900 dark:text-white">{activeServersCount}</span>
          </div>

          <Select label="Modo" value={bulkApplyServersMode} onChange={(e) => setBulkApplyServersMode(e.target.value as any)}>
            <option value="append">Adicionar (append)</option>
            <option value="replace">Substituir (replace)</option>
          </Select>

          {bulkApplyServersMutation.isPending ? (
            <div className="flex items-center gap-3 text-zinc-700 dark:text-zinc-300">
              <Spinner />
              <span>Aplicando servidores...</span>
            </div>
          ) : null}

          {bulkApplyServersResult ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="info">Modo: {bulkApplyServersResult.mode}</Badge>
                <Badge variant="info">Servidores: {bulkApplyServersResult.serversUsed}</Badge>
                <Badge variant="success">Atualizadas: {bulkApplyServersResult.updated}</Badge>
                <Badge variant="warning">Ignoradas: {bulkApplyServersResult.skipped}</Badge>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-zinc-600 dark:text-zinc-400">
                      <th className="py-2 pr-4">Stream</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Adicionadas</th>
                      <th className="py-2 pr-4">Total URLs</th>
                      <th className="py-2 pr-4">Erro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkApplyServersResult.results.map((r) => {
                      const name = streamById[r.streamId]?.name || r.streamId;
                      return (
                        <tr key={r.streamId} className="border-t border-zinc-200/70 dark:border-zinc-800/70">
                          <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-white">{name}</td>
                          <td className="py-3 pr-4">
                            <Badge variant={r.updated ? 'success' : 'warning'}>{r.updated ? 'ATUALIZADA' : 'IGNORADA'}</Badge>
                          </td>
                          <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{r.added}</td>
                          <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{r.totalUrls}</td>
                          <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{r.error || '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setBulkApplyServersModalOpen(false)}>Fechar</Button>
            <Button
              disabled={isBillingBlocked || bulkApplyServersMutation.isPending || selectedStreamIds.length === 0 || activeServersCount === 0}
              loading={bulkApplyServersMutation.isPending}
              onClick={() => bulkApplyServersMutation.mutate({ streamIds: selectedStreamIds, mode: bulkApplyServersMode })}
            >
              Aplicar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={bouquetModalOpen}
        onClose={() => setBouquetModalOpen(false)}
        title={editingBouquet ? 'Editar Categoria' : 'Nova Categoria'}
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label="Nome"
            value={bouquetForm.name}
            onChange={(e) => setBouquetForm((p) => ({ ...p, name: e.target.value }))}
          />
          <Select
            label="Status"
            value={bouquetForm.isActive ? 'true' : 'false'}
            onChange={(e) => setBouquetForm((p) => ({ ...p, isActive: e.target.value === 'true' }))}
          >
            <option value="true">Ativo</option>
            <option value="false">Inativo</option>
          </Select>

          <div className="space-y-2">
            <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Streams</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {streams.map((s) => {
                const checked = bouquetForm.streamIds.includes(s.id);
                return (
                  <label
                    key={s.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(bouquetForm.streamIds);
                        if (e.target.checked) next.add(s.id);
                        else next.delete(s.id);
                        setBouquetForm((p) => ({ ...p, streamIds: Array.from(next) }));
                      }}
                    />
                    <span className="text-sm text-zinc-800 dark:text-zinc-200">{s.name}</span>
                  </label>
                );
              })}
              {streams.length === 0 ? (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">Crie uma stream primeiro</div>
              ) : null}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setBouquetModalOpen(false)}>Cancelar</Button>
            <Button
              disabled={isBillingBlocked}
              onClick={() => {
                if (!bouquetForm.name) {
                  toast.error('Preencha o nome');
                  return;
                }
                if (editingBouquet) updateBouquetMutation.mutate();
                else createBouquetMutation.mutate();
              }}
            >
              Salvar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={packageModalOpen}
        onClose={() => setPackageModalOpen(false)}
        title={editingPackage ? 'Editar Pacote' : 'Novo Pacote'}
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label="Nome"
            value={packageForm.name}
            onChange={(e) => setPackageForm((p) => ({ ...p, name: e.target.value }))}
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input
              label="Dias"
              type="number"
              value={packageForm.durationDays}
              onChange={(e) => setPackageForm((p) => ({ ...p, durationDays: parseInt(e.target.value || '0', 10) }))}
            />
            <Input
              label="Conexões"
              type="number"
              value={packageForm.connections}
              onChange={(e) => setPackageForm((p) => ({ ...p, connections: parseInt(e.target.value || '0', 10) }))}
            />
            <Input
              label="Preço (centavos)"
              type="number"
              value={packageForm.priceCents}
              onChange={(e) => setPackageForm((p) => ({ ...p, priceCents: parseInt(e.target.value || '0', 10) }))}
            />
          </div>
          <Select
            label="Status"
            value={packageForm.isActive ? 'true' : 'false'}
            onChange={(e) => setPackageForm((p) => ({ ...p, isActive: e.target.value === 'true' }))}
          >
            <option value="true">Ativo</option>
            <option value="false">Inativo</option>
          </Select>

          <div className="space-y-2">
            <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Categorias</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {bouquets.map((b) => {
                const checked = packageForm.bouquetIds.includes(b.id);
                return (
                  <label
                    key={b.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(packageForm.bouquetIds);
                        if (e.target.checked) next.add(b.id);
                        else next.delete(b.id);
                        setPackageForm((p) => ({ ...p, bouquetIds: Array.from(next) }));
                      }}
                    />
                    <span className="text-sm text-zinc-800 dark:text-zinc-200">{b.name}</span>
                  </label>
                );
              })}
              {bouquets.length === 0 ? (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">Crie uma categoria primeiro</div>
              ) : null}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPackageModalOpen(false)}>Cancelar</Button>
            <Button
              disabled={isBillingBlocked}
              onClick={() => {
                if (!packageForm.name) {
                  toast.error('Preencha o nome');
                  return;
                }
                if ((packageForm.bouquetIds || []).length === 0) {
                  toast.error('Selecione ao menos 1 categoria');
                  return;
                }
                if (editingPackage) updatePackageMutation.mutate();
                else createPackageMutation.mutate();
              }}
            >
              Salvar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={lineModalOpen}
        onClose={() => setLineModalOpen(false)}
        title={editingLine ? 'Editar Linha' : 'Nova Linha'}
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="Usuário"
              value={lineForm.username}
              onChange={(e) => setLineForm((p) => ({ ...p, username: e.target.value }))}
            />
            <Input
              label={editingLine ? 'Senha (deixe em branco para manter)' : 'Senha'}
              type="password"
              value={lineForm.password}
              onChange={(e) => setLineForm((p) => ({ ...p, password: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input
              label="Expira em"
              type="date"
              value={lineForm.expiresAt}
              onChange={(e) => setLineForm((p) => ({ ...p, expiresAt: e.target.value }))}
            />
            <Input
              label="Conexões"
              type="number"
              value={lineForm.connections}
              onChange={(e) => setLineForm((p) => ({ ...p, connections: parseInt(e.target.value || '0', 10) }))}
            />
            <Select
              label="Status"
              value={lineForm.status}
              onChange={(e) => setLineForm((p) => ({ ...p, status: e.target.value as any }))}
            >
              <option value="ACTIVE">Ativa</option>
              <option value="DISABLED">Desativada</option>
            </Select>
          </div>
          <Select
            label="Pacote"
            value={lineForm.packageId}
            onChange={(e) => setLineForm((p) => ({ ...p, packageId: e.target.value }))}
          >
            <option value="">(sem pacote)</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>

          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 text-sm text-zinc-700 dark:text-zinc-300">
            M3U: <span className="font-medium">/get.php?username=USUARIO&amp;password=SENHA</span>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setLineModalOpen(false)}>Cancelar</Button>
            <Button
              disabled={isBillingBlocked}
              onClick={() => {
                if (!lineForm.username) {
                  toast.error('Preencha o usuário');
                  return;
                }
                if (!editingLine && !lineForm.password) {
                  toast.error('Preencha a senha');
                  return;
                }
                if (!editingLine && packages.length > 0 && !lineForm.packageId) {
                  toast.error('Selecione um pacote');
                  return;
                }
                if (!lineForm.expiresAt) {
                  toast.error('Preencha a data de expiração');
                  return;
                }
                if (editingLine) updateLineMutation.mutate();
                else createLineMutation.mutate();
              }}
            >
              Salvar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default CoreXtreamPage;
