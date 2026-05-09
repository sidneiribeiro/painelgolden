import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, Badge, Spinner } from '../../components/ui';
import { api } from '../../api/client';
import toast from 'react-hot-toast';

interface NotificationSettings {
  enabled: boolean;
  daysBefore: string;
  sendTime: string;
  whatsappEnabled: boolean;
  botbotAppKey?: string;
  botbotAuthKey?: string;
  telegramEnabled: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
  emailEnabled: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
  reminderTemplate?: string;
  urgentReminderTemplate?: string;
  expiryTemplate?: string;
  renewalConfirmationTemplate?: string;
  welcomeTemplate?: string;
  recoveryTemplate?: string;
  coreWelcomeTemplate?: string;
  coreRenewalTemplate?: string;
  corePaymentReminderTemplate?: string;
  coreReminderMinAgeMinutes?: number;
  coreReminderMinGapHours?: number;
  coreReminderMaxCount?: number;
  corePaymentOverdueTemplate?: string;
}

interface NotificationLog {
  id: string;
  customerName?: string;
  phone?: string;
  type: string;
  channel: string;
  status: string;
  message: string;
  sentAt?: string;
  error?: string;
  createdAt: string;
}

type TabType = 'general' | 'whatsapp' | 'telegram' | 'email' | 'templates' | 'logs';

