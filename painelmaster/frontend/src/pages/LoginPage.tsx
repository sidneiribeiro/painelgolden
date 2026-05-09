import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Input, Card } from '../components/ui';
import { api } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { usePanelSettings } from '../hooks/usePanelSettings';
import { getImageUrl } from '../utils/imageUrl';
import toast from 'react-hot-toast';

export function LoginPage() {
  const login = useAuthStore((state) => state.login);
  const { data: panelSettings } = usePanelSettings(true);
  const [form, setForm] = useState({
    username: '',
    password: '',
  });

  const loginMutation = useMutation({
    mutationFn: async (data: { username: string; password: string }) => {
      const res = await api.post('/auth/login', data);
      return res.data;
    },
    onSuccess: (data) => {
      login(data.user, data.token);
      toast.success('Login realizado com sucesso!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Usuário ou senha inválidos');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate(form);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-cyan-50 via-white to-violet-50 dark:from-zinc-950 dark:via-cyan-950/20 dark:to-violet-950/20 p-4 relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-violet-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-r from-cyan-500/5 to-violet-500/5 rounded-full blur-3xl" />
      </div>

      {/* Floating Elements */}
      <div className="absolute top-20 left-20 w-2 h-2 bg-cyan-400 rounded-full animate-pulse opacity-50" />
      <div className="absolute top-40 right-32 w-3 h-3 bg-violet-400 rounded-full animate-pulse opacity-50" style={{ animationDelay: '1s' }} />
      <div className="absolute bottom-32 left-40 w-2 h-2 bg-cyan-300 rounded-full animate-pulse opacity-40" style={{ animationDelay: '0.5s' }} />
      <div className="absolute bottom-20 right-20 w-4 h-4 bg-violet-300 rounded-full animate-pulse opacity-30" style={{ animationDelay: '1.5s' }} />

      <Card className="w-full max-w-md p-8 relative backdrop-blur-xl bg-white/80 dark:bg-zinc-900/80 border border-zinc-200/50 dark:border-zinc-700/50 shadow-2xl shadow-cyan-500/10">
        {/* Logo */}
        <div className="text-center mb-8">
          {panelSettings?.logoUrl ? (
            <img
              src={getImageUrl(panelSettings.logoUrl) || ''}
              alt={panelSettings.panelName}
              className="w-28 h-28 object-contain mx-auto mb-4 drop-shadow-lg"
              onError={(e) => {
                console.error('Erro ao carregar logo:', e);
                (e.target as HTMLImageElement).style.display = 'none';
                const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                if (fallback) fallback.style.display = 'flex';
              }}
            />
          ) : null}
          <div className={`w-24 h-24 bg-gradient-to-br from-cyan-500 via-violet-500 to-cyan-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-cyan-500/30 ${panelSettings?.logoUrl ? 'hidden' : ''}`}>
            <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-600 to-violet-600 dark:from-cyan-400 dark:to-violet-400 bg-clip-text text-transparent">
            {panelSettings?.panelName || 'PAINEL MASTER'}
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400 mt-2 text-sm">Sistema de Gestão de Revenda</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Usuário ou Email</label>
            <Input
              placeholder="Digite seu usuário"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              autoFocus
              required
              className="!py-3"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Senha</label>
            <Input
              type="password"
              placeholder="Digite sua senha"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              className="!py-3"
            />
          </div>

          <Button
            type="submit"
            className="w-full !py-3 text-base font-semibold mt-2"
            loading={loginMutation.isPending}
          >
            {loginMutation.isPending ? 'Entrando...' : 'Entrar'}
          </Button>
        </form>

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-zinc-200/50 dark:border-zinc-700/50">
          <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
            Sistema protegido. Acesso restrito a usuários autorizados.
          </p>
          <p className="text-center text-xs text-zinc-400 dark:text-zinc-500 mt-2">
            v2.0.3 • PainelMaster
          </p>
        </div>
      </Card>
    </div>
  );
}

export default LoginPage;
