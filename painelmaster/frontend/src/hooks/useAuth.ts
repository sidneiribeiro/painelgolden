import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { authApi, getErrorMessage } from '@/api';
import toast from 'react-hot-toast';
import type { LoginCredentials } from '@/types';

export function useAuth() {
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading, login, logout, setLoading } = useAuthStore();

  // Verifica se está autenticado ao carregar
  const { refetch: checkAuth } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: authApi.me,
    enabled: isAuthenticated,
    retry: false,
    onSuccess: (userData) => {
      useAuthStore.getState().setUser(userData);
      setLoading(false);
    },
    onError: () => {
      logout();
      setLoading(false);
    },
  });

  useEffect(() => {
    if (isAuthenticated && !user) {
      checkAuth();
    } else {
      setLoading(false);
    }
  }, []);

  // Mutation de login
  const loginMutation = useMutation({
    mutationFn: (credentials: LoginCredentials) => authApi.login(credentials),
    onSuccess: (data) => {
      login(data.user, data.accessToken);
      toast.success(`Bem-vindo, ${data.user.username}!`);
      navigate('/dashboard');
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });

  // Mutation de logout
  const logoutMutation = useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      logout();
      toast.success('Logout realizado com sucesso');
      navigate('/login');
    },
    onError: () => {
      // Desloga mesmo se der erro na API
      logout();
      navigate('/login');
    },
  });

  const handleLogin = useCallback((credentials: LoginCredentials) => {
    loginMutation.mutate(credentials);
  }, []);

  const handleLogout = useCallback(() => {
    logoutMutation.mutate();
  }, []);

  return {
    user,
    isAuthenticated,
    isLoading: isLoading || loginMutation.isPending,
    login: handleLogin,
    logout: handleLogout,
    isLoggingIn: loginMutation.isPending,
    isLoggingOut: logoutMutation.isPending,
  };
}