const defaultTemplates = {
  reminder: `📅 *Lembrete de Renovação*

Olá {name}! 👋

Sua assinatura vence em *{days_until_expiry} dias* ({expires_at}).

📦 Plano: {package}
💰 Valor: R$ {plan_price}

Renove agora e não perca acesso!

🔗 {renew_url}`,

  urgent: `⚠️ *ATENÇÃO - ÚLTIMO DIA!*

{name}, sua assinatura vence *AMANHÃ*!

Não fique sem acesso - renove agora:
🔗 {renew_url}

📦 Plano: {package}
💰 Valor: R$ {plan_price}`,

  expiry: `🔴 *Assinatura Vencida*

{name}, sua assinatura venceu hoje.

Para reativar seu acesso:
🔗 {renew_url}

Qualquer dúvida, estamos à disposição!`,

  welcome: `🎉 *Bem-vindo!*

Olá {name}! 

Seus dados de acesso:

👤 Usuário: {username}
🔑 Senha: {password}
📡 Validade: {expires_at}

📺 Link M3U:
{m3u_url}

Bom entretenimento! 🍿`,

  recovery: `🎁 *PROMOÇÃO ESPECIAL - Recupere Seu Acesso!*

Olá {name}! 😊

Sentimos sua falta! Seu acesso expirou há *{days_until_expiry} dias*.

🎯 *OFERTA EXCLUSIVA PARA VOCÊ:*
📦 Plano: {package}
💰 Valor promocional: R$ {plan_price}

Não perca mais tempo sem seus canais favoritos!

🔗 Renove agora: {renew_url}

Esta é uma oferta especial para clientes como você! 🌟`,

  coreWelcome: `Olá {name}!

Seu acesso foi liberado:
Usuário: {username}
Senha: {password}
Vence em: {expires_at}

Links:
M3U: {m3u_url}
XMLTV: {xmltv_url}
XC API: {xc_api_url}`,

  coreRenewal: `✅ Renovação confirmada!

Usuário: {username}
Novo vencimento: {expires_at}`,

  corePaymentReminder: `Olá {name}!

Segue um lembrete do seu pagamento PIX.

📦 Pacote: {package}
💰 Valor: {plan_price}
📅 Vencimento: {due_date}

PIX copia e cola:
{pix}

Link do pagamento:
{invoice_url}

Acompanhar status:
{checkout_url}`,

  corePaymentOverdue: `Olá {name}!

⚠️ Seu pagamento está vencido.

📦 Pacote: {package}
💰 Valor: {plan_price}
📅 Vencimento: {due_date}

Se precisar, gere um novo PIX e eu te envio novamente.

Link do pagamento:
{invoice_url}

Acompanhar status:
{checkout_url}`,
};

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabType>('general');
  const [testPhone, setTestPhone] = useState('');
  const [testChatId, setTestChatId] = useState('');

  // Busca configurações
  const { data: settings, isLoading } = useQuery({
    queryKey: ['notification-settings'],
    queryFn: async () => {
      const res = await api.get('/notifications/settings');
      return res.data.data as NotificationSettings;
    },
  });

  // Busca logs
  const { data: logsData } = useQuery({
    queryKey: ['notification-logs'],
    queryFn: async () => {
      const res = await api.get('/notifications/logs?perPage=50');
      return res.data;
    },
    enabled: activeTab === 'logs',
  });

  // Form state
  const [form, setForm] = useState<Partial<NotificationSettings>>({});

  // Atualiza form quando carrega settings
  useEffect(() => {
    if (settings) {
      setForm(settings);
    }
  }, [settings]);

  // Mutation para salvar
  const saveMutation = useMutation({
    mutationFn: async (data: Partial<NotificationSettings>) => {
      const res = await api.put('/notifications/settings', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-settings'] });
      toast.success('Configurações salvas!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao salvar');
    },
  });

  // Teste WhatsApp
  const testWhatsAppMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/notifications/test-whatsapp', { phone: testPhone });
      return res.data;
    },
    onSuccess: () => {
      toast.success('Mensagem de teste enviada!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao enviar');
    },
  });

  // Teste Telegram
  const testTelegramMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/notifications/test-telegram', { chatId: testChatId });
      return res.data;
    },
    onSuccess: () => {
      toast.success('Mensagem de teste enviada!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao enviar');
    },
  });

  // Executar agora
  const runNowMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/notifications/run-now');
      return res.data;
    },
    onSuccess: (data) => {
      toast.success(data.message || 'Notificações enviadas!');
      queryClient.invalidateQueries({ queryKey: ['notification-logs'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro');
    },
  });

  // 🚀 NOVA FUNCIONALIDADE: Campanha de Recuperação
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const [minDaysExpired, setMinDaysExpired] = useState(3);
  const [maxDaysExpired, setMaxDaysExpired] = useState(30);
  const [customTemplate, setCustomTemplate] = useState('');

  const recoveryCampaignMutation = useMutation({
    mutationFn: async () => {
      try {
        const res = await api.post('/notifications/recovery-campaign', {
          minDaysExpired,
          maxDaysExpired: maxDaysExpired || undefined,
          customTemplate: customTemplate.trim() || undefined,
        });
        return res.data;
      } catch (error: any) {
        // Se a resposta tiver dados mesmo com erro HTTP, retornar os dados
        if (error.response?.data?.result || error.response?.data?.success) {
          return error.response.data;
        }
        throw error;
      }
    },
    onSuccess: (data) => {
      // Tratar diferentes formatos de resposta
      const result = data?.result || data;
      const sent = result?.sent || 0;
      const failed = result?.failed || 0;
      const skipped = result?.skipped || 0;
      
      // Sempre mostrar sucesso se houver mensagens enviadas ou se success=true
      if (data?.success || sent > 0) {
        toast.success(`✅ Campanha enviada! ${sent} mensagens enviadas, ${failed} falharam, ${skipped} ignorados.`);
      } else if (failed > 0) {
        toast.warning(`⚠️ Campanha processada: ${sent} enviadas, ${failed} falharam, ${skipped} ignorados.`);
      } else {
        toast.info(`ℹ️ Campanha processada: ${sent} enviadas, ${failed} falharam, ${skipped} ignorados.`);
      }
      
      queryClient.invalidateQueries({ queryKey: ['notification-logs'] });
      setShowRecoveryModal(false);
      setCustomTemplate(''); // Limpar template após envio
    },
    onError: (error: any) => {
      // Verificar se há dados de sucesso mesmo com erro
      const errorData = error.response?.data;
      if (errorData?.result || errorData?.success) {
        const result = errorData.result || errorData;
        const sent = result?.sent || 0;
        const failed = result?.failed || 0;
        const skipped = result?.skipped || 0;
        
        // Se houver sucesso ou mensagens enviadas, mostrar como sucesso
        if (errorData.success || sent > 0) {
          toast.success(`✅ Campanha enviada! ${sent} mensagens enviadas, ${failed} falharam, ${skipped} ignorados.`);
        } else {
          toast.warning(`⚠️ Campanha processada: ${sent} enviadas, ${failed} falharam, ${skipped} ignorados.`);
        }
        
        queryClient.invalidateQueries({ queryKey: ['notification-logs'] });
        setShowRecoveryModal(false);
        setCustomTemplate('');
      } else {
        // Só mostrar erro real se não houver dados de sucesso
        const errorMessage = errorData?.error || errorData?.message || error.message || 'Erro ao enviar campanha';
        toast.error(errorMessage);
      }
    },
  });

  const updateForm = (field: keyof NotificationSettings, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    saveMutation.mutate(form);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  const currentSettings = { ...settings, ...form };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">🤖 Configurações do BOT</h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-1">Configure notificações automáticas</p>
        </div>
        <Button onClick={handleSave} loading={saveMutation.isPending}>
          💾 Salvar Configurações
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap border-b border-zinc-200 dark:border-zinc-700 pb-2">
        {[
          { key: 'general', label: '⚙️ Geral' },
          { key: 'whatsapp', label: '📱 WhatsApp' },
          { key: 'telegram', label: '📨 Telegram' },
          { key: 'email', label: '📧 Email' },
          { key: 'templates', label: '📝 Templates' },
          { key: 'logs', label: '📋 Logs' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as TabType)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-blue-600 dark:bg-cyan-500 text-white'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Conteúdo das Tabs */}
      {activeTab === 'general' && (
        <Card className="p-6 space-y-4">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Configurações Gerais</h3>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={currentSettings.enabled ?? true}
              onChange={(e) => updateForm('enabled', e.target.checked)}
              className="w-5 h-5 rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-blue-600 dark:text-cyan-500"
            />
            <span className="text-zinc-900 dark:text-white">Ativar notificações automáticas</span>
          </label>

          <Input
            label="Horário de envio"
            type="time"
            value={currentSettings.sendTime ?? '09:00'}
            onChange={(e) => updateForm('sendTime', e.target.value)}
          />

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              Dias antes/após do vencimento para notificar
            </label>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-2">Antes do vencimento:</p>
                <div className="flex gap-2 flex-wrap">
                  {[7, 3, 1, 0].map((day) => {
                    const days = (currentSettings.daysBefore || '7,3,1,0').split(',').map(Number);
                    const isSelected = days.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => {
                          const newDays = isSelected
                            ? days.filter((d) => d !== day)
                            : [...days, day].sort((a, b) => b - a);
                          updateForm('daysBefore', newDays.join(','));
                        }}
                        className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                          isSelected
                            ? 'bg-blue-600 dark:bg-cyan-500 text-white'
                            : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-700'
                        }`}
                      >
                        {day === 0 ? 'No dia' : `${day} dias antes`}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-2">Após o vencimento:</p>
                <div className="flex gap-2 flex-wrap">
                  {[3].map((day) => {
                    const days = (currentSettings.daysBefore || '7,3,1,0').split(',').map(Number);
                    // Para "após", usamos valores negativos no backend (-3 = 3 dias após)
                    const isSelected = days.includes(-day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => {
                          const currentDays = (currentSettings.daysBefore || '7,3,1,0').split(',').map(Number);
                          const newDays = isSelected
                            ? currentDays.filter((d) => d !== -day)
                            : [...currentDays, -day];
                          updateForm('daysBefore', newDays.join(','));
                        }}
                        className={`px-4 py-2 rounded-lg text-sm ${
                          isSelected
                            ? 'bg-red-600 dark:bg-red-500 text-white'
                            : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-700'
                        }`}
                      >
                        {day} dias após
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-3 p-3 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                <p className="text-xs text-zinc-700 dark:text-zinc-300">
                  💡 <strong>Testes:</strong> Notificações automáticas serão enviadas 1 hora antes do vencimento para todos os testes (3h, 6h, 12h, 24h)
                </p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {activeTab === 'whatsapp' && (
        <div className="space-y-4">
          <Card className="p-6 space-y-4">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">WhatsApp via BotBot</h3>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={currentSettings.whatsappEnabled ?? false}
              onChange={(e) => updateForm('whatsappEnabled', e.target.checked)}
              className="w-5 h-5 rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-blue-600 dark:text-cyan-500"
            />
            <span className="text-zinc-900 dark:text-white">Ativar WhatsApp</span>
          </label>

            <Input
              label="App Key"
              placeholder="uuid-da-chave"
              value={currentSettings.botbotAppKey ?? ''}
              onChange={(e) => updateForm('botbotAppKey', e.target.value)}
            />

            <Input
              label="Auth Key"
              type="password"
              placeholder="token-de-autenticacao"
              value={currentSettings.botbotAuthKey ?? ''}
              onChange={(e) => updateForm('botbotAuthKey', e.target.value)}
            />

            <div className="border-t border-zinc-700 pt-4">
              <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Teste de Envio</h4>
              <div className="flex gap-2">
                <Input
                  placeholder="5524999999999"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  className="flex-1"
                />
                <Button
                  onClick={() => testWhatsAppMutation.mutate()}
                  loading={testWhatsAppMutation.isPending}
                  disabled={!testPhone}
                >
                  📱 Enviar Teste
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4">📘 Como configurar o BotBot</h3>
            <ol className="list-decimal list-inside space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
              <li>
                Acesse{' '}
                <a href="https://botbot.app" target="_blank" className="text-cyan-400 underline">
                  botbot.app
                </a>{' '}
                e crie uma conta
              </li>
              <li>Conecte seu WhatsApp escaneando o QR Code</li>
              <li>Copie o App Key e Auth Key das configurações</li>
            </ol>
          </Card>
        </div>
      )}

      {activeTab === 'telegram' && (
        <Card className="p-6 space-y-4">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Telegram Bot</h3>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={currentSettings.telegramEnabled ?? false}
              onChange={(e) => updateForm('telegramEnabled', e.target.checked)}
              className="w-5 h-5 rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-blue-600 dark:text-cyan-500"
            />
            <span className="text-zinc-900 dark:text-white">Ativar Telegram</span>
          </label>

          <Input
            label="Bot Token"
            type="password"
            placeholder="123456:ABC-DEF..."
            value={currentSettings.telegramBotToken ?? ''}
            onChange={(e) => updateForm('telegramBotToken', e.target.value)}
          />

          <Input
            label="Chat ID (para notificações admin)"
            placeholder="-1001234567890"
            value={currentSettings.telegramChatId ?? ''}
            onChange={(e) => updateForm('telegramChatId', e.target.value)}
          />

          <div className="border-t border-zinc-700 pt-4">
            <h4 className="text-sm font-medium text-zinc-300 mb-2">Teste de Envio</h4>
            <div className="flex gap-2">
              <Input
                placeholder="Chat ID"
                value={testChatId}
                onChange={(e) => setTestChatId(e.target.value)}
                className="flex-1"
              />
              <Button
                onClick={() => testTelegramMutation.mutate()}
                loading={testTelegramMutation.isPending}
                disabled={!testChatId}
              >
                📨 Enviar Teste
              </Button>
            </div>
          </div>
        </Card>
      )}

      {activeTab === 'email' && (
        <Card className="p-6 space-y-4">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Email SMTP</h3>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={currentSettings.emailEnabled ?? false}
              onChange={(e) => updateForm('emailEnabled', e.target.checked)}
              className="w-5 h-5 rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-blue-600 dark:text-cyan-500"
            />
            <span className="text-zinc-900 dark:text-white">Ativar Email</span>
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label="Host SMTP"
              placeholder="smtp.gmail.com"
              value={currentSettings.smtpHost ?? ''}
              onChange={(e) => updateForm('smtpHost', e.target.value)}
            />
            <Input
              label="Porta"
              type="number"
              placeholder="587"
              value={currentSettings.smtpPort ?? ''}
              onChange={(e) => updateForm('smtpPort', parseInt(e.target.value))}
            />
          </div>

          <Input
            label="Usuário"
            placeholder="seu-email@gmail.com"
            value={currentSettings.smtpUser ?? ''}
            onChange={(e) => updateForm('smtpUser', e.target.value)}
          />

          <Input
            label="Senha"
            type="password"
            placeholder="senha-de-aplicativo"
            value={currentSettings.smtpPass ?? ''}
            onChange={(e) => updateForm('smtpPass', e.target.value)}
          />

          <Input
            label="Email de Envio (From)"
            placeholder="noreply@seudominio.com"
            value={currentSettings.smtpFrom ?? ''}
            onChange={(e) => updateForm('smtpFrom', e.target.value)}
          />
        </Card>
      )}

      {activeTab === 'templates' && (
        <Card className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Templates de Mensagem</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Variáveis: {'{name}'}, {'{username}'}, {'{password}'}, {'{package}'}, {'{expires_at}'},{' '}
              {'{days_until_expiry}'}, {'{plan_price}'}, {'{renew_url}'}, {'{m3u_url}'}, {'{xmltv_url}'}, {'{xc_api_url}'},{' '}
              {'{invoice_url}'}, {'{checkout_url}'}, {'{pix}'}, {'{due_date}'}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input
              label="Core — Min. tempo para lembrar (min)"
              type="number"
              value={String(currentSettings.coreReminderMinAgeMinutes ?? 30)}
              onChange={(e) => updateForm('coreReminderMinAgeMinutes', parseInt(e.target.value || '0', 10))}
            />
            <Input
              label="Core — Intervalo entre lembretes (h)"
              type="number"
              value={String(currentSettings.coreReminderMinGapHours ?? 6)}
              onChange={(e) => updateForm('coreReminderMinGapHours', parseInt(e.target.value || '0', 10))}
            />
            <Input
              label="Core — Máx. lembretes"
              type="number"
              value={String(currentSettings.coreReminderMaxCount ?? 3)}
              onChange={(e) => updateForm('coreReminderMaxCount', parseInt(e.target.value || '0', 10))}
            />
          </div>

          {[
            { key: 'reminderTemplate', label: '📅 Lembrete (7 e 3 dias)', default: defaultTemplates.reminder },
            { key: 'urgentReminderTemplate', label: '⚠️ Urgente (1 dia)', default: defaultTemplates.urgent },
            { key: 'expiryTemplate', label: '🔴 Dia do Vencimento', default: defaultTemplates.expiry },
            { key: 'recoveryTemplate', label: '🎁 Campanha de Recuperação (clientes vencidos)', default: defaultTemplates.recovery },
            { key: 'trialExpiryTemplate', label: '⏰ Teste Vencendo (1h antes)', default: defaultTemplates.trialExpiry || '⏰ *Teste Vencendo em Breve*\n\nOlá {name}! 👋\n\nSeu teste de acesso IPTV vence em aproximadamente *1 hora*.\n\n👤 Usuário: {username}\n🔑 Senha: {password}\n📅 Vencimento: {expires_at}\n\nRenove agora para continuar assistindo! 🎬' },
            { key: 'postExpiryTemplate', label: '📢 Pós-Vencimento (3 dias após)', default: defaultTemplates.postExpiry || '📢 *Lembrete de Renovação*\n\nOlá {name}! 👋\n\nSua assinatura venceu há *3 dias*.\n\nPara reativar seu acesso e continuar assistindo:\n🔗 Entre em contato conosco\n\n👤 Usuário: {username}\n📦 Plano anterior: {package}\n💰 Valor: {plan_price}\n\nAguardamos seu retorno! 📺' },
            { key: 'welcomeTemplate', label: '👋 Boas-vindas (Teste/Cliente criado)', default: defaultTemplates.welcome },
            { key: 'renewalConfirmationTemplate', label: '✅ Renovação Confirmada', default: defaultTemplates.renewalConfirmation || '✅ *Renovação Confirmada!*\n\nOlá {name}! 👋\n\nSua assinatura foi renovada com sucesso!\n\n👤 Usuário: {username}\n🔑 Senha: {password}\n📅 Novo Vencimento: {expires_at}\n📦 Plano: {package}\n💰 Valor: {plan_price}\n\nAproveite! 🎬' },
            { key: 'coreWelcomeTemplate', label: '🧩 Core — Venda (entrega do acesso)', default: defaultTemplates.coreWelcome },
            { key: 'coreRenewalTemplate', label: '🧩 Core — Renovação (confirmação)', default: defaultTemplates.coreRenewal },
            { key: 'corePaymentReminderTemplate', label: '🧩 Core — Lembrete PIX (pendente)', default: defaultTemplates.corePaymentReminder },
            { key: 'corePaymentOverdueTemplate', label: '🧩 Core — Vencido (OVERDUE)', default: defaultTemplates.corePaymentOverdue },
          ].map((template) => (
            <div key={template.key} className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{template.label}</label>
                <button
                  type="button"
                  onClick={() => updateForm(template.key as keyof NotificationSettings, template.default)}
                  className="text-xs text-cyan-400 hover:underline"
                >
                  Restaurar padrão
                </button>
              </div>
              <textarea
                rows={8}
                className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg p-3 text-zinc-900 dark:text-white text-sm font-mono resize-y focus:ring-2 focus:ring-blue-500 dark:focus:ring-cyan-500 focus:border-transparent"
                value={(currentSettings as any)[template.key] ?? template.default}
                onChange={(e) => updateForm(template.key as keyof NotificationSettings, e.target.value)}
              />
            </div>
          ))}
        </Card>
      )}

      {activeTab === 'logs' && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Histórico de Envios</h3>
            <div className="flex items-center gap-2">
              <Button
                variant="success"
                onClick={() => setShowRecoveryModal(true)}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                🎁 Campanha de Recuperação
              </Button>
              <DeleteLogsButton />
              <Button
                variant="outline"
                onClick={() => runNowMutation.mutate()}
                loading={runNowMutation.isPending}
              >
                ▶️ Executar Agora
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400">
                  <th className="text-left py-2 px-3">Data</th>
                  <th className="text-left py-2 px-3">Cliente</th>
                  <th className="text-left py-2 px-3">Tipo</th>
                  <th className="text-left py-2 px-3">Canal</th>
                  <th className="text-left py-2 px-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {logsData?.data?.map((log: NotificationLog) => (
                  <tr key={log.id} className="border-b border-zinc-200 dark:border-zinc-800">
                    <td className="py-2 px-3 text-zinc-600 dark:text-zinc-300">
                      {new Date(log.createdAt).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'America/Sao_Paulo',
                      })}
                    </td>
                    <td className="py-2 px-3 text-zinc-900 dark:text-white">{log.customerName || '-'}</td>
                    <td className="py-2 px-3">
                      <Badge variant="default">{log.type}</Badge>
                    </td>
                    <td className="py-2 px-3">
                      <Badge variant="default">{log.channel}</Badge>
                    </td>
                    <td className="py-2 px-3">
                      <Badge
                        variant={
                          log.status === 'SENT' ? 'success' : log.status === 'FAILED' ? 'error' : 'warning'
                        }
                      >
                        {log.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {(!logsData?.data || logsData.data.length === 0) && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-zinc-500 dark:text-zinc-400">
                      Nenhum log encontrado
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Modal de Campanha de Recuperação */}
      {showRecoveryModal && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-xl p-6 max-w-md w-full shadow-xl">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4">
              🎁 Campanha de Recuperação de Clientes
            </h3>

            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
              Envie mensagens promocionais para clientes vencidos há mais de X dias.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  Mínimo de dias vencidos
                </label>
                <Input
                  type="number"
                  value={minDaysExpired}
                  onChange={(e) => setMinDaysExpired(parseInt(e.target.value) || 3)}
                  placeholder="3"
                  min="1"
                />
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  Enviar para clientes vencidos há pelo menos {minDaysExpired} dias
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  Máximo de dias vencidos (opcional)
                </label>
                <Input
                  type="number"
                  value={maxDaysExpired}
                  onChange={(e) => setMaxDaysExpired(parseInt(e.target.value) || 0)}
                  placeholder="30"
                  min="0"
                />
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  Deixe 0 para sem limite máximo
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  📝 Mensagem Personalizada (opcional)
                </label>
                <textarea
                  value={customTemplate}
                  onChange={(e) => setCustomTemplate(e.target.value)}
                  placeholder={`Deixe em branco para usar o template padrão configurado.

Variáveis disponíveis:
{name}, {username}, {password}, {package}, {expires_at}, {days_until_expiry}, {plan_price}, {renew_url}`}
                  rows={6}
                  className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:ring-2 focus:ring-cyan-500 dark:focus:ring-cyan-400 focus:border-transparent"
                />
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  💡 Se deixar em branco, usará o template configurado em "Templates"
                </p>
              </div>

              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  💡 <strong>Proteção anti-spam:</strong> Clientes que já receberam mensagem de recuperação nos últimos 30 dias serão automaticamente ignorados.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-6">
              <Button
                variant="outline"
                onClick={() => setShowRecoveryModal(false)}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                onClick={() => recoveryCampaignMutation.mutate()}
                loading={recoveryCampaignMutation.isPending}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              >
                🚀 Enviar Campanha
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Componente para apagar logs
function DeleteLogsButton() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [deleteOption, setDeleteOption] = useState<'all' | 'old'>('old');
  const [olderThanDays, setOlderThanDays] = useState(30);

  const deleteMutation = useMutation({
    mutationFn: async (data: { deleteAll?: boolean; olderThanDays?: number }) => {
      const res = await api.delete('/notifications/logs', { data });
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['notification-logs'] });
      toast.success(`✅ ${data.count} log(s) deletado(s) com sucesso!`);
      setShowModal(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '❌ Erro ao deletar logs');
    },
  });

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setShowModal(true)}
        className="text-red-600 dark:text-red-400 border-red-300 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-500/10"
      >
        🗑️ Apagar Logs
      </Button>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-xl p-6 max-w-md w-full shadow-xl">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4">
              Apagar Logs de Notificação
            </h3>

            <div className="space-y-4">
              <div>
                <label className="flex items-center gap-2 mb-2">
                  <input
                    type="radio"
                    checked={deleteOption === 'old'}
                    onChange={() => setDeleteOption('old')}
                    className="w-4 h-4 text-blue-600 dark:text-cyan-500"
                  />
                  <span className="text-zinc-700 dark:text-zinc-300">
                    Apagar logs mais antigos que X dias
                  </span>
                </label>
                {deleteOption === 'old' && (
                  <Input
                    type="number"
                    value={olderThanDays}
                    onChange={(e) => setOlderThanDays(parseInt(e.target.value) || 30)}
                    placeholder="30"
                    className="ml-6 mt-2"
                  />
                )}
              </div>

              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={deleteOption === 'all'}
                    onChange={() => setDeleteOption('all')}
                    className="w-4 h-4 text-red-600"
                  />
                  <span className="text-zinc-700 dark:text-zinc-300">
                    Apagar todos os logs
                  </span>
                </label>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-6">
              <Button
                variant="outline"
                onClick={() => setShowModal(false)}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (deleteOption === 'all') {
                    deleteMutation.mutate({ deleteAll: true });
                  } else {
                    deleteMutation.mutate({ olderThanDays });
                  }
                }}
                loading={deleteMutation.isPending}
                className="flex-1"
              >
                Apagar
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default NotificationsPage;
