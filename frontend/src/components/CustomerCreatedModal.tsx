import { Modal } from './ui/Modal';
import { CopyButton } from './CopyButton';
import { Button } from './ui/Button';
import { Card } from './ui/Card';

interface CustomerCreatedModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: {
    username: string;
    password: string;
    expiresAt: string;
    package?: string;
    urls?: {
      m3u_ts?: string;
      m3u_hls?: string;
      ssiptv?: string;
      xciptv?: {
        server: string;
        username: string;
        password: string;
      };
    };
    m3u_url?: string;
  };
  server?: {
    dnsPrimary?: string;
    partnerApps?: { name: string; code: string }[];
  };
}

export function CustomerCreatedModal({ isOpen, onClose, customer, server }: CustomerCreatedModalProps) {
  const urls = customer.urls || {
    m3u_ts: customer.m3u_url,
    m3u_hls: customer.m3u_url?.replace('mpegts', 'hls'),
    ssiptv: customer.m3u_url?.replace('m3u_plus', 'm3u'),
    xciptv: {
      server: server?.dnsPrimary || '',
      username: customer.username,
      password: customer.password,
    },
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Cliente Criado com Sucesso!" size="lg">
      <div className="space-y-4">
        {/* Dados do Cliente */}
        <Card className="p-4 bg-zinc-800/50">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-sm text-zinc-400">Usuário:</span>
              <p className="font-mono font-bold text-white text-lg">{customer.username}</p>
            </div>
            <div>
              <span className="text-sm text-zinc-400">Senha:</span>
              <p className="font-mono font-bold text-white text-lg">{customer.password}</p>
            </div>
            {customer.package && (
              <div>
                <span className="text-sm text-zinc-400">Pacote:</span>
                <p className="font-semibold text-white">{customer.package}</p>
              </div>
            )}
            <div>
              <span className="text-sm text-zinc-400">Expira em:</span>
              <p className="font-semibold text-white">
                {new Date(customer.expiresAt).toLocaleDateString('pt-BR')}
              </p>
            </div>
          </div>
        </Card>

        {/* Botões de Cópia */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-zinc-300">Copiar Dados:</h3>
          <div className="grid grid-cols-2 gap-2">
            <CopyButton 
              text={customer.username} 
              label="📋 Copiar Usuário" 
            />
            <CopyButton 
              text={customer.password} 
              label="📋 Copiar Senha" 
            />
            <CopyButton 
              text={`${customer.username}\n${customer.password}`} 
              label="📋 Usuário + Senha" 
            />
            {urls.m3u_ts && (
              <CopyButton 
                text={urls.m3u_ts} 
                label="🟢 Link M3U (TS)" 
              />
            )}
            {urls.m3u_hls && (
              <CopyButton 
                text={urls.m3u_hls} 
                label="🟡 Link M3U (HLS)" 
              />
            )}
            {urls.ssiptv && (
              <CopyButton 
                text={urls.ssiptv} 
                label="🔴 Link SSIPTV" 
              />
            )}
            {urls.xciptv && (
              <CopyButton 
                text={`DNS: ${urls.xciptv.server}\nUsuário: ${urls.xciptv.username}\nSenha: ${urls.xciptv.password}`} 
                label="🟠 Dados XCIPTV" 
              />
            )}
          </div>
        </div>

        {/* Apps Parceiros */}
        {server?.partnerApps && server.partnerApps.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-zinc-300">Apps Parceiros:</h3>
            <div className="grid grid-cols-1 gap-2">
              {server.partnerApps.map((app, idx) => (
                <CopyButton 
                  key={idx}
                  text={`App: ${app.name}\nCódigo: ${app.code}\nUsuário: ${customer.username}\nSenha: ${customer.password}`} 
                  label={`📺 ${app.name}`} 
                />
              ))}
            </div>
          </div>
        )}

        {/* Botão Fechar */}
        <div className="pt-4 border-t border-zinc-800">
          <Button onClick={onClose} className="w-full">
            Fechar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

