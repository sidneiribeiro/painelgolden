import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Card, Spinner } from '../../components/ui';
import { api } from '../../api/client';
import toast from 'react-hot-toast';

interface AsaasConfig {
  id?: string;
  environment?: string;
  pixKey?: string;
  isActive?: boolean;
  webhookToken?: string;
  webhookUrl?: string;
}

export function AsaasPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    apiKey: '',
    environment: 'sandbox',
    pixKey: '',
  });

  // Buscar configuração existente
  const { data: config, isLoading } = useQuery({
    queryKey: ['asaasConfig'],
    queryFn: async () => {
      try {
        const res = await api.get('/asaas/config');
        return res.data.data as AsaasConfig | null;
      } catch (error: any) {
        if (error.response?.status === 404) {
          return null;
        }
        throw error;
      }
    },
  });

  useEffect(() => {
    if (config) {
      setForm((prev) => ({
        ...prev,
        environment: config.environment || 'sandbox',
        pixKey: config.pixKey || '',
      }));
    }
  }, [config]);

  // Salvar configuração
  const saveMutation = useMutation({
    mutationFn: async (data: { apiKey: string; environment: string; pixKey?: string }) => {
      const res = await api.post('/asaas/config', data);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['asaasConfig'] });
      toast.success('Configuração salva com sucesso!');
      
      if (data.data?.webhookUrl) {
        toast.success(`Webhook URL: ${data.data.webhookUrl}`, { duration: 8000 });
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao salvar configuração');
    },
  });

  // Testar conexão
  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/asaas/test');
      return res.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success('Conexão com Asaas OK! ✅');
      } else {
        toast.error('Falha na conexão com Asaas');
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao testar conexão');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!form.apiKey.trim()) {
      toast.error('API Key é obrigatória');
      return;
    }

    saveMutation.mutate({
      apiKey: form.apiKey,
      environment: form.environment,
      pixKey: form.pixKey || undefined,
    });
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
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-zinc-900 dark:text-white">
          💳 Integração Asaas
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400 text-sm lg:text-base mt-1">
          Configure sua integração com o Asaas para receber pagamentos PIX
        </p>
      </div>

      {/* Card de Informações */}
      <Card className="p-6 bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30">
        <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-300 mb-2">
          ℹ️ Como obter sua API Key
        </h3>
        <ol className="list-decimal list-inside space-y-2 text-blue-800 dark:text-blue-200/80 text-sm">
          <li>Acesse sua conta Asaas (sandbox ou produção)</li>
          <li>Vá em <strong>Minha Conta &gt; Integração</strong></li>
          <li>Clique em <strong>Gerar API Key</strong></li>
          <li>Copie a chave gerada e cole no campo abaixo</li>
        </ol>
        <div className="mt-4 pt-4 border-t border-blue-200 dark:border-blue-500/30">
          <p className="text-sm text-blue-700 dark:text-blue-300">
            <strong>Sandbox:</strong> Use para testes (https://sandbox.asaas.com)
          </p>
          <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
            <strong>Produção:</strong> Use em ambiente real (https://www.asaas.com)
          </p>
        </div>
      </Card>

      {/* Formulário de Configuração */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-white mb-4">
          Configuração
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Ambiente */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              Ambiente
            </label>
            <select
              value={form.environment}
              onChange={(e) => setForm({ ...form, environment: e.target.value })}
              className="w-full px-4 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-zinc-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
            >
              <option value="sandbox">Sandbox (Testes)</option>
              <option value="production">Produção</option>
            </select>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Use Sandbox para testes antes de ir para produção
            </p>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              API Key <span className="text-red-500">*</span>
            </label>
            <Input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder="Cole sua API Key do Asaas aqui"
              required
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Sua API Key será criptografada e armazenada com segurança
            </p>
          </div>

          {/* Chave PIX (opcional) */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-400 mb-2">
              Chave PIX (Opcional)
            </label>
            <Input
              type="text"
              value={form.pixKey}
              onChange={(e) => setForm({ ...form, pixKey: e.target.value })}
              placeholder="Ex: email@exemplo.com ou CPF/CNPJ"
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Chave PIX cadastrada na sua conta Asaas (para referência)
            </p>
          </div>

          {/* Botões */}
          <div className="flex gap-3 pt-4">
            <Button
              type="submit"
              loading={saveMutation.isPending}
              disabled={!form.apiKey.trim()}
            >
              {config ? 'Atualizar Configuração' : 'Salvar Configuração'}
            </Button>
            
            {config && (
              <Button
                type="button"
                variant="outline"
                onClick={() => testMutation.mutate()}
                loading={testMutation.isPending}
              >
                🔍 Testar Conexão
              </Button>
            )}
          </div>
        </form>
      </Card>

      {/* Informações do Webhook */}
      {config?.webhookToken && (
        <Card className="p-6 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30">
          <h3 className="text-lg font-semibold text-amber-900 dark:text-amber-300 mb-2">
            🔗 Configurar Webhook no Asaas
          </h3>
          <p className="text-sm text-amber-800 dark:text-amber-200/80 mb-3">
            Para receber notificações de pagamento e renovar clientes automaticamente, configure o webhook no painel Asaas:
          </p>
          <ol className="list-decimal list-inside space-y-2 text-amber-800 dark:text-amber-200/80 text-sm mb-4">
            <li>Acesse <strong>Minha Conta &gt; Integração &gt; Webhooks</strong> no Asaas</li>
            <li>Clique em <strong>Adicionar Webhook</strong></li>
            <li>Cole a URL abaixo:</li>
          </ol>
          <div className="bg-white dark:bg-zinc-900 p-3 rounded border border-amber-200 dark:border-amber-500/30">
            <code className="text-sm text-zinc-900 dark:text-white break-all">
              {typeof window !== 'undefined' 
                ? `${window.location.origin}/api/asaas/webhook/${config.webhookToken}`
                : `[URL do servidor]/api/asaas/webhook/${config.webhookToken}`
              }
            </code>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => {
                const url = typeof window !== 'undefined' 
                  ? `${window.location.origin}/api/asaas/webhook/${config.webhookToken}`
                  : '';
                if (url) {
                  navigator.clipboard.writeText(url);
                  toast.success('URL copiada!');
                }
              }}
            >
              📋 Copiar URL
            </Button>
          </div>
          <div className="mt-4 pt-4 border-t border-amber-200 dark:border-amber-500/30">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-300 mb-2">
              Eventos para selecionar:
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm text-amber-800 dark:text-amber-200/80">
              <li>✅ PAYMENT_RECEIVED</li>
              <li>✅ PAYMENT_CONFIRMED</li>
              <li>✅ PAYMENT_OVERDUE (opcional)</li>
              <li>✅ PAYMENT_REFUNDED (opcional)</li>
            </ul>
          </div>
        </Card>
      )}

      {/* Status da Configuração */}
      {config && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4">
            Status da Configuração
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-zinc-600 dark:text-zinc-400">Ambiente:</span>
              <span className="font-medium text-zinc-900 dark:text-white">
                {config.environment === 'sandbox' ? '🔬 Sandbox' : '🚀 Produção'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-zinc-600 dark:text-zinc-400">Status:</span>
              <span className={`font-medium ${config.isActive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {config.isActive ? '✅ Ativo' : '❌ Inativo'}
              </span>
            </div>
            {config.pixKey && (
              <div className="flex justify-between items-center">
                <span className="text-zinc-600 dark:text-zinc-400">Chave PIX:</span>
                <span className="font-medium text-zinc-900 dark:text-white">{config.pixKey}</span>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

