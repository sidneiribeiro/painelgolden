/**
 * Página de Agendamentos VOD
 * Gerencia agendamentos automáticos de importação M3U
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Input, Select, Modal } from '../../components/ui';
import { api } from '../../api/client';
import toast from 'react-hot-toast';
import { Calendar, Plus, Play, Trash2, Edit, Clock, CheckCircle, XCircle, Pause } from 'lucide-react';

interface VODSchedule {
  id: string;
  serverId: string;
  name: string;
  cronExpression: string;
  m3uUrl: string;
  vodType: 'movie' | 'series' | 'both';
  enrichWithTMDB: boolean;
  isActive: boolean;
  lastRunAt?: string;
  lastRunStatus?: string;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
  server: {
    id: string;
    name: string;
  };
}

interface ScheduleFormData {
  serverId: string;
  name: string;
  cronExpression: string;
  m3uUrl: string;
  vodType: 'movie' | 'series' | 'both';
  enrichWithTMDB: boolean;
  isActive: boolean;
}

interface ScheduleTimeConfig {
  frequency: 'hourly' | 'daily' | 'weekly' | 'monthly';
  hour: string;
  minute: string;
  dayOfWeek?: string;
  dayOfMonth?: string;
}

// Converter configuração amigável para cron
const convertToCron = (config: ScheduleTimeConfig): string => {
  const { frequency, hour, minute, dayOfWeek, dayOfMonth } = config;
  
  switch (frequency) {
    case 'hourly':
      return `${minute} * * * *`;
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekly':
      return `${minute} ${hour} * * ${dayOfWeek || '0'}`;
    case 'monthly':
      return `${minute} ${hour} ${dayOfMonth || '1'} * *`;
    default:
      return '0 2 * * *';
  }
};

// Converter cron para configuração amigável
const parseCron = (cron: string): ScheduleTimeConfig => {
  const parts = cron.split(' ');
  const minute = parts[0] || '0';
  const hour = parts[1] || '2';
  const dayOfMonth = parts[2];
  const month = parts[3];
  const dayOfWeek = parts[4];
  
  if (hour === '*') {
    return { frequency: 'hourly', hour: '0', minute };
  } else if (dayOfWeek !== '*') {
    return { frequency: 'weekly', hour, minute, dayOfWeek };
  } else if (dayOfMonth !== '*') {
    return { frequency: 'monthly', hour, minute, dayOfMonth };
  } else {
    return { frequency: 'daily', hour, minute };
  }
};

export function VODSchedulePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<VODSchedule | null>(null);
  const [formData, setFormData] = useState<ScheduleFormData>({
    serverId: '',
    name: '',
    cronExpression: '0 2 * * *',
    m3uUrl: '',
    vodType: 'both',
    enrichWithTMDB: false,
    isActive: true,
  });
  const [timeConfig, setTimeConfig] = useState<ScheduleTimeConfig>({
    frequency: 'daily',
    hour: '02',
    minute: '00',
  });

  // Buscar agendamentos
  const { data: schedulesData, isLoading } = useQuery({
    queryKey: ['vod-schedules'],
    queryFn: async () => {
      const res = await api.get('/vod/schedules');
      return res.data.data || [];
    },
  });

  const schedules: VODSchedule[] = Array.isArray(schedulesData) ? schedulesData : [];

  // Buscar servidores
  const { data: serversData } = useQuery({
    queryKey: ['servers'],
    queryFn: async () => {
      const res = await api.get('/servers');
      return res.data.data || [];
    },
  });

  // Mutation criar/editar
  const saveMutation = useMutation({
    mutationFn: async (data: ScheduleFormData) => {
      if (editingSchedule) {
        const res = await api.put(`/vod/schedules/${editingSchedule.id}`, data);
        return res.data;
      } else {
        const res = await api.post('/vod/schedules', data);
        return res.data;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vod-schedules'] });
      setShowModal(false);
      setEditingSchedule(null);
      resetForm();
      toast.success(editingSchedule ? 'Agendamento atualizado!' : 'Agendamento criado!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao salvar agendamento');
    },
  });

  // Mutation deletar
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/vod/schedules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vod-schedules'] });
      toast.success('Agendamento deletado!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao deletar agendamento');
    },
  });

  // Mutation executar agora
  const runMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/vod/schedules/${id}/run`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vod-schedules'] });
      toast.success('Importação iniciada!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Erro ao executar agendamento');
    },
  });

  const resetForm = () => {
    const newTimeConfig = {
      frequency: 'daily' as const,
      hour: '02',
      minute: '00',
    };
    setTimeConfig(newTimeConfig);
    setFormData({
      serverId: '',
      name: '',
      cronExpression: convertToCron(newTimeConfig),
      m3uUrl: '',
      vodType: 'both',
      enrichWithTMDB: false,
      isActive: true,
    });
  };

  // Atualizar cron quando timeConfig mudar
  const updateTimeConfig = (updates: Partial<ScheduleTimeConfig>) => {
    const newConfig = { ...timeConfig, ...updates };
    setTimeConfig(newConfig);
    setFormData({ ...formData, cronExpression: convertToCron(newConfig) });
  };

  const handleNew = () => {
    resetForm();
    setEditingSchedule(null);
    setShowModal(true);
  };

  const handleEdit = (schedule: VODSchedule) => {
    setEditingSchedule(schedule);
    const parsedTime = parseCron(schedule.cronExpression);
    setTimeConfig(parsedTime);
    setFormData({
      serverId: schedule.serverId,
      name: schedule.name,
      cronExpression: schedule.cronExpression,
      m3uUrl: schedule.m3uUrl,
      vodType: schedule.vodType,
      enrichWithTMDB: schedule.enrichWithTMDB,
      isActive: schedule.isActive,
    });
    setShowModal(true);
  };

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Tem certeza que deseja deletar o agendamento "${name}"?`)) {
      deleteMutation.mutate(id);
    }
  };

  const handleRun = (id: string, name: string) => {
    if (confirm(`Executar importação "${name}" agora?`)) {
      runMutation.mutate(id);
    }
  };

  const handleSave = () => {
    if (!formData.serverId || !formData.name || !formData.cronExpression || !formData.m3uUrl) {
      toast.error('Preencha todos os campos obrigatórios');
      return;
    }

    saveMutation.mutate(formData);
  };

  const formatDate = (date?: string) => {
    if (!date) return '-';
    return new Date(date).toLocaleString('pt-BR');
  };

  const getStatusBadge = (status?: string) => {
    if (!status) return <span className="text-gray-500 text-xs">Nunca executado</span>;
    
    if (status === 'SUCCESS') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300 rounded text-xs">
          <CheckCircle className="w-3 h-3" />
          Sucesso
        </span>
      );
    }
    
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 rounded text-xs">
        <XCircle className="w-3 h-3" />
        Erro
      </span>
    );
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Calendar className="w-7 h-7 text-blue-500" />
            Agendamentos VOD
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Automatize importações M3U com agendamentos periódicos
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/vod')}>
            ← Voltar
          </Button>
          <Button onClick={handleNew}>
            <Plus className="w-4 h-4 mr-2" />
            Novo Agendamento
          </Button>
        </div>
      </div>

      {/* Lista de Agendamentos */}
      {isLoading ? (
        <Card className="p-8 text-center">
          <p className="text-gray-500">Carregando agendamentos...</p>
        </Card>
      ) : schedules.length === 0 ? (
        <Card className="p-8 text-center">
          <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Nenhum agendamento criado
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Crie seu primeiro agendamento para automatizar importações M3U
          </p>
          <Button onClick={handleNew}>
            <Plus className="w-4 h-4 mr-2" />
            Criar Agendamento
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {schedules.map((schedule) => (
            <Card key={schedule.id} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                      {schedule.name}
                    </h3>
                    {schedule.isActive ? (
                      <span className="px-2 py-1 bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300 rounded text-xs font-medium">
                        Ativo
                      </span>
                    ) : (
                      <span className="px-2 py-1 bg-gray-100 dark:bg-gray-500/20 text-gray-700 dark:text-gray-300 rounded text-xs font-medium flex items-center gap-1">
                        <Pause className="w-3 h-3" />
                        Pausado
                      </span>
                    )}
                  </div>

                  <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Servidor:</span>
                      <span>{schedule.server.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span className="font-medium">Agendamento:</span>
                      <code className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs">
                        {schedule.cronExpression}
                      </code>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Tipo:</span>
                      <span className="capitalize">{schedule.vodType === 'both' ? 'Filmes e Séries' : schedule.vodType === 'movie' ? 'Filmes' : 'Séries'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">TMDB:</span>
                      <span>{schedule.enrichWithTMDB ? '✅ Ativo' : '❌ Desativado'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Última execução:</span>
                      <span>{formatDate(schedule.lastRunAt)}</span>
                      {schedule.lastRunStatus && getStatusBadge(schedule.lastRunStatus)}
                    </div>
                    {schedule.nextRunAt && (
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Próxima execução:</span>
                        <span className="text-blue-600 dark:text-blue-400">
                          {formatDate(schedule.nextRunAt)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRun(schedule.id, schedule.name)}
                    disabled={runMutation.isPending}
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Executar Agora
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleEdit(schedule)}
                  >
                    <Edit className="w-4 h-4 mr-2" />
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => handleDelete(schedule.id, schedule.name)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Deletar
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Modal Criar/Editar */}
      <Modal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          setEditingSchedule(null);
          resetForm();
        }}
        title={editingSchedule ? 'Editar Agendamento' : 'Novo Agendamento'}
        size="lg"
      >
        <div className="space-y-4">
          {/* Nome */}
          <Input
            label="Nome do Agendamento"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Ex: Importação Diária de Filmes"
            required
          />

          {/* Servidor */}
          <Select
            label="Servidor XUI"
            value={formData.serverId}
            onChange={(e) => setFormData({ ...formData, serverId: e.target.value })}
            required
          >
            <option value="">Selecione um servidor</option>
            {Array.isArray(serversData) && serversData.map((server: any) => (
              <option key={server.id} value={server.id}>
                {server.name} ({server.host})
              </option>
            ))}
          </Select>

          {/* URL M3U */}
          <Input
            label="URL M3U"
            type="url"
            value={formData.m3uUrl}
            onChange={(e) => setFormData({ ...formData, m3uUrl: e.target.value })}
            placeholder="https://example.com/playlist.m3u"
            required
          />

          {/* Tipo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Tipo de Conteúdo
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="vodType"
                  value="both"
                  checked={formData.vodType === 'both'}
                  onChange={(e) => setFormData({ ...formData, vodType: e.target.value as any })}
                />
                <span className="text-sm">Ambos</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="vodType"
                  value="movie"
                  checked={formData.vodType === 'movie'}
                  onChange={(e) => setFormData({ ...formData, vodType: e.target.value as any })}
                />
                <span className="text-sm">Apenas Filmes</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="vodType"
                  value="series"
                  checked={formData.vodType === 'series'}
                  onChange={(e) => setFormData({ ...formData, vodType: e.target.value as any })}
                />
                <span className="text-sm">Apenas Séries</span>
              </label>
            </div>
          </div>

          {/* Agendamento Amigável */}
          <div className="space-y-4 p-4 bg-blue-50 dark:bg-blue-500/10 rounded-lg border border-blue-200 dark:border-blue-500/30">
            <h4 className="font-medium text-blue-900 dark:text-blue-100 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Configurar Horário de Importação
            </h4>

            {/* Frequência */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Frequência
              </label>
              <Select
                value={timeConfig.frequency}
                onChange={(e) => updateTimeConfig({ frequency: e.target.value as any })}
              >
                <option value="hourly">A cada hora</option>
                <option value="daily">Diariamente</option>
                <option value="weekly">Semanalmente</option>
                <option value="monthly">Mensalmente</option>
              </Select>
            </div>

            {/* Hora e Minuto */}
            {timeConfig.frequency !== 'hourly' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Hora
                  </label>
                  <Select
                    value={timeConfig.hour}
                    onChange={(e) => updateTimeConfig({ hour: e.target.value })}
                  >
                    {Array.from({ length: 24 }, (_, i) => {
                      const hour = i.toString().padStart(2, '0');
                      return (
                        <option key={hour} value={hour}>
                          {hour}:00
                        </option>
                      );
                    })}
                  </Select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Minuto
                  </label>
                  <Select
                    value={timeConfig.minute}
                    onChange={(e) => updateTimeConfig({ minute: e.target.value })}
                  >
                    {['00', '15', '30', '45'].map(minute => (
                      <option key={minute} value={minute}>
                        :{minute}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            )}

            {/* Apenas Minuto para hourly */}
            {timeConfig.frequency === 'hourly' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Minuto da hora
                </label>
                <Select
                  value={timeConfig.minute}
                  onChange={(e) => updateTimeConfig({ minute: e.target.value })}
                >
                  {['00', '15', '30', '45'].map(minute => (
                    <option key={minute} value={minute}>
                      :{minute}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Será executado aos {timeConfig.minute} minutos de cada hora
                </p>
              </div>
            )}

            {/* Dia da Semana */}
            {timeConfig.frequency === 'weekly' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Dia da Semana
                </label>
                <Select
                  value={timeConfig.dayOfWeek || '0'}
                  onChange={(e) => updateTimeConfig({ dayOfWeek: e.target.value })}
                >
                  <option value="0">Domingo</option>
                  <option value="1">Segunda-feira</option>
                  <option value="2">Terça-feira</option>
                  <option value="3">Quarta-feira</option>
                  <option value="4">Quinta-feira</option>
                  <option value="5">Sexta-feira</option>
                  <option value="6">Sábado</option>
                </Select>
              </div>
            )}

            {/* Dia do Mês */}
            {timeConfig.frequency === 'monthly' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Dia do Mês
                </label>
                <Select
                  value={timeConfig.dayOfMonth || '1'}
                  onChange={(e) => updateTimeConfig({ dayOfMonth: e.target.value })}
                >
                  {Array.from({ length: 31 }, (_, i) => {
                    const day = (i + 1).toString();
                    return (
                      <option key={day} value={day}>
                        Dia {day}
                      </option>
                    );
                  })}
                </Select>
              </div>
            )}

            {/* Preview do Cron */}
            <div className="pt-2 border-t border-blue-200 dark:border-blue-500/30">
              <div className="text-xs text-gray-600 dark:text-gray-400">
                <span className="font-medium">Expressão Cron:</span>{' '}
                <code className="px-2 py-1 bg-white dark:bg-gray-800 rounded font-mono">
                  {formData.cronExpression}
                </code>
              </div>
            </div>
          </div>

          {/* Opções */}
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.enrichWithTMDB}
                onChange={(e) => setFormData({ ...formData, enrichWithTMDB: e.target.checked })}
                className="w-4 h-4"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Enriquecer com TMDB
              </span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                className="w-4 h-4"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Ativar agendamento
              </span>
            </label>
          </div>

          {/* Botões */}
          <div className="flex gap-2 justify-end pt-4">
            <Button
              variant="outline"
              onClick={() => {
                setShowModal(false);
                setEditingSchedule(null);
                resetForm();
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              loading={saveMutation.isPending}
            >
              {editingSchedule ? 'Atualizar' : 'Criar'} Agendamento
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default VODSchedulePage;

