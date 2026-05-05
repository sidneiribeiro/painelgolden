/**
 * Modal para editar/enriquecer metadados de um item VOD
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Input, Badge, Spinner } from '../ui';
import { api } from '../../api/client';
import toast from 'react-hot-toast';
import { Search, Film, Tv, CheckCircle, Loader } from 'lucide-react';

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
  metadata?: any;
}

interface TMDBResult {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  vote_average?: number;
}

interface VODMetadataModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: VODItem;
}

export function VODMetadataModal({ isOpen, onClose, item }: VODMetadataModalProps) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTMDBId, setSelectedTMDBId] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);

  // Buscar no TMDB
  const { data: tmdbResults, isLoading: searchingTMDB, refetch: searchTMDB } = useQuery({
    queryKey: ['tmdb-search', item.id, searchQuery],
    queryFn: async () => {
      if (!searchQuery.trim()) return [];
      
      const year = item.year || undefined;
      const type = item.vodType === 'movie' ? 'movie' : 'tv';
      
      const res = await api.get('/vod/tmdb/search', {
        params: {
          query: searchQuery,
          type,
          year,
        },
      });
      
      return res.data.data || [];
    },
    enabled: false, // Não busca automaticamente
  });

  // Enriquecer item
  const enrichMutation = useMutation({
    mutationFn: async ({ tmdbId }: { tmdbId: number }) => {
      const res = await api.post(`/vod/${item.id}/enrich`, { tmdbId });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vod-stats'] });
      queryClient.invalidateQueries({ queryKey: ['vod-movies'] });
      queryClient.invalidateQueries({ queryKey: ['vod-series'] });
      toast.success('Item enriquecido com sucesso!');
      onClose();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao enriquecer item');
    },
  });

  const handleSearch = () => {
    if (!searchQuery.trim()) {
      toast.error('Digite um termo para buscar');
      return;
    }
    setSearching(true);
    searchTMDB().finally(() => setSearching(false));
  };

  const handleSelectTMDB = (tmdbResult: TMDBResult) => {
    setSelectedTMDBId(tmdbResult.id);
  };

  const handleEnrich = () => {
    if (!selectedTMDBId) {
      toast.error('Selecione um resultado do TMDB primeiro');
      return;
    }

    enrichMutation.mutate({ tmdbId: selectedTMDBId });
  };

  if (!isOpen) return null;

  const results: TMDBResult[] = tmdbResults || [];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Enriquecer: ${item.title}`}>
      <div className="space-y-6">
        {/* Informações Atuais */}
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Informações Atuais</h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              {item.vodType === 'movie' ? (
                <Film className="w-4 h-4 text-blue-500" />
              ) : (
                <Tv className="w-4 h-4 text-purple-500" />
              )}
              <span className="font-medium">{item.title}</span>
              {item.year && <span className="text-gray-500">({item.year})</span>}
            </div>
            {item.categoryName && (
              <div className="text-gray-600 dark:text-gray-400">
                Categoria: {item.categoryName}
              </div>
            )}
            {item.hasMetadata ? (
              <Badge variant="success">Tem Metadados TMDB</Badge>
            ) : (
              <Badge variant="warning">Sem Metadados</Badge>
            )}
          </div>
        </div>

        {/* Busca TMDB */}
        <div>
          <label className="block text-sm font-medium mb-2">Buscar no TMDB</label>
          <div className="flex gap-2">
            <Input
              placeholder={`Buscar ${item.vodType === 'movie' ? 'filme' : 'série'}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              className="flex-1"
            />
            <Button
              onClick={handleSearch}
              disabled={searching || searchingTMDB}
            >
              <Search className="w-4 h-4 mr-2" />
              Buscar
            </Button>
          </div>
        </div>

        {/* Resultados TMDB */}
        {searchingTMDB && (
          <div className="flex items-center justify-center py-8">
            <Spinner size="lg" />
            <span className="ml-2 text-gray-600 dark:text-gray-400">Buscando no TMDB...</span>
          </div>
        )}

        {results.length > 0 && (
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">
              Resultados Encontrados ({results.length})
            </h3>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {results.map((result) => {
                const isSelected = selectedTMDBId === result.id;
                const title = result.title || result.name || 'Sem título';
                const originalTitle = result.original_title || result.original_name || title;
                const releaseDate = result.release_date || result.first_air_date || '';
                const year = releaseDate ? new Date(releaseDate).getFullYear() : null;
                const posterUrl = result.poster_path
                  ? `https://image.tmdb.org/t/p/w500${result.poster_path}`
                  : null;

                return (
                  <div
                    key={result.id}
                    className={`border rounded-lg p-4 cursor-pointer transition-all ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                    onClick={() => handleSelectTMDB(result)}
                  >
                    <div className="flex gap-4">
                      {/* Poster */}
                      <div className="w-20 h-28 bg-gray-200 dark:bg-gray-800 rounded flex-shrink-0 overflow-hidden">
                        {posterUrl ? (
                          <img
                            src={posterUrl}
                            alt={title}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            {item.vodType === 'movie' ? (
                              <Film className="w-8 h-8 text-gray-400" />
                            ) : (
                              <Tv className="w-8 h-8 text-gray-400" />
                            )}
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h4 className="font-semibold text-gray-900 dark:text-white">
                              {title}
                            </h4>
                            {originalTitle !== title && (
                              <p className="text-sm text-gray-500 dark:text-gray-400">
                                {originalTitle}
                              </p>
                            )}
                            {year && (
                              <span className="text-sm text-gray-500 dark:text-gray-400">
                                {year}
                              </span>
                            )}
                          </div>
                          {isSelected && (
                            <CheckCircle className="w-5 h-5 text-blue-500 flex-shrink-0" />
                          )}
                        </div>
                        {result.overview && (
                          <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mb-2">
                            {result.overview}
                          </p>
                        )}
                        {result.vote_average && (
                          <div className="text-xs text-gray-500">
                            ⭐ {result.vote_average.toFixed(1)}/10
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Ações */}
        <div className="flex justify-end gap-2 pt-4 border-t border-gray-200 dark:border-gray-700">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleEnrich}
            disabled={!selectedTMDBId || enrichMutation.isPending}
          >
            {enrichMutation.isPending ? (
              <>
                <Loader className="w-4 h-4 mr-2 animate-spin" />
                Enriquecendo...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4 mr-2" />
                Enriquecer Item
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

