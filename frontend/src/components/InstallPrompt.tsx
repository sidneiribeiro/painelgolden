import { useState, useEffect } from 'react';
import { Button } from './ui';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Verificar se já está instalado
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
      return;
    }

    // Verificar se está em modo standalone (iOS)
    if ((window.navigator as any).standalone) {
      setIsInstalled(true);
      return;
    }

    // Escutar o evento beforeinstallprompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Mostrar o prompt após 3 segundos (opcional)
      setTimeout(() => {
        setShowPrompt(true);
      }, 3000);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Limpar estado se o usuário instalar
    window.addEventListener('appinstalled', () => {
      setIsInstalled(true);
      setShowPrompt(false);
      setDeferredPrompt(null);
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) {
      // Fallback para iOS
      return;
    }

    // Mostrar o prompt de instalação
    deferredPrompt.prompt();

    // Esperar pela escolha do usuário
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'accepted') {
      console.log('Usuário aceitou a instalação');
      setShowPrompt(false);
      setDeferredPrompt(null);
    } else {
      console.log('Usuário rejeitou a instalação');
      // Esconder o prompt por um tempo
      setShowPrompt(false);
      // Pode mostrar novamente depois de um tempo (opcional)
      setTimeout(() => {
        if (deferredPrompt) {
          setShowPrompt(true);
        }
      }, 60000); // 1 minuto
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    // Guardar no localStorage que o usuário dispensou
    localStorage.setItem('installPromptDismissed', Date.now().toString());
    // Pode mostrar novamente depois de 7 dias
    setTimeout(() => {
      localStorage.removeItem('installPromptDismissed');
    }, 7 * 24 * 60 * 60 * 1000);
  };

  // Não mostrar se já estiver instalado
  if (isInstalled) {
    return null;
  }

  // Verificar se foi dispensado recentemente
  useEffect(() => {
    const dismissed = localStorage.getItem('installPromptDismissed');
    if (dismissed) {
      const dismissedTime = parseInt(dismissed);
      const daysSinceDismissed = (Date.now() - dismissedTime) / (1000 * 60 * 60 * 24);
      if (daysSinceDismissed < 7) {
        setShowPrompt(false);
      }
    }
  }, []);

  // Não mostrar se não tiver o prompt disponível ou se foi dispensado
  if (!showPrompt || !deferredPrompt) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50 animate-in slide-in-from-bottom-4">
      <div className="bg-white dark:bg-zinc-800 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 p-4 flex items-start gap-3">
        <div className="flex-1">
          <h3 className="font-semibold text-zinc-900 dark:text-white mb-1">
            📱 Instalar App
          </h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">
            Instale o painel no seu celular para acesso rápido e fácil!
          </p>
          <div className="flex gap-2">
            <Button
              onClick={handleInstallClick}
              size="sm"
              className="flex-1"
            >
              ✅ Instalar Agora
            </Button>
            <Button
              onClick={handleDismiss}
              variant="ghost"
              size="sm"
              className="px-3"
            >
              ✕
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}


