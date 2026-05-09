/**
 * Dashboard de VOD (Filmes e Séries)
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Spinner, Select } from '../../components/ui';
import { api } from '../../api/client';
import { Film, Tv, CheckCircle, AlertCircle, Radio } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui';

export function VODDashboardPage() {
  const navigate = useNavigate();
  const [selectedServerId, setSelectedServerId] = useState<string>('');

  // Buscar servidores XUI
  const { data: serversData } = useQuery({
    queryKey: ['servers'],
    queryFn: async () => {
      const res = await api.get('/servers');
      return res.data.data || [];
    },
  });

  // Selecionar servidor padrão (recuperar do localStorage ou usar o primeiro)
  useEffect(() => {
    if (Array.isArray(serversData) && serversData.length > 0 && !selectedServerId) {
      const savedServerId = localStorage.getItem('dashboard-selected-server');
      if (savedServerId && serversData.find((s: any) => s.id === savedServerId)) {
        setSelectedServerId(savedServerId);
      } else {
        setSelectedServerId(serversData[0].id);
      }
    }
  }, [serversData, selectedServerId]);

  // Salvar seleção no localStorage
  useEffect(() => {
    if (selectedServerId) {
      localStorage.setItem('dashboard-selected-server', selectedServerId);
    }
  }, [selectedServerId]);

  const { data: statsData, isLoading, refetch } = useQuery({
    queryKey: ['vod-stats', selectedServerId],
    queryFn: async () => {
      if (!selectedServerId) return null;
      const res = await api.get('/vod/stats', { params: { serverId: selectedServerId } });
      return res.data.data;
    },
    enabled: !!selectedServerId,
    refetchInterval: 60000, // Atualizar a cada 60s
  });

  // Nome do servidor selecionado
  const selectedServer = Array.isArray(serversData) 
    ? serversData.find((s: any) => s.id === selectedServerId)
    : null;

  // ⚠️ REMOVIDO: Sincronização completa não é mais necessária
  // As estatísticas são consultadas diretamente do XUI (sempre atualizado)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner size="lg" />
      </div>
    );
  }

  const stats = {
    total: statsData?.total || 0,
    movies: statsData?.movies || 0,
    series: statsData?.series || 0,
    channels: statsData?.channels || 0,
    withMetadata: statsData?.withMetadata || 0,
    withoutMetadata: statsData?.withoutMetadata || 0,
    moviesWithMetadata: statsData?.moviesWithMetadata || 0,
    moviesWithoutMetadata: statsData?.moviesWithoutMetadata || 0,
    seriesWithMetadata: statsData?.seriesWithMetadata || 0,
    seriesWithoutMetadata: statsData?.seriesWithoutMetadata || 0,
  };

  const statsCards: Array<{
    title: string;
    value: string;
    icon: any;
    color: string;
    bgColor: string;
    subtitle?: string;
    onClick?: () => void;
  }> = [
    {
      title: 'Canais (Live)',
      value: (stats.channels || 0).toLocaleString('pt-BR'),
      icon: Radio,
      color: 'text-red-500',
      bgColor: 'bg-red-50 dark:bg-red-500/10',
      subtitle: 'Transmissões ao vivo',
    },
    {
      title: 'Filmes',
      value: (stats.movies || 0).toLocaleString('pt-BR'),
      icon: Film,
      color: 'text-blue-500',
      bgColor: 'bg-blue-50 dark:bg-blue-500/10',
      subtitle: `${stats.moviesWithMetadata} com metadados`,
      onClick: () => navigate('/vod/items?vodType=movie'),
    },
    {
      title: 'Séries',
      value: (stats.series || 0).toLocaleString('pt-BR'),
      icon: Tv,
      color: 'text-purple-500',
      bgColor: 'bg-purple-50 dark:bg-purple-500/10',
      subtitle: `${stats.seriesWithMetadata || 0} com metadados`,
      onClick: () => navigate('/vod/items?vodType=series'),
    },
    {
      title: 'Total Filmes/Séries',
      value: (stats.total || 0).toLocaleString('pt-BR'),
      icon: CheckCircle,
      color: 'text-cyan-500',
      bgColor: 'bg-cyan-50 dark:bg-cyan-500/10',
      subtitle: 'Filmes + Séries',
      onClick: () => navigate('/vod/items'),
    },
    {
      title: 'Com Metadados TMDB',
      value: (stats.withMetadata || 0).toLocaleString('pt-BR'),
      subtitle: `${stats.total > 0 ? Math.round((stats.withMetadata / stats.total) * 100) : 0}% do total`,
      icon: CheckCircle,
      color: 'text-green-500',
      bgColor: 'bg-green-50 dark:bg-green-500/10',
    },
    {
      title: 'Sem Metadados',
      value: (stats.withoutMetadata || 0).toLocaleString('pt-BR'),
      subtitle: `${stats.total > 0 ? Math.round((stats.withoutMetadata / stats.total) * 100) : 0}% do total`,
      icon: AlertCircle,
      color: 'text-orange-500',
      bgColor: 'bg-orange-50 dark:bg-orange-500/10',
    },
  ];

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white">
            Dashboard Filmes e Séries
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            {selectedServer?.name 
              ? `Servidor: ${selectedServer.name}` 
              : 'Gerencie seu catálogo de Filmes e Séries'}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          {/* Seletor de Servidor */}
          <Select
            value={selectedServerId}
            onChange={(e) => setSelectedServerId(e.target.value)}
            className="min-w-[200px]"
          >
            <option value="">Selecione um servidor</option>
            {Array.isArray(serversData) && serversData.map((server: any) => (
              <option key={server.id} value={server.id}>
                {server.name}
              </option>
            ))}
          </Select>

        </div>
      </div>

      {/* Info: Dados sempre atualizados */}
      {selectedServer && (
        <Card className="p-4 bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30">
          <div className="flex items-center gap-3">
            <span className="text-blue-600 dark:text-blue-400 text-xl">🖥️</span>
            <div className="flex-1">
              <p className="font-semibold text-blue-900 dark:text-blue-100 text-sm">
                Servidor: <span className="font-bold">{selectedServer.name}</span>
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                Dados consultados diretamente do XUI. Atualização automática a cada 60 segundos.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Cards de Estatísticas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {statsCards.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <Card
              key={index}
              className={`p-6 ${stat.onClick ? 'cursor-pointer hover:shadow-lg transition-shadow' : ''} ${stat.bgColor}`}
              onClick={stat.onClick}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                    {stat.title}
                  </p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">
                    {stat.value}
                  </p>
                  {stat.subtitle && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {stat.subtitle}
                    </p>
                  )}
                </div>
                <Icon className={`w-8 h-8 ${stat.color}`} />
              </div>
            </Card>
          );
        })}
      </div>

      {/* Resumo Detalhado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Filmes */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Film className="w-5 h-5 text-blue-500" />
            Filmes
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-600 dark:text-gray-400">Total</span>
              <span className="font-semibold text-gray-900 dark:text-white">
                {(stats.movies || 0).toLocaleString('pt-BR')}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600 dark:text-gray-400">Com Metadados</span>
              <span className="font-semibold text-green-600 dark:text-green-400">
                {(stats.moviesWithMetadata || 0).toLocaleString('pt-BR')}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600 dark:text-gray-400">Sem Metadados</span>
              <span className="font-semibold text-orange-600 dark:text-orange-400">
                {(stats.moviesWithoutMetadata || 0).toLocaleString('pt-BR')}
              </span>
            </div>
          </div>
        </Card>

        {/* Séries */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Tv className="w-5 h-5 text-purple-500" />
            Séries
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-600 dark:text-gray-400">Total</span>
              <span className="font-semibold text-gray-900 dark:text-white">
                {(stats.series || 0).toLocaleString('pt-BR')}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600 dark:text-gray-400">Com Metadados</span>
              <span className="font-semibold text-green-600 dark:text-green-400">
                {(stats.seriesWithMetadata || 0).toLocaleString('pt-BR')}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600 dark:text-gray-400">Sem Metadados</span>
              <span className="font-semibold text-orange-600 dark:text-orange-400">
                {(stats.seriesWithoutMetadata || 0).toLocaleString('pt-BR')}
              </span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default VODDashboardPage;
