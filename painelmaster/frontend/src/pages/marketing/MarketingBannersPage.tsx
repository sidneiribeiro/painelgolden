import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Spinner, Badge } from '../../components/ui';
import { api } from '../../api/client';
import toast from 'react-hot-toast';
import { RefreshCw } from 'lucide-react';

interface GeneratedBanner {
  id: number;
  type: string;
  orientation: string;
  contentTitle: string;
  filePath: string;
  createdAt: string;
  sentToTelegram: boolean;
  sentToWhatsapp: boolean;
}

export default function MarketingBannersPage() {
  const queryClient = useQueryClient();
  const [selectedType, setSelectedType] = useState<string>('');
  const [selectedServerId, setSelectedServerId] = useState<string>('');
  // Mostrar apenas verticais por padrão (horizontais são usadas só para vídeo)
  const [selectedOrientation, setSelectedOrientation] = useState<string>('vertical');

  const { data: banners, isLoading } = useQuery<GeneratedBanner[]>({
    queryKey: ['marketingBanners', selectedType, selectedOrientation],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedType) params.append('type', selectedType);
      if (selectedOrientation) params.append('orientation', selectedOrientation);
      
      const response = await api.get(`/marketing/banners?${params.toString()}`);
      return response.data;
    },
    refetchInterval: 30000, // Atualizar a cada 30 segundos
  });

  const { data: videos } = useQuery({
    queryKey: ['marketingVideos'],
    queryFn: async () => {
      const response = await api.get('/marketing/videos');
      return response.data;
    },
    refetchInterval: 30000, // Atualizar a cada 30 segundos (mesmo intervalo de conteudosAtualizados)
  });

  const { data: conteudosAtualizados } = useQuery({
    queryKey: ['conteudosAtualizados'],
    queryFn: async () => {
      const response = await api.get('/marketing/conteudos-atualizados');
      return response.data;
    },
    refetchInterval: 30000, // Atualizar a cada 30 segundos
  });

  const { data: footballBanners } = useQuery({
    queryKey: ['footballBanners'],
    queryFn: async () => {
      const response = await api.get('/jogos-do-dia/banners');
      return response.data;
    },
    refetchInterval: 30000, // Atualizar a cada 30 segundos
  });

  // Buscar servidores XUI para o trigger manual
  const { data: serversData } = useQuery({
    queryKey: ['servers'],
    queryFn: async () => {
      const res = await api.get('/servers');
      return res.data.data || [];
    },
  });

  // Mutation para trigger manual de marketing
  const triggerMarketingMutation = useMutation({
    mutationFn: async () => {
      if (!selectedServerId) {
        throw new Error('Selecione um servidor XUI primeiro');
      }

      const response = await api.post('/marketing/manual-trigger', {
        xuiServerId: selectedServerId,
        streamServerId: 1, // ID do servidor de streaming
        bouquetId: 1, // Bouquet "All Channels"
      });
      return response.data;
    },
    onSuccess: (data) => {
      toast.success(data.message || 'Marketing executado com sucesso!');
      // Atualizar todas as queries relacionadas
      queryClient.invalidateQueries({ queryKey: ['marketingBanners'] });
      queryClient.invalidateQueries({ queryKey: ['marketingVideos'] });
      queryClient.invalidateQueries({ queryKey: ['conteudosAtualizados'] });
    },
    onError: (error: any) => {
      toast.error(`Erro ao executar marketing: ${error.response?.data?.error || error.message}`);
    },
  });

  const fileBase = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

  const getVideoUrl = (filePath: string) => {
    if (!filePath) return '';
    if (filePath.startsWith('/')) {
      return `${fileBase}${filePath}`;
    }
    return filePath;
  };

  const getBannerUrl = (banner: GeneratedBanner) => {
    if (banner.filePath.startsWith('/')) {
      return `${fileBase}${banner.filePath}`;
    }
    return banner.filePath;
  };

  const getFootballBannerUrl = (filePath: string) => {
    if (!filePath) return '';
    if (filePath.startsWith('/')) {
      return `${fileBase}${filePath}`;
    }
    if (filePath.startsWith('storage/')) {
      return `${fileBase}/${filePath}`;
    }
    return `${fileBase}/storage/banners/football/${filePath}`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6">
      {/* Header responsivo */}
      <div className="flex flex-col gap-4 mb-6 lg:flex-row lg:justify-between lg:items-center">
        <h1 className="text-2xl md:text-3xl font-bold">🎨 Banners e Vídeos</h1>
        
        {/* Controles de marketing - empilhados no mobile, lado a lado no desktop */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex flex-col flex-1 sm:min-w-[200px]">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Servidor XUI
            </label>
            <select
              value={selectedServerId}
              onChange={(e) => setSelectedServerId(e.target.value)}
              className="w-full px-3 py-2 text-sm md:text-base border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
            >
              <option value="">Selecione</option>
              {serversData?.map((server: any) => (
                <option key={server.id} value={server.id}>
                  {server.name}
                </option>
              ))}
            </select>
          </div>
          
          <Button
            onClick={() => triggerMarketingMutation.mutate()}
            disabled={triggerMarketingMutation.isPending || !selectedServerId}
            className="w-full sm:w-auto bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white text-sm md:text-base py-2 px-4"
          >
            {triggerMarketingMutation.isPending ? (
              <>
                <Spinner className="w-4 h-4 mr-2" />
                Gerando...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">Gerar Marketing Agora</span>
                <span className="sm:hidden">Gerar Agora</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <Card className="p-4 mb-6">
        <div className="flex gap-4 flex-wrap">
          <div>
            <label className="block text-sm font-medium mb-2 text-white">Tipo</label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            >
              <option value="">Todos</option>
              <option value="movie">Filmes</option>
              <option value="series">Séries</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-white">Orientação</label>
            <select
              value={selectedOrientation}
              onChange={(e) => setSelectedOrientation(e.target.value)}
              className="px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            >
              <option value="">Todas</option>
              <option value="vertical">Vertical (Stories)</option>
              <option value="horizontal">Horizontal (Vídeo)</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Banners */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">📸 Banners ({banners?.length || 0})</h2>
        
        {banners && banners.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {banners.map((banner) => (
              <Card key={banner.id} className="p-4">
                <div className="mb-4">
                  <img
                    src={getBannerUrl(banner)}
                    alt={banner.contentTitle}
                    className="w-full rounded-lg"
                    style={{
                      maxHeight: banner.orientation === 'vertical' ? '400px' : '200px',
                      objectFit: 'contain',
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <h3 className="font-semibold truncate">{banner.contentTitle}</h3>
                  <div className="flex gap-2 flex-wrap">
                    <Badge variant={banner.type === 'movie' ? 'success' : 'info'}>
                      {banner.type === 'movie' ? '🎬 Filme' : '📺 Série'}
                    </Badge>
                    <Badge variant="secondary">
                      {banner.orientation === 'vertical' ? '📱 Vertical' : '🖥️ Horizontal'}
                    </Badge>
                    {banner.sentToTelegram && (
                      <Badge variant="info">📢 Telegram</Badge>
                    )}
                    {banner.sentToWhatsapp && (
                      <Badge variant="success">📱 WhatsApp</Badge>
                    )}
                  </div>
                  <p className="text-sm text-gray-400">
                    {new Date(banner.createdAt).toLocaleString('pt-BR')}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        const url = getBannerUrl(banner);
                        window.open(url, '_blank');
                      }}
                    >
                      Ver
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const url = getBannerUrl(banner);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${banner.contentTitle}_${banner.orientation}.png`;
                        a.click();
                      }}
                    >
                      Download
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="p-8 text-center">
            <p className="text-gray-400">Nenhum banner gerado ainda.</p>
            <p className="text-sm text-gray-500 mt-2">
              Os banners serão gerados automaticamente após a próxima importação de VOD.
            </p>
          </Card>
        )}
      </div>

      {/* Banners de Jogos do Dia */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">⚽ Banners de Jogos do Dia ({footballBanners?.length || 0})</h2>
        
        {footballBanners && footballBanners.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {footballBanners.map((banner: any) => (
              <Card key={banner.id} className="p-4">
                <div className="mb-4">
                  <img
                    src={getFootballBannerUrl(banner.filePath)}
                    alt={`Banner com ${banner.matchCount} jogo(s)`}
                    className="w-full rounded-lg"
                    style={{
                      maxHeight: '400px',
                      objectFit: 'contain',
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <h3 className="font-semibold">⚽ Jogos do Dia</h3>
                  <div className="flex gap-2 flex-wrap">
                    <Badge variant="success">
                      ⚽ Futebol
                    </Badge>
                    <Badge variant="info">
                      {banner.matchCount} jogo{banner.matchCount > 1 ? 's' : ''}
                    </Badge>
                  </div>
                  <div className="text-sm text-gray-400 space-y-1">
                    {banner.matches && banner.matches.length > 0 && (
                      <div>
                        <p className="font-semibold mb-1">Jogos no banner:</p>
                        {banner.matches.slice(0, 3).map((match: any, idx: number) => (
                          <p key={idx} className="truncate">
                            {match.homeTeam} vs {match.awayTeam}
                          </p>
                        ))}
                        {banner.matches.length > 3 && (
                          <p className="text-gray-500">+{banner.matches.length - 3} mais...</p>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-gray-400">
                    {new Date(banner.createdAt).toLocaleString('pt-BR')}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        const url = getFootballBannerUrl(banner.filePath);
                        window.open(url, '_blank');
                      }}
                    >
                      Ver
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const url = getFootballBannerUrl(banner.filePath);
                        const a = document.createElement('a');
                        a.href = url;
                        const fileName = banner.filePath.split('/').pop() || `jogos_do_dia_${banner.id}.jpeg`;
                        a.download = fileName;
                        a.click();
                      }}
                    >
                      Download
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="p-8 text-center">
            <p className="text-gray-400">Nenhum banner de jogos do dia gerado ainda.</p>
            <p className="text-sm text-gray-500 mt-2">
              Os banners serão gerados automaticamente quando houver jogos do dia e a opção "Gerar Banners" estiver habilitada nas configurações.
            </p>
          </Card>
        )}
      </div>

      {/* Conteúdos Atualizados */}
      {conteudosAtualizados && conteudosAtualizados.success && (
        <div className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">📺 Conteúdos Atualizados</h2>
          <Card className="p-6">
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-2">Categoria no XUI</h3>
                <div className="flex items-center gap-2">
                  <Badge variant="info">{conteudosAtualizados.category?.name || 'Conteúdos Atualizados'}</Badge>
                  <span className="text-sm text-gray-400">ID: {conteudosAtualizados.category?.id}</span>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-2">Canais Criados ({conteudosAtualizados.channels?.length || 0})</h3>
                {conteudosAtualizados.channels && conteudosAtualizados.channels.length > 0 ? (
                  <div className="space-y-2">
                    {conteudosAtualizados.channels.map((channel: any) => (
                      <Card key={channel.id} className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="font-semibold">{channel.name}</h4>
                            {channel.streamSource && channel.streamSource.length > 0 && (
                              <p className="text-sm text-gray-400 mt-1 truncate max-w-md">
                                {channel.streamSource[0]}
                              </p>
                            )}
                          </div>
                          <Badge variant="success">✅ Ativo</Badge>
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400">Nenhum canal criado ainda</p>
                )}
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-2">Vídeos Mais Recentes</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {conteudosAtualizados.latestVideos?.movies && (
                    <Card className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-semibold">🎬 Filmes Adicionados</h4>
                          <p className="text-sm text-gray-400">
                            {new Date(conteudosAtualizados.latestVideos.movies.createdAt).toLocaleString('pt-BR')}
                          </p>
                        </div>
                        <Badge variant="info">Filmes</Badge>
                      </div>
                    </Card>
                  )}
                  {conteudosAtualizados.latestVideos?.series && (
                    <Card className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-semibold">📺 Séries Atualizadas</h4>
                          <p className="text-sm text-gray-400">
                            {new Date(conteudosAtualizados.latestVideos.series.createdAt).toLocaleString('pt-BR')}
                          </p>
                        </div>
                        <Badge variant="info">Séries</Badge>
                      </div>
                    </Card>
                  )}
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Vídeos */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-semibold">🎬 Vídeos Promocionais ({videos?.length || 0})</h2>
          <p className="text-sm text-gray-400">Clique no título para abrir o link direto</p>
        </div>
        
        {videos && videos.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {videos.map((video: any) => (
              <Card key={video.id} className="p-4">
                <div className="space-y-2">
                  <button
                    className="font-semibold text-cyan-400 hover:underline text-left"
                    onClick={() => {
                      const url = getVideoUrl(video.filePath);
                      if (url) window.open(url, '_blank');
                    }}
                  >
                    {video.type === 'movies' ? '🎬 Filme - Vídeo gerado' : '📺 Série - Vídeo gerado'}
                  </button>
                  <p className="text-sm text-gray-400">
                    {video.bannerCount} banners • {Math.floor(video.duration / 60)}min {video.duration % 60}s
                  </p>
                  <p className="text-sm text-gray-400">
                    {new Date(video.createdAt).toLocaleString('pt-BR')}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        const url = getVideoUrl(video.filePath);
                        if (url) window.open(url, '_blank');
                        else toast.error('Link inválido');
                      }}
                    >
                      Assistir
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const url = getVideoUrl(video.filePath);
                        if (!url) return toast.error('Link inválido');
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `promo_${video.type}_${video.id}.mp4`;
                        a.click();
                      }}
                    >
                      Download
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="p-8 text-center">
            <p className="text-gray-400">Nenhum vídeo gerado ainda.</p>
            <p className="text-sm text-gray-500 mt-2">
              Os vídeos serão gerados automaticamente após a próxima importação de VOD.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

