/**
 * Página de Importação VOD V2 - Sistema Refatorado
 * Com seleção de categorias para importação controlada
 */
import { useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Card, Button, Input, Select } from '../../components/ui';
import { api } from '../../api/client';
import toast from 'react-hot-toast';
import { Upload, Film, Eye, CheckCircle, Loader2, FolderOpen, CheckSquare, Square, Database, AlertTriangle } from 'lucide-react';
import { useImportSources } from '../../hooks/use-import-sources';
import type { ImportSource } from '../../api/import-sources';

interface CategoryPreview {
  name: string;
  count: number;
  type: string;
}

export function VODImportV2Page() {
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [m3uUrl, setM3uUrl] = useState('');
  const [serverId, setServerId] = useState('');
  const [vodType, setVodType] = useState<'movie' | 'series' | 'both'>('movie');
  const [sourceType, setSourceType] = useState<'primary' | 'secondary'>('primary');
  const [importMode, setImportMode] = useState<'append' | 'update' | 'replace'>('append');
  const [deleteCategories, setDeleteCategories] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);

  // Buscar fontes cadastradas
  const { data: importSources } = useImportSources();
  const [bouquetIds, setBouquetIds] = useState<number[]>([]);
  const [enrichWithTMDB, setEnrichWithTMDB] = useState(false);
  const [maxItems, setMaxItems] = useState<number | undefined>(undefined);
  const [previewResult, setPreviewResult] = useState<any>(null);
  const [importResult, setImportResult] = useState<any>(null);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [categoryMappings, setCategoryMappings] = useState<Record<string, number>>({}); // Mapeamento: nome_fonte -> id_xui
  const [updateExistingSeries, setUpdateExistingSeries] = useState(false); // Atualizar séries existentes (adicionar episódios)
  const [generateMarketing, setGenerateMarketing] = useState(false); // Gerar banners e vídeos de marketing
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [importLogs, setImportLogs] = useState<string[]>([]);

  const { data: serversData } = useQuery({
    queryKey: ['servers'],
    queryFn: async () => (await api.get('/servers')).data.data || [],
  });

  useEffect(() => {
    if (Array.isArray(serversData) && serversData.length > 0 && !serverId) {
      setServerId(serversData[0].id);
    }
  }, [serversData, serverId]);

  useEffect(() => {
    const storedJobId = localStorage.getItem('vodImportV2JobId');
    if (storedJobId && !jobId) {
      setJobId(storedJobId);
      setJobStatus('processing');
      setImportLogs([`[${new Date().toLocaleTimeString()}] Retomando importação em andamento...`]);
    }
  }, [jobId]);

  // Quando selecionar uma fonte cadastrada, preencher URL e tipo automaticamente
  useEffect(() => {
    if (selectedSourceId && importSources) {
      const source = importSources.find((s: ImportSource) => s.id === selectedSourceId);
      if (source) {
        setM3uUrl(source.url);
        setSourceType(source.type);
      }
    }
  }, [selectedSourceId, importSources]);

  useEffect(() => {
    if (sourceType === 'primary') {
      setEnrichWithTMDB(true);
    }
  }, [sourceType]);

  useEffect(() => {
    if (sourceType === 'secondary' && importMode === 'replace') {
      setImportMode('append');
      setDeleteCategories(false);
      setConfirmReplace(false);
    }
  }, [sourceType, importMode]);

  useEffect(() => {
    if (importMode !== 'replace' && deleteCategories) {
      setDeleteCategories(false);
    }
  }, [importMode, deleteCategories]);

  useEffect(() => {
    if (importMode !== 'replace' && confirmReplace) {
      setConfirmReplace(false);
    }
  }, [importMode, confirmReplace]);

  const { data: bouquetsData } = useQuery({
    queryKey: ['import-v2-bouquets', serverId],
    queryFn: async () => {
      if (!serverId) return [];
      return (await api.get(`/bouquets/for-select/${serverId}`)).data.data || [];
    },
    enabled: !!serverId,
  });

  useEffect(() => {
    setBouquetIds([]);
  }, [serverId]);

  // Buscar categorias do XUI para mapeamento manual (fonte secundária)
  const { data: xuiCategories } = useQuery({
    queryKey: ['import-v2-categories', serverId, vodType],
    queryFn: async () => {
      if (!serverId) return [];
      const type = vodType === 'series' ? 'series' : 'movie';
      return (await api.get('/import-v2/categories', { params: { serverId, type } })).data.data || [];
    },
    enabled: !!serverId && sourceType === 'secondary',
  });

  const previewMutation = useMutation({
    mutationFn: async () => (await api.get('/import-v2/preview', { params: { url: m3uUrl, serverId } })).data.data,
    onSuccess: (data: any) => { 
      setPreviewResult(data); 
      setSelectedCategories(new Set()); // Reset seleção
      toast.success(`${data.total} itens encontrados`); 
    },
    onError: (e: any) => toast.error(e.response?.data?.error || e.message),
  });

  // Filtra categorias pelo tipo selecionado (movie/series)
  const getFilteredCategories = (): CategoryPreview[] => {
    if (!previewResult?.categories) return [];
    if (vodType === 'both') return previewResult.categories;
    return previewResult.categories.filter((c: CategoryPreview) => c.type === vodType);
  };

  // Funções para gerenciar seleção de categorias
  const toggleCategory = (catName: string) => {
    setSelectedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(catName)) {
        newSet.delete(catName);
      } else {
        newSet.add(catName);
      }
      return newSet;
    });
  };

  const selectAllCategories = () => {
    const filtered = getFilteredCategories();
    setSelectedCategories(new Set(filtered.map((c) => c.name)));
  };

  const deselectAllCategories = () => {
    setSelectedCategories(new Set());
  };

  const getSelectedItemCount = () => {
    const filtered = getFilteredCategories();
    return filtered
      .filter((c) => selectedCategories.has(c.name))
      .reduce((sum: number, c) => sum + c.count, 0);
  };

  // Limpa seleção quando muda o tipo
  useEffect(() => {
    setSelectedCategories(new Set());
  }, [vodType]);

  // Polling do status do job
  useEffect(() => {
    if (!jobId || jobStatus === 'completed' || jobStatus === 'failed') return;

    const checkOnce = async () => {
      try {
        const response = await api.get(`/import-v2/jobs/${jobId}`);
        const job = response.data;
        const normalizedStatus = job.status === 'running' ? 'processing' : job.status;
        setJobStatus(normalizedStatus);
        
        // Atualizar logs do backend (substituir, não adicionar)
        if (job.logs && job.logs.length > 0) {
          setImportLogs(job.logs);
        }
        
        if (job.status === 'completed') {
          setImportResult(job.result);
          const details = job.result?.details || {};
          const moviesAdded = typeof details.movies === 'number' ? details.movies : undefined;
          const seriesAdded = typeof details.series === 'number' ? details.series : undefined;
          const episodesAdded = typeof details.episodes === 'number' ? details.episodes : undefined;
          const addedLabel = moviesAdded != null
            ? `${moviesAdded} filmes`
            : (seriesAdded != null ? `${seriesAdded} séries` : `${job.result.inserted} itens`);
          const extra = episodesAdded != null ? ` (+${episodesAdded} eps)` : '';
          toast.success(`Finalizado: ${addedLabel}${extra}`);
          setJobStatus('completed');
          setJobId(null);
          localStorage.removeItem('vodImportV2JobId');
        } else if (job.status === 'failed') {
          toast.error(job.error || 'Erro na importação');
          setJobStatus('failed');
          setJobId(null);
          localStorage.removeItem('vodImportV2JobId');
        }
      } catch (error) {
        const status = error?.response?.status;
        if (status === 401 || status === 403 || status === 404) {
          toast.error('Importação anterior não encontrada ou expirada. Limpando acompanhamento.');
          setJobStatus(null);
          setJobId(null);
          localStorage.removeItem('vodImportV2JobId');
          setImportLogs([]);
          return;
        }
        console.error('Erro ao verificar status:', error);
      }
    };

    checkOnce();
    const interval = setInterval(checkOnce, 2000); // Polling mais frequente para logs
    
    return () => clearInterval(interval);
  }, [jobId, jobStatus]);

  const importMutation = useMutation({
    mutationFn: async () => {
      const endpoint = vodType === 'series' ? '/import-v2/series' : '/import-v2/movies';
      const categoriesToImport = selectedCategories.size > 0 ? Array.from(selectedCategories) : undefined;
      const effectiveUpdateExistingSeries = vodType === 'series'
        ? (importMode === 'update' ? true : updateExistingSeries)
        : undefined;
      
      // Converter mapeamento para formato do backend (nome -> id)
      const mappingsToSend = Object.keys(categoryMappings).length > 0 ? categoryMappings : undefined;
      
      return (await api.post(endpoint, { 
        m3uUrl, 
        serverId, 
        streamServerId: 1, 
        bouquetIds: bouquetIds.length > 0 ? bouquetIds : undefined,
        enrichWithTMDB, 
        importMode,
        deleteCategories: importMode === 'replace' ? deleteCategories : false,
        maxItems, 
        autoCreateCategories: sourceType !== 'secondary', // Não criar categorias automaticamente para fonte secundária
        selectedCategories: categoriesToImport,
        sourceType,
        categoryMappings: mappingsToSend,
        updateExistingSeries: effectiveUpdateExistingSeries, // Atualizar séries existentes (adicionar episódios novos / atualizar metadados)
        generateMarketing, // Gerar banners e vídeos de marketing
      })).data;
    },
    onSuccess: (data: any) => { 
      if (data.jobId) {
        // Importação assíncrona - iniciar polling
        setJobId(data.jobId);
        setJobStatus('processing');
        localStorage.setItem('vodImportV2JobId', data.jobId);
        setImportLogs([`[${new Date().toLocaleTimeString()}] Importação iniciada...`]);
        toast.success('Importação iniciada em background...');
      } else if (data.data) {
        // Resposta síncrona (fallback)
        setImportResult(data.data); 
        toast.success(`${data.data.inserted} itens inseridos!`); 
      }
    },
    onError: (e: any) => toast.error(e.response?.data?.error || e.message),
  });

  const testMutation = useMutation({
    mutationFn: async () => (await api.post('/import-v2/test-connection', { serverId })).data,
    onSuccess: (d) => d.success ? toast.success('Conexão OK!') : toast.error(d.error),
    onError: (e: any) => toast.error(e.message),
  });

  const requireReplaceConfirm = importMode === 'replace';

  return (
    <div className="space-y-6 p-4 md:p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Film className="w-7 h-7 text-purple-500" />
            Importação VOD V2 (NOVO)
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">Sistema refatorado - mais rápido e seguro</p>
        </div>
        <Button onClick={() => testMutation.mutate()} variant="outline" disabled={testMutation.isPending}>
          {testMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
          <span className="ml-2">Testar Conexão</span>
        </Button>
      </div>

      <Card className="p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4"><Database className="w-5 h-5 inline text-purple-500 mr-2" />Configurações</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fonte Cadastrada (opcional)</label>
            <Select value={selectedSourceId} onChange={(e) => setSelectedSourceId(e.target.value)}>
              <option value="">-- Selecionar fonte cadastrada ou digitar URL abaixo --</option>
              {Array.isArray(importSources) && importSources.filter((s: ImportSource) => s.isActive).map((s: ImportSource) => (
                <option key={s.id} value={s.id}>
                  {s.type === 'primary' ? '🟢' : '🟡'} {s.name} ({s.type === 'primary' ? 'Primária' : 'Secundária'})
                </option>
              ))}
            </Select>
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">Ao selecionar, a URL e o tipo serão preenchidos automaticamente</p>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">URL do M3U</label>
            <Input value={m3uUrl} onChange={(e) => setM3uUrl(e.target.value)} placeholder="https://exemplo.com/lista.m3u" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Servidor XUI</label>
            <Select value={serverId} onChange={(e) => setServerId(e.target.value)}>
              <option value="">Selecione...</option>
              {Array.isArray(serversData) && serversData.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo</label>
            <Select value={vodType} onChange={(e) => setVodType(e.target.value as any)}>
              <option value="movie">Filmes</option>
              <option value="series">Séries</option>
              <option value="both">Ambos</option>
            </Select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo de Fonte</label>
            <Select value={sourceType} onChange={(e) => setSourceType(e.target.value as any)}>
              <option value="primary">Primária (importação completa)</option>
              <option value="secondary">Secundária (complementa)</option>
            </Select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Modo de Importação</label>
            <Select value={importMode} onChange={(e) => setImportMode(e.target.value as any)}>
              <option value="append">Importar sem apagar</option>
              <option value="update">Atualizar sem apagar</option>
              <option value="replace" disabled={sourceType === 'secondary'}>Apagar e importar</option>
            </Select>
            {sourceType === 'secondary' && (
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                Apagar e importar não é permitido em fonte secundária.
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bouquet</label>
            <Select
              multiple
              value={bouquetIds.map(String)}
              onChange={(e) => {
                const values = Array.from(e.target.selectedOptions).map((o) => parseInt(o.value, 10)).filter((v) => !Number.isNaN(v));
                setBouquetIds(values);
              }}
              className="w-full min-h-[120px]"
            >
              {Array.isArray(bouquetsData) && bouquetsData.map((b: any) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </Select>
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
              Selecione um ou mais bouquets para adicionar os itens importados automaticamente
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Limite (teste)</label>
            <Input type="number" value={maxItems || ''} onChange={(e) => setMaxItems(e.target.value ? parseInt(e.target.value) : undefined)} placeholder="50" />
          </div>
          <div className="md:col-span-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enrichWithTMDB}
                disabled={sourceType === 'primary'}
                onChange={(e) => setEnrichWithTMDB(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <span className="text-gray-700 dark:text-gray-300">Enriquecer com TMDB</span>
            </label>
            {sourceType === 'primary' && (
              <p className="text-xs text-gray-500 dark:text-gray-500 ml-6 mt-1">
                Ativo automaticamente para fonte primária
              </p>
            )}
          </div>
          {importMode === 'replace' && (
            <div className="md:col-span-2">
              <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-900 dark:border-red-700 dark:bg-red-900/20 dark:text-red-100">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                  <div className="text-sm">
                    <div className="font-semibold">Atenção: este modo apaga dados do banco do XUI</div>
                    <div className="mt-1">
                      Vai apagar {vodType === 'movie' ? 'TODOS os filmes' : vodType === 'series' ? 'TODAS as séries e episódios' : 'TODOS os filmes + séries e episódios'} antes de importar novamente.
                      Essa ação não tem desfazer.
                    </div>
                  </div>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteCategories}
                  onChange={(e) => setDeleteCategories(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <span className="text-gray-700 dark:text-gray-300">Apagar também categorias ({vodType === 'series' ? 'séries' : vodType === 'movie' ? 'filmes' : 'filmes/séries'})</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer mt-2">
                <input
                  type="checkbox"
                  checked={confirmReplace}
                  onChange={(e) => setConfirmReplace(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <span className="text-gray-700 dark:text-gray-300">Eu entendo e quero apagar e importar</span>
              </label>
            </div>
          )}
          <div className="md:col-span-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={generateMarketing} onChange={(e) => setGenerateMarketing(e.target.checked)} className="w-4 h-4 rounded" />
              <span className="text-gray-700 dark:text-gray-300">🎨 Gerar banners e vídeos de marketing</span>
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-500 ml-6 mt-1">
              Gera automaticamente banners e vídeos promocionais após a importação.
            </p>
          </div>
          {vodType === 'series' && importMode !== 'update' && (
            <div className="md:col-span-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={updateExistingSeries} onChange={(e) => setUpdateExistingSeries(e.target.checked)} className="w-4 h-4 rounded" />
                <span className="text-gray-700 dark:text-gray-300">Atualizar séries existentes (adicionar episódios novos)</span>
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-500 ml-6 mt-1">
                Quando ativado, busca séries pelo TMDB ID ou título parcial e adiciona apenas episódios que não existem.
              </p>
            </div>
          )}
          {vodType === 'series' && importMode === 'update' && (
            <div className="md:col-span-2">
              <p className="text-xs text-gray-500 dark:text-gray-500">
                No modo "Atualizar sem apagar", a atualização de séries existentes fica ativa automaticamente.
              </p>
            </div>
          )}
        </div>
        <div className="flex gap-3 mt-6">
          <Button onClick={() => previewMutation.mutate()} variant="outline" disabled={previewMutation.isPending || !m3uUrl}>
            {previewMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
            <span className="ml-2">Preview</span>
          </Button>
          <Button onClick={() => importMutation.mutate()} disabled={importMutation.isPending || jobStatus === 'processing' || !m3uUrl || (requireReplaceConfirm && !confirmReplace)} className="bg-purple-600 hover:bg-purple-700">
            {(importMutation.isPending || jobStatus === 'processing') ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            <span className="ml-2">
              {importMutation.isPending ? 'Iniciando...' : jobStatus === 'processing' ? 'Importando em background...' : 'Importar'}
            </span>
          </Button>
        </div>
      </Card>

      {previewResult && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4"><Eye className="w-5 h-5 inline text-blue-500 mr-2" />Preview</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-4">
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 text-center"><div className="text-2xl font-bold text-gray-900 dark:text-white">{previewResult.total}</div><div className="text-gray-600 dark:text-gray-400 text-sm">Total</div></div>
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 text-center"><div className="text-2xl font-bold text-purple-500">{previewResult.movies}</div><div className="text-gray-600 dark:text-gray-400 text-sm">Filmes</div></div>
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 text-center"><div className="text-2xl font-bold text-blue-500">{previewResult.series}</div><div className="text-gray-600 dark:text-gray-400 text-sm">Séries</div></div>
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 text-center"><div className="text-2xl font-bold text-green-500">{previewResult.live}</div><div className="text-gray-600 dark:text-gray-400 text-sm">Live</div></div>
          </div>

          {/* Seleção de Categorias */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3">
              <h3 className="text-md font-medium text-gray-900 dark:text-white flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-yellow-500" />
                Categorias de {vodType === 'movie' ? 'Filmes' : vodType === 'series' ? 'Séries' : 'Todos'} ({selectedCategories.size} de {getFilteredCategories().length})
              </h3>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={selectAllCategories}>Selecionar Todas</Button>
                <Button size="sm" variant="outline" onClick={deselectAllCategories}>Limpar</Button>
              </div>
            </div>

            {selectedCategories.size > 0 && (
              <div className="bg-purple-900/30 border border-purple-500/50 rounded-lg p-3 mb-3">
                <span className="text-purple-300 font-medium">
                  {getSelectedItemCount()} itens serão importados das categorias selecionadas
                </span>
              </div>
            )}

            <div className="max-h-60 overflow-y-auto bg-gray-100 dark:bg-gray-800 rounded-lg p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {getFilteredCategories().length === 0 ? (
                <div className="col-span-3 text-center text-gray-500 py-4">
                  Nenhuma categoria do tipo "{vodType === 'movie' ? 'Filmes' : vodType === 'series' ? 'Séries' : 'Todos'}" encontrada
                </div>
              ) : (
                getFilteredCategories().map((c, i) => (
                  <div 
                    key={i} 
                    onClick={() => toggleCategory(c.name)}
                    className={`flex items-center gap-2 rounded px-3 py-2 cursor-pointer transition-colors ${
                      selectedCategories.has(c.name) 
                        ? 'bg-purple-600/40 border border-purple-500' 
                        : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 border border-transparent'
                    }`}
                  >
                    {selectedCategories.has(c.name) ? (
                      <CheckSquare className="w-4 h-4 text-purple-400 flex-shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    )}
                    <span className="text-gray-700 dark:text-gray-300 text-sm truncate flex-1">{c.name}</span>
                    <span className="text-gray-500 text-xs">{c.count}</span>
                  </div>
                ))
              )}
            </div>

            {selectedCategories.size === 0 && (
              <p className="text-yellow-500 text-sm mt-2">
                ⚠️ Nenhuma categoria selecionada. Selecione as categorias que deseja importar.
              </p>
            )}
          </div>

          {/* Mapeamento Manual de Categorias (apenas para fonte secundária) */}
          {sourceType === 'secondary' && selectedCategories.size > 0 && xuiCategories && xuiCategories.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
              <h3 className="text-md font-medium text-gray-900 dark:text-white flex items-center gap-2 mb-3">
                🗺️ Mapeamento de Categorias (Fonte Secundária)
              </h3>
              <p className="text-gray-600 dark:text-gray-400 text-sm mb-3">
                Mapeie as categorias da fonte para categorias existentes no XUI para evitar duplicação.
              </p>
              <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 space-y-2 max-h-60 overflow-y-auto">
                {Array.from(selectedCategories).map((catName) => (
                  <div key={catName} className="flex items-center gap-3">
                    <span className="text-gray-700 dark:text-gray-300 text-sm w-1/3 truncate">{catName}</span>
                    <span className="text-gray-500">→</span>
                    <Select 
                      value={categoryMappings[catName]?.toString() || ''} 
                      onChange={(e) => {
                        const value = e.target.value;
                        setCategoryMappings(prev => {
                          if (value) {
                            return { ...prev, [catName]: parseInt(value) };
                          } else {
                            const { [catName]: _, ...rest } = prev;
                            return rest;
                          }
                        });
                      }}
                      className="flex-1"
                    >
                      <option value="">-- Criar nova categoria --</option>
                      {xuiCategories.map((xc: any) => (
                        <option key={xc.id} value={xc.id}>{xc.category_name}</option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>
              <p className="text-gray-500 dark:text-gray-500 text-xs mt-2">
                💡 Categorias não mapeadas serão criadas automaticamente no XUI.
              </p>
            </div>
          )}

          {/* Botão de Importar movido para cá */}
          <div className="flex gap-3 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <Button 
              onClick={() => importMutation.mutate()} 
              disabled={importMutation.isPending || selectedCategories.size === 0 || (requireReplaceConfirm && !confirmReplace)} 
              className="bg-purple-600 hover:bg-purple-700"
            >
              {importMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              <span className="ml-2">
                {importMutation.isPending 
                  ? 'Importando...' 
                  : `Importar ${getSelectedItemCount()} itens`}
              </span>
            </Button>
          </div>
        </Card>
      )}

      {/* Logs de Importação */}
      {importLogs.length > 0 && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            {jobStatus === 'processing' && <Loader2 className="w-5 h-5 inline text-blue-500 mr-2 animate-spin" />}
            {jobStatus === 'completed' && <CheckCircle className="w-5 h-5 inline text-green-500 mr-2" />}
            Log de Importação
          </h2>
          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 max-h-40 overflow-y-auto font-mono text-sm">
            {importLogs.map((log, i) => (
              <div key={i} className="text-gray-600 dark:text-gray-400 py-0.5">{log}</div>
            ))}
          </div>
        </Card>
      )}

      {importResult && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4"><CheckCircle className="w-5 h-5 inline text-green-500 mr-2" />Resultado</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 text-center"><div className="text-2xl font-bold text-green-500">{importResult.inserted}</div><div className="text-gray-600 dark:text-gray-400 text-sm">Inseridos</div></div>
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 text-center"><div className="text-2xl font-bold text-yellow-500">{importResult.skipped}</div><div className="text-gray-600 dark:text-gray-400 text-sm">Ignorados</div></div>
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 text-center"><div className="text-2xl font-bold text-red-500">{importResult.errors}</div><div className="text-gray-600 dark:text-gray-400 text-sm">Erros</div></div>
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 text-center"><div className="text-2xl font-bold text-blue-500">{(importResult.duration/1000).toFixed(1)}s</div><div className="text-gray-600 dark:text-gray-400 text-sm">Tempo</div></div>
          </div>
          {importResult.details && (
            <div className="mt-4 rounded-lg bg-gray-50 dark:bg-gray-900 p-3 text-sm text-gray-700 dark:text-gray-300">
              {typeof importResult.details.movies === 'number' && (
                <div>Filmes adicionados: <span className="font-semibold">{importResult.details.movies}</span>{typeof importResult.details.moviesUpdated === 'number' ? <> | Atualizados: <span className="font-semibold">{importResult.details.moviesUpdated}</span></> : null}</div>
              )}
              {typeof importResult.details.series === 'number' && (
                <div>Séries adicionadas: <span className="font-semibold">{importResult.details.series}</span></div>
              )}
              {typeof importResult.details.episodes === 'number' && (
                <div>Episódios adicionados: <span className="font-semibold">{importResult.details.episodes}</span></div>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
