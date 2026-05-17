import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { Card } from '../components/ui';

type PublicCorePackage = {
  id: string;
  name: string;
  durationDays: number;
  priceCents: number;
  connections: number;
};

type PublicCorePackagesResponse = {
  data: { reseller: string; packages: PublicCorePackage[] };
};

type PublicCoreBrandingResponse = {
  data: { reseller: string; panelName: string; logoUrl: string | null; publicBaseUrl?: string | null };
};

type PublicCoreCheckoutCreateResponse = {
  data: {
    id: string;
    status: string;
    asaasPaymentId: string | null;
    invoiceUrl: string | null;
    pixQrCode: string | null;
    pixCopyPaste: string | null;
    amountCents: number;
    daysToAdd: number;
    dueDate?: string | null;
    createdAt: string;
    packageId: string;
  };
  checkoutToken: string;
  reseller: string;
  package: PublicCorePackage;
  message: string;
};

type PublicCoreCheckoutStatusResponse = {
  data: {
    id: string;
    status: string;
    amountCents: number;
    daysToAdd: number;
    pixQrCode: string | null;
    pixCopyPaste: string | null;
    invoiceUrl: string | null;
    dueDate?: string | null;
    paidAt: string | null;
    createdAt: string;
    packageName: string | null;
    credentials: null | {
      username: string;
      password: string;
      m3u: string;
      xmltv: string;
      xc: string;
    };
  };
};

function formatCurrency(cents: number) {
  const reais = cents / 100;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(reais);
}

