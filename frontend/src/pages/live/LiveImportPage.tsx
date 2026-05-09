/**
 * Página de Importação de Canais LIVE
 * Seguindo o padrão VODImportPage
 */

import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Input, Select } from '../../components/ui';
import { api } from '../../api/client';
import { useSocket } from '../../hooks/useSocket';
import toast from 'react-hot-toast';
import { 
  Upload, 
  CheckCircle, 
  Eye, 
  MapPin, 
  Pause, 
  X, 
  TvMinimalPlay,
  Loader2
} from 'lucide-react';

interface XUIServer {
  id: string;
  name: string;
  baseUrl: string;
}

interface XUIStreamServer {
  id: number;
  server_name: string;
  server_ip: string;
}

interface XUICategory {
  id: number;
  category_name: string;
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
  importCategory: boolean;
}

interface Bouquet {
  id: number;
  bouquet_name: string;
}

export function LiveImportPage() {
  const queryClient = useQueryClient();
  
  // Estados principais
  const [serverId, setServerId] = useState('');
  const [m3uUrl, setM3uUrl] = useState('');
  const [bouquetId, setBouquetId] = useState<number>(1);
  
  // Estados de configuração de importação
  const [importMode, setImportMode] = useState<'direct' | 'ondemand'>('direct');
  const [directSource, setDirectSource] = useState<number>(1);
  const [directProxy, setDirectProxy] = useState<number>(0);
  const [selectedServerId, setSelectedServerId] = useState<number>(0);
  const [updateExistingIcons, setUpdateExistingIcons] = useState(false);
  
  // Estados de preview e mapeamento
  const [showPreview, setShowPreview] = useState(false);
  const [m3uCategories, setM3uCategories] = useState<M3UCategory[]>([]);
  const [categoryMappings, setCategoryMappings] = useState<Map<string, CategoryMapping>>(new Map());
  
  // Estados de processo
  const [processStatus, setProcessStatus] = useState<'idle' | 'running' | 'completed' | 'error' | 'paused'>('idle');
  const [processProgress, setProcessProgress] = useState(0);
  const [processMessage, setProcessMessage] = useState('');
  const [processStats, setProcessStats] = useState<{
    totalItems?: number;
    importedItems?: number;
  }>({});

  // Socket.io
  useSocket({
    onProcessUpdate: (data) => {
      // Converter 'processing' para 'running' e manter outros status
      const status = data.status === 'processing' ? 'running' : (data.status as 'idle' | 'running' | 'completed' | 'error' | 'paused');
      setProcessStatus(status);
      setProcessProgress(data.progress || 0);
      setProcessMessage(data.currentItem || data.message || '');
      if (data.stats) {
        setProcessStats(data.stats);
      } else if (data.addedItems !== undefined || data.processedItems !== undefined) {
        setProcessStats({
          totalItems: data.totalItems || 0,
          importedItems: data.addedItems || data.processedItems || 0,
        });
      }
    },
    onProcessComplete: (data) => {
      // Sempre setar estatísticas primeiro
      if (data.stats) {
        setProcessStats(data.stats);
      } else if (data.addedItems !== undefined || data.totalItems !== undefined) {
        setProcessStats({
          totalItems: data.totalItems || data.processedItems || 0,
          importedItems: data.addedItems || data.processedItems || 0,
        });
      } else {
        // Garantir que sempre há estatísticas
        setProcessStats({
          totalItems: data.totalItems || 0,
          importedItems: data.addedItems || 0,
        });
      }
      
      setProcessStatus('completed'); // Manter como 'completed' para mostrar botão Fechar
      setProcessProgress(100);
      setProcessMessage(data.currentItem || data.message || 'Importação concluída!');
      queryClient.invalidateQueries({ queryKey: ['live-channels'] });
      toast.success('Importação concluída com sucesso!');
    },
    onProcessError: (error) => {
      setProcessStatus('error');
      setProcessMessage(error);
      toast.error(`Erro: ${error}`);
    },
  });

  // Query: Servidores
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

  // Query: Categorias LIVE do XUI
  const { data: xuiCategoriesData } = useQuery({
    queryKey: ['live-categories', serverId],
    queryFn: async () => {
      if (!serverId) return [];
      const res = await api.get(`/live/categories?serverId=${serverId}`);
      return res.data || [];
    },
    enabled: !!serverId,
  });

  const xuiCategories: XUICategory[] = Array.isArray(xuiCategoriesData) ? xuiCategoriesData : [];

  // Query: Servidores de Streaming do XUI (Server Tree)
  const { data: xuiServersData } = useQuery({
    queryKey: ['xui-stream-servers', serverId],
    queryFn: async () => {
      if (!serverId) return [];
      const res = await api.get(`/live/servers?serverId=${serverId}`);
      return res.data || [];
    },
    enabled: !!serverId,
  });

  const xuiServers: XUIStreamServer[] = Array.isArray(xuiServersData) ? xuiServersData : [];

  // Query: Bouquets
  const { data: bouquetsData } = useQuery({
    queryKey: ['live-bouquets', serverId],
    queryFn: async () => {
      if (!serverId) return [];
      const res = await api.get(`/live/bouquets?serverId=${serverId}`);
      return res.data || [];
    },
    enabled: !!serverId,
  });

  const bouquets: Bouquet[] = Array.isArray(bouquetsData) ? bouquetsData : [];

  // Mutation: Analisar M3U (Preview)
  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/live/analyze-m3u', {
        serverId,
        m3uUrl: m3uUrl.trim(),
      });
      return res.data;
    },
    onSuccess: (data) => {
      const categories = data.categories || [];
      setM3uCategories(categories);
      setShowPreview(true);
      
      // Resetar estado de processo ao analisar novo M3U
      setProcessStatus('idle');
      setProcessProgress(0);
      setProcessMessage('');
      setProcessStats({});
      
      // Inicializar mapeamentos (todas DESMARCADAS por padrão)
      const mappings = new Map<string, CategoryMapping>();
      categories.forEach((cat: M3UCategory) => {
        mappings.set(cat.name, {
          m3uCategory: cat.name,
          action: 'map',
          importCategory: false, // Desmarcado por padrão
        });
      });
      setCategoryMappings(mappings);
      
      toast.success(`${data.totalChannels} canais encontrados em ${categories.length} categorias`);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao analisar M3U');
    },
  });

  // Mutation: Importar
  const importMutation = useMutation({
    mutationFn: async () => {
      // Preparar mapeamentos apenas das categorias MARCADAS
      const mappingsArray = Array.from(categoryMappings.values())
        .filter(m => m.importCategory) // Apenas as marcadas
        .map(m => ({
          m3uCategory: m.m3uCategory,
          xuiCategoryId: m.xuiCategoryId,
          action: m.action,
          newCategoryName: m.newCategoryName,
        }));

      if (mappingsArray.length === 0) {
        throw new Error('Selecione pelo menos uma categoria para importar');
      }

      const res = await api.post('/live/import', {
        serverId,
        m3uUrl: m3uUrl.trim(),
        categoryMappings: mappingsArray,
        bouquetId,
        importMode,
        directSource,
        directProxy,
        streamServerId: selectedServerId || undefined,
        updateExistingIcons,
      });
      return res.data;
    },
    onSuccess: () => {
      toast.success('Importação iniciada! Acompanhe o progresso abaixo.');
      setProcessStatus('running');
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.error || error.message || 'Erro ao iniciar importação';
      toast.error(errorMsg);
      setProcessStatus('error');
      setProcessMessage(errorMsg);
    },
  });

  // Handlers
  const handlePreview = () => {
    if (!m3uUrl.trim()) {
      toast.error('URL M3U é obrigatória');
      return;
    }
    if (!serverId) {
      toast.error('Selecione um servidor XUI');
      return;
    }
    previewMutation.mutate();
  };

  const handleImport = () => {
    if (!serverId) {
      toast.error('Selecione um servidor');
      return;
    }
    if (!m3uUrl.trim()) {
      toast.error('Informe a URL do M3U');
      return;
    }
    
    const selectedCount = Array.from(categoryMappings.values()).filter(m => m.importCategory).length;
    if (selectedCount === 0) {
      toast.error('Selecione pelo menos uma categoria para importar');
      return;
    }

    importMutation.mutate();
  };

  const handlePause = async () => {
    try {
      await api.post('/live/import/pause', { forceAll: true });
      toast.success('Importação pausada');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Erro ao pausar');
    }
  };

  // const handleResume = async () => {
  //   try {
  //     await api.post('/live/import/resume');
  //     toast.success('Importação retomada');
  //   } catch (error: any) {
  //     toast.error(error.response?.data?.error || 'Erro ao retomar');
  //   }
  // };

  const handleCancel = async () => {
    try {
      await api.post('/live/import/cancel', { forceAll: true });
      toast.success('Importação cancelada');
      setProcessStatus('idle');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Erro ao cancelar');
    }
  };

  // Funções de mapeamento
  const updateMapping = (m3uCat: string, updates: Partial<CategoryMapping>) => {
    setCategoryMappings(prev => {
      const newMappings = new Map(prev);
      const current = newMappings.get(m3uCat);
      if (current) {
        newMappings.set(m3uCat, { ...current, ...updates });
      }
      return newMappings;
    });
  };

  const toggleCategory = (m3uCat: string) => {
    const current = categoryMappings.get(m3uCat);
    if (current) {
      updateMapping(m3uCat, { importCategory: !current.importCategory });
    }
  };

  const selectAllCategories = () => {
    setCategoryMappings(prev => {
      const newMappings = new Map(prev);
      newMappings.forEach((value, key) => {
        newMappings.set(key, { ...value, importCategory: true });
      });
      return newMappings;
    });
  };

  const deselectAllCategories = () => {
    setCategoryMappings(prev => {
      const newMappings = new Map(prev);
      newMappings.forEach((value, key) => {
        newMappings.set(key, { ...value, importCategory: false });
      });
      return newMappings;
    });
  };

  const servers = Array.isArray(serversData) ? serversData : [];
  const selectedCount = Array.from(categoryMappings.values()).filter(m => m.importCategory).length;
  const totalChannelsSelected = m3uCategories
    .filter(cat => categoryMappings.get(cat.name)?.importCategory)
    .reduce((sum, cat) => sum + cat.count, 0);

  return (
    <div className="container mx-auto py-6 px-4 lg:px-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <TvMinimalPlay className="h-8 w-8 text-cyan-500" />
        <div>
          <h1 className="text-3xl font-bold">Importar Canais LIVE</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Importe canais de TV ao vivo de arquivos M3U para o XUI.ONE
          </p>
        </div>
      </div>

      {/* Formulário */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Configuração de Importação</h2>
        
        <div className="space-y-4">
          {/* Servidor */}
          <div>
            <label className="block text-sm font-medium mb-2">Servidor XUI.ONE</label>
            <Select
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
            >
              <option value="">Selecione o servidor</option>
              {servers.map((server: XUIServer) => (
                <option key={server.id} value={server.id}>
                  {server.name}
                </option>
              ))}
            </Select>
          </div>

          {/* URL M3U */}
          <div>
            <label className="block text-sm font-medium mb-2">URL do M3U</label>
            <Input
              type="url"
              placeholder="https://example.com/playlist.m3u"
              value={m3uUrl}
              onChange={(e) => setM3uUrl(e.target.value)}
            />
          </div>

          {/* Bouquet */}
          <div>
            <label className="block text-sm font-medium mb-2">Bouquet de Destino</label>
            <Select
              value={bouquetId.toString()}
              onChange={(e) => setBouquetId(Number(e.target.value))}
              disabled={bouquets.length === 0}
            >
              {bouquets.length === 0 ? (
                <option value="">Carregando...</option>
              ) : (
                bouquets.map((bouquet) => (
                  <option key={bouquet.id} value={bouquet.id}>
                    {bouquet.bouquet_name}
                  </option>
                ))
              )}
            </Select>
          </div>

          {/* Botão Preview */}
          <div className="pt-4">
            <Button
              onClick={handlePreview}
              disabled={previewMutation.isPending || !serverId || !m3uUrl.trim()}
              variant="secondary"
              className="w-full sm:w-auto"
            >
              {previewMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analisando M3U...
                </>
              ) : (
                <>
                  <Eye className="mr-2 h-4 w-4" />
                  Analisar M3U e Mapear Categorias
                </>
              )}
            </Button>
          </div>
        </div>
      </Card>

      {/* Preview e Mapeamento de Categorias */}
      {showPreview && m3uCategories.length > 0 && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Mapeamento de Categorias
              </h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                Selecione as categorias que deseja importar e mapeie para categorias do XUI
              </p>
            </div>
          </div>

          {/* Estatísticas */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <div className="text-sm text-blue-600 dark:text-blue-400">Total de Categorias</div>
              <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                {m3uCategories.length}
              </div>
            </div>
            <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
              <div className="text-sm text-green-600 dark:text-green-400">Categorias Selecionadas</div>
              <div className="text-2xl font-bold text-green-700 dark:text-green-300">
                {selectedCount}
              </div>
            </div>
            <div className="p-4 bg-cyan-50 dark:bg-cyan-900/20 rounded-lg">
              <div className="text-sm text-cyan-600 dark:text-cyan-400">Total de Canais</div>
              <div className="text-2xl font-bold text-cyan-700 dark:text-cyan-300">
                {totalChannelsSelected}
              </div>
            </div>
          </div>

          {/* Botões de Seleção */}
          <div className="flex gap-2 mb-4">
            <Button variant="outline" size="sm" onClick={selectAllCategories}>
              <CheckCircle className="mr-2 h-4 w-4" />
              Selecionar Todas
            </Button>
            <Button variant="outline" size="sm" onClick={deselectAllCategories}>
              <X className="mr-2 h-4 w-4" />
              Desmarcar Todas
            </Button>
          </div>

          {/* Lista de Categorias */}
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {m3uCategories.map((cat) => {
              const mapping = categoryMappings.get(cat.name);
              if (!mapping) return null;

              return (
                <div
                  key={cat.name}
                  className={`p-4 border rounded-lg ${
                    mapping.importCategory
                      ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20'
                      : 'border-zinc-200 dark:border-zinc-800'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={mapping.importCategory}
                      onChange={() => toggleCategory(cat.name)}
                      className="mt-1 h-5 w-5 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                    />

                    <div className="flex-1 space-y-3">
                      {/* Nome e Contagem */}
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-medium">{cat.name}</span>
                          <span className="ml-2 text-sm text-zinc-600 dark:text-zinc-400">
                            ({cat.count} {cat.count === 1 ? 'canal' : 'canais'})
                          </span>
                        </div>
                      </div>

                      {/* Mapeamento */}
                      {mapping.importCategory && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {/* Ação */}
                          <div>
                            <label className="block text-xs font-medium mb-1">Ação</label>
                            <Select
                              value={mapping.action}
                              onChange={(e) => updateMapping(cat.name, { 
                                action: e.target.value as 'map' | 'create' | 'ignore' 
                              })}
                              className="text-sm"
                            >
                              <option value="map">Mapear para categoria existente</option>
                              <option value="create">Criar nova categoria</option>
                              <option value="ignore">Ignorar (sem categoria)</option>
                            </Select>
                          </div>

                          {/* Categoria XUI ou Nome Nova */}
                          {mapping.action === 'map' && (
                            <div>
                              <label className="block text-xs font-medium mb-1">Categoria XUI</label>
                              <Select
                                value={mapping.xuiCategoryId?.toString() || ''}
                                onChange={(e) => {
                                  const xuiCat = xuiCategories.find(c => c.id === Number(e.target.value));
                                  updateMapping(cat.name, {
                                    xuiCategoryId: Number(e.target.value),
                                    xuiCategoryName: xuiCat?.category_name,
                                  });
                                }}
                                className="text-sm"
                              >
                                <option value="">Selecione...</option>
                                {xuiCategories.map((xuiCat) => (
                                  <option key={xuiCat.id} value={xuiCat.id}>
                                    {xuiCat.category_name}
                                  </option>
                                ))}
                              </Select>
                            </div>
                          )}

                          {mapping.action === 'create' && (
                            <div>
                              <label className="block text-xs font-medium mb-1">Nome da Nova Categoria</label>
                              <Input
                                value={mapping.newCategoryName || cat.name}
                                onChange={(e) => updateMapping(cat.name, { newCategoryName: e.target.value })}
                                placeholder="Nome da categoria"
                                className="text-sm"
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Configurações de Importação */}
          <div className="mt-6 pt-6 border-t border-zinc-200 dark:border-zinc-800 space-y-4">
            <h3 className="text-lg font-semibold">Configurações de Importação</h3>
            
            <div>
              <label className="block text-sm font-medium mb-2">Modo de Importação</label>
              <Select
                value={importMode}
                onChange={(e) => setImportMode(e.target.value as 'direct' | 'ondemand')}
              >
                <option value="direct">Direct Source + Direct Stream (Padrão)</option>
                <option value="ondemand">On-Demand (Generate PTS)</option>
              </Select>
              <p className="text-xs text-zinc-500 mt-1">
                {importMode === 'direct' 
                  ? 'Canais transmitidos diretamente da URL (recomendado para a maioria dos casos)'
                  : 'Canais processados pelo servidor On-Demand com geração de PTS'}
              </p>
            </div>

            {importMode === 'direct' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Direct Source</label>
                  <Select
                    value={directSource}
                    onChange={(e) => setDirectSource(Number(e.target.value))}
                  >
                    <option value={1}>✅ Ativado (URL Direta)</option>
                    <option value={0}>❌ Desativado (Transcoded)</option>
                  </Select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Direct Proxy</label>
                  <Select
                    value={directProxy}
                    onChange={(e) => setDirectProxy(Number(e.target.value))}
                  >
                    <option value={0}>❌ Desativado</option>
                    <option value={1}>✅ Ativado</option>
                  </Select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium mb-1">Servidor de Streaming</label>
                  <Select
                    value={selectedServerId || ''}
                    onChange={(e) => setSelectedServerId(Number(e.target.value) || 0)}
                    disabled={xuiServers.length === 0}
                  >
                    <option value="">Nenhum servidor (padrão)</option>
                    {xuiServers.map((srv) => (
                      <option key={srv.id} value={srv.id}>
                        {srv.server_name}
                      </option>
                    ))}
                  </Select>
                  {xuiServers.length === 0 && (
                    <p className="text-xs text-yellow-600 mt-1">⚠️ Carregando servidores...</p>
                  )}
                  {xuiServers.length > 0 && (
                    <p className="text-xs text-zinc-500 mt-1">Servidor para processar os streams</p>
                  )}
                </div>
              </div>
            )}

            {importMode === 'ondemand' && (
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Servidor de Streaming</label>
                  <Select
                    value={selectedServerId || ''}
                    onChange={(e) => setSelectedServerId(Number(e.target.value) || 0)}
                    disabled={xuiServers.length === 0}
                  >
                    <option value="">Selecione o servidor</option>
                    {xuiServers.map((srv) => (
                      <option key={srv.id} value={srv.id}>
                        {srv.server_name}
                      </option>
                    ))}
                  </Select>
                  <p className="text-xs text-zinc-500 mt-1">Servidor para processar streams on-demand</p>
                </div>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={updateExistingIcons}
                onChange={(e) => setUpdateExistingIcons(e.target.checked)}
              />
              Atualizar logos dos canais já existentes
            </label>
          </div>

          {/* Botão Importar */}
          <div className="mt-6 pt-6 border-t border-zinc-200 dark:border-zinc-800">
            <Button
              onClick={handleImport}
              disabled={processStatus === 'running' || selectedCount === 0}
              className="w-full sm:w-auto"
            >
              {processStatus === 'running' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importando...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Iniciar Importação ({totalChannelsSelected} canais)
                </>
              )}
            </Button>
          </div>
        </Card>
      )}

      {/* Progresso */}
      {(processStatus !== 'idle' || (processStats.totalItems !== undefined && processStats.totalItems > 0)) && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Progresso da Importação</h2>
            {processStatus === 'running' && (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={handlePause}>
                  <Pause className="h-4 w-4 mr-1" />
                  Pausar
                </Button>
                <Button size="sm" variant="danger" onClick={handleCancel}>
                  <X className="h-4 w-4 mr-1" />
                  Cancelar
                </Button>
              </div>
            )}
            {processStatus !== 'running' && (
              <Button size="sm" variant="secondary" onClick={() => {
                setProcessStatus('idle');
                setProcessProgress(0);
                setProcessMessage('');
                setProcessStats({});
                setShowPreview(false);
                setM3uCategories([]);
                setCategoryMappings(new Map());
              }}>
                Fechar
              </Button>
            )}
          </div>

          {/* Barra de Progresso */}
          <div className="mb-4">
            <div className="flex justify-between text-sm mb-2">
              <span>{processMessage}</span>
              <span className="font-medium">{processProgress}%</span>
            </div>
            <div className="w-full bg-zinc-200 dark:bg-zinc-800 rounded-full h-2">
              <div
                className="bg-cyan-600 dark:bg-cyan-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${processProgress}%` }}
              />
            </div>
          </div>

          {/* Estatísticas Detalhadas */}
          {(processStats.totalItems !== undefined && processStats.totalItems > 0) && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
              <div className="p-3 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                <div className="text-sm text-zinc-600 dark:text-zinc-400">Total de Canais</div>
                <div className="text-2xl font-bold">{processStats.totalItems || 0}</div>
              </div>
              <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <div className="text-sm text-green-600 dark:text-green-400">Importados</div>
                <div className="text-2xl font-bold text-green-600">
                  {processStats.importedItems || 0}
                </div>
              </div>
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <div className="text-sm text-blue-600 dark:text-blue-400">Processados</div>
                <div className="text-2xl font-bold text-blue-600">
                  {processStats.importedItems || 0}
                </div>
              </div>
              <div className="p-3 bg-cyan-50 dark:bg-cyan-900/20 rounded-lg">
                <div className="text-sm text-cyan-600 dark:text-cyan-400">Progresso</div>
                <div className="text-2xl font-bold text-cyan-600">
                  {processProgress}%
                </div>
              </div>
            </div>
          )}

          {/* Status */}
          {processStatus === 'completed' && (
            <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg mt-4">
              <p className="text-green-800 dark:text-green-200 font-medium">
                ✅ Importação concluída com sucesso!
              </p>
            </div>
          )}

          {processStatus === 'error' && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg mt-4">
              <p className="text-red-800 dark:text-red-200 font-medium">
                ❌ {processMessage}
              </p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
