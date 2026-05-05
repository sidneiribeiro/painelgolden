/**
 * Página de Jogos do Dia - Design Atualizado
 * 
 * Features:
 * 1. Tabs visuais modernas
 * 2. Cards com gradientes
 * 3. Matching visual com scores
 * 4. Status ao vivo animado
 * 5. Fluxo explicativo visual
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import toast from 'react-hot-toast';

// Cores do tema (removido - usando classes Tailwind com dark mode)

// Interfaces
interface FootballConfig {
  id?: number;
  serverId?: string;
  categoryName: string;
  xuiCategoryId?: number;
  bouquetId?: number;
  timeOffsetMinutes?: number;
  autoUpdate: boolean;
  updateSchedule?: string;
  generateBanners: boolean;
  apiFootballKey?: string;
  enabledLeagues?: string;
}

interface FootballChannel {
  id: number;
  xuiStreamId: number;
  xuiStreamName: string;
  streamUrl?: string;
  keywords: string;
  customKeywords?: string;
  priority: number;
  isActive: boolean;
}

interface DailyMatch {
  id: number;
  homeTeam: string;
  awayTeam: string;
  homeTeamLogo?: string;
  awayTeamLogo?: string;
  leagueId?: number;
  leagueName: string;
  leagueLogo?: string;
  matchTime: string;
  matchDate: string;
  status: string;
  apiChannels?: string;
  mappedChannelId?: number;
  mappedChannelName?: string;
  matchScore?: number;
  xuiStreamId?: number;
  source?: 'GE' | 'TheSportsDB'; // ✨ Nova prop para identificar fonte da API
}

interface XuiServer {
  id: string;
  name: string;
}

interface XuiCategory {
  id: number;
  category_name: string;
}

interface XuiChannel {
  id: number;
  name: string;
  source?: string[];
}

interface Competition {
  id: number;
  name: string;
  category: string;
}

export default function JogosDoDiaPage() {
  const [activeTab, setActiveTab] = useState<'jogos' | 'canais' | 'config' | 'fluxo'>('jogos');
  const [selectedServerId, setSelectedServerId] = useState<string>('');
  const [showAddChannelModal, setShowAddChannelModal] = useState(false);
  const [showMapModal, setShowMapModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<DailyMatch | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [categoryChannels, setCategoryChannels] = useState<XuiChannel[]>([]);
  const [selectedCompetitions, setSelectedCompetitions] = useState<number[]>([]);
  const [filterCompetition, setFilterCompetition] = useState<number | 'all'>('all');
  const [filterDateRange, setFilterDateRange] = useState<'today' | 'tomorrow' | 'next3days'>('today');
  const [availableLeagues, setAvailableLeagues] = useState<any[]>([]);
  const [showLeaguesModal, setShowLeaguesModal] = useState(false);
  const [selectedLeagueImport, setSelectedLeagueImport] = useState<string>('');
  const queryClient = useQueryClient();

  // ============================================
  // QUERIES
  // ============================================

  // Servidores XUI
  const { data: xuiServers } = useQuery<XuiServer[]>({
    queryKey: ['xuiServers'],
    queryFn: async () => {
      const response = await api.get('/settings/xui');
      return response.data.data || [];
    },
  });

  // Configuração
  const { data: config, isLoading: configLoading } = useQuery<FootballConfig>({
    queryKey: ['footballConfig', selectedServerId],
    queryFn: async () => {
      if (!selectedServerId) return null;
      try {
        const response = await api.get(`/football/config/${selectedServerId}`);
        return response.data;
      } catch (error: any) {
        if (error.response?.status === 404) return null;
        throw error;
      }
    },
    enabled: !!selectedServerId,
  });

  // Canais cadastrados
  const { data: footballChannels = [], isLoading: channelsLoading } = useQuery<FootballChannel[]>({
    queryKey: ['footballChannels', selectedServerId],
    queryFn: async () => {
      if (!selectedServerId) return [];
      const response = await api.get(`/football/channels/${selectedServerId}`);
      return response.data || [];
    },
    enabled: !!selectedServerId,
  });

  // Jogos do dia
  const { data: dailyMatches = [], isLoading: matchesLoading } = useQuery<DailyMatch[]>({
    queryKey: ['dailyMatches', selectedServerId, filterDateRange],
    queryFn: async () => {
      if (!selectedServerId) return [];
      const response = await api.get(`/football/matches/${selectedServerId}`, {
        params: { dateRange: filterDateRange }
      });
      return response.data || [];
    },
    enabled: !!selectedServerId,
  });

  // Categorias XUI (buscar do banco MySQL do XUI)
  const { data: xuiCategories = [], refetch: refetchCategories } = useQuery<XuiCategory[]>({
    queryKey: ['xuiCategories', selectedServerId],
    queryFn: async () => {
      if (!selectedServerId) return [];
      try {
        const response = await api.get(`/football/xui-categories/${selectedServerId}`);
        return response.data || [];
      } catch (error: any) {
        console.error('Erro ao carregar categorias XUI:', error);
        return [];
      }
    },
    enabled: !!selectedServerId,
  });

  // Bouquets (para adicionar streams)
  const { data: bouquets = [] } = useQuery<{ id: string; externalId: string; name: string }[]>({
    queryKey: ['footballBouquets', selectedServerId],
    queryFn: async () => {
      if (!selectedServerId) return [];
      const response = await api.get(`/football/bouquets/${selectedServerId}`);
      return response.data || [];
    },
    enabled: !!selectedServerId,
  });

  // Competições disponíveis
  const { data: competitions = [] } = useQuery<Competition[]>({
    queryKey: ['footballCompetitions'],
    queryFn: async () => {
      const response = await api.get('/football/competitions');
      return response.data || [];
    },
  });

  // ============================================
  // MUTATIONS
  // ============================================

  const saveConfigMutation = useMutation({
    mutationFn: async (data: FootballConfig) => {
      const response = await api.put(`/football/config/${selectedServerId}`, data);
      return response.data;
    },
    onSuccess: () => {
      toast.success('Configuração salva!');
      queryClient.invalidateQueries({ queryKey: ['footballConfig'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Erro ao salvar');
    },
  });

  const addChannelMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await api.post(`/football/channels/${selectedServerId}`, data);
      return response.data;
    },
    onSuccess: () => {
      toast.success('Canal cadastrado!');
      queryClient.invalidateQueries({ queryKey: ['footballChannels'] });
      setShowAddChannelModal(false);
      setSelectedCategoryId(null);
      setCategoryChannels([]);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Erro ao cadastrar');
    },
  });

  const deleteChannelMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await api.delete(`/football/channels/${id}`);
      return response.data;
    },
    onSuccess: () => {
      toast.success('Canal removido!');
      queryClient.invalidateQueries({ queryKey: ['footballChannels'] });
    },
  });

  const updateMatchesMutation = useMutation({
    mutationFn: async (params?: { dateRange?: string }) => {
      try {
        // Timeout maior para atualização de jogos (pode levar 60-90s com muitas ligas)
        const response = await api.post(`/football/matches/${selectedServerId}/update`, {
          dateRange: params?.dateRange || 'today'
        }, {
          timeout: 120000 // 2 minutos
        });
        console.log('✅ Resposta da API:', response.data);
        return response.data;
      } catch (error: any) {
        console.error('❌ Erro na mutation:', error);
        console.error('Response error:', error.response?.data);
        throw error;
      }
    },
    onSuccess: (data) => {
      console.log('✅ onSuccess chamado com:', data);
      const total = data?.total ?? data?.total ?? 0;
      const mapped = data?.mapped ?? 0;
      toast.success(`${total} jogos encontrados, ${mapped} mapeados!`);
      queryClient.invalidateQueries({ queryKey: ['dailyMatches'] });
    },
    onError: (error: any) => {
      console.error('❌ onError chamado:', error);
      console.error('Error response:', error.response);
      const errorMessage = error.response?.data?.message || error.response?.data?.error || error.message || 'Erro ao atualizar';
      toast.error(errorMessage);
    },
  });

  const mapChannelMutation = useMutation({
    mutationFn: async ({ matchId, channelId }: { matchId: number; channelId: number }) => {
      const response = await api.post(`/football/matches/${matchId}/map`, { channelId });
      return response.data;
    },
    onSuccess: () => {
      toast.success('Canal mapeado!');
      queryClient.invalidateQueries({ queryKey: ['dailyMatches'] });
      setShowMapModal(false);
    },
  });

  const deleteMatchMutation = useMutation({
    mutationFn: async (matchId: number) => {
      const response = await api.delete(`/football/matches/${matchId}`);
      return response.data;
    },
    onSuccess: () => {
      toast.success('Jogo deletado!');
      queryClient.invalidateQueries({ queryKey: ['dailyMatches'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Erro ao deletar jogo');
    },
  });

  const updateMatchMutation = useMutation({
    mutationFn: async ({ matchId, data }: { matchId: number; data: { matchTime?: string; homeTeam?: string; awayTeam?: string; matchDate?: string } }) => {
      const response = await api.patch(`/football/matches/${matchId}`, data);
      return response.data;
    },
    onSuccess: () => {
      toast.success('Jogo atualizado!');
      queryClient.invalidateQueries({ queryKey: ['dailyMatches'] });
      setShowEditModal(false);
      setSelectedMatch(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Erro ao atualizar jogo');
    },
  });

  // Criar categoria no XUI
  const createCategoryMutation = useMutation({
    mutationFn: async (categoryName: string) => {
      if (!selectedServerId) throw new Error('Selecione um servidor XUI');
      const response = await api.post(`/football/create-category/${selectedServerId}`, {
        categoryName: categoryName || '⚽ JOGOS DO DIA'
      });
      return response.data;
    },
    onSuccess: (data) => {
      toast.success(data.message || 'Categoria criada com sucesso!');
      // Atualizar lista de categorias
      refetchCategories();
      // Se retornou categoryId, selecionar automaticamente
      if (data.categoryId && config) {
        saveConfigMutation.mutate({
          ...config,
          xuiCategoryId: data.categoryId
        });
      }
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.message || error.response?.data?.error || error.message || 'Erro ao criar categoria';
      toast.error(errorMsg);
      console.error('Erro ao criar categoria:', error);
    },
  });

  // Descoberta de ligas
  const discoverLeaguesMutation = useMutation({
    mutationFn: async () => {
      const response = await api.get('/football/discover-leagues');
      return response.data;
    },
    onSuccess: (data) => {
      setAvailableLeagues(data.leagues || []);
      setShowLeaguesModal(true);
      toast.success(`${data.total} ligas encontradas!`);
    },
    onError: (error: any) => {
      toast.error('Erro ao descobrir ligas');
    },
  });

  // Importação por liga específica
  const importLeagueMutation = useMutation({
    mutationFn: async (leagueId: string) => {
      const response = await api.post(`/football/${selectedServerId}/import-league/${leagueId}`);
      return response.data;
    },
    onSuccess: (data) => {
      toast.success(`${data.imported} jogos importados de ${data.leagueName || 'liga'}!`);
      queryClient.invalidateQueries({ queryKey: ['dailyMatches'] });
      setSelectedLeagueImport('');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Erro ao importar liga');
    },
  });

  // ============================================
  // HANDLERS
  // ============================================

  const loadCategoryChannels = async (categoryId: number) => {
    try {
      const response = await api.get(`/football/xui-channels/${selectedServerId}/${categoryId}`);
      setCategoryChannels(response.data || []);
    } catch (error) {
      toast.error('Erro ao carregar canais');
      setCategoryChannels([]);
    }
  };

  const getScoreColor = (score: number | null | undefined) => {
    if (!score) return 'text-gray-500';
    if (score >= 0.9) return 'text-green-400';
    if (score >= 0.7) return 'text-yellow-400';
    return 'text-orange-400';
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'LIVE':
      case '1H':
      case '2H':
      case 'HT':
        return (
          <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded-full text-xs font-bold animate-pulse">
            🔴 AO VIVO
          </span>
        );
      case 'FT':
      case 'AET':
      case 'PEN':
        return (
          <span className="px-2 py-1 bg-gray-500/20 text-gray-400 rounded-full text-xs">
            ✓ FINALIZADO
          </span>
        );
      default:
        return (
          <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded-full text-xs">
            ⏰ AGENDADO
          </span>
        );
    }
  };

  // Definir servidor quando carregar configuração
  useEffect(() => {
    if (config?.serverId && !selectedServerId) {
      setSelectedServerId(config.serverId);
    }
  }, [config, selectedServerId]);

  // Carregar competições selecionadas quando config carregar
  useEffect(() => {
    if (config?.enabledLeagues) {
      try {
        const leagues = JSON.parse(config.enabledLeagues);
        setSelectedCompetitions(Array.isArray(leagues) ? leagues : []);
      } catch (e) {
        setSelectedCompetitions([]);
      }
    } else {
      setSelectedCompetitions([]);
    }
  }, [config]);

  // Stats calculados
  const stats = {
    total: dailyMatches.length,
    mapped: dailyMatches.filter(m => m.mappedChannelId).length,
    unmapped: dailyMatches.filter(m => !m.mappedChannelId).length,
    live: dailyMatches.filter(m => ['LIVE', '1H', '2H', 'HT'].includes(m.status)).length,
  };

  // ============================================
  // RENDER
  // ============================================

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-gray-900 dark:text-white p-4 sm:p-6 overflow-x-hidden">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 sm:gap-3 mb-2">
          <span className="text-3xl sm:text-4xl">⚽</span>
          <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
            Jogos do Dia
          </h1>
        </div>
        <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">Gerencie jogos de futebol e mapeie canais automaticamente</p>
      </div>

      {/* Servidor Selector */}
      <div className="mb-4 sm:mb-6">
        <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Servidor XUI</label>
        <select
          value={selectedServerId}
          onChange={(e) => setSelectedServerId(e.target.value)}
          className="bg-gray-100 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 rounded-lg px-3 sm:px-4 py-2 text-gray-900 dark:text-white w-full sm:w-64 text-sm"
        >
          <option value="">Selecione um servidor</option>
          {xuiServers?.map(server => (
            <option key={server.id} value={server.id}>{server.name}</option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 sm:gap-2 mb-4 sm:mb-6 border-b border-gray-200 dark:border-zinc-700 pb-3 sm:pb-4 overflow-x-auto">
        {[
          { id: 'jogos', label: '⚽ Jogos', count: stats.total },
          { id: 'canais', label: '📺 Canais', count: footballChannels.length },
          { id: 'config', label: '⚙️ Configuração', count: null },
          { id: 'fluxo', label: '🔄 Como Funciona', count: null },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg text-sm sm:text-base font-medium transition-all flex items-center gap-1 sm:gap-2 whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-cyan-500/20 dark:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-500/50'
                : 'bg-gray-100 dark:bg-zinc-800/50 text-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-zinc-700/50 border border-transparent'
            }`}
          >
            {tab.label}
            {tab.count !== null && (
              <span className={`px-2 py-0.5 rounded-full text-xs ${
                activeTab === tab.id ? 'bg-cyan-500/30' : 'bg-gray-700'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ============================================ */}
      {/* TAB: JOGOS */}
      {/* ============================================ */}
      {activeTab === 'jogos' && (
        <div>
          {/* Actions */}
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 sm:gap-0 mb-4 sm:mb-6">
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <select 
                value={filterCompetition}
                onChange={(e) => setFilterCompetition(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                className="bg-gray-100 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 rounded-lg px-3 sm:px-4 py-2 text-sm text-gray-900 dark:text-white w-full sm:w-auto"
              >
                <option value="all">Todas as Competições</option>
                {competitions
                  .filter(comp => selectedCompetitions.includes(comp.id))
                  .map(comp => (
                    <option key={comp.id} value={comp.id}>{comp.name}</option>
                  ))}
              </select>
              <select 
                value={filterDateRange}
                onChange={(e) => setFilterDateRange(e.target.value as any)}
                className="bg-gray-100 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 rounded-lg px-3 sm:px-4 py-2 text-sm text-gray-900 dark:text-white w-full sm:w-auto"
              >
                <option value="today">Hoje</option>
                <option value="tomorrow">Amanhã</option>
                <option value="next3days">Próximos 3 dias</option>
              </select>
              {/* Importar liga específica */}
              <div className="flex items-center gap-2">
                <select
                  value={selectedLeagueImport}
                  onChange={(e) => setSelectedLeagueImport(e.target.value)}
                  className="bg-gray-100 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white w-full sm:w-auto"
                >
                  <option value="">📥 Importar liga específica...</option>
                  {competitions
                    .filter(comp => selectedCompetitions.includes(comp.id))
                    .map(comp => (
                      <option key={comp.id} value={comp.id}>{comp.name}</option>
                    ))}
                </select>
                
                {selectedLeagueImport && (
                  <button
                    onClick={() => importLeagueMutation.mutate(selectedLeagueImport)}
                    disabled={importLeagueMutation.isPending}
                    className="px-4 py-2 bg-purple-500/20 text-purple-400 rounded-lg text-sm hover:bg-purple-500/30 border border-purple-500/30"
                  >
                    {importLeagueMutation.isPending ? '⏳...' : '📥 Importar'}
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => discoverLeaguesMutation.mutate()}
                disabled={discoverLeaguesMutation.isPending}
                className="px-4 py-2 bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg text-sm hover:bg-green-500/30 transition flex items-center justify-center gap-2"
              >
                {discoverLeaguesMutation.isPending ? (
                  <>🔍 Buscando...</>
                ) : (
                  <>🔍 Descobrir Ligas Brasileiras</>
                )}
              </button>
              <button
                onClick={() => updateMatchesMutation.mutate({ dateRange: filterDateRange })}
                disabled={updateMatchesMutation.isPending || !selectedServerId}
                className="flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-500 to-blue-500 px-3 sm:px-4 py-2 rounded-lg text-sm sm:text-base font-medium hover:opacity-90 transition disabled:opacity-50 text-white w-full sm:w-auto"
              >
                {updateMatchesMutation.isPending ? '⏳ Atualizando...' : '🔄 Atualizar Jogos'}
              </button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 mb-4 sm:mb-6">
            {[
              { label: 'Total de Jogos', value: stats.total, icon: '⚽', color: 'cyan' },
              { label: 'Mapeados', value: stats.mapped, icon: '✅', color: 'green' },
              { label: 'Sem Canal', value: stats.unmapped, icon: '⚠️', color: 'orange' },
              { label: 'Ao Vivo', value: stats.live, icon: '🔴', color: 'red' },
            ].map((stat, i) => (
              <div key={i} className="bg-gray-50 dark:bg-zinc-900 rounded-xl p-3 sm:p-4 border border-gray-200 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <span className="text-xl sm:text-2xl">{stat.icon}</span>
                  <span className={`text-2xl sm:text-3xl font-bold text-${stat.color}-400`}>{stat.value}</span>
                </div>
                <p className="text-gray-600 dark:text-gray-400 text-xs sm:text-sm mt-1 sm:mt-2">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Matches List */}
          {!selectedServerId ? (
            <div className="text-center py-12 text-gray-500">
              Selecione um servidor XUI acima
            </div>
          ) : matchesLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin text-4xl">⚽</div>
              <p className="text-gray-400 mt-2">Carregando jogos...</p>
            </div>
          ) : dailyMatches.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800">
              <span className="text-5xl">📭</span>
              <p className="text-gray-400 mt-4">Nenhum jogo encontrado</p>
              <p className="text-gray-500 text-sm mt-2">Clique em "Atualizar Jogos" para buscar</p>
            </div>
          ) : (
            <div className="space-y-3">
              {dailyMatches
                .filter(match => {
                  // Filtro por competição
                  if (filterCompetition !== 'all') {
                    return match.leagueId === filterCompetition;
                  }
                  return true;
                })
                .map(match => {
                const apiChannels = match.apiChannels ? JSON.parse(match.apiChannels) : [];
                return (
                  <div
                    key={match.id}
                    className={`bg-gray-50 dark:bg-zinc-900 rounded-xl p-3 sm:p-4 border transition-all hover:border-cyan-500/30 ${
                      ['LIVE', '1H', '2H', 'HT'].includes(match.status) ? 'border-red-500/50' : 'border-gray-200 dark:border-zinc-800'
                    }`}
                  >
                    {/* Mobile Layout */}
                    <div className="flex flex-col sm:hidden gap-3">
                      {/* Header: Time, Status, League */}
                      <div className="flex items-center justify-between">
                        <div className="text-center">
                          <div className="text-xl font-bold text-gray-900 dark:text-white">{match.matchTime}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{match.leagueName?.split(' ')[0]}</div>
                        </div>
                        <div>{getStatusBadge(match.status)}</div>
                      </div>
                      
                      {/* Teams */}
                      <div className="flex items-center justify-center gap-2">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          {match.homeTeamLogo && (
                            <img src={match.homeTeamLogo} alt="" className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0" />
                          )}
                          <span className="font-medium text-sm truncate">{match.homeTeam}</span>
                        </div>
                        <span className="text-gray-500 dark:text-gray-400 font-bold text-xs">VS</span>
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          {match.awayTeamLogo && (
                            <img src={match.awayTeamLogo} alt="" className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0" />
                          )}
                          <span className="font-medium text-sm truncate">{match.awayTeam}</span>
                        </div>
                      </div>

                      {/* Channel Mapping */}
                      <div className="flex flex-col gap-2 pt-2 border-t border-gray-200 dark:border-zinc-700">
                        {apiChannels.length > 0 && (
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <div className="text-xs text-gray-600 dark:text-gray-400">Canais sugeridos:</div>
                              {/* Badge da Fonte da API */}
                              {match.source && (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  match.source === 'GE' 
                                    ? 'bg-green-500/20 text-green-600 dark:text-green-400 border border-green-500/30' 
                                    : 'bg-gray-500/20 text-gray-600 dark:text-gray-400 border border-gray-500/30'
                                }`}>
                                  {match.source === 'GE' ? '✅ GE' : '⚠️ Genérico'}
                                </span>
                              )}
                            </div>
                            <div className="flex gap-1 flex-wrap">
                              {apiChannels.slice(0, 3).map((ch: string, i: number) => (
                                <button
                                  key={i}
                                  onClick={() => {
                                    setSelectedMatch(match);
                                    setShowMapModal(true);
                                  }}
                                  className="px-2 py-0.5 bg-cyan-500/20 dark:bg-cyan-600/20 rounded text-xs text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/30 dark:hover:bg-cyan-600/30 transition cursor-pointer border border-cyan-500/30"
                                >
                                  {ch}
                                </button>
                              ))}
                              {apiChannels.length > 3 && (
                                <button
                                  onClick={() => {
                                    setSelectedMatch(match);
                                    setShowMapModal(true);
                                  }}
                                  className="px-2 py-0.5 bg-gray-300/40 dark:bg-zinc-700/50 rounded text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-300/60 dark:hover:bg-zinc-700/70 transition cursor-pointer"
                                >
                                  +{apiChannels.length - 3}
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                        {match.mappedChannelId ? (
                          <div className="flex items-center gap-2">
                            <span className="text-green-400">✓</span>
                            <span className="font-medium text-sm text-cyan-600 dark:text-cyan-400">{match.mappedChannelName}</span>
                            {match.xuiStreamId && (
                              <span className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-xs ml-auto">
                                📺 OK
                              </span>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setSelectedMatch(match);
                              setShowMapModal(true);
                            }}
                            className="w-full px-3 py-2 bg-orange-500/20 text-orange-600 dark:text-orange-400 rounded-lg text-sm hover:bg-orange-500/30 transition border border-orange-500/30"
                          >
                            ⚠️ Mapear Canal
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Desktop Layout */}
                    <div className="hidden sm:flex items-center justify-between">
                      {/* Left: Match Info */}
                      <div className="flex items-center gap-4 lg:gap-6 flex-1 min-w-0">
                        {/* Time & League */}
                        <div className="text-center w-16 lg:w-20 flex-shrink-0">
                          <div className="text-xl lg:text-2xl font-bold text-gray-900 dark:text-white">{match.matchTime}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{match.leagueName?.split(' ')[0]}</div>
                        </div>

                        {/* Teams */}
                        <div className="flex items-center gap-2 lg:gap-4 flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 lg:gap-2 flex-1 min-w-0">
                            {match.homeTeamLogo && (
                              <img src={match.homeTeamLogo} alt="" className="w-6 h-6 lg:w-8 lg:h-8 object-contain flex-shrink-0" />
                            )}
                            <span className="font-medium text-sm lg:text-base truncate">{match.homeTeam}</span>
                          </div>
                          <span className="text-gray-500 dark:text-gray-400 font-bold text-xs lg:text-sm flex-shrink-0">VS</span>
                          <div className="flex items-center gap-1.5 lg:gap-2 flex-1 min-w-0">
                            {match.awayTeamLogo && (
                              <img src={match.awayTeamLogo} alt="" className="w-6 h-6 lg:w-8 lg:h-8 object-contain flex-shrink-0" />
                            )}
                            <span className="font-medium text-sm lg:text-base truncate">{match.awayTeam}</span>
                          </div>
                        </div>

                        {/* Status */}
                        <div className="flex-shrink-0">
                          {getStatusBadge(match.status)}
                        </div>
                      </div>

                      {/* Right: Channel Mapping */}
                      <div className="flex items-center gap-3 lg:gap-4 ml-4">
                        {/* API Channels */}
                        {apiChannels.length > 0 && (
                          <>
                            <div className="text-right hidden lg:block">
                              <div className="flex items-center justify-end gap-2 mb-1">
                                <div className="text-xs text-gray-600 dark:text-gray-400">Canais:</div>
                                {/* Badge da Fonte da API */}
                                {match.source && (
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    match.source === 'GE' 
                                      ? 'bg-green-500/20 text-green-600 dark:text-green-400 border border-green-500/30' 
                                      : 'bg-gray-500/20 text-gray-600 dark:text-gray-400 border border-gray-500/30'
                                  }`}>
                                    {match.source === 'GE' ? '✅ GE' : '⚠️ Genérico'}
                                  </span>
                                )}
                              </div>
                              <div className="flex gap-1 justify-end flex-wrap max-w-32">
                                {apiChannels.slice(0, 2).map((ch: string, i: number) => (
                                  <button
                                    key={i}
                                    onClick={() => {
                                      setSelectedMatch(match);
                                      setShowMapModal(true);
                                    }}
                                    className="px-2 py-0.5 bg-cyan-500/20 dark:bg-cyan-600/20 rounded text-xs text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/30 dark:hover:bg-cyan-600/30 transition cursor-pointer border border-cyan-500/30"
                                  >
                                    {ch}
                                  </button>
                                ))}
                                {apiChannels.length > 2 && (
                                  <button
                                    onClick={() => {
                                      setSelectedMatch(match);
                                      setShowMapModal(true);
                                    }}
                                    className="px-2 py-0.5 bg-gray-300/40 dark:bg-zinc-700/50 rounded text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-300/60 dark:hover:bg-zinc-700/70 transition cursor-pointer"
                                  >
                                    +{apiChannels.length - 2}
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="text-gray-500 dark:text-gray-400 hidden lg:block">→</div>
                          </>
                        )}

                        {/* Mapped Channel */}
                        <div className="w-32 lg:w-40">
                          {match.mappedChannelId ? (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1">
                                  <span className="text-green-400 flex-shrink-0">✓</span>
                                  <span className="font-medium text-sm text-cyan-600 dark:text-cyan-400 truncate">{match.mappedChannelName}</span>
                                </div>
                                <div className={`text-xs ${getScoreColor(match.matchScore)}`}>
                                  {match.matchScore ? (match.matchScore * 100).toFixed(0) : 0}%
                                </div>
                              </div>
                              {match.xuiStreamId && (
                                <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded text-xs flex-shrink-0">
                                  📺
                                </span>
                              )}
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setSelectedMatch(match);
                                setShowMapModal(true);
                              }}
                              className="w-full px-2 py-1.5 lg:px-3 lg:py-2 bg-orange-500/20 text-orange-600 dark:text-orange-400 rounded-lg text-xs lg:text-sm hover:bg-orange-500/30 transition border border-orange-500/30 whitespace-nowrap"
                            >
                              ⚠️ Mapear
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ============================================ */}
      {/* TAB: CANAIS */}
      {/* ============================================ */}
      {activeTab === 'canais' && (
        <div>
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 sm:gap-0 mb-4 sm:mb-6">
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">Canais de Futebol Cadastrados</h2>
              <p className="text-gray-600 dark:text-gray-400 text-xs sm:text-sm">Canais do XUI que serão usados no matching automático</p>
            </div>
            <button
              onClick={() => setShowAddChannelModal(true)}
              disabled={!selectedServerId}
              className="flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-500 to-blue-500 px-3 sm:px-4 py-2 rounded-lg text-sm sm:text-base font-medium hover:opacity-90 transition disabled:opacity-50 text-white w-full sm:w-auto"
            >
              + Adicionar Canal
            </button>
          </div>

          {!selectedServerId ? (
            <div className="text-center py-12 text-gray-500">
              Selecione um servidor XUI acima
            </div>
          ) : channelsLoading ? (
            <div className="text-center py-12">Carregando...</div>
          ) : footballChannels.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800">
              <span className="text-5xl">📺</span>
              <p className="text-gray-400 mt-4">Nenhum canal cadastrado</p>
              <p className="text-gray-500 text-sm mt-2">Clique em "+ Adicionar Canal" para começar</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {footballChannels.map(channel => {
                const keywords = JSON.parse(channel.keywords || '[]');
                const customKw = channel.customKeywords ? JSON.parse(channel.customKeywords) : [];
                return (
                  <div key={channel.id} className="bg-gray-50 dark:bg-zinc-900 rounded-xl p-3 sm:p-4 border border-gray-200 dark:border-zinc-800 hover:border-cyan-500/30 transition">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-cyan-500/20 rounded-lg flex items-center justify-center">
                          📺
                        </div>
                        <div>
                          <h3 className="font-bold text-cyan-400">{channel.xuiStreamName}</h3>
                          <p className="text-xs text-gray-500">Stream ID: {channel.xuiStreamId}</p>
                        </div>
                      </div>
                      <div className={`w-3 h-3 rounded-full ${channel.isActive ? 'bg-green-400' : 'bg-gray-500'}`} />
                    </div>

                    {/* Keywords */}
                    <div className="mb-3">
                      <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Keywords:</div>
                      <div className="flex flex-wrap gap-1">
                        {keywords.map((kw: string, i: number) => (
                          <span key={i} className="px-2 py-0.5 bg-gray-200 dark:bg-zinc-700/50 rounded text-xs text-gray-700 dark:text-gray-300">
                            {kw}
                          </span>
                        ))}
                        {customKw.map((kw: string, i: number) => (
                          <span key={`c${i}`} className="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded text-xs">
                            {kw}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between pt-3 border-t border-gray-200 dark:border-zinc-800">
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        Prioridade: <span className="text-cyan-600 dark:text-cyan-400">{channel.priority}</span>
                      </div>
                      <button
                        onClick={() => {
                          if (confirm('Remover este canal?')) {
                            deleteChannelMutation.mutate(channel.id);
                          }
                        }}
                        className="px-3 py-1 bg-red-500/20 dark:bg-red-500/20 text-red-600 dark:text-red-400 rounded text-sm hover:bg-red-500/30 transition"
                      >
                        🗑️ Remover
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ============================================ */}
      {/* TAB: CONFIGURAÇÃO */}
      {/* ============================================ */}
      {activeTab === 'config' && (
        <div className="max-w-2xl w-full">
          <div className="bg-gray-50 dark:bg-zinc-900 rounded-xl p-4 sm:p-6 border border-gray-200 dark:border-zinc-800">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
              <span>⚙️</span> Configuração
            </h2>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                saveConfigMutation.mutate({
                  categoryName: form.get('categoryName') as string || '⚽ JOGOS DO DIA',
                  xuiCategoryId: form.get('xuiCategoryId') ? parseInt(form.get('xuiCategoryId') as string) : undefined,
                  bouquetId: form.get('bouquetId') ? parseInt(form.get('bouquetId') as string) : undefined,
                  timeOffsetMinutes: form.get('timeOffsetMinutes') ? parseInt(form.get('timeOffsetMinutes') as string) : undefined,
                  autoUpdate: form.get('autoUpdate') === 'on',
                  updateSchedule: form.get('updateSchedule') as string || '0 6 * * *',
                  generateBanners: form.get('generateBanners') === 'on',
                  apiFootballKey: form.get('apiFootballKey') as string || undefined,
                  enabledLeagues: JSON.stringify(selectedCompetitions),
                });
              }}
              className="space-y-6"
            >
              {/* Categoria XUI */}
              <div>
                <label className="block text-sm font-medium mb-2">Categoria no XUI</label>
                <div className="space-y-2">
                  <select
                    name="xuiCategoryId"
                    defaultValue={config?.xuiCategoryId?.toString() || ''}
                    className="w-full bg-gray-100 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 rounded-lg px-4 py-3 text-gray-900 dark:text-white"
                  >
                    <option value="">Selecione uma categoria</option>
                    {xuiCategories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.category_name}</option>
                    ))}
                  </select>
                  {/* Botão para criar categoria se não existir */}
                  {xuiCategories.length > 0 && !xuiCategories.some(cat => 
                    cat.category_name.toLowerCase().includes('jogos') || 
                    cat.category_name.includes('⚽')
                  ) && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm('Deseja criar a categoria "⚽ JOGOS DO DIA" no XUI?')) {
                          createCategoryMutation.mutate('⚽ JOGOS DO DIA');
                        }
                      }}
                      disabled={createCategoryMutation.isPending || !selectedServerId}
                      className="w-full px-4 py-2 bg-cyan-500/20 text-cyan-400 rounded-lg text-sm hover:bg-cyan-500/30 transition border border-cyan-500/30 disabled:opacity-50"
                    >
                      {createCategoryMutation.isPending ? '⏳ Criando...' : '➕ Criar Categoria "⚽ JOGOS DO DIA"'}
                    </button>
                  )}
                  {xuiCategories.length === 0 && selectedServerId && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm('Deseja criar a categoria "⚽ JOGOS DO DIA" no XUI?')) {
                          createCategoryMutation.mutate('⚽ JOGOS DO DIA');
                        }
                      }}
                      disabled={createCategoryMutation.isPending}
                      className="w-full px-4 py-2 bg-cyan-500/20 text-cyan-400 rounded-lg text-sm hover:bg-cyan-500/30 transition border border-cyan-500/30 disabled:opacity-50"
                    >
                      {createCategoryMutation.isPending ? '⏳ Criando...' : '➕ Criar Categoria "⚽ JOGOS DO DIA"'}
                    </button>
                  )}
                </div>
              </div>

              {/* Nome da Categoria */}
              <div>
                <label className="block text-sm font-medium mb-2">Nome da Categoria</label>
                <input
                  name="categoryName"
                  type="text"
                  defaultValue={config?.categoryName || '⚽ JOGOS DO DIA'}
                  className="w-full bg-gray-100 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 rounded-lg px-4 py-3 text-gray-900 dark:text-white"
                />
              </div>

              {/* Bouquet */}
              <div>
                <label className="block text-sm font-medium mb-2">Bouquet (onde os streams serão adicionados)</label>
                <select
                  name="bouquetId"
                  defaultValue={config?.bouquetId?.toString() || '1'}
                  className="w-full bg-gray-100 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 rounded-lg px-4 py-3 text-gray-900 dark:text-white"
                >
                  <option value="1">ID 1 (padrão)</option>
                  {bouquets.map(b => (
                    <option key={b.id} value={b.externalId}>
                      {b.name} (ID: {b.externalId})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  Se a lista estiver vazia, o painel ainda não sincronizou bouquets — você pode usar o ID manualmente (ex: 1).
                </p>
              </div>

              {/* Ajuste de horário */}
              <div>
                <label className="block text-sm font-medium mb-2">Ajuste de horário (minutos)</label>
                <input
                  name="timeOffsetMinutes"
                  type="number"
                  defaultValue={(config?.timeOffsetMinutes ?? 0).toString()}
                  className="w-full bg-gray-100 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 rounded-lg px-4 py-3 text-gray-900 dark:text-white"
                />
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  Use <strong>-120</strong> para subtrair 2 horas (caso o TheSportsDB esteja vindo adiantado). Padrão: 0.
                </p>
              </div>

              {/* API Key */}
              <div>
                <label className="block text-sm font-medium mb-2">API Key (RapidAPI)</label>
                <input
                  name="apiFootballKey"
                  type="password"
                  defaultValue={config?.apiFootballKey || ''}
                  placeholder="Sua chave RapidAPI"
                  className="w-full bg-gray-100 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 rounded-lg px-4 py-3 text-gray-900 dark:text-white"
                />
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  Obtenha em: rapidapi.com/api-sports/api/api-football
                </p>
              </div>

              {/* Competições */}
              <div>
                <label className="block text-sm font-medium mb-3">Competições para Buscar</label>
                <p className="text-xs text-gray-500 mb-3">
                  Selecione as competições que deseja buscar jogos na API
                </p>
                <div className="bg-gray-100 dark:bg-zinc-800/50 rounded-lg p-4 border border-gray-300 dark:border-zinc-700 max-h-64 overflow-y-auto">
                  {Object.entries(
                    competitions.reduce((acc, comp) => {
                      if (!acc[comp.category]) acc[comp.category] = [];
                      acc[comp.category].push(comp);
                      return acc;
                    }, {} as Record<string, Competition[]>)
                  ).map(([category, comps]) => (
                    <div key={category} className="mb-4 last:mb-0">
                      <h4 className="text-sm font-semibold text-cyan-400 mb-2">{category}</h4>
                      <div className="space-y-2">
                        {comps.map(comp => (
                          <label
                            key={comp.id}
                            className="flex items-center gap-2 cursor-pointer hover:bg-gray-700/30 p-2 rounded transition"
                          >
                            <input
                              type="checkbox"
                              checked={selectedCompetitions.includes(comp.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedCompetitions([...selectedCompetitions, comp.id]);
                                } else {
                                  setSelectedCompetitions(selectedCompetitions.filter(id => id !== comp.id));
                                }
                              }}
                              className="w-4 h-4 accent-cyan-500"
                            />
                            <span className="text-sm text-gray-700 dark:text-gray-300">{comp.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {selectedCompetitions.length === 0 && (
                  <p className="text-xs text-orange-400 mt-2">
                    ⚠️ Selecione pelo menos uma competição para buscar jogos
                  </p>
                )}
              </div>

              {/* Horário */}
              <div>
                <label className="block text-sm font-medium mb-2">Horário de Atualização (Cron)</label>
                <input
                  name="updateSchedule"
                  type="text"
                  defaultValue={config?.updateSchedule || '0 6 * * *'}
                  className="w-full bg-gray-100 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 rounded-lg px-4 py-3 text-gray-900 dark:text-white"
                />
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  Formato cron. Ex: "0 6 * * *" = todo dia às 6h
                </p>
              </div>

              {/* Toggles */}
              <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-zinc-700">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    name="autoUpdate"
                    type="checkbox"
                    defaultChecked={config?.autoUpdate !== false}
                    className="w-5 h-5 accent-cyan-500"
                  />
                  <span>Atualização Automática</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    name="generateBanners"
                    type="checkbox"
                    defaultChecked={config?.generateBanners !== false}
                    className="w-5 h-5 accent-cyan-500"
                  />
                  <span>Gerar Banners Automaticamente</span>
                </label>
              </div>

              {/* Buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  disabled={saveConfigMutation.isPending || !selectedServerId}
                  className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-500 py-3 rounded-lg font-medium hover:opacity-90 transition disabled:opacity-50"
                >
                  {saveConfigMutation.isPending ? 'Salvando...' : '💾 Salvar Configuração'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================ */}
      {/* TAB: COMO FUNCIONA */}
      {/* ============================================ */}
      {activeTab === 'fluxo' && (
        <div className="max-w-4xl w-full">
          <div className="bg-gray-50 dark:bg-zinc-900 rounded-xl p-4 sm:p-6 border border-gray-200 dark:border-zinc-800">
            <h2 className="text-xl font-bold mb-6">🔄 Como Funciona o Sistema</h2>

            <div className="space-y-6">
              {/* Steps */}
              {[
                {
                  num: '1️⃣',
                  colorClass: 'cyan',
                  title: 'Você Cadastra Canais do XUI',
                  desc: 'Adicione os canais do seu servidor XUI que transmitem futebol. O sistema gera keywords automaticamente.',
                  example: ['PREMIERE HD', 'SPORTV HD', 'ESPN BRASIL']
                },
                {
                  num: '2️⃣',
                  colorClass: 'blue',
                  title: 'Sistema Busca Jogos na API',
                  desc: 'A cada atualização, o sistema busca os jogos do dia na API-Football. Retorna: times, horário, competição.',
                  example: null
                },
                {
                  num: '3️⃣',
                  colorClass: 'purple',
                  title: 'Mapeamento por Competição',
                  desc: 'Cada competição tem canais pré-mapeados baseado nos direitos de transmissão do Brasil.',
                  example: null
                },
                {
                  num: '4️⃣',
                  colorClass: 'green',
                  title: 'Fuzzy Matching Automático',
                  desc: 'O sistema compara os canais da competição com seus canais XUI usando algoritmo de similaridade.',
                  example: null
                },
              ].map((step, i) => {
                const colorClasses = {
                  cyan: {
                    bg: 'bg-cyan-500/20',
                    text: 'text-cyan-600 dark:text-cyan-400',
                    textBadge: 'text-cyan-400'
                  },
                  blue: {
                    bg: 'bg-blue-500/20',
                    text: 'text-blue-600 dark:text-blue-400',
                    textBadge: 'text-blue-400'
                  },
                  purple: {
                    bg: 'bg-purple-500/20',
                    text: 'text-purple-600 dark:text-purple-400',
                    textBadge: 'text-purple-400'
                  },
                  green: {
                    bg: 'bg-green-500/20',
                    text: 'text-green-600 dark:text-green-400',
                    textBadge: 'text-green-400'
                  }
                };
                const colors = colorClasses[step.colorClass as keyof typeof colorClasses];
                return (
                  <div key={i}>
                    <div className="flex items-start gap-4">
                      <div className={`w-12 h-12 ${colors.bg} rounded-xl flex items-center justify-center text-2xl shrink-0`}>
                        {step.num}
                      </div>
                      <div className="flex-1 bg-gray-100 dark:bg-zinc-800/50 rounded-xl p-4">
                        <h3 className={`font-bold ${colors.text} mb-2`}>{step.title}</h3>
                        <p className="text-gray-600 dark:text-gray-400 text-sm mb-3">{step.desc}</p>
                        {step.example && (
                          <div className="flex gap-2">
                            {step.example.map((ex, j) => (
                              <span key={j} className={`px-3 py-1 ${colors.bg} ${colors.textBadge} rounded-lg text-sm`}>
                                {ex}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  {i < 3 && (
                    <div className="flex justify-center py-2">
                      <span className="text-2xl text-gray-400 dark:text-gray-600">↓</span>
                    </div>
                  )}
                  </div>
                );
              })}
            </div>

            {/* Learning Note */}
            <div className="mt-6 p-4 bg-blue-500/10 dark:bg-blue-500/10 border border-blue-500/30 dark:border-blue-500/30 rounded-xl">
              <h4 className="font-bold text-blue-600 dark:text-blue-400 mb-2">💡 Aprendizado Automático</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Quando você mapeia um canal manualmente, o sistema <strong>aprende</strong> essa associação.
                Na próxima vez que o mesmo canal aparecer, será mapeado automaticamente!
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ============================================ */}
      {/* MODAL: ADICIONAR CANAL */}
      {/* ============================================ */}
      {showAddChannelModal && (
        <div className="fixed inset-0 bg-black/70 dark:bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl p-4 sm:p-6 w-full max-w-[500px] border border-gray-200 dark:border-zinc-700 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold">Adicionar Canal de Futebol</h3>
              <button
                onClick={() => {
                  setShowAddChannelModal(false);
                  setSelectedCategoryId(null);
                  setCategoryChannels([]);
                }}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white text-2xl"
              >
                ×
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                const channelId = parseInt(form.get('xuiChannelId') as string);
                const channel = categoryChannels.find(c => c.id === channelId);
                if (!channel) {
                  toast.error('Selecione um canal');
                  return;
                }
                addChannelMutation.mutate({
                  xuiStreamId: channel.id,
                  xuiStreamName: channel.name,
                  streamUrl: channel.source?.[0] || undefined,
                  customKeywords: form.get('customKeywords') as string || undefined,
                });
              }}
              className="space-y-4"
            >
              {/* Categoria */}
              <div>
                <label className="block text-sm font-medium mb-2">Categoria XUI *</label>
                <div className="space-y-2">
                  <select
                    value={selectedCategoryId || ''}
                    onChange={(e) => {
                      const id = e.target.value ? parseInt(e.target.value) : null;
                      setSelectedCategoryId(id);
                      if (id) loadCategoryChannels(id);
                      else setCategoryChannels([]);
                    }}
                    className="w-full bg-gray-100 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 rounded-lg px-4 py-3 text-gray-900 dark:text-white"
                    required
                  >
                    <option value="">Selecione categoria</option>
                    {xuiCategories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.category_name}</option>
                    ))}
                  </select>
                  {/* Botão para criar categoria */}
                  {xuiCategories.length > 0 && !xuiCategories.some(cat => 
                    cat.category_name.toLowerCase().includes('jogos') || 
                    cat.category_name.includes('⚽')
                  ) && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm('Deseja criar a categoria "⚽ JOGOS DO DIA" no XUI?')) {
                          createCategoryMutation.mutate('⚽ JOGOS DO DIA');
                        }
                      }}
                      disabled={createCategoryMutation.isPending || !selectedServerId}
                      className="w-full px-4 py-2 bg-cyan-500/20 text-cyan-400 rounded-lg text-sm hover:bg-cyan-500/30 transition border border-cyan-500/30 disabled:opacity-50"
                    >
                      {createCategoryMutation.isPending ? '⏳ Criando...' : '➕ Criar Categoria "⚽ JOGOS DO DIA"'}
                    </button>
                  )}
                  {xuiCategories.length === 0 && selectedServerId && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm('Deseja criar a categoria "⚽ JOGOS DO DIA" no XUI?')) {
                          createCategoryMutation.mutate('⚽ JOGOS DO DIA');
                        }
                      }}
                      disabled={createCategoryMutation.isPending}
                      className="w-full px-4 py-2 bg-cyan-500/20 text-cyan-400 rounded-lg text-sm hover:bg-cyan-500/30 transition border border-cyan-500/30 disabled:opacity-50"
                    >
                      {createCategoryMutation.isPending ? '⏳ Criando...' : '➕ Criar Categoria "⚽ JOGOS DO DIA"'}
                    </button>
                  )}
                </div>
              </div>

              {/* Canal */}
              {selectedCategoryId && categoryChannels.length > 0 && (
                <div>
                  <label className="block text-sm font-medium mb-2">Canal XUI *</label>
                  <select
                    name="xuiChannelId"
                    className="w-full bg-gray-100 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 rounded-lg px-4 py-3 text-gray-900 dark:text-white"
                    required
                  >
                    <option value="">Selecione canal</option>
                    {categoryChannels.map(ch => (
                      <option key={ch.id} value={ch.id}>{ch.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {selectedCategoryId && categoryChannels.length === 0 && (
                <p className="text-sm text-gray-500">Nenhum canal encontrado nesta categoria</p>
              )}

              {/* Custom Keywords */}
              <div>
                <label className="block text-sm font-medium mb-2">Keywords Personalizadas (opcional)</label>
                <input
                  name="customKeywords"
                  type="text"
                  placeholder="Ex: premiere, globo (separados por vírgula)"
                  className="w-full bg-gray-100 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 rounded-lg px-4 py-3 text-gray-900 dark:text-white"
                />
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  O sistema já gera keywords automaticamente do nome
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddChannelModal(false);
                    setSelectedCategoryId(null);
                    setCategoryChannels([]);
                  }}
                  className="flex-1 py-3 bg-gray-200 dark:bg-zinc-700 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-zinc-600 transition text-gray-900 dark:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={addChannelMutation.isPending || !selectedCategoryId || categoryChannels.length === 0}
                  className="flex-1 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-lg font-medium hover:opacity-90 transition disabled:opacity-50"
                >
                  {addChannelMutation.isPending ? 'Cadastrando...' : '✓ Adicionar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================ */}
      {/* MODAL: MAPEAR CANAL */}
      {/* ============================================ */}
      {showMapModal && selectedMatch && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0f1629] rounded-2xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto border border-gray-700">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold">🗺️ Mapear Canal Manualmente</h3>
              <button onClick={() => setShowMapModal(false)} className="text-gray-500 hover:text-white text-2xl">×</button>
            </div>

            {/* Match Info */}
            <div className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/30 rounded-lg p-4 mb-6">
              <div className="flex items-center justify-center gap-4">
                {selectedMatch.homeTeamLogo && (
                  <img src={selectedMatch.homeTeamLogo} alt="" className="w-12 h-12 object-contain" />
                )}
                <div className="text-center">
                  <div className="flex items-center gap-2 justify-center">
                    <span className="font-bold text-lg">{selectedMatch.homeTeam}</span>
                    <span className="text-gray-400 font-bold">VS</span>
                    <span className="font-bold text-lg">{selectedMatch.awayTeam}</span>
                  </div>
                  <div className="text-sm text-gray-400 mt-1">
                    {selectedMatch.leagueName} • {selectedMatch.matchTime}
                  </div>
                </div>
                {selectedMatch.awayTeamLogo && (
                  <img src={selectedMatch.awayTeamLogo} alt="" className="w-12 h-12 object-contain" />
                )}
              </div>
            </div>

            {/* API Channels - Destaque Visual */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <label className="text-base font-bold text-cyan-400">📡 Canais Sugeridos pela API</label>
                {selectedMatch.source && (
                  <span className={`px-2 py-1 rounded text-xs font-bold ${
                    selectedMatch.source === 'GE' 
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                      : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                  }`}>
                    {selectedMatch.source === 'GE' ? '✅ API GE' : '⚠️ API Genérica'}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {(selectedMatch.apiChannels ? JSON.parse(selectedMatch.apiChannels) : []).map((ch: string, i: number) => (
                  <div
                    key={i}
                    className="bg-cyan-500/20 border border-cyan-500/40 rounded-lg px-4 py-3 text-center"
                  >
                    <div className="text-sm font-bold text-cyan-300">{ch}</div>
                  </div>
                ))}
              </div>
              {(selectedMatch.apiChannels ? JSON.parse(selectedMatch.apiChannels) : []).length === 0 && (
                <div className="text-center py-4 text-gray-500 bg-zinc-800/50 rounded-lg border border-zinc-700">
                  Nenhum canal sugerido pela API
                </div>
              )}
            </div>

            {/* All Available Channels */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                const channelId = parseInt(form.get('channelId') as string);
                if (channelId) {
                  mapChannelMutation.mutate({ matchId: selectedMatch.id, channelId });
                }
              }}
            >
              <div className="mb-6">
                <label className="block text-base font-bold text-orange-400 mb-3">📺 Todos os Canais XUI Disponíveis ({footballChannels.length})</label>
                <div className="bg-zinc-800/50 rounded-lg border border-zinc-700 p-4 max-h-64 overflow-y-auto">
                  <div className="space-y-2">
                    {footballChannels.map(ch => (
                      <label
                        key={ch.id}
                        className="flex items-center gap-3 p-3 bg-gray-100 dark:bg-zinc-800 rounded-lg hover:bg-cyan-500/10 hover:border-cyan-500/30 border border-transparent transition cursor-pointer"
                      >
                        <input
                          type="radio"
                          name="channelId"
                          value={ch.id}
                          className="w-4 h-4 accent-cyan-500"
                          required
                        />
                        <div className="flex-1">
                          <div className="font-medium text-sm text-gray-900 dark:text-white">{ch.xuiStreamName}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            Keywords: {ch.keywords || 'Sem keywords'}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                  {footballChannels.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      <div className="text-4xl mb-2">💭</div>
                      <p>Nenhum canal cadastrado</p>
                      <p className="text-sm mt-1">Vá para a aba "Canais" para adicionar</p>
                    </div>
                  )}
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-400 mb-4">
                <input type="checkbox" defaultChecked className="accent-cyan-500" />
                Lembrar este mapeamento para próximos jogos
              </label>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowMapModal(false)}
                  className="flex-1 py-3 bg-gray-200 dark:bg-zinc-700 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-zinc-600 transition text-gray-900 dark:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={mapChannelMutation.isPending}
                  className="flex-1 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-lg font-medium hover:opacity-90 transition disabled:opacity-50"
                >
                  {mapChannelMutation.isPending ? 'Mapeando...' : '✓ Mapear Canal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================ */}
      {/* MODAL: DESCOBRIR LIGAS */}
      {/* ============================================ */}
      {showLeaguesModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">🏆 Ligas Brasileiras no TheSportsDB</h3>
              <button onClick={() => setShowLeaguesModal(false)} className="text-gray-400 hover:text-white text-2xl">×</button>
            </div>
            
            <p className="text-sm text-gray-500 mb-4">
              Copie os IDs das ligas que deseja adicionar. Procure por "Copinha" ou "São Paulo".
            </p>
            
            <div className="flex-1 overflow-y-auto space-y-2">
              {availableLeagues.map((league) => (
                <div key={league.id} className="flex items-center justify-between p-3 bg-gray-100 dark:bg-zinc-800 rounded-lg">
                  <div className="flex items-center gap-3">
                    {league.logo && <img src={league.logo} alt="" className="w-8 h-8 object-contain" />}
                    <div>
                      <div className="font-medium">{league.name}</div>
                      <div className="text-xs text-gray-500">{league.season}</div>
                    </div>
                  </div>
                  <code className="bg-cyan-500/20 text-cyan-400 px-3 py-1 rounded font-bold">
                    {league.id}
                  </code>
                </div>
              ))}
            </div>
            
            <button onClick={() => setShowLeaguesModal(false)} className="mt-4 w-full py-2 bg-zinc-700 rounded-lg hover:bg-zinc-600">
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