function normalizeBrPhone(raw: string) {
  const digits = String(raw || '').trim().replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export function PublicCoreCheckoutPage({ resellerOverride }: { resellerOverride?: string } = {}) {
  const params = useParams<{ reseller: string }>();
  const reseller = resellerOverride || params.reseller;
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [resolvedReseller, setResolvedReseller] = useState<string>('');
  const [packages, setPackages] = useState<PublicCorePackage[]>([]);
  const [branding, setBranding] = useState<PublicCoreBrandingResponse['data'] | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [recreatingPix, setRecreatingPix] = useState(false);
  const [checkout, setCheckout] = useState<PublicCoreCheckoutCreateResponse | null>(null);
  const [checkoutToken, setCheckoutToken] = useState<string>('');
  const [status, setStatus] = useState<PublicCoreCheckoutStatusResponse | null>(null);

  const qrCodeRef = useRef<HTMLDivElement>(null);

  const selectedPackage = useMemo(
    () => packages.find((p) => p.id === selectedPackageId) || null,
    [packages, selectedPackageId]
  );

  const tokenFromUrl = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return params.get('t') || '';
  }, [location.search]);

  const effectivePixQrCode = status?.data?.pixQrCode || checkout?.data?.pixQrCode || null;
  const effectivePixCopyPaste = status?.data?.pixCopyPaste || checkout?.data?.pixCopyPaste || null;
  const effectiveAmountCents = status?.data?.amountCents ?? checkout?.data?.amountCents ?? null;
  const effectiveStatus = status?.data?.status || checkout?.data?.status || 'PENDING';
  const effectiveInvoiceUrl = status?.data?.invoiceUrl || checkout?.data?.invoiceUrl || null;
  const effectiveDueDate = status?.data?.dueDate || checkout?.data?.dueDate || null;

  const shareUrl = useMemo(() => {
    if (!checkoutToken) return '';
    let origin = '';
    try {
      origin = window.location.origin || '';
    } catch {
      origin = '';
    }
    const path = reseller ? `/core/checkout/${encodeURIComponent(reseller)}` : '/core/checkout';
    return origin ? `${origin}${path}?t=${encodeURIComponent(checkoutToken)}` : '';
  }, [checkoutToken, reseller]);

  const statusBadgeClass = useMemo(() => {
    const st = String(effectiveStatus || '').toUpperCase();
    if (st === 'CONFIRMED' || st === 'RECEIVED') return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-200';
    if (st === 'OVERDUE') return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-200';
    if (st === 'CANCELLED') return 'bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200';
    return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200';
  }, [effectiveStatus]);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      setLoading(true);
      try {
        const [packagesRes, brandingRes] = reseller
          ? await Promise.all([
              api.get<PublicCorePackagesResponse>(`/public/core/${encodeURIComponent(reseller)}/packages`),
              api.get<PublicCoreBrandingResponse>(`/public/core/${encodeURIComponent(reseller)}/branding`),
            ])
          : await Promise.all([
              api.get<PublicCorePackagesResponse>(`/public/core/packages`),
              api.get<PublicCoreBrandingResponse>(`/public/core/branding`),
            ]);
        const pkgs = packagesRes.data.data.packages || [];
        if (!alive) return;
        setPackages(pkgs);
        setSelectedPackageId(pkgs.find((p) => p.id)?.id || '');
        setBranding(brandingRes.data.data);
        if (!reseller) setResolvedReseller(brandingRes.data.data?.reseller || packagesRes.data.data?.reseller || '');
      } catch (e: any) {
        if (!alive) return;
        toast.error(e.response?.data?.error || 'Erro ao carregar pacotes');
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    };
    run();
    return () => {
      alive = false;
    };
  }, [reseller]);

  useEffect(() => {
    if (tokenFromUrl) {
      setCheckoutToken(tokenFromUrl);
      return;
    }
    if (checkout?.checkoutToken) setCheckoutToken(checkout.checkoutToken);
  }, [tokenFromUrl, checkout?.checkoutToken]);

  useEffect(() => {
    if (!checkoutToken) return;
    const fetchOnce = async () => {
      try {
        const res = await api.get<PublicCoreCheckoutStatusResponse>(
          `/public/core/checkout/${encodeURIComponent(checkoutToken)}`
        );
        setStatus(res.data);
      } catch {}
    };
    fetchOnce();
    const interval = window.setInterval(async () => {
      try {
        const res = await api.get<PublicCoreCheckoutStatusResponse>(
          `/public/core/checkout/${encodeURIComponent(checkoutToken)}`
        );
        setStatus(res.data);
      } catch {}
    }, 5000);
    return () => window.clearInterval(interval);
  }, [checkoutToken]);

  useEffect(() => {
    if (effectivePixQrCode && qrCodeRef.current) {
      setTimeout(() => {
        qrCodeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 250);
    }
  }, [effectivePixQrCode]);

  const effectiveReseller = reseller || resolvedReseller;

  const onCreate = async () => {
    if (!effectiveReseller) return;
    if (!selectedPackageId) {
      toast.error('Selecione um pacote');
      return;
    }
    setCreating(true);
    try {
      const normalizedPhone = normalizeBrPhone(customerPhone || '');
      const url = reseller ? `/public/core/${encodeURIComponent(reseller)}/checkout` : `/public/core/checkout`;
      const res = await api.post<PublicCoreCheckoutCreateResponse>(url, {
        packageId: selectedPackageId,
        customerName: customerName || undefined,
        customerPhone: normalizedPhone || undefined,
      });
      setCheckout(res.data);
      setCheckoutToken(res.data.checkoutToken);
      setStatus(null);
      toast.success('PIX gerado');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao gerar PIX');
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-100 dark:bg-zinc-950">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto"></div>
          <p className="mt-4 text-zinc-600 dark:text-zinc-400">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!effectiveReseller) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-100 dark:bg-zinc-950 p-4">
        <Card className="max-w-md w-full p-6 text-center">
          <h1 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-4">Revenda não encontrada</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Este domínio ainda não foi configurado no painel.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-950 dark:to-zinc-900 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center">
          {branding?.logoUrl ? (
            <div className="flex justify-center mb-3">
              <img src={branding.logoUrl} alt="Logo" className="h-16 w-auto object-contain" />
            </div>
          ) : null}
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-white">{branding?.panelName || 'Assinatura IPTV'}</h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-2">Revenda: {branding?.reseller || effectiveReseller}</p>
        </div>

        <Card className="p-6">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-white mb-4">Escolha seu plano</h2>
          {packages.length === 0 ? (
            <p className="text-zinc-600 dark:text-zinc-400">Nenhum pacote disponível.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {packages.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPackageId(p.id)}
                    className={`p-4 rounded-lg border-2 transition-all text-left ${
                      selectedPackageId === p.id
                        ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-500/20'
                        : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:border-cyan-300 dark:hover:border-cyan-600'
                    }`}
                  >
                    <div className="font-semibold text-zinc-900 dark:text-white">{p.name}</div>
                    <div className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                      {p.durationDays} dias • {p.connections} conexões
                    </div>
                    <div className="text-sm font-medium text-zinc-900 dark:text-white mt-2">{formatCurrency(p.priceCents)}</div>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-6">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Nome (opcional)
                  </label>
                  <input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    WhatsApp (opcional)
                  </label>
                  <input
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="Ex: 11999999999"
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end mt-6">
                <button
                  onClick={onCreate}
                  disabled={creating}
                  className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white font-medium disabled:opacity-60"
                >
                  {creating ? 'Gerando...' : 'Gerar PIX'}
                </button>
              </div>

              {selectedPackage ? (
                <div className="text-sm text-zinc-600 dark:text-zinc-400 mt-3">
                  Selecionado: <span className="font-medium text-zinc-900 dark:text-white">{selectedPackage.name}</span>
                </div>
              ) : null}
            </>
          )}
        </Card>

        {effectivePixQrCode ? (
          <Card className="p-6" ref={qrCodeRef as any}>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-white mb-4">Pague com PIX</h2>
            <div className="flex items-center justify-between text-sm text-zinc-700 dark:text-zinc-300 mb-3">
              <div>
                Valor:{' '}
                <span className="font-medium">
                  {effectiveAmountCents !== null ? formatCurrency(effectiveAmountCents) : '-'}
                </span>
              </div>
              <div>
                Status:{' '}
                <span className={`font-medium px-2 py-0.5 rounded ${statusBadgeClass}`}>
                  {effectiveStatus}
                </span>
              </div>
            </div>
            {effectiveDueDate ? (
              <div className="text-sm text-zinc-700 dark:text-zinc-300 mb-3">
                Vencimento:{' '}
                <span className="font-medium">
                  {new Date(effectiveDueDate).toLocaleDateString('pt-BR')}
                </span>
              </div>
            ) : null}
            <div className="flex justify-center mb-4">
              <img
                src={`data:image/png;base64,${effectivePixQrCode}`}
                alt="QR Code PIX"
                className="max-w-xs border-2 border-zinc-200 dark:border-zinc-700 rounded-lg p-2 bg-white"
              />
            </div>
            {effectivePixCopyPaste ? (
              <div className="space-y-2">
                <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Código PIX (copia e cola)</div>
                <textarea
                  readOnly
                  value={effectivePixCopyPaste}
                  onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                  className="w-full p-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm font-mono text-zinc-900 dark:text-white resize-none cursor-pointer"
                  rows={4}
                />
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(effectivePixCopyPaste || '');
                      toast.success('Código PIX copiado!');
                    } catch {
                      toast.error('Erro ao copiar. Copie manualmente.');
                    }
                  }}
                  className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  Copiar código PIX
                </button>
              </div>
            ) : null}

            {effectiveInvoiceUrl ? (
              <div className="mt-4">
                <button
                  onClick={() => window.open(effectiveInvoiceUrl, '_blank', 'noopener,noreferrer')}
                  className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  Abrir link do pagamento
                </button>
              </div>
            ) : null}

            {shareUrl ? (
              <div className="mt-4 space-y-2">
                <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Link para acompanhar</div>
                <input
                  readOnly
                  value={shareUrl}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(shareUrl);
                        toast.success('Link copiado!');
                      } catch {
                        toast.error('Erro ao copiar. Copie manualmente.');
                      }
                    }}
                    className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    Copiar link
                  </button>
                  <button
                    onClick={() => window.open(shareUrl, '_blank', 'noopener,noreferrer')}
                    className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    Abrir
                  </button>
                </div>
              </div>
            ) : null}

            {effectivePixCopyPaste && customerPhone ? (
              <div className="mt-4">
                <button
                  onClick={() => {
                    const phone = normalizeBrPhone(customerPhone);
                    if (phone.length < 12) {
                      toast.error('WhatsApp inválido');
                      return;
                    }
                    const msg =
                      `Olá${customerName ? `, ${customerName}` : ''}!\n\n` +
                      `Segue o PIX para pagamento.\n` +
                      (effectiveAmountCents !== null ? `Valor: ${formatCurrency(effectiveAmountCents)}\n` : '') +
                      (effectiveDueDate ? `Vencimento: ${new Date(effectiveDueDate).toLocaleDateString('pt-BR')}\n` : '') +
                      `\nPIX copia e cola:\n${effectivePixCopyPaste}\n\n` +
                      (shareUrl ? `Acompanhar status:\n${shareUrl}\n` : '');
                    const url = `https://wa.me/${encodeURIComponent(phone)}?text=${encodeURIComponent(msg)}`;
                    window.open(url, '_blank', 'noopener,noreferrer');
                  }}
                  className="px-3 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium"
                >
                  Enviar PIX no WhatsApp
                </button>
              </div>
            ) : null}

            {checkoutToken && (effectiveStatus === 'OVERDUE' || effectiveStatus === 'CANCELLED') ? (
              <div className="mt-4">
                <button
                  disabled={recreatingPix}
                  onClick={async () => {
                    try {
                      setRecreatingPix(true);
                      const res = await api.post<PublicCoreCheckoutStatusResponse>(
                        `/public/core/checkout/${encodeURIComponent(checkoutToken)}/recreate-pix`
                      );
                      setStatus(res.data);
                      toast.success('Novo PIX gerado');
                    } catch (e: any) {
                      toast.error(e.response?.data?.error || 'Erro ao gerar novo PIX');
                    } finally {
                      setRecreatingPix(false);
                    }
                  }}
                  className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white font-medium disabled:opacity-60"
                >
                  {recreatingPix ? 'Gerando...' : 'Gerar novo PIX'}
                </button>
              </div>
            ) : null}

            {status?.data?.credentials ? (
              <div className="mt-6 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4 space-y-2">
                <div className="font-semibold text-green-900 dark:text-green-200">Pagamento confirmado! Seus dados:</div>
                <div className="text-sm text-zinc-800 dark:text-zinc-200">
                  Usuário: <span className="font-mono">{status.data.credentials.username}</span>
                </div>
                <div className="text-sm text-zinc-800 dark:text-zinc-200">
                  Senha: <span className="font-mono">{status.data.credentials.password}</span>
                </div>
                <div className="text-sm text-zinc-800 dark:text-zinc-200 break-all">
                  M3U: <span className="font-mono">{status.data.credentials.m3u}</span>
                </div>
                <div className="text-sm text-zinc-800 dark:text-zinc-200 break-all">
                  XMLTV: <span className="font-mono">{status.data.credentials.xmltv}</span>
                </div>
                <div className="text-sm text-zinc-800 dark:text-zinc-200 break-all">
                  XC API: <span className="font-mono">{status.data.credentials.xc}</span>
                </div>
              </div>
            ) : (
              <div className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
                Após o pagamento confirmar, esta página libera automaticamente usuário/senha.
              </div>
            )}
          </Card>
        ) : null}
      </div>
    </div>
  );
}
