import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, Spinner } from '../../components/ui';
import { api } from '../../api/client';
import toast from 'react-hot-toast';

interface PanelSettings {
  id: string;
  panelName: string | null;
  logoUrl: string | null;
  publicBaseUrl?: string | null;
}

export function PanelSettingsPage() {
  const queryClient = useQueryClient();
  const [panelName, setPanelName] = useState('');
  const [publicBaseUrl, setPublicBaseUrl] = useState('');
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Buscar configurações atuais
  const { data: settings, isLoading } = useQuery({
    queryKey: ['panelSettings'],
    queryFn: async () => {
      const res = await api.get('/settings/panel');
      return res.data.data as PanelSettings;
    },
  });

  useEffect(() => {
    if (settings) {
      setPanelName(settings.panelName || '');
      setPublicBaseUrl(settings.publicBaseUrl || '');
      if (settings.logoUrl) {
        setLogoPreview(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}${settings.logoUrl}`);
      }
    }
  }, [settings]);

  // Atualizar nome do painel
  const updateNameMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await api.put('/settings/panel/name', { panelName: name });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['panelSettings'] });
      toast.success('Nome do painel atualizado com sucesso!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao atualizar nome do painel');
    },
  });

  const updatePublicBaseUrlMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await api.put('/settings/panel/public-base-url', { publicBaseUrl: url });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['panelSettings'] });
      toast.success('URL pública atualizada com sucesso!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao atualizar URL pública');
    },
  });

  // Upload de logo
  const uploadLogoMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('logo', file);
      const res = await api.post('/settings/panel/logo', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['panelSettings'] });
      toast.success('Logo atualizado com sucesso!');
      setSelectedFile(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao fazer upload do logo');
    },
  });

  // Remover logo
  const removeLogoMutation = useMutation({
    mutationFn: async () => {
      const res = await api.delete('/settings/panel/logo');
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['panelSettings'] });
      toast.success('Logo removido com sucesso!');
      setLogoPreview(null);
      setSelectedFile(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao remover logo');
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validar tipo
      if (!file.type.startsWith('image/')) {
        toast.error('Por favor, selecione um arquivo de imagem');
        return;
      }
      
      // Validar tamanho (5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast.error('O arquivo deve ter no máximo 5MB');
        return;
      }

      setSelectedFile(file);
      
      // Criar preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUpload = () => {
    if (selectedFile) {
      uploadLogoMutation.mutate(selectedFile);
    }
  };

  const handleRemoveLogo = () => {
    if (confirm('Tem certeza que deseja remover o logo?')) {
      removeLogoMutation.mutate();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-zinc-900 dark:text-white">
          ⚙️ Configurações do Painel
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400 text-sm lg:text-base mt-1">
          Personalize o nome e logo do painel
        </p>
      </div>

      {/* Nome do Painel */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4">
          Nome do Painel
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
          O nome será exibido na tela de login e no cabeçalho do sistema.
        </p>
        <div className="flex gap-3">
          <Input
            value={panelName}
            onChange={(e) => setPanelName(e.target.value)}
            placeholder="Digite o nome do painel"
            className="flex-1"
            maxLength={100}
          />
          <Button
            onClick={() => updateNameMutation.mutate(panelName)}
            loading={updateNameMutation.isPending}
            disabled={!(panelName || '').trim() || (panelName || '') === (settings?.panelName || '')}
          >
            Salvar Nome
          </Button>
        </div>
      </Card>

      {/* Logo do Painel */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4">
          Logo do Painel
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
          O logo será exibido na tela de login e no cabeçalho. Formatos aceitos: JPG, PNG, GIF, WebP (máx. 5MB).
        </p>

        {/* Preview do Logo */}
        {logoPreview && (
          <div className="mb-4">
            <div className="inline-block p-4 bg-zinc-100 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
              <img
                src={logoPreview}
                alt="Logo preview"
                className="max-w-xs max-h-32 object-contain"
              />
            </div>
          </div>
        )}

        {/* Upload de Logo */}
        <div className="space-y-4">
          <div>
            <input
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
              onChange={handleFileChange}
              className="block w-full text-sm text-zinc-900 dark:text-zinc-400
                file:mr-4 file:py-2 file:px-4
                file:rounded-lg file:border-0
                file:text-sm file:font-semibold
                file:bg-blue-600 dark:file:bg-cyan-500
                file:text-white
                hover:file:bg-blue-700 dark:hover:file:bg-cyan-600
                cursor-pointer
                bg-white dark:bg-zinc-800
                border border-zinc-300 dark:border-zinc-700
                rounded-lg
              "
            />
          </div>

          <div className="flex gap-3">
            {selectedFile && (
              <>
                <Button
                  onClick={handleUpload}
                  loading={uploadLogoMutation.isPending}
                >
                  {settings?.logoUrl ? 'Atualizar Logo' : 'Enviar Logo'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedFile(null);
                    if (settings?.logoUrl) {
                      setLogoPreview(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}${settings.logoUrl}`);
                    } else {
                      setLogoPreview(null);
                    }
                  }}
                >
                  Cancelar
                </Button>
              </>
            )}
            {settings?.logoUrl && !selectedFile && (
              <Button
                variant="danger"
                onClick={handleRemoveLogo}
                loading={removeLogoMutation.isPending}
              >
                Remover Logo
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4">Domínio da Revenda</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
          URL base usada para gerar links públicos (checkout e envio de acesso via WhatsApp). Exemplo: http://revenda.seudominio.com
        </p>
        <div className="flex gap-3">
          <Input
            value={publicBaseUrl}
            onChange={(e) => setPublicBaseUrl(e.target.value)}
            placeholder="http://revenda.seudominio.com"
            className="flex-1"
            maxLength={200}
          />
          <Button
            onClick={() => updatePublicBaseUrlMutation.mutate(publicBaseUrl)}
            loading={updatePublicBaseUrlMutation.isPending}
            disabled={(publicBaseUrl || '').trim() === (settings?.publicBaseUrl || '').trim()}
          >
            Salvar URL
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default PanelSettingsPage;
