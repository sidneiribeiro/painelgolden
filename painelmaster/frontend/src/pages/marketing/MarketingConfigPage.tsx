import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, Spinner } from '../../components/ui';
import { api } from '../../api/client';
import toast from 'react-hot-toast';

interface MarketingConfig {
  id?: number;
  painelName: string;
  painelLogo?: string;
  whatsappNumber?: string;
  primaryColor: string;
  secondaryColor: string;
  sloganText?: string;
  maxBannersPerImport: number;
  videoMusicFilmes?: string;
  videoMusicSeries?: string;
  videoMusicFutebol?: string;
}

export default function MarketingConfigPage() {
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const queryClient = useQueryClient();

  // Buscar configuração
  const { data: config, isLoading } = useQuery<MarketingConfig>({
    queryKey: ['marketingConfig'],
    queryFn: async () => {
      const response = await api.get('/marketing/config');
      return response.data;
    },
  });

  // Salvar configuração
  const saveMutation = useMutation({
    mutationFn: async (data: MarketingConfig) => {
      // Upload de logo primeiro se houver
      if (logoFile) {
        const formData = new FormData();
        formData.append('logo', logoFile);
        const uploadResponse = await api.post('/marketing/upload-logo', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        data.painelLogo = uploadResponse.data.url;
      }

      const response = await api.post('/marketing/config', data);
      return response.data;
    },
    onSuccess: () => {
      toast.success('Configuração salva com sucesso!');
      queryClient.invalidateQueries({ queryKey: ['marketingConfig'] });
      setLogoFile(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Erro ao salvar configuração');
    },
  });

  const fileBase = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

  useEffect(() => {
    if (config?.painelLogo) {
      const url = config.painelLogo.startsWith('/')
        ? `${fileBase}${config.painelLogo}`
        : config.painelLogo;
      setLogoPreview(url);
    }
  }, [config, fileBase]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const data: MarketingConfig = {
      painelName: formData.get('painelName') as string || 'PAINEL SGPLAY',
      whatsappNumber: formData.get('whatsappNumber') as string || undefined,
      primaryColor: formData.get('primaryColor') as string || '#00E5FF',
      secondaryColor: formData.get('secondaryColor') as string || '#1E88E5',
      sloganText: formData.get('sloganText') as string || undefined,
      maxBannersPerImport: parseInt(formData.get('maxBannersPerImport') as string) || 30,
      videoMusicFilmes: formData.get('videoMusicFilmes') as string || undefined,
      videoMusicSeries: formData.get('videoMusicSeries') as string || undefined,
      videoMusicFutebol: formData.get('videoMusicFutebol') as string || undefined,
    };

    if (config?.painelLogo && !logoFile) {
      data.painelLogo = config.painelLogo;
    }

    saveMutation.mutate(data);
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        setLogoPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">⚙️ Configuração de Marketing</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Informações do Painel */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">📋 Informações do Painel</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Nome do Painel</label>
              <Input
                name="painelName"
                defaultValue={config?.painelName || 'PAINEL SGPLAY'}
                placeholder="PAINEL SGPLAY"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Slogan</label>
              <Input
                name="sloganText"
                defaultValue={config?.sloganText || ''}
                placeholder="O melhor do streaming você encontra aqui"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium mb-2">Logo do Painel</label>
            <div className="flex items-center gap-4">
              {logoPreview && (
                <img
                  src={logoPreview}
                  alt="Logo"
                  className="w-24 h-24 object-contain bg-gray-700 rounded-lg p-2"
                  onError={(e) => {
                    console.error('Erro ao carregar logo:', logoPreview);
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              )}
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoChange}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-cyan-500 file:text-white hover:file:bg-cyan-600"
              />
            </div>
            {config?.painelLogo && !logoPreview && (
              <p className="text-xs text-gray-400 mt-2">Logo atual: {config.painelLogo}</p>
            )}
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium mb-2">Máximo de Banners por Importação</label>
            <Input
              name="maxBannersPerImport"
              type="number"
              min="1"
              max="50"
              defaultValue={config?.maxBannersPerImport || 30}
              placeholder="30"
            />
          </div>
        </Card>

        {/* Cores */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">🎨 Cores</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Cor Primária (Cyan)</label>
              <div className="flex gap-2">
                <input
                  type="color"
                  name="primaryColor"
                  defaultValue={config?.primaryColor || '#00E5FF'}
                  className="w-20 h-12 rounded-lg cursor-pointer"
                />
                <Input
                  name="primaryColor"
                  defaultValue={config?.primaryColor || '#00E5FF'}
                  className="flex-1"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Cor Secundária (Azul)</label>
              <div className="flex gap-2">
                <input
                  type="color"
                  name="secondaryColor"
                  defaultValue={config?.secondaryColor || '#1E88E5'}
                  className="w-20 h-12 rounded-lg cursor-pointer"
                />
                <Input
                  name="secondaryColor"
                  defaultValue={config?.secondaryColor || '#1E88E5'}
                  className="flex-1"
                />
              </div>
            </div>
          </div>
        </Card>

        {/* WhatsApp */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">📱 WhatsApp</h2>

          <div>
            <label className="block text-sm font-medium mb-2">Número do WhatsApp</label>
            <Input
              name="whatsappNumber"
              defaultValue={config?.whatsappNumber || ''}
              placeholder="+55 11 99999-9999"
            />
          </div>
        </Card>

        {/* Músicas para Vídeos */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">🎵 Músicas para Vídeos</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Música para Filmes</label>
              <div className="flex gap-2">
                <Input
                  name="videoMusicFilmes"
                  defaultValue={config?.videoMusicFilmes || ''}
                  placeholder="/storage/music/filmes.mp3"
                  className="flex-1"
                />
                <input
                  type="file"
                  accept="audio/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file && file.size > 100 * 1024 * 1024) {
                      toast.error('Arquivo muito grande! Máximo: 100MB');
                      return;
                    }
                    if (file) {
                      const formData = new FormData();
                      formData.append('music', file);
                      formData.append('type', 'filmes');
                      try {
                        const response = await api.post('/marketing/upload-music', formData, {
                          headers: { 'Content-Type': 'multipart/form-data' },
                        });
                        const input = document.querySelector('input[name="videoMusicFilmes"]') as HTMLInputElement;
                        if (input) input.value = response.data.path;
                        toast.success('Música enviada com sucesso!');
                      } catch (error: any) {
                        toast.error(error.response?.data?.message || 'Erro ao enviar música');
                      }
                    }
                  }}
                  className="block text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-cyan-500 file:text-white hover:file:bg-cyan-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Música para Séries</label>
              <div className="flex gap-2">
                <Input
                  name="videoMusicSeries"
                  defaultValue={config?.videoMusicSeries || ''}
                  placeholder="/storage/music/series.mp3"
                  className="flex-1"
                />
                <input
                  type="file"
                  accept="audio/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file && file.size > 100 * 1024 * 1024) {
                      toast.error('Arquivo muito grande! Máximo: 100MB');
                      return;
                    }
                    if (file) {
                      const formData = new FormData();
                      formData.append('music', file);
                      formData.append('type', 'series');
                      try {
                        const response = await api.post('/marketing/upload-music', formData, {
                          headers: { 'Content-Type': 'multipart/form-data' },
                        });
                        const input = document.querySelector('input[name="videoMusicSeries"]') as HTMLInputElement;
                        if (input) input.value = response.data.path;
                        toast.success('Música enviada com sucesso!');
                      } catch (error: any) {
                        toast.error(error.response?.data?.message || 'Erro ao enviar música');
                      }
                    }
                  }}
                  className="block text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-cyan-500 file:text-white hover:file:bg-cyan-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Música para Futebol</label>
              <div className="flex gap-2">
                <Input
                  name="videoMusicFutebol"
                  defaultValue={config?.videoMusicFutebol || ''}
                  placeholder="/storage/music/futebol.mp3"
                  className="flex-1"
                />
                <input
                  type="file"
                  accept="audio/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file && file.size > 100 * 1024 * 1024) {
                      toast.error('Arquivo muito grande! Máximo: 100MB');
                      return;
                    }
                    if (file) {
                      const formData = new FormData();
                      formData.append('music', file);
                      formData.append('type', 'futebol');
                      try {
                        const response = await api.post('/marketing/upload-music', formData, {
                          headers: { 'Content-Type': 'multipart/form-data' },
                        });
                        const input = document.querySelector('input[name="videoMusicFutebol"]') as HTMLInputElement;
                        if (input) input.value = response.data.path;
                        toast.success('Música enviada com sucesso!');
                      } catch (error: any) {
                        toast.error(error.response?.data?.message || 'Erro ao enviar música');
                      }
                    }
                  }}
                  className="block text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-cyan-500 file:text-white hover:file:bg-cyan-600"
                />
              </div>
            </div>
            <p className="text-xs text-gray-400">Limite de tamanho: 100MB por arquivo</p>
          </div>
        </Card>

        <Button
          type="submit"
          disabled={saveMutation.isPending}
          className="w-full py-4 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600"
        >
          {saveMutation.isPending ? 'Salvando...' : 'Salvar Configuração'}
        </Button>
      </form>
    </div>
  );
}
