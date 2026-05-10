/**
 * Página de Importação M3U para VOD
 * Com mapeamento de categorias
 */

import { useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, Button, Input, Select, Modal } from '../../components/ui';
import { api } from '../../api/client';
import { useSocket } from '../../hooks/useSocket';
import toast from 'react-hot-toast';
import { Upload, Film, Tv, Trash2, CheckCircle, AlertCircle, Database, Eye, MapPin, Pause, Play, X, Clock, Save } from 'lucide-react';
import { useImportSources, useCreateImportSource } from '../../hooks/use-import-sources';

interface ImportResult {
  total: number;
  movies: number;
  series: number;
  inserted: number;
  errors: number;
  skipped: number; // Duplicados ignorados
  method: 'mysql' | 'api';
  duration: number;
}

interface XUICategory {
  id: number;
  category_name: string;
  category_type: string;
}

interface M3UCategory {
  name: string;
  count: number;
}

interface CategoryMapping {
  m3uCategory: string;
  xuiCategoryId?: number;
  xuiCategoryName?: string;
  action: 'map' | 'create' | 'ignore';
  newCategoryName?: string;
  importCategory: boolean; // Se deve importar esta categoria
}

export function VODImportPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sourceIdFromUrl = searchParams.get('sourceId');
  
  const [m3uUrl, setM3uUrl] = useState('');
  const [serverId, setServerId] = useState('');
  const [vodType, setVodType] = useState<'both' | 'movie' | 'series'>('both');
  const [clearBeforeImport, setClearBeforeImport] = useState(false);
  const [enrichWithTMDB, setEnrichWithTMDB] = useState(false);
  const [bouquetId, setBouquetId] = useState<number | undefined>(undefined);

  const [cleanupUrlBase, setCleanupUrlBase] = useState('');
  const [cleanupFoundCount, setCleanupFoundCount] = useState<number | null>(null);
  const [showCleanupConfirmModal, setShowCleanupConfirmModal] = useState(false);
  
  // 🆕 FONTES SALVAS
  const { data: sources } = useImportSources();
  const createSourceMutation = useCreateImportSource();
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [showSaveSourceModal, setShowSaveSourceModal] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceType, setNewSourceType] = useState<'primary' | 'secondary'>('secondary');
  
  // ⚠️ NOVA FUNCIONALIDADE: Categoria especial por ano (agora com múltiplos anos)
  const [createYearCategory, setCreateYearCategory] = useState(false);
  const [selectedYears, setSelectedYears] = useState<number[]>([new Date().getFullYear()]); // Array de anos
  // 🆕 NOVA FUNCIONALIDADE: Atualizar categorias de filmes existentes
  const [updateExistingCategories, setUpdateExistingCategories] = useState(false);
  
  const [showClearModal, setShowClearModal] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showProgressCard, setShowProgressCard] = useState(false);
  const [selectedServerId, setSelectedServerId] = useState<number>(0);
  const [importLogs, setImportLogs] = useState<string[]>([]);

  // Estados para mapeamento
  const [showPreview, setShowPreview] = useState(false);
  const [m3uCategories, setM3uCategories] = useState<M3UCategory[]>([]);
  const [categoryMappings, setCategoryMappings] = useState<Map<string, CategoryMapping>>(new Map());

  // Socket.io para progresso em tempo real
  const { isConnected, processStatus } = useSocket({
    onProcessUpdate: (update) => {
      console.log('Progresso atualizado:', update);
      // Se houver processo em andamento, mostrar o card
      if (update.status === 'processing' || update.status === 'paused') {
        setShowProgressCard(true);
      }
      // Adicionar logs (evitar duplicatas)
      if (update.message) {
        const newLog = `${new Date().toLocaleTimeString()}: ${update.message}`;
        setImportLogs(prev => {
          // Verificar se a última mensagem é igual para evitar repetição
          if (prev.length > 0 && prev[prev.length - 1].includes(update.message || '')) {
            return prev;
          }
          return [...prev.slice(-49), newLog];
        });
      }
      if (update.currentItem) {
        const newLog = `${new Date().toLocaleTimeString()}: Processando ${update.currentItem}`;
        setImportLogs(prev => {
          // Verificar se a última mensagem é igual para evitar repetição
          if (prev.length > 0 && prev[prev.length - 1].includes(update.currentItem || '')) {
            return prev;
          }
          return [...prev.slice(-49), newLog];
        });
      }
    },
    onProcessComplete: (result) => {
      setImportResult(result);
      setShowProgressCard(true); // Garantir que o card apareça quando completar
      setImportLogs(prev => [...prev.slice(-49), `${new Date().toLocaleTimeString()}: ✅ Importação concluída! ${result.inserted} itens inseridos`]);
      toast.success(`Importação concluída! ${result.inserted} itens inseridos`);
    },
    onProcessError: (error) => {
      setImportLogs(prev => [...prev.slice(-49), `${new Date().toLocaleTimeString()}: ❌ Erro: ${error}`]);
      toast.error(`Erro na importação: ${error}`);
    },
  });

  // Verificar status ao carregar página e quando voltar à página
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await api.get('/vod/import/status');
        if (res.data?.data) {
          const status = res.data.data;
          // ⚠️ CORREÇÃO: Não processar se status é 'completed' há mais de 10 segundos
          // Isso evita logs repetidos de processos antigos
          if (status.status === 'processing' || status.status === 'paused') {
            setShowProgressCard(true);
            // Atualizar logs iniciais apenas se ainda estiver processando
            if (status.message && status.status === 'processing') {
              const newLog = `${new Date().toLocaleTimeString()}: ${status.message}`;
              setImportLogs(prev => {
                // Verificar se a última mensagem é igual para evitar repetição
                if (prev.length > 0 && prev[prev.length - 1].includes(status.message || '')) {
                  return prev;
                }
                return [...prev.slice(-49), newLog];
              });
            }
          } else if (status.status === 'completed') {
            // Se completado, mostrar card mas não adicionar logs repetidos
            setShowProgressCard(true);
            // Não adicionar logs de processos já completados
          }
        }
      } catch (error) {
        // Ignorar erros silenciosamente
      }
    };
    checkStatus();
    
    // Verificar periodicamente quando a página está visível (apenas se houver processo ativo)
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        // ⚠️ CORREÇÃO: Verificar se há processo ativo antes de checar status
        // Isso evita requisições desnecessárias quando não há importação em andamento
        if (processStatus.status === 'processing' || processStatus.status === 'paused') {
          checkStatus();
        }
      }
    }, 5000); // Verificar a cada 5 segundos
    
    // Verificar quando a página volta a ficar visível
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkStatus();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Buscar servidores XUI
  const { data: serversData } = useQuery({
    queryKey: ['servers'],
    queryFn: async () => {
      const res = await api.get('/servers');
      return res.data.data || [];
    },
  });

  // Selecionar primeiro servidor por padrão
  useEffect(() => {
    if (Array.isArray(serversData) && serversData.length > 0 && !serverId) {
      setServerId(serversData[0].id);
    }
  }, [serversData, serverId]);

  // 🆕 Carregar fonte selecionada (da URL ou dropdown)
  useEffect(() => {
    const sourceId = sourceIdFromUrl || selectedSourceId;
    if (sourceId && sources) {
      const source = sources.find(s => s.id === sourceId);
      if (source) {
        setM3uUrl(source.url);
        if (sourceIdFromUrl) {
          setSelectedSourceId(sourceId);
        }
      }
    }
  }, [sourceIdFromUrl, selectedSourceId, sources]);

  // Handler para salvar fonte
  const handleSaveSource = () => {
    if (!newSourceName || !m3uUrl) {
      toast.error('Preencha o nome e a URL');
      return;
    }

    createSourceMutation.mutate(
      {
        name: newSourceName,
        type: newSourceType,
        url: m3uUrl,
        isActive: true,
      },
      {
        onSuccess: () => {
          setShowSaveSourceModal(false);
          setNewSourceName('');
          toast.success('✅ Fonte salva com sucesso!');
        },
      }
    );
  };

  // Buscar categorias do XUI quando servidor for selecionado (filtradas por tipo)
  const { data: xuiCategoriesData } = useQuery({
    queryKey: ['vod-categories', serverId, vodType],
    queryFn: async () => {
      if (!serverId) return [];
      const params: any = { serverId };
      // Filtrar por tipo no backend
      if (vodType === 'movie') params.type = 'vod';
      else if (vodType === 'series') params.type = 'series';
      const res = await api.get('/vod/categories', { params });
      return res.data.data || [];
    },
    enabled: !!serverId,
  });

  const xuiCategories: XUICategory[] = Array.isArray(xuiCategoriesData) ? xuiCategoriesData : [];

  // Buscar bouquets do servidor quando servidor for selecionado
  const { data: bouquetsData } = useQuery({
    queryKey: ['bouquets-for-select', serverId],
    queryFn: async () => {
      if (!serverId) return [];
      const res = await api.get(`/bouquets/for-select/${serverId}`);
      return res.data.data || [];
    },
    enabled: !!serverId,
  });

  const bouquets: Array<{ value: number; label: string }> = Array.isArray(bouquetsData) ? bouquetsData : [];

  // Query: Servidores de streaming do XUI (para Server Tree)
  const { data: xuiServersData, error: xuiServersError, isLoading: xuiServersLoading } = useQuery({
    queryKey: ['vod-streaming-servers', serverId],
    queryFn: async () => {
      if (!serverId) return [];
      const res = await api.get(`/vod/servers?serverId=${serverId}`);
      return res.data.data || [];
    },
    enabled: !!serverId,
    retry: false, // Não repetir em caso de erro MySQL
  });

  const xuiServers: Array<{ id: number; server_name: string; server_ip: string }> = Array.isArray(xuiServersData) ? xuiServersData : [];

  // Mutation de preview
  const previewMutation = useMutation({
    mutationFn: async (data: { serverId: string; m3uUrl: string; vodType: string }) => {
      try {
        console.log('Enviando preview M3U:', { serverId: data.serverId, hasUrl: !!data.m3uUrl, vodType: data.vodType });
        const res = await api.post('/vod/preview', data, {
          timeout: 60000, // 60 segundos para arquivos M3U grandes
        });
        console.log('Preview M3U resposta:', res.data);
        return res.data.data || res.data;
      } catch (error: any) {
        console.error('Erro na chamada preview M3U:', {
          message: error.message,
          response: error.response?.data,
          status: error.response?.status,
          statusText: error.response?.statusText
        });
        throw error;
      }
    },
    onSuccess: (data) => {
      console.log('Preview M3U sucesso:', data);
      // Filtrar categorias por tipo se necessário (o backend já filtra, mas garantir)
      const allCategories = data.categories || [];
      setM3uCategories(allCategories);
      setShowPreview(true);
      
      // Inicializar mapeamentos (todas DESMARCADAS por padrão para facilitar seleção)
      const mappings = new Map<string, CategoryMapping>();
      allCategories.forEach((cat: M3UCategory) => {
        mappings.set(cat.name, {
          m3uCategory: cat.name,
          action: 'map',
          importCategory: false, // Começar desmarcado para facilitar
        });
      });
      setCategoryMappings(mappings);
      
      toast.success(`Preview: ${data.total || 0} itens encontrados em ${allCategories.length} categorias`);
    },
    onError: (error: any) => {
      console.error('Erro no preview M3U (onError):', error);
      const errorMessage = error.response?.data?.error || 
                          error.response?.data?.message || 
                          error.message || 
                          'Erro ao fazer preview do M3U';
      console.error('Mensagem de erro:', errorMessage);
      toast.error(errorMessage);
    },
  });

  // Mutation de importação
  const importMutation = useMutation({
    mutationFn: async (data: {
      serverId: string;
      m3uUrl: string;
      clearBeforeImport: boolean;
      categoryId?: number;
      vodType: 'both' | 'movie' | 'series';
      enrichWithTMDB: boolean;
      categoryMappings?: CategoryMapping[];
      bouquetId?: number;
      streamServerId?: number;
    }) => {
      // Timeout reduzido - API retorna imediatamente e Socket.io faz o resto
      const res = await api.post('/vod/import', data, {
        timeout: 30000, // 30 segundos apenas para iniciar
      });
      return res.data.data as ImportResult;
    },
    onSuccess: () => {
      // Importação iniciada com sucesso
      setShowPreview(false);
      toast.success('Importação iniciada! Acompanhe o progresso abaixo.');
    },
    onError: (error: any) => {
      // Verificar se é timeout
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        // Timeout não é erro - importação continua em background
        console.log('Timeout esperado - importação continua em background via Socket.io');
        setShowPreview(false);
        toast.success('Importação iniciada! Acompanhe o progresso abaixo.');
      } else {
        // Erro real
        toast.error(error.response?.data?.error || 'Erro ao iniciar importação');
      }
    },
  });

  // Funções de controle de importação
  const handlePauseImport = async () => {
    try {
      await api.post('/vod/import/pause', { forceAll: false });
      toast.success('Importação pausada');
    } catch (error: any) {
      // Tentar pausar QUALQUER processo
      try {
        await api.post('/vod/import/pause', { forceAll: true });
        toast.success('Importação pausada (processo de outro usuário)');
      } catch (secondError: any) {
        toast.error(secondError.response?.data?.error || 'Erro ao pausar importação');
      }
    }
  };

  const handleResumeImport = async () => {
    try {
      await api.post('/vod/import/resume');
      toast.success('Importação retomada');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Erro ao retomar importação');
    }
  };

  const handleCancelImport = async () => {
    try {
      // Primeira tentativa: cancelar processo do usuário atual
      await api.post('/vod/import/cancel', { forceAll: false });
      toast.success('Importação cancelada');
    } catch (error: any) {
      // Se falhar, tentar cancelar QUALQUER processo em andamento
      try {
        await api.post('/vod/import/cancel', { forceAll: true });
        toast.success('Importação cancelada (processo de outro usuário)');
      } catch (secondError: any) {
        toast.error(secondError.response?.data?.error || 'Erro ao cancelar importação');
      }
    }
  };

  // Mutation de limpeza
  const clearMutation = useMutation({
    mutationFn: async (data: { serverId: string; vodType?: 'movie' | 'series' }) => {
      const res = await api.delete('/vod/clear', {
        params: data,
      });
      return res.data;
    },
    onSuccess: (data) => {
      toast.success(`${data.data.movies} filmes e ${data.data.series} séries deletados`);
      setShowClearModal(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao limpar conteúdo');
    },
  });

  const cleanupByUrlMutation = useMutation({
    mutationFn: async (data: { serverId: string; urlBase: string; dryRun: boolean }) => {
      const res = await api.delete('/vod/movies/by-url', {
        data,
        timeout: 120000,
      });
      return res.data;
    },
    onSuccess: (data: any, variables) => {
      const found = data?.data?.found ?? 0;
      const deleted = data?.data?.deleted ?? 0;

      if (variables.dryRun) {
        setCleanupFoundCount(found);
        toast.success(`Simulação: ${found} filme(s) encontrados para excluir`);
      } else {
        setCleanupFoundCount(null);
        setShowCleanupConfirmModal(false);
        toast.success(`${deleted} filme(s) excluídos com sucesso`);
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || error.response?.data?.message || 'Erro ao excluir filmes por URL');
    },
  });

  const handlePreview = () => {
    if (!m3uUrl.trim()) {
      toast.error('URL M3U é obrigatória');
      return;
    }

    if (!serverId) {
      toast.error('Selecione um servidor XUI');
      return;
    }

    previewMutation.mutate({
      serverId,
      m3uUrl: m3uUrl.trim(),
      vodType,
    });
  };

  const handleImport = () => {
    if (!m3uUrl.trim()) {
      toast.error('URL M3U é obrigatória');
      return;
    }

    if (!serverId) {
      toast.error('Selecione um servidor XUI');
      return;
    }

    // Mostrar card de progresso quando iniciar importação
    setShowProgressCard(true);
    setImportResult(null);

    // Converter mapeamentos para formato do backend
    const categoryMappingsArray = Array.from(categoryMappings.values());

    // Validar mapeamentos (se houver preview, todos devem estar mapeados)
    if (showPreview && categoryMappingsArray.length > 0) {
      const unmappedCategories = categoryMappingsArray.filter(
        (m) => m.importCategory && m.action === 'map' && !m.xuiCategoryId
      );
      if (unmappedCategories.length > 0) {
        toast.error(
          `Categorias sem mapeamento: ${unmappedCategories.map((m) => m.m3uCategory).join(', ')}`
        );
        return;
      }
    }

    importMutation.mutate({
      serverId,
      m3uUrl: m3uUrl.trim(),
      clearBeforeImport,
      vodType,
      enrichWithTMDB,
      categoryMappings: categoryMappingsArray,
      bouquetId: bouquetId,
      streamServerId: selectedServerId && selectedServerId > 0 ? selectedServerId : undefined,
      // ⚠️ NOVA FUNCIONALIDADE: Passa configurações da categoria especial por ano (agora com múltiplos anos)
      createYearCategory,
      selectedYears: createYearCategory && selectedYears.length > 0 ? selectedYears : undefined,
      // 🆕 NOVA FUNCIONALIDADE: Atualizar categorias de filmes existentes
      updateExistingCategories: createYearCategory && updateExistingCategories,
      // 🚨 VALIDAÇÃO: ID da fonte para prevenir "Limpar antes" em secundárias
      sourceId: selectedSourceId || undefined,
    });
  };

  const handleClear = () => {
    if (!serverId) {
      toast.error('Selecione um servidor XUI');
      return;
    }

    clearMutation.mutate({ serverId, vodType: vodType === 'both' ? undefined : vodType });
  };

  const updateCategoryMapping = (m3uCategoryName: string, updates: Partial<CategoryMapping>) => {
    const current = categoryMappings.get(m3uCategoryName);
    if (current) {
      const updated = { ...current, ...updates };
      setCategoryMappings(new Map(categoryMappings.set(m3uCategoryName, updated)));
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}min`;
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Upload className="w-7 h-7 text-blue-500" />
            Importar M3U
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Importe filmes e séries de fontes M3U para o XUI
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => navigate('/vod')}
          >
            ← Voltar
          </Button>
          <Button
            variant="danger"
            onClick={() => setShowClearModal(true)}
            disabled={clearMutation.isPending}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Limpar Conteúdo
          </Button>
        </div>
      </div>

      {/* Aviso sobre método de importação */}
      <Card className="p-4 bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30">
        <div className="flex items-center gap-3">
          <span className="text-blue-600 dark:text-blue-400 text-xl">ℹ️</span>
          <div>
            <p className="font-semibold text-blue-900 dark:text-blue-100 text-sm">
              Importação otimizada
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
              Para grandes volumes (100k+ itens), a importação usa MySQL direto (100x mais rápido que API HTTP).
              Processa em minutos ao invés de horas.
            </p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Formulário Principal */}
        <div className="lg:col-span-2 space-y-4">
          {/* Configuração da Fonte */}
          <Card className="p-5">
            <h3 className="font-semibold mb-4 flex items-center gap-2 text-gray-900 dark:text-white">
              <Database className="w-5 h-5 text-blue-500" />
              Configuração da Fonte
            </h3>

            <div className="space-y-4">
              {/* Servidor XUI */}
              <div>
                <Select
                  label="Servidor XUI"
                  value={serverId}
                  onChange={(e) => {
                    setServerId(e.target.value);
                    setShowPreview(false); // Reset preview quando mudar servidor
                  }}
                  required
                >
                  <option value="">Selecione um servidor</option>
                  {Array.isArray(serversData) && serversData.map((server: any) => (
                    <option key={server.id} value={server.id}>
                      {server.name} ({server.host})
                    </option>
                  ))}
                </Select>
                {serverId && xuiCategories.length > 0 && (
                  <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                    ✓ {xuiCategories.length} categorias encontradas no XUI
                  </p>
                )}
              </div>

              {/* 🆕 DROPDOWN DE FONTES SALVAS */}
              {sources && sources.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    💾 Fontes Salvas (opcional)
                  </label>
                  <Select
                    value={selectedSourceId}
                    onChange={(e) => {
                      setSelectedSourceId(e.target.value);
                      const source = sources.find(s => s.id === e.target.value);
                      if (source) {
                        setM3uUrl(source.url);
                      }
                    }}
                  >
                    <option value="">Selecione uma fonte...</option>
                    {sources
                      .filter(s => s.isActive)
                      .map(source => (
                        <option key={source.id} value={source.id}>
                          {source.type === 'primary' ? '🎯' : '📦'} {source.name}
                        </option>
                      ))}
                  </Select>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Ou cole uma URL abaixo
                  </p>
                </div>
              )}

              {/* URL M3U */}
              <div>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Input
                      label="URL M3U"
                      type="url"
                      placeholder="https://example.com/playlist.m3u"
                      value={m3uUrl}
                      onChange={(e) => {
                        setM3uUrl(e.target.value);
                        setShowPreview(false); // Reset preview quando mudar URL
                        setSelectedSourceId(''); // Limpar seleção de fonte
                      }}
                      required
                    />
                  </div>
                  {m3uUrl && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowSaveSourceModal(true)}
                      className="mb-0.5"
                    >
                      <Save className="w-4 h-4 mr-1" />
                      Salvar Fonte
                    </Button>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  URL completa do arquivo M3U (ou caminho local)
                </p>
              </div>

              {/* Tipo de Conteúdo */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Tipo de Conteúdo
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="vodType"
                      value="both"
                      checked={vodType === 'both'}
                      onChange={(e) => setVodType(e.target.value as any)}
                      className="text-blue-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Ambos</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="vodType"
                      value="movie"
                      checked={vodType === 'movie'}
                      onChange={(e) => setVodType(e.target.value as any)}
                      className="text-blue-500"
                    />
                    <Film className="w-4 h-4 text-blue-500" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Apenas Filmes</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="vodType"
                      value="series"
                      checked={vodType === 'series'}
                      onChange={(e) => setVodType(e.target.value as any)}
                      className="text-blue-500"
                    />
                    <Tv className="w-4 h-4 text-purple-500" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Apenas Séries</span>
                  </label>
                </div>
              </div>

              {/* Botão Preview */}
              <div>
                <Button
                  onClick={handlePreview}
                  disabled={previewMutation.isPending || !m3uUrl.trim() || !serverId}
                  loading={previewMutation.isPending}
                  variant="outline"
                  className="w-full"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  {previewMutation.isPending ? 'Analisando...' : 'Preview - Ver Categorias'}
                </Button>
              </div>
            </div>
          </Card>

          {/* Mapeamento de Categorias */}
          {showPreview && m3uCategories.length > 0 && (
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold flex items-center gap-2 text-gray-900 dark:text-white">
                  <MapPin className="w-5 h-5 text-green-500" />
                  Mapeamento de Categorias
                </h3>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const newMappings = new Map(categoryMappings);
                      m3uCategories.forEach(cat => {
                        const mapping = newMappings.get(cat.name) || {
                          m3uCategory: cat.name,
                          action: 'map' as const,
                          importCategory: false,
                        };
                        newMappings.set(cat.name, { ...mapping, importCategory: true });
                      });
                      setCategoryMappings(newMappings);
                      toast.success('Todas as categorias selecionadas');
                    }}
                  >
                    Selecionar Todas
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const newMappings = new Map(categoryMappings);
                      m3uCategories.forEach(cat => {
                        const mapping = newMappings.get(cat.name) || {
                          m3uCategory: cat.name,
                          action: 'map' as const,
                          importCategory: false,
                        };
                        newMappings.set(cat.name, { ...mapping, importCategory: false });
                      });
                      setCategoryMappings(newMappings);
                      toast.success('Todas as categorias desmarcadas');
                    }}
                  >
                    Desmarcar Todas
                  </Button>
                </div>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Mapeie as categorias do M3U para as categorias do XUI ({vodType === 'both' ? 'Filmes e Séries' : vodType === 'movie' ? 'Apenas Filmes' : 'Apenas Séries'})
              </p>

              <div className="space-y-3 max-h-96 overflow-y-auto">
                {m3uCategories.map((m3uCat) => {
                  const mapping = categoryMappings.get(m3uCat.name) || {
                    m3uCategory: m3uCat.name,
                    action: 'map',
                    importCategory: true,
                  };

                  return (
                    <div
                      key={m3uCat.name}
                      className="p-3 bg-gray-50 dark:bg-zinc-800 rounded-lg border border-gray-200 dark:border-zinc-700"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <input
                              type="checkbox"
                              checked={mapping.importCategory}
                              onChange={(e) =>
                                updateCategoryMapping(m3uCat.name, { importCategory: e.target.checked })
                              }
                              className="w-4 h-4 text-blue-500 rounded"
                            />
                            <span className="font-medium text-gray-900 dark:text-white">
                              {m3uCat.name || 'Sem categoria'}
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              ({m3uCat.count} itens)
                            </span>
                          </div>

                          {mapping.importCategory && (
                            <div className="ml-6">
                              <Select
                                value={mapping.action}
                                onChange={(e) => {
                                  const action = e.target.value as 'map' | 'create' | 'ignore';
                                  updateCategoryMapping(m3uCat.name, {
                                    action,
                                    xuiCategoryId: undefined,
                                    xuiCategoryName: undefined,
                                  });
                                }}
                                className="text-sm"
                              >
                                <option value="map">Mapear para categoria existente</option>
                                <option value="create">Criar nova categoria no XUI</option>
                                <option value="ignore">Ignorar esta categoria</option>
                              </Select>

                              {mapping.action === 'map' && (
                                <Select
                                  value={mapping.xuiCategoryId || ''}
                                  onChange={(e) => {
                                    const selected = xuiCategories.find(
                                      (c) => c.id === parseInt(e.target.value, 10)
                                    );
                                    updateCategoryMapping(m3uCat.name, {
                                      xuiCategoryId: selected?.id,
                                      xuiCategoryName: selected?.category_name,
                                    });
                                  }}
                                  className="text-sm mt-2"
                                >
                                  <option value="">Selecione uma categoria XUI</option>
                                  {xuiCategories.map((xuiCat) => (
                                    <option key={xuiCat.id} value={xuiCat.id}>
                                      {xuiCat.category_name} ({xuiCat.category_type})
                                    </option>
                                  ))}
                                </Select>
                              )}

                              {mapping.action === 'create' && (
                                <Input
                                  placeholder="Nome da nova categoria"
                                  value={mapping.newCategoryName || m3uCat.name}
                                  onChange={(e) =>
                                    updateCategoryMapping(m3uCat.name, { newCategoryName: e.target.value })
                                  }
                                  className="text-sm mt-2"
                                />
                              )}

                              {mapping.action === 'ignore' && (
                                <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">
                                  ⚠️ Esta categoria será ignorada na importação
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-zinc-700">
                <div className="flex justify-between items-center text-sm text-gray-600 dark:text-gray-400 mb-2">
                  <span>
                    Categorias selecionadas:{' '}
                    {Array.from(categoryMappings.values()).filter((m) => m.importCategory).length} / {m3uCategories.length}
                  </span>
                </div>
              </div>
            </Card>
          )}

          {/* Opções Avançadas */}
          <Card className="p-5">
            <h3 className="font-semibold mb-4 text-gray-900 dark:text-white flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-yellow-500" />
              Opções Avançadas
            </h3>

            <div className="space-y-4">
              {/* Limpar antes de importar */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={clearBeforeImport}
                  onChange={(e) => setClearBeforeImport(e.target.checked)}
                  className="w-4 h-4 text-blue-500 rounded"
                />
                <div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Limpar conteúdo antes de importar
                  </span>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    ⚠️ Remove todo o conteúdo de filmes/séries existente antes de importar o novo
                  </p>
                </div>
              </label>

              {/* Enriquecer com TMDB */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enrichWithTMDB}
                  onChange={(e) => setEnrichWithTMDB(e.target.checked)}
                  className="w-4 h-4 text-blue-500 rounded"
                />
                <div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Enriquecer com TMDB
                  </span>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Adiciona metadados automaticamente (poster, sinopse, ano, etc.) via TMDB API
                  </p>
                </div>
              </label>

              {/* ⚠️ NOVA FUNCIONALIDADE: Categoria Especial por Ano */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createYearCategory}
                  onChange={(e) => setCreateYearCategory(e.target.checked)}
                  className="w-4 h-4 text-purple-500 rounded"
                />
                <div className="flex-1">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    🎆 Criar Categoria Especial por Ano
                  </span>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Agrupa filmes por ano de lançamento (ex: "Filmes | Lançamentos 2025") mantendo-os nas categorias originais
                  </p>
                </div>
              </label>

              {/* Seletor de Anos (aparece apenas se checkbox marcado) */}
              {createYearCategory && (
                <div className="ml-7 pl-3 border-l-2 border-purple-300 dark:border-purple-600">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Selecione os anos (múltiplos):
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() + 1 - i).map(year => (
                      <label key={year} className="flex items-center gap-2 cursor-pointer p-2 rounded hover:bg-purple-50 dark:hover:bg-purple-900/20">
                        <input
                          type="checkbox"
                          checked={selectedYears.includes(year)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedYears([...selectedYears, year].sort((a, b) => b - a));
                            } else {
                              setSelectedYears(selectedYears.filter(y => y !== year));
                            }
                          }}
                          className="w-4 h-4 text-purple-500 rounded"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">{year}</span>
                      </label>
                    ))}
                  </div>
                  {selectedYears.length > 0 && (
                    <p className="text-xs text-purple-600 dark:text-purple-400 mt-3">
                      ✅ Criando {selectedYears.length} categoria{selectedYears.length > 1 ? 's' : ''}: {selectedYears.sort((a, b) => b - a).map(y => `"Filmes | Lançamentos ${y}"`).join(', ')}
                    </p>
                  )}
                  {selectedYears.length === 0 && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-3">
                      ⚠️ Selecione pelo menos um ano
                    </p>
                  )}
                  
                  {/* 🆕 NOVA FUNCIONALIDADE: Atualizar filmes existentes */}
                  <div className="mt-4 pt-3 border-t border-purple-200 dark:border-purple-800">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={updateExistingCategories}
                        onChange={(e) => setUpdateExistingCategories(e.target.checked)}
                        className="w-4 h-4 text-purple-500 rounded"
                      />
                      <div className="flex-1">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          🆕 Atualizar filmes já existentes
                        </span>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          Adiciona os filmes duplicados às categorias de ano selecionadas (sem duplicar o filme)
                        </p>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {/* Seleção de Bouquet */}
              {bouquets.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Bouquet (Opcional)
                  </label>
                  <Select
                    value={bouquetId || ''}
                    onChange={(e) => setBouquetId(e.target.value ? parseInt(e.target.value, 10) : undefined)}
                    className="w-full"
                  >
                    <option value="">Nenhum (não adicionar ao bouquet)</option>
                    {bouquets.map((bouquet) => (
                      <option key={bouquet.value} value={bouquet.value}>
                        {bouquet.label}
                      </option>
                    ))}
                  </Select>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Selecione um bouquet para adicionar os filmes importados automaticamente
                  </p>
                </div>
              )}

              {/* Servidor de Streaming (Server Tree) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Servidor de Streaming (Server Tree)
                </label>
                <Select
                  value={selectedServerId || ''}
                  onChange={(e) => setSelectedServerId(Number(e.target.value) || 0)}
                  disabled={xuiServers.length === 0}
                  className="w-full"
                >
                  <option value="">Nenhum servidor (padrão)</option>
                  {xuiServers.map((srv) => (
                    <option key={srv.id} value={srv.id}>
                      {srv.server_name}
                    </option>
                  ))}
                </Select>
                {xuiServersLoading && serverId && (
                  <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                    ⏳ Carregando servidores...
                  </p>
                )}
                {xuiServersError && serverId && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                    ❌ Erro ao carregar servidores MySQL. Verifique as credenciais do banco de dados XUI.
                  </p>
                )}
                {!xuiServersLoading && !xuiServersError && xuiServers.length === 0 && serverId && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Nenhum servidor de streaming encontrado (campo opcional)
                  </p>
                )}
                {xuiServers.length > 0 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Servidor para processar os streams de filmes/séries (opcional)
                  </p>
                )}
              </div>
            </div>
          </Card>

          {/* Progresso em Tempo Real */}
          {showProgressCard && (processStatus.status === 'processing' || processStatus.status === 'paused' || processStatus.status === 'completed' || processStatus.status === 'error' || importResult !== null) && (
            <Card className={`p-5 ${
              processStatus.status === 'completed' 
                ? 'bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/30' 
                : 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30'
            }`}>
              <h3 className={`font-semibold mb-4 flex items-center gap-2 ${
                processStatus.status === 'completed' 
                  ? 'text-green-900 dark:text-green-100' 
                  : 'text-blue-900 dark:text-blue-100'
              }`}>
                {processStatus.status === 'completed' ? (
                  <>
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    Importação Concluída com Sucesso! ✅
                  </>
                ) : processStatus.status === 'paused' ? (
                  <>
                    <Pause className="w-5 h-5 text-orange-500" />
                    Importação Pausada
                  </>
                ) : (
                  <>
                    <Clock className="w-5 h-5 text-blue-500 animate-pulse" />
                    Importação em Andamento
                  </>
                )}
              </h3>

              {/* Barra de Progresso */}
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className={`font-medium ${
                      processStatus.status === 'completed' 
                        ? 'text-green-900 dark:text-green-100' 
                        : 'text-blue-900 dark:text-blue-100'
                    }`}>
                      Progresso: {processStatus.totalItems > 0 
                        ? ((processStatus.processedItems / processStatus.totalItems) * 100).toFixed(1)
                        : processStatus.progress.toFixed(1)}%
                    </span>
                    {processStatus.timeRemaining && processStatus.status !== 'completed' && (
                      <span className="text-blue-700 dark:text-blue-300 flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {processStatus.timeRemaining}
                      </span>
                    )}
                    {processStatus.status === 'completed' && (
                      <span className="text-green-700 dark:text-green-300 flex items-center gap-1 font-semibold">
                        <CheckCircle className="w-4 h-4" />
                        Concluído!
                      </span>
                    )}
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-3 rounded-full transition-all duration-300 ease-linear ${
                        processStatus.status === 'completed'
                          ? 'bg-gradient-to-r from-green-500 to-green-600'
                          : 'bg-gradient-to-r from-blue-500 to-blue-600'
                      }`}
                      style={{ 
                        width: `${processStatus.totalItems > 0 
                          ? Math.min(100, (processStatus.processedItems / processStatus.totalItems) * 100)
                          : processStatus.progress}%` 
                      }}
                    />
                  </div>
                  {/* Indicador de atualização */}
                  {processStatus.status === 'processing' && (
                    <div className="text-xs text-blue-600 dark:text-blue-400 mt-1 text-center">
                      {processStatus.processedItems > 0 && processStatus.totalItems > 0 && (
                        <>Atualizando... {processStatus.processedItems.toLocaleString()} / {processStatus.totalItems.toLocaleString()}</>
                      )}
                    </div>
                  )}
                </div>

                {/* Estatísticas */}
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                      {processStatus.processedItems.toLocaleString('pt-BR')}
                    </div>
                    <div className="text-xs text-blue-700 dark:text-blue-300">Processados</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                      {processStatus.addedItems.toLocaleString('pt-BR')}
                    </div>
                    <div className="text-xs text-green-700 dark:text-green-300">Inseridos</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gray-600 dark:text-gray-400">
                      {processStatus.totalItems.toLocaleString('pt-BR')}
                    </div>
                    <div className="text-xs text-gray-700 dark:text-gray-300">Total</div>
                  </div>
                </div>

                {/* Botões de Controle */}
                {processStatus.status !== 'completed' && (
                  <div className="flex gap-2 pt-2">
                    {processStatus.status === 'processing' ? (
                      <Button
                        onClick={handlePauseImport}
                        variant="outline"
                        size="sm"
                        className="flex-1"
                      >
                        <Pause className="w-4 h-4 mr-2" />
                        Pausar
                      </Button>
                    ) : (
                      <Button
                      onClick={handleResumeImport}
                      variant="primary"
                      size="sm"
                      className="flex-1"
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Retomar
                    </Button>
                  )}
                    <Button
                      onClick={handleCancelImport}
                      variant="danger"
                      size="sm"
                      className="flex-1"
                    >
                      <X className="w-4 h-4 mr-2" />
                      Cancelar
                    </Button>
                  </div>
                )}

                {/* Botão Fechar quando Completo ou com Erro */}
                {((processStatus.status === 'completed' || processStatus.status === 'error' || importResult !== null) && processStatus.status !== 'processing' && processStatus.status !== 'paused') && (
                  <div className="flex gap-2 pt-2">
                    <Button
                      onClick={() => {
                        console.log('[VODImportPage] Fechando card de progresso');
                        setShowProgressCard(false);
                        setImportResult(null);
                      }}
                      variant={processStatus.status === 'error' ? 'secondary' : 'primary'}
                      size="sm"
                      className="flex-1"
                    >
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Fechar
                    </Button>
                  </div>
                )}

                {/* Logs de Importação */}
                {importLogs.length > 0 && (
                  <div className="pt-2 border-t border-blue-200 dark:border-blue-500/30">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-blue-900 dark:text-blue-100">
                        📋 Logs de Importação
                      </span>
                      <button
                        onClick={() => setImportLogs([])}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Limpar
                      </button>
                    </div>
                    <div className="bg-gray-900 dark:bg-black rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-xs">
                      {importLogs.map((log, index) => (
                        <div key={index} className="text-green-400 dark:text-green-300 mb-1">
                          {log}
                        </div>
                      ))}
                      {importLogs.length === 0 && (
                        <div className="text-gray-500 dark:text-gray-400">
                          Aguardando logs...
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Status da Conexão */}
                <div className="pt-2 border-t border-blue-200 dark:border-blue-500/30">
                  <div className="flex items-center justify-center gap-2 text-xs">
                    <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                    <span className="text-blue-700 dark:text-blue-300">
                      {isConnected ? 'Conectado ao servidor' : 'Desconectado'}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Botão de Importação */}
          <div className="flex gap-2">
            <Button
              onClick={handleImport}
              disabled={
                importMutation.isPending || 
                !m3uUrl.trim() || 
                !serverId || 
                processStatus.status === 'processing' ||
                processStatus.status === 'paused'
              }
              loading={importMutation.isPending}
              size="lg"
              className="flex-1"
            >
              <Upload className="w-4 h-4 mr-2" />
              {importMutation.isPending || processStatus.status === 'processing' || processStatus.status === 'paused'
                ? 'Importando...'
                : 'Iniciar Importação'}
            </Button>
          </div>
        </div>

        {/* Sidebar - Informações */}
        <div className="space-y-4">
          {/* Resultado da Importação */}
          {importResult && (
            <Card className="p-5 bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/30">
              <h3 className="font-semibold mb-4 flex items-center gap-2 text-green-900 dark:text-green-100">
                <CheckCircle className="w-5 h-5 text-green-500" />
                Resultado
              </h3>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Total processado</span>
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {importResult.total.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Filmes</span>
                  <span className="font-semibold text-blue-600 dark:text-blue-400">
                    {importResult.movies.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Séries</span>
                  <span className="font-semibold text-purple-600 dark:text-purple-400">
                    {importResult.series.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Inseridos</span>
                  <span className="font-semibold text-green-600 dark:text-green-400">
                    {importResult.inserted.toLocaleString('pt-BR')}
                  </span>
                </div>
                {importResult.errors > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Erros</span>
                    <span className="font-semibold text-red-600 dark:text-red-400">
                      {importResult.errors.toLocaleString('pt-BR')}
                    </span>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
                  <span className="text-gray-600 dark:text-gray-400">Tempo</span>
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {formatDuration(importResult.duration)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Método</span>
                  <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded">
                    {importResult.method === 'mysql' ? 'MySQL Direto' : 'API HTTP'}
                  </span>
                </div>
              </div>
            </Card>
          )}

          <Card className="p-5">
            <h3 className="font-semibold mb-3 flex items-center gap-2 text-gray-900 dark:text-white">
              <Trash2 className="w-5 h-5 text-red-500" />
              Limpeza por URL (duplicados)
            </h3>

            <div className="text-xs text-gray-600 dark:text-gray-400 space-y-2 mb-3">
              <p>
                Remove filmes cujo link do stream começa com a URL informada.
              </p>
              <p>
                Como usar:
                <span className="font-semibold"> Simular</span> para ver quantos serão removidos,
                depois <span className="font-semibold">Excluir</span> para confirmar.
              </p>
            </div>

            <div className="space-y-3">
              <Input
                label="URL base"
                type="text"
                placeholder="Ex: http://cdn4k.net"
                value={cleanupUrlBase}
                onChange={(e) => {
                  setCleanupUrlBase(e.target.value);
                  setCleanupFoundCount(null);
                }}
              />

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  disabled={!serverId || !cleanupUrlBase.trim() || cleanupByUrlMutation.isPending}
                  loading={cleanupByUrlMutation.isPending}
                  onClick={() => {
                    if (!serverId || !cleanupUrlBase.trim()) {
                      toast.error('Selecione um servidor e informe a URL base');
                      return;
                    }
                    cleanupByUrlMutation.mutate({
                      serverId,
                      urlBase: cleanupUrlBase.trim(),
                      dryRun: true,
                    });
                  }}
                >
                  Simular
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  className="flex-1"
                  disabled={!serverId || !cleanupUrlBase.trim() || cleanupByUrlMutation.isPending}
                  onClick={() => {
                    if (!serverId || !cleanupUrlBase.trim()) {
                      toast.error('Selecione um servidor e informe a URL base');
                      return;
                    }
                    setShowCleanupConfirmModal(true);
                  }}
                >
                  Excluir
                </Button>
              </div>

              {cleanupFoundCount !== null && (
                <div className="text-sm text-gray-700 dark:text-gray-300">
                  Encontrados para excluir: <span className="font-semibold">{cleanupFoundCount.toLocaleString('pt-BR')}</span>
                </div>
              )}
            </div>
          </Card>

          {/* Informações */}
          <Card className="p-5">
            <h3 className="font-semibold mb-4 text-gray-900 dark:text-white">ℹ️ Informações</h3>
            <div className="space-y-3 text-xs text-gray-600 dark:text-gray-400">
              <p>
                • Use "Preview" para ver categorias antes de importar
              </p>
              <p>
                • Mapeie categorias M3U para categorias XUI
              </p>
              <p>
                • Categorias não mapeadas serão criadas automaticamente
              </p>
              <p>
                • Desmarque categorias que não deseja importar
              </p>
              <p>
                • Limpeza por URL: remove filmes por prefixo do link (recomendado usar “Simular” antes)
              </p>
            </div>
          </Card>
        </div>
      </div>

      {/* Modal de Confirmação de Limpeza */}
      <Modal
        isOpen={showClearModal}
        onClose={() => setShowClearModal(false)}
        title="Limpar Conteúdo (Filmes/Séries)"
        size="md"
      >
        <div className="space-y-4">
          <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg p-4">
            <p className="text-sm text-red-900 dark:text-red-100 font-semibold">
              ⚠️ Atenção: Esta ação não pode ser desfeita!
            </p>
            <p className="text-xs text-red-700 dark:text-red-300 mt-2">
              Todos os {vodType === 'both' ? 'filmes e séries' : vodType === 'movie' ? 'filmes' : 'séries'} serão
              permanentemente removidos do XUI.
            </p>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowClearModal(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={handleClear}
              loading={clearMutation.isPending}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Confirmar Limpeza
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showCleanupConfirmModal}
        onClose={() => setShowCleanupConfirmModal(false)}
        title="Excluir filmes por URL base"
        size="md"
      >
        <div className="space-y-4">
          <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg p-4">
            <p className="text-sm text-red-900 dark:text-red-100 font-semibold">
              ⚠️ Atenção: esta ação não pode ser desfeita!
            </p>
            <p className="text-xs text-red-700 dark:text-red-300 mt-2">
              Serão excluídos filmes cujo link do stream começa com: <span className="font-mono">{cleanupUrlBase.trim() || '-'}</span>
            </p>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowCleanupConfirmModal(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={cleanupByUrlMutation.isPending}
              onClick={() => {
                if (!serverId || !cleanupUrlBase.trim()) {
                  toast.error('Selecione um servidor e informe a URL base');
                  return;
                }
                cleanupByUrlMutation.mutate({
                  serverId,
                  urlBase: cleanupUrlBase.trim(),
                  dryRun: false,
                });
              }}
            >
              Confirmar Exclusão
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Salvar Fonte */}
      <Modal
        isOpen={showSaveSourceModal}
        onClose={() => {
          setShowSaveSourceModal(false);
          setNewSourceName('');
          setNewSourceType('secondary');
        }}
        title="💾 Salvar Fonte de Importação"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Nome da Fonte
            </label>
            <input
              type="text"
              value={newSourceName}
              onChange={(e) => setNewSourceName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              placeholder="Ex: IPTV Provider X"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Tipo
            </label>
            <select
              value={newSourceType}
              onChange={(e) => setNewSourceType(e.target.value as 'primary' | 'secondary')}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              <option value="primary">🎯 Primária (catálogo base)</option>
              <option value="secondary">📦 Secundária (complemento)</option>
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Primária: importada primeiro. Secundária: complementa sem duplicatas
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              URL
            </label>
            <input
              type="text"
              value={m3uUrl}
              disabled
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 font-mono text-sm"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowSaveSourceModal(false);
                setNewSourceName('');
                setNewSourceType('secondary');
              }}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSaveSource}
              disabled={createSourceMutation.isPending || !newSourceName}
              className="flex-1"
            >
              {createSourceMutation.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default VODImportPage;
