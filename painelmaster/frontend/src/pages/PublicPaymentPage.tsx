import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import { Card } from '../components/ui';
import toast from 'react-hot-toast';

interface CustomerData {
  username: string;
  name: string;
  package: string;
  expiresAt: string;
  daysUntilExpiry: number;
  isTrial: boolean;
  dns: string;
}

interface PackageOption {
  months: number;
  label: string;
  duration: number;
  price: number; // Em centavos
}

export function PublicPaymentPage() {
  const { token } = useParams<{ token: string }>();
  const [customer, setCustomer] = useState<CustomerData | null>(null);
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [selectedMonths, setSelectedMonths] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [paymentData, setPaymentData] = useState<{
    pixQrCode: string | null;
    pixCopyPaste: string | null;
    paymentLinkUrl?: string | null;
    valueFormatted: string;
    paymentId: string;
    expirationDate?: string;
  } | null>(null);

  const qrCodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token) return;

    const fetchData = async () => {
      try {
        const [customerRes, packagesRes] = await Promise.all([
          api.get(`/public/payment/customer/${token}`),
          api.get(`/public/payment/packages/${token}`),
        ]);

        setCustomer(customerRes.data.data);
        setPackages(packagesRes.data.data);
      } catch (error: any) {
        toast.error(error.response?.data?.error || 'Erro ao carregar dados');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [token]);

  // Scroll automático para o QR Code quando ele for gerado
  useEffect(() => {
    if (paymentData && paymentData.pixQrCode && qrCodeRef.current) {
      // Pequeno delay para garantir que o elemento foi renderizado
      setTimeout(() => {
        qrCodeRef.current?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
      }, 300);
    }
  }, [paymentData?.pixQrCode]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'America/Sao_Paulo',
    });
  };

  const formatCurrency = (cents: number) => {
    const reais = cents / 100;
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(reais);
  };

  const handleGeneratePayment = async () => {
    if (!token) return;

    setGenerating(true);
    try {
      const res = await api.post(`/public/payment/payment/${token}`, {
        months: selectedMonths,
      });

      const data = res.data.data;
      setPaymentData({
        pixQrCode: data.pixQrCode || null,
        pixCopyPaste: data.pixCopyPaste || null,
        paymentLinkUrl: data.paymentLinkUrl || null,
        valueFormatted: data.valueFormatted,
        paymentId: data.paymentId,
        expirationDate: data.expirationDate,
      });

      toast.success('Pagamento gerado com sucesso!');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Erro ao gerar pagamento');
    } finally {
      setGenerating(false);
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

  if (!customer) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-100 dark:bg-zinc-950 p-4">
        <Card className="max-w-md w-full p-6 text-center">
          <h1 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-4">
            Cliente não encontrado
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            O link de pagamento é inválido ou expirou.
          </p>
        </Card>
      </div>
    );
  }

  const selectedPackage = packages.find((p) => p.months === selectedMonths);

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-950 dark:to-zinc-900 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-white mb-2">
            Obrigado por ser nosso cliente!
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Renove sua assinatura IPTV de forma rápida e segura
          </p>
        </div>

        {/* Customer Info */}
        <Card className="mb-6 p-6">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-white mb-4">
            Detalhes da sua assinatura
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">Usuário:</span>
              <span className="font-medium text-zinc-900 dark:text-white">{customer.username}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">Plano Atual:</span>
              <span className="font-medium text-zinc-900 dark:text-white">{customer.package}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">Data de Vencimento:</span>
              <span className="font-medium text-zinc-900 dark:text-white">
                {formatDate(customer.expiresAt)}
              </span>
            </div>
            {customer.daysUntilExpiry >= 0 && (
              <div className="flex justify-between">
                <span className="text-zinc-600 dark:text-zinc-400">Dias Restantes:</span>
                <span
                  className={`font-medium ${
                    customer.daysUntilExpiry <= 7
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-green-600 dark:text-green-400'
                  }`}
                >
                  {customer.daysUntilExpiry} dias
                </span>
              </div>
            )}
          </div>
        </Card>

        {/* Package Selection */}
        <Card className="mb-6 p-6">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-white mb-4">
            Selecione o período de renovação
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            {packages.map((pkg) => (
              <button
                key={pkg.months}
                onClick={() => setSelectedMonths(pkg.months)}
                className={`p-4 rounded-lg border-2 transition-all ${
                  selectedMonths === pkg.months
                    ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300'
                    : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-cyan-300 dark:hover:border-cyan-600'
                }`}
              >
                <div className="font-semibold">{pkg.label}</div>
                <div className="text-sm mt-1">{formatCurrency(pkg.price)}</div>
              </button>
            ))}
          </div>

          {selectedPackage && (
            <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-4 mb-4">
              <div className="flex justify-between items-center">
                <span className="text-zinc-600 dark:text-zinc-400">Valor Total:</span>
                <span className="text-2xl font-bold text-zinc-900 dark:text-white">
                  {formatCurrency(selectedPackage.price)}
                </span>
              </div>
            </div>
          )}

          <button
            onClick={handleGeneratePayment}
            disabled={generating || !selectedPackage}
            className="w-full bg-cyan-500 hover:bg-cyan-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? 'Gerando pagamento...' : 'Renovar Plano'}
          </button>
        </Card>

        {/* Payment QR Code PIX */}
        {paymentData && paymentData.pixQrCode && (
          <Card ref={qrCodeRef} className="p-6">
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-white mb-4">
              Pagamento PIX
            </h2>
            <div className="text-center">
              <div className="mb-6">
                <p className="text-zinc-700 dark:text-zinc-300 mb-4 font-medium">
                  Escaneie o QR Code com o app do seu banco:
                </p>
                <div className="flex justify-center mb-4">
                  <img
                    src={`data:image/png;base64,${paymentData.pixQrCode}`}
                    alt="QR Code PIX"
                    className="max-w-xs border-2 border-zinc-200 dark:border-zinc-700 rounded-lg p-2 bg-white"
                  />
                </div>
              </div>
              
              {paymentData.pixCopyPaste && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    Ou copie o código PIX:
                  </label>
                  <textarea
                    readOnly
                    value={paymentData.pixCopyPaste}
                    onClick={(e) => {
                      // Selecionar todo o texto ao clicar
                      (e.target as HTMLTextAreaElement).select();
                    }}
                    className="w-full p-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm font-mono text-zinc-900 dark:text-white resize-none cursor-pointer"
                    rows={4}
                  />
                  <button
                    onClick={async () => {
                      try {
                        if (paymentData.pixCopyPaste) {
                          await navigator.clipboard.writeText(paymentData.pixCopyPaste);
                          toast.success('Código PIX copiado!');
                        } else {
                          toast.error('Código PIX não disponível');
                        }
                      } catch (error) {
                        // Fallback para navegadores que não suportam clipboard API
                        const textarea = document.createElement('textarea');
                        textarea.value = paymentData.pixCopyPaste || '';
                        textarea.style.position = 'fixed';
                        textarea.style.opacity = '0';
                        document.body.appendChild(textarea);
                        textarea.select();
                        try {
                          document.execCommand('copy');
                          toast.success('Código PIX copiado!');
                        } catch (err) {
                          toast.error('Erro ao copiar código PIX');
                        }
                        document.body.removeChild(textarea);
                      }
                    }}
                    className="mt-2 w-full bg-cyan-500 hover:bg-cyan-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                  >
                    📋 Copiar código PIX
                  </button>
                </div>
              )}

              <div className="bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 rounded-lg p-4 mb-4">
                <p className="text-sm text-green-700 dark:text-green-300 font-medium">
                  💰 Valor: {paymentData.valueFormatted}
                </p>
              </div>

              {paymentData.expirationDate && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
                  Válido até: {new Date(paymentData.expirationDate).toLocaleString('pt-BR', {
                    timeZone: 'America/Sao_Paulo',
                  })}
                </p>
              )}

              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Após o pagamento confirmado, sua assinatura será renovada automaticamente
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

