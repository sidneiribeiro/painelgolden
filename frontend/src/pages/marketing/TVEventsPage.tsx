import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Button, Card, Input, Spinner, Select, Badge } from '../../components/ui';
import toast from 'react-hot-toast';

interface TVEvent {
  id: number;
  title: string;
  sport?: string | null;
  league?: string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
  date: string;
  matchTime: string;
  channelName?: string | null;
  channelLogo?: string | null;
}

interface TVChannelMap {
  id: number;
  apiChannel: string;
  xuiStreamId?: number | null;
  xuiServerId?: string | null;
  xuiCategoryId?: number | null;
  priority: number;
}

interface XuiServer {
  id: string;
  name: string;
  baseUrl: string;
  isActive: boolean;
}

interface LiveCategory {
  id: number;
  category_name: string;
  category_type: string;
}

export default function TVEventsPage() {
  const queryClient = useQueryClient();
  const [daysAhead, setDaysAhead] = useState(1);

  const { data: events, isLoading: loadingEvents } = useQuery<TVEvent[]>({
    queryKey: ['tvEvents'],
    queryFn: async () => {
      const response = await api.get('/tv/events');
      return response.data || [];
    },
  });

  const { data: channelMaps, isLoading: loadingMaps } = useQuery<TVChannelMap[]>({
    queryKey: ['tvChannelMaps'],
    queryFn: async () => {
      const response = await api.get('/tv/channels');
      return response.data || [];
    },
  });

  // Servidores XUI (reutiliza endpoint de settings/xui)
  const { data: xuiServers } = useQuery<XuiServer[]>({
    queryKey: ['xuiServers'],
    queryFn: async () => {
      const response = await api.get('/settings/xui');
      return response.data.data || [];
    },
  });

  // Categorias LIVE do XUI para o servidor selecionado
  const [selectedServer, setSelectedServer] = useState<string>('');
  const {
    data: liveCategories,
    isLoading: loadingCategories,
  } = useQuery<LiveCategory[]>({
    queryKey: ['liveCategories', selectedServer],
    enabled: !!selectedServer,
    queryFn: async () => {
      const response = await api.get('/live/categories', {
        params: { serverId: selectedServer },
      });
      return response.data || [];
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post('/tv/refresh', { daysAhead });
      return response.data;
    },
    onSuccess: () => {
      toast.success('Atualização iniciada. Aguarde alguns minutos.');
      queryClient.invalidateQueries({ queryKey: ['tvEvents'] });
    },
    onError: () => {
      toast.error('Erro ao atualizar eventos de TV');
    },
  });

  const upsertChannelMutation = useMutation({
    mutationFn: async (data: Partial<TVChannelMap>) => {
      const response = await api.post('/tv/channels', data);
      return response.data;
    },
    onSuccess: () => {
      toast.success('Canal mapeado com sucesso');
      queryClient.invalidateQueries({ queryKey: ['tvChannelMaps'] });
    },
    onError: () => {
      toast.error('Erro ao salvar mapeamento');
    },
  });

  const handleSubmitMap = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const apiChannel = (formData.get('apiChannel') as string)?.trim();
    if (!apiChannel) {
      toast.error('Informe o nome do canal da API');
      return;
    }
    upsertChannelMutation.mutate({
      apiChannel,
      xuiStreamId: formData.get('xuiStreamId')
        ? Number(formData.get('xuiStreamId'))
        : undefined,
      xuiServerId: (formData.get('xuiServerId') as string) || selectedServer || undefined,
      xuiCategoryId: formData.get('xuiCategoryId')
        ? Number(formData.get('xuiCategoryId'))
        : undefined,
      priority: formData.get('priority')
        ? Number(formData.get('priority'))
        : 0,
    });
    e.currentTarget.reset();
  };

  const getMapping = (channelName?: string | null) => {
    if (!channelName || !channelMaps) return undefined;
    return channelMaps.find(
      (m) => m.apiChannel.toLowerCase() === channelName.toLowerCase()
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">📺 Eventos do Dia</h1>
          <p className="text-sm text-gray-400">
            Eventos de TV (multi-esporte) e mapeamento de canais para XUI
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select
            value={daysAhead}
            onChange={(e) => setDaysAhead(Number(e.target.value))}
            className="w-32"
          >
            <option value={1}>Hoje</option>
            <option value={3}>Próx. 3 dias</option>
            <option value={7}>Próx. 7 dias</option>
          </Select>
          <Button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
          >
            {refreshMutation.isPending ? 'Atualizando...' : 'Atualizar Agora'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card className="p-4">
          <h3 className="text-lg font-semibold mb-2">Resumo</h3>
          <p className="text-sm text-gray-300">
            Eventos carregados: {events?.length ?? 0}
          </p>
          <p className="text-sm text-gray-300">
            Canais mapeados: {channelMaps?.length ?? 0}
          </p>
        </Card>
        <Card className="p-4 lg:col-span-2">
          <h3 className="text-lg font-semibold mb-3">Mapear Canal</h3>
          <form className="grid grid-cols-1 md:grid-cols-5 gap-3" onSubmit={handleSubmitMap}>
            <Input name="apiChannel" placeholder="Canal da API (ex: ESPN Brasil)" className="md:col-span-2" />
            <Select
              value={selectedServer}
              onChange={(e) => setSelectedServer(e.target.value)}
              className="w-full"
            >
              <option value="">Servidor XUI</option>
              {xuiServers?.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
            <Select name="xuiCategoryId" disabled={!selectedServer || loadingCategories}>
              <option value="">Categoria XUI</option>
              {liveCategories?.map((c) => (
                <option key={c.id} value={c.id}>{c.category_name}</option>
              ))}
            </Select>
            <Input name="xuiStreamId" placeholder="Stream ID no XUI" />
            <div className="flex gap-2 items-center">
              <Input name="priority" placeholder="Prioridade" className="w-24" />
              <Button type="submit" disabled={upsertChannelMutation.isPending}>
                {upsertChannelMutation.isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </form>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-4">
          <h3 className="text-lg font-semibold mb-3">Canais Mapeados</h3>
          {loadingMaps ? (
            <div className="flex items-center gap-2"><Spinner /> Carregando canais...</div>
          ) : (channelMaps?.length ?? 0) === 0 ? (
            <p className="text-sm text-gray-400">Nenhum mapeamento cadastrado.</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {channelMaps?.map((m) => (
                <div key={m.id} className="border border-gray-700 rounded-md p-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-semibold">{m.apiChannel}</span>
                    <Badge variant="info">prio {m.priority}</Badge>
                  </div>
                  <p className="text-xs text-gray-400">Stream: {m.xuiStreamId ?? '—'}</p>
                  <p className="text-xs text-gray-400">Categoria: {m.xuiCategoryId ?? '—'}</p>
                  <p className="text-xs text-gray-400">Servidor: {m.xuiServerId ?? '—'}</p>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold">Eventos</h3>
            {loadingEvents && <div className="flex items-center gap-2 text-sm text-gray-400"><Spinner size="sm" /> Atualizando...</div>}
          </div>

          {loadingEvents ? (
            <div className="flex items-center gap-2"><Spinner /> Carregando eventos...</div>
          ) : (events?.length ?? 0) === 0 ? (
            <p className="text-sm text-gray-400">Nenhum evento encontrado para o período.</p>
          ) : (
            <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
              {events?.map((ev) => {
                const mapping = getMapping(ev.channelName);
                return (
                  <div key={ev.id} className="border border-gray-800 rounded-md p-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <p className="text-sm text-gray-400">{ev.sport || 'Esporte'}</p>
                        <h4 className="text-md font-semibold">
                          {ev.homeTeam && ev.awayTeam
                            ? `${ev.homeTeam} vs ${ev.awayTeam}`
                            : ev.title}
                        </h4>
                        <p className="text-xs text-gray-400">{ev.league || '—'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm">{new Date(ev.date).toLocaleDateString('pt-BR')}</p>
                        <p className="text-sm font-semibold">{ev.matchTime}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-2 text-sm text-gray-300">
                        <span>Canal: {ev.channelName || '—'}</span>
                        {mapping ? (
                          <Badge variant="success">Mapeado</Badge>
                        ) : (
                          <Badge variant="warning">Sem mapeamento</Badge>
                        )}
                      </div>
                      {mapping && (
                        <p className="text-xs text-gray-400">
                          Stream: {mapping.xuiStreamId ?? '—'} | Cat: {mapping.xuiCategoryId ?? '—'} | Serv: {mapping.xuiServerId ?? '—'}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

