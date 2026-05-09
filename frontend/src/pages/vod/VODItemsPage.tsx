/**
 * Lista de Itens VOD (Filmes e Séries)
 */

import { useQuery } from '@tanstack/react-query';
import { Card, Spinner, Button, Select } from '../../components/ui';
import { api } from '../../api/client';
import { Film, Tv, Search, AlertCircle } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Input } from '../../components/ui/Input';
import toast from 'react-hot-toast';
import { useDebounce } from '../../hooks/useDebounce';

export function VODItemsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const debouncedSearch = useDebounce(search, 500); // Debounce de 500ms
  const [page, setPage] = useState(parseInt(searchParams.get('page') || '1', 10));
  const [vodType, setVodType] = useState<'movie' | 'series' | ''>(searchParams.get('vodType') as any || '');
  const [serverId, setServerId] = useState('');

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

  // Atualizar URL quando debouncedSearch mudar
  useEffect(() => {
    const newParams = new URLSearchParams();
    if (debouncedSearch) newParams.set('search', debouncedSearch);
    if (vodType) newParams.set('vodType', vodType);
    newParams.set('page', '1');
    setSearchParams(newParams);
    setPage(1);
  }, [debouncedSearch, vodType, setSearchParams]);

  const { data, isLoading } = useQuery({
    queryKey: ['vod-items', serverId, page, debouncedSearch, vodType],
    queryFn: async () => {
      if (!serverId) {
        return { data: [], pagination: { page: 1, perPage: 20, total: 0, totalPages: 0 } };
      }

      const params: any = {
        serverId,
        page: page.toString(),
        perPage: '20',
      };
      if (debouncedSearch) params.search = debouncedSearch;
      if (vodType) params.vodType = vodType;

      const res = await api.get('/vod/items', { params });
      return res.data;
    },
    enabled: !!serverId,
  });

  const items = Array.isArray(data?.data) ? data.data : [];
  const pagination = data?.pagination || { page: 1, perPage: 20, total: 0, totalPages: 0 };

  const handleSearch = () => {
    // A busca agora é automática via debounce, mas mantemos para compatibilidade com Enter
    setPage(1);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner size="lg" />
      </div>
    );
  }

  // Mensagem se não houver servidor
  if (!serverId && Array.isArray(serversData) && serversData.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="p-8 text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-orange-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
            Nenhum Servidor Cadastrado
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Cadastre um servidor XUI para visualizar filmes e séries.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white">
            Filmes e Séries
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Filmes e Séries sincronizados
          </p>
        </div>
      </div>

      {/* Filtros */}
      <Card className="p-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                Servidor XUI
              </label>
              <Select
                value={serverId}
                onChange={(e) => {
                  setServerId(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Selecione um servidor</option>
                {Array.isArray(serversData) && serversData.map((server: any) => (
                  <option key={server.id} value={server.id}>
                    {server.name || server.url}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                Buscar
              </label>
              <Input
                placeholder="Buscar por título..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant={vodType === '' ? 'primary' : 'outline'}
              onClick={() => {
                setVodType('');
                setPage(1);
                handleSearch();
              }}
            >
              Todos
            </Button>
            <Button
              variant={vodType === 'movie' ? 'primary' : 'outline'}
              onClick={() => {
                setVodType('movie');
                setPage(1);
                handleSearch();
              }}
            >
              <Film className="w-4 h-4 mr-2" />
              Filmes
            </Button>
            <Button
              variant={vodType === 'series' ? 'primary' : 'outline'}
              onClick={() => {
                setVodType('series');
                setPage(1);
                handleSearch();
              }}
            >
              <Tv className="w-4 h-4 mr-2" />
              Séries
            </Button>
            <Button onClick={handleSearch}>
              <Search className="w-4 h-4 mr-2" />
              Buscar
            </Button>
          </div>
        </div>
      </Card>

      {/* Info */}
      {serverId && (
        <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
          <span>
            {pagination.total > 0 ? (
              <>
                Mostrando {items.length} de {pagination.total.toLocaleString('pt-BR')} {vodType === 'movie' ? 'filmes' : vodType === 'series' ? 'séries' : 'itens'}
              </>
            ) : (
              'Nenhum item encontrado'
            )}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPage(1);
              handleSearch();
            }}
          >
            Atualizar
          </Button>
        </div>
      )}

      {/* Lista */}
      {items.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Nenhum item encontrado{serverId ? ' neste servidor' : ''}
          </p>
          {serverId && (
            <p className="text-sm text-gray-500 dark:text-gray-500">
              Verifique se você já importou filmes/séries ou ajuste os filtros de busca.
            </p>
          )}
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map((item: any) => (
              <Card key={item.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                    item.vodType === 'movie' 
                      ? 'bg-blue-100 dark:bg-blue-500/20' 
                      : 'bg-purple-100 dark:bg-purple-500/20'
                  }`}>
                    {item.vodType === 'movie' ? (
                      <Film className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <Tv className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                      {item.title || item.streamName}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                      {item.categoryName || 'Sem categoria'}
                    </p>
                    {item.year && (
                      <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                        {item.year}
                      </p>
                    )}
                    {item.hasMetadata && (
                      <span className="inline-block mt-2 px-2 py-1 text-xs bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 rounded">
                        Com metadados
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Paginação */}
          {pagination.totalPages > 1 && (
            <div className="flex justify-center items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Anterior
              </Button>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Página {pagination.page} de {pagination.totalPages}
              </span>
              <Button
                variant="outline"
                onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                disabled={page === pagination.totalPages}
              >
                Próxima
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
