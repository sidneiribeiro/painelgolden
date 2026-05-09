/**
 * 🎬 VÍDEO PROMOCIONAL PAGE
 * 
 * Página para geração de vídeos promocionais de filmes/séries
 * para redes sociais (Instagram Reels, TikTok, Facebook).
 */

import { useState, useEffect } from 'react';
import { Search, Film, Tv, Play, Download, Share2, Loader2, Video, Sparkles, AlertCircle } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { copyToClipboard } from '../../utils/clipboard';

const API_URL = import.meta.env.VITE_API_URL || '';

interface SearchResult {
  id: number;
  title: string;
  originalTitle: string;
  year: string;
  type: 'movie' | 'tv';
  posterUrl: string | null;
  backdropUrl: string | null;
  overview: string;
  rating: number;
}

interface ContentDetails {
  tmdbId: number;
  type: 'movie' | 'tv';
  title: string;
  year: string;
  overview: string;
  posterUrl: string;
  backdropUrl: string;
  trailerUrl: string | null;
  trailerKey: string | null;
}

interface GeneratedVideo {
  publicPath: string;
  duration: number;
  title: string;
  year: string;
  synopsis: string;
  shareText: string;
}

export default function VideoPromocionalPage() {
  const token = useAuthStore((state) => state.token);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedContent, setSelectedContent] = useState<ContentDetails | null>(null);
  const [generatedVideo, setGeneratedVideo] = useState<GeneratedVideo | null>(null);
  const [currentVideo, setCurrentVideo] = useState<string | null>(null);
  
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [ctaText, setCtaText] = useState('👉 Quer assistir? Chama no WhatsApp');

  // Carregar vídeo atual ao iniciar
  useEffect(() => {
    loadCurrentVideo();
  }, []);

  const loadCurrentVideo = async () => {
    try {
      const response = await fetch(`${API_URL}/video-promocional/current`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const data = await response.json();
      if (data.success && data.data?.publicPath) {
        setCurrentVideo(data.data.publicPath);
        // Restaurar metadados completos se disponíveis
        if (data.data.shareText) {
          setGeneratedVideo({
            publicPath: data.data.publicPath,
            duration: data.data.duration || 25,
            title: data.data.title || '',
            year: data.data.year || '',
            synopsis: data.data.synopsis || '',
            shareText: data.data.shareText,
          });
        }
      }
    } catch (err) {
      // Ignorar - vídeo atual pode não existir
    }
  };

  const handleSearch = async () => {
    if (!searchQuery || searchQuery.length < 2) return;
    
    setIsSearching(true);
    setError(null);
    setSearchResults([]);
    setSelectedContent(null);
    
    try {
      const response = await fetch(
        `${API_URL}/video-promocional/search?q=${encodeURIComponent(searchQuery)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (!response.ok) throw new Error('Erro na busca');
      const data = await response.json();
      
      if (data.success) {
        setSearchResults(data.data);
      } else {
        setError(data.error || 'Erro na busca');
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao buscar');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectContent = async (result: SearchResult) => {
    setIsLoadingDetails(true);
    setError(null);
    setSelectedContent(null);
    
    try {
      const response = await fetch(
        `${API_URL}/video-promocional/details/${result.type}/${result.id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (!response.ok) throw new Error('Erro ao obter detalhes');
      const data = await response.json();
      
      if (data.success) {
        setSelectedContent(data.data);
      } else {
        setError(data.error || 'Erro ao obter detalhes');
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao obter detalhes');
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleGenerateVideo = async () => {
    if (!selectedContent) return;
    
    setIsGenerating(true);
    setError(null);
    setGeneratedVideo(null);
    
    try {
      const response = await fetch(`${API_URL}/video-promocional/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tmdbId: selectedContent.tmdbId,
          type: selectedContent.type,
          ctaText,
        }),
      });
      
      if (!response.ok) throw new Error('Erro ao gerar vídeo');
      const data = await response.json();
      
      if (data.success) {
        setGeneratedVideo(data.data);
        setCurrentVideo(data.data.publicPath);
        
        // Copiar texto automaticamente
        if (data.data.shareText) {
          copyToClipboard(data.data.shareText);
          // Mostrar toast de sucesso
          const toast = document.createElement('div');
          toast.className = 'fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50';
          toast.textContent = '✅ Texto copiado para a legenda!';
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 3000);
        }
      } else {
        setError(data.error || 'Erro ao gerar vídeo');
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao gerar vídeo');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!currentVideo) return;
    
    const link = document.createElement('a');
    link.href = currentVideo;
    link.download = 'video-promocional.mp4';
    link.click();
  };

  const handleShare = async () => {
    if (!currentVideo) return;
    
    try {
      // Tentar usar Web Share API
      if (navigator.share) {
        const videoUrl = currentVideo;
        const response = await fetch(videoUrl);
        const blob = await response.blob();
        const file = new File([blob], 'video-promocional.mp4', { type: 'video/mp4' });
        
        const shareText = generatedVideo?.shareText || 'Confira este vídeo promocional!';
        const title = generatedVideo ? `${generatedVideo.title} (${generatedVideo.year})` : 'Vídeo Promocional';
        
        await navigator.share({
          title,
          text: shareText,
          files: [file],
        });
      } else {
        // Fallback: copiar link para clipboard
        const fullUrl = window.location.origin + currentVideo;
        await copyToClipboard(fullUrl);
        alert('Link copiado para a área de transferência!');
      }
    } catch (err: any) {
      // Se o share falhar, copiar link
      try {
        const fullUrl = window.location.origin + currentVideo;
        await copyToClipboard(fullUrl);
        alert('Link do vídeo copiado!');
      } catch {
        console.error('Erro ao compartilhar:', err);
        alert('Não foi possível compartilhar. Tente baixar o vídeo.');
      }
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl flex items-center justify-center">
          <Video className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Vídeo Promocional</h1>
          <p className="text-zinc-500 dark:text-zinc-400">
            Gere vídeos para Instagram, TikTok e Facebook
          </p>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500" />
          <span className="text-red-700 dark:text-red-400">{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column - Search & Select */}
        <div className="space-y-6">
          {/* Search Box */}
          <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4 flex items-center gap-2">
              <Search className="w-5 h-5" />
              Buscar Filme ou Série
            </h2>
            
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Digite o nome do filme ou série..."
                className="flex-1 px-4 py-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button
                onClick={handleSearch}
                disabled={isSearching || searchQuery.length < 2}
                className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-400 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                {isSearching ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Search className="w-5 h-5" />
                )}
                Buscar
              </button>
            </div>
          </div>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4">
                Resultados ({searchResults.length})
              </h2>
              
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {searchResults.map((result) => (
                  <button
                    key={`${result.type}-${result.id}`}
                    onClick={() => handleSelectContent(result)}
                    disabled={isLoadingDetails}
                    className={`w-full flex items-center gap-4 p-3 rounded-lg border transition-all ${
                      selectedContent?.tmdbId === result.id
                        ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                        : 'border-zinc-200 dark:border-zinc-700 hover:border-purple-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {/* Poster */}
                    <div className="w-16 h-24 bg-zinc-200 dark:bg-zinc-700 rounded-lg overflow-hidden flex-shrink-0">
                      {result.posterUrl ? (
                        <img
                          src={result.posterUrl}
                          alt={result.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          {result.type === 'movie' ? (
                            <Film className="w-6 h-6 text-zinc-400" />
                          ) : (
                            <Tv className="w-6 h-6 text-zinc-400" />
                          )}
                        </div>
                      )}
                    </div>
                    
                    {/* Info */}
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          result.type === 'movie'
                            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                            : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                        }`}>
                          {result.type === 'movie' ? 'Filme' : 'Série'}
                        </span>
                        {result.year && (
                          <span className="text-xs text-zinc-500">{result.year}</span>
                        )}
                        <span className="text-xs text-yellow-500">⭐ {result.rating.toFixed(1)}</span>
                      </div>
                      <h3 className="font-medium text-zinc-900 dark:text-white mt-1 line-clamp-1">
                        {result.title}
                      </h3>
                      <p className="text-sm text-zinc-500 dark:text-zinc-400 line-clamp-2 mt-1">
                        {result.overview || 'Sem descrição disponível'}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Selected Content Details */}
          {selectedContent && (
            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-500" />
                Conteúdo Selecionado
              </h2>
              
              <div className="flex gap-4">
                {selectedContent.posterUrl && (
                  <img
                    src={selectedContent.posterUrl}
                    alt={selectedContent.title}
                    className="w-32 h-48 object-cover rounded-lg"
                  />
                )}
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-zinc-900 dark:text-white">
                    {selectedContent.title}
                  </h3>
                  <p className="text-zinc-500 dark:text-zinc-400">{selectedContent.year}</p>
                  <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-2 line-clamp-3">
                    {selectedContent.overview}
                  </p>
                  
                  {selectedContent.trailerKey ? (
                    <div className="mt-3 flex items-center gap-2 text-green-600 dark:text-green-400">
                      <Play className="w-4 h-4" />
                      <span className="text-sm">Trailer disponível</span>
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center gap-2 text-red-500">
                      <AlertCircle className="w-4 h-4" />
                      <span className="text-sm">Trailer não disponível</span>
                    </div>
                  )}
                </div>
              </div>

              {/* CTA Input */}
              <div className="mt-4">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  Texto de chamada (CTA)
                </label>
                <input
                  type="text"
                  value={ctaText}
                  onChange={(e) => setCtaText(e.target.value)}
                  className="w-full px-4 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white"
                />
              </div>

              {/* Generate Button */}
              <button
                onClick={handleGenerateVideo}
                disabled={isGenerating || !selectedContent.trailerKey}
                className="mt-4 w-full py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-zinc-400 disabled:to-zinc-500 text-white rounded-lg font-semibold transition-all flex items-center justify-center gap-2"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Gerando vídeo... (pode levar até 2 min)
                  </>
                ) : (
                  <>
                    <Video className="w-5 h-5" />
                    Gerar Vídeo Promocional
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Right Column - Preview & Actions */}
        <div className="space-y-6">
          {/* Video Preview */}
          <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4 flex items-center gap-2">
              <Play className="w-5 h-5" />
              Preview do Vídeo
            </h2>
            
            <div className="aspect-[9/16] bg-zinc-900 rounded-xl overflow-hidden flex items-center justify-center max-h-[600px] mx-auto">
              {currentVideo ? (
                <video
                  key={currentVideo}
                  src={currentVideo}
                  controls
                  className="w-full h-full object-contain"
                  poster={selectedContent?.backdropUrl || undefined}
                />
              ) : (
                <div className="text-center text-zinc-500 p-8">
                  <Video className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p>Nenhum vídeo gerado</p>
                  <p className="text-sm mt-2">Busque um filme ou série e clique em "Gerar Vídeo"</p>
                </div>
              )}
            </div>

            {/* Actions */}
            {currentVideo && (
              <div className="mt-4 space-y-3">
                <div className="flex gap-3">
                  <button
                    onClick={handleDownload}
                    className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <Download className="w-5 h-5" />
                    Baixar para Reels/Feed
                  </button>
                  <button
                    onClick={handleShare}
                    className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <Share2 className="w-5 h-5" />
                    Stories
                  </button>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 text-center">
                  📱 Para Reels/Feed: baixe o vídeo e poste pelo app do Instagram
                </p>
              </div>
            )}
          </div>

          {/* Share Text Preview */}
          {generatedVideo && (
            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4">
                Texto para Legenda
              </h2>
              
              <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-4 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                {generatedVideo.shareText}
              </div>
              
              <button
                onClick={() => {
                  copyToClipboard(generatedVideo.shareText);
                  alert('Texto copiado!');
                }}
                className="mt-3 w-full py-2 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-200 rounded-lg font-medium transition-colors"
              >
                Copiar Texto
              </button>
            </div>
          )}

          {/* Instructions */}
          <div className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 rounded-xl border border-purple-200 dark:border-purple-800 p-6">
            <h3 className="font-semibold text-purple-900 dark:text-purple-300 mb-3">
              📱 Como usar
            </h3>
            <ol className="text-sm text-purple-800 dark:text-purple-400 space-y-2">
              <li>1. Busque um filme ou série pelo nome</li>
              <li>2. Selecione o conteúdo desejado</li>
              <li>3. Personalize o texto de chamada (CTA)</li>
              <li>4. Clique em "Gerar Vídeo Promocional"</li>
              <li>5. Baixe ou compartilhe diretamente nas redes</li>
            </ol>
            <div className="mt-4 p-3 bg-white/50 dark:bg-zinc-900/50 rounded-lg">
              <p className="text-xs text-purple-700 dark:text-purple-400">
                <strong>Formato:</strong> 1080x1920 (9:16 vertical)<br />
                <strong>Duração:</strong> ~25 segundos<br />
                <strong>Ideal para:</strong> Instagram Reels, TikTok, Facebook
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
