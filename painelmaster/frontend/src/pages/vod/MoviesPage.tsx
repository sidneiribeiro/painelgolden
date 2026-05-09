/**
 * Página de Listagem de Filmes
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Input, Badge, Spinner, Select } from '../../components/ui';
import { Pagination } from '../../components/ui/Pagination';
import { api } from '../../api/client';
import { Film, Search, CheckCircle, AlertCircle, RefreshCw, Sparkles } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { VODMetadataModal } from '../../components/vod/VODMetadataModal';
import { Button } from '../../components/ui';
import { useDebounce } from '../../hooks/useDebounce';

interface VODItem {
  id: string;
  title: string;
  year?: number;
  categoryName?: string;
  posterUrl?: string;
  overview?: string;
  hasMetadata: boolean;
  needsReview: boolean;
  metadataSource?: string;
  vodType: 'movie' | 'series';
  server: {
    id: string;
    name: string;
  };
}

export function MoviesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const debouncedSearch = useDebounce(search, 500); // Debounce de 500ms
  const [currentPage, setCurrentPage] = useState(parseInt(searchParams.get('page') || '1', 10));
  const [hasMetadataFilter, setHasMetadataFilter] = useState<string>(searchParams.get('hasMetadata') || '');
  const [needsReviewFilter, setNeedsReviewFilter] = useState<string>(searchParams.get('needsReview') || '');
  const [isMetadataModalOpen, setIsMetadataModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<VODItem | null>(null);

  // Atualizar URL quando debouncedSearch mudar
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (debouncedSearch) params.set('search', debouncedSearch);
    else params.delete('search');
    params.set('page', '1');
    navigate(`?${params.toString()}`, { replace: true });
    setCurrentPage(1);
  }, [debouncedSearch]);

  // Construir query params
  const queryParams = new URLSearchParams();
  if (debouncedSearch) queryParams.set('search', debouncedSearch);
  if (hasMetadataFilter) queryParams.set('hasMetadata', hasMetadataFilter);
  if (needsReviewFilter) queryParams.set('needsReview', needsReviewFilter);
  queryParams.set('page', currentPage.toString());
  queryParams.set('limit', '50');

  const { data: moviesData, isLoading } = useQuery({
    queryKey: ['vod-movies', debouncedSearch, currentPage, hasMetadataFilter, needsReviewFilter],
    queryFn: async () => {
      const res = await api.get(`/vod/movies?${queryParams.toString()}`);
      return res.data.data;
    },
  });

  const handleSearch = (value: string) => {
    setSearch(value);
    // A busca agora é automática via debounce
  };

  const handleFilterChange = (filter: string, value: string) => {
    if (filter === 'hasMetadata') {
      setHasMetadataFilter(value);
    } else if (filter === 'needsReview') {
      setNeedsReviewFilter(value);
    }
    setCurrentPage(1);
    const params = new URLSearchParams(searchParams);
    if (value) params.set(filter, value);
    else params.delete(filter);
    params.set('page', '1');
    navigate(`?${params.toString()}`, { replace: true });
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    const params = new URLSearchParams(searchParams);
    params.set('page', page.toString());
    navigate(`?${params.toString()}`, { replace: true });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner size="lg" />
      </div>
    );
  }

  const movies: VODItem[] = Array.isArray(moviesData?.items) ? moviesData.items : [];
  const pagination = moviesData?.pagination || {
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Film className="w-8 h-8" />
            Filmes
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Total: {pagination.total.toLocaleString('pt-BR')} filmes
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <Input
              placeholder="Buscar filmes..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <Select
          value={hasMetadataFilter}
          onChange={(e) => handleFilterChange('hasMetadata', e.target.value)}
          className="w-full sm:w-48"
        >
          <option value="">Todos (Metadados)</option>
          <option value="true">Com Metadados</option>
          <option value="false">Sem Metadados</option>
        </Select>
        <Select
          value={needsReviewFilter}
          onChange={(e) => handleFilterChange('needsReview', e.target.value)}
          className="w-full sm:w-48"
        >
          <option value="">Todos (Status)</option>
          <option value="true">Precisam Revisão</option>
          <option value="false">OK</option>
        </Select>
      </div>

      {/* Lista de Filmes */}
      {movies.length === 0 ? (
        <Card className="p-8 text-center">
          <Film className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600 dark:text-gray-400">
            {search || hasMetadataFilter || needsReviewFilter
              ? 'Nenhum filme encontrado com os filtros selecionados'
              : 'Nenhum filme cadastrado. Sincronize do XUI primeiro.'}
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {movies.map((movie) => (
              <Card key={movie.id} className="overflow-hidden hover:shadow-lg transition-shadow">
                {/* Poster */}
                <div className="aspect-[2/3] bg-gray-200 dark:bg-gray-800 relative">
                  {movie.posterUrl ? (
                    <img
                      src={movie.posterUrl}
                      alt={movie.title}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Film className="w-16 h-16 text-gray-400" />
                    </div>
                  )}
                  {/* Badges */}
                  <div className="absolute top-2 right-2 flex gap-1">
                    {movie.hasMetadata ? (
                      <Badge variant="success" className="text-xs">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        TMDB
                      </Badge>
                    ) : (
                      <Badge variant="warning" className="text-xs">
                        <AlertCircle className="w-3 h-3 mr-1" />
                        Sem Info
                      </Badge>
                    )}
                    {movie.needsReview && (
                      <Badge variant="danger" className="text-xs">
                        <RefreshCw className="w-3 h-3 mr-1" />
                        Revisar
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Info */}
                <div className="p-4">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-1 line-clamp-2">
                    {movie.title}
                  </h3>
                  <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
                    {movie.year && <span>{movie.year}</span>}
                    {movie.categoryName && (
                      <span className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                        {movie.categoryName}
                      </span>
                    )}
                  </div>
                  {movie.overview && (
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-2 line-clamp-2">
                      {movie.overview}
                    </p>
                  )}
                  {/* Botão Enriquecer */}
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        setSelectedItem(movie);
                        setIsMetadataModalOpen(true);
                      }}
                    >
                      <Sparkles className="w-3 h-3 mr-1" />
                      {movie.hasMetadata ? 'Re-enriquecer' : 'Enriquecer'}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Paginação */}
          {pagination.totalPages > 1 && (
            <div className="flex justify-center">
              <Pagination
                currentPage={pagination.page}
                totalPages={pagination.totalPages}
                onPageChange={handlePageChange}
              />
            </div>
          )}
        </>
      )}

      {/* Modal de Enriquecimento */}
      {selectedItem && (
        <VODMetadataModal
          isOpen={isMetadataModalOpen}
          onClose={() => {
            setIsMetadataModalOpen(false);
            setSelectedItem(null);
          }}
          item={selectedItem}
        />
      )}
    </div>
  );
}

export default MoviesPage;

