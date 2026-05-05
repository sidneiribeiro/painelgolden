import { useState, useEffect } from 'react';
import { getImageUrl } from '../utils/imageUrl';

export function LandingPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [panelName, setPanelName] = useState<string>('PainelMaster');

  const getSubdomainReseller = (hostname: string) => {
    const parts = (hostname || '').split('.').filter(Boolean);
    if (parts.length < 3) return '';
    const sub = parts[0].toLowerCase();
    if (sub === 'www') return '';
    return sub;
  };

  useEffect(() => {
    // Buscar logo do painel (se existir)
    const fetchLogo = async () => {
      try {
        let hostname = '';
        try {
          hostname = window.location.hostname || '';
        } catch {
          hostname = '';
        }
        const reseller = getSubdomainReseller(hostname);
        const apiUrl = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:3001/api');
        const response = await fetch(`${apiUrl}/settings/panel/public${reseller ? `?reseller=${encodeURIComponent(reseller)}` : ''}`);
        if (response.ok) {
          const result = await response.json();
          if (result.data?.panelName) setPanelName(result.data.panelName);
          if (result.data?.logoUrl) {
            const logoUrl = getImageUrl(result.data.logoUrl);
            setLogoUrl(logoUrl);
          }
        }
      } catch (error) {
        setPanelName('PainelMaster');
      }
    };
    fetchLogo();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // Criar link mailto com assunto e corpo
    const subject = encodeURIComponent('Contato - PainelMaster');
    const body = encodeURIComponent(`Email: ${email}\n\nMensagem:\n${message}`);
    const mailtoLink = `mailto:portalrioinfo@gmail.com?subject=${subject}&body=${body}`;
    
    // Abrir cliente de email
    window.location.href = mailtoLink;
    
    setIsSubmitting(false);
    setEmail('');
    setMessage('');
  };


  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <div className="flex items-center space-x-3">
              {logoUrl ? (
                <img src={logoUrl} alt={panelName} className="h-14 md:h-16 w-auto max-w-[250px]" />
              ) : (
                <div className="w-14 h-14 md:w-16 md:h-16 bg-gradient-to-br from-primary-500 to-accent-500 rounded-lg"></div>
              )}
              <span className="text-xl md:text-2xl font-bold bg-gradient-to-r from-primary-600 to-accent-600 bg-clip-text text-transparent">
                {panelName}
              </span>
            </div>
            <div className="flex items-center space-x-4">
              <a
                href="#features"
                className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
              >
                Funcionalidades
              </a>
              <a
                href="#pricing"
                className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
              >
                Preços
              </a>
              <a
                href="/login"
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors font-medium"
              >
                Acessar Painel
              </a>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold mb-6">
              <span className="bg-gradient-to-r from-primary-600 via-accent-600 to-primary-600 bg-clip-text text-transparent animate-gradient">
                Painel Master Completo
              </span>
              <br />
              <span className="text-gray-900 dark:text-white">Profissional e Moderno</span>
            </h1>
            <p className="text-xl md:text-2xl text-gray-600 dark:text-gray-300 mb-8 max-w-3xl mx-auto">
              Gerencie seu Negócio de IPTV com ferramentas poderosas, integração completa e painel administrativo de última geração para XUIONE
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <a
                href="#pricing"
                className="px-8 py-4 bg-gradient-to-r from-primary-600 to-accent-600 text-white text-lg font-semibold rounded-xl hover:shadow-2xl hover:shadow-primary-500/50 transition-all transform hover:scale-105"
              >
                🚀 Começar Agora - R$ 1.000,00
              </a>
              <a
                href="#features"
                className="px-8 py-4 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-lg font-semibold rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-primary-500 transition-all"
              >
                Ver Funcionalidades
              </a>
            </div>
          </div>

          {/* Video Section */}
          <div className="mt-20 max-w-4xl mx-auto">
            <div className="relative rounded-2xl overflow-hidden shadow-2xl bg-gray-900 aspect-video">
              <iframe
                className="w-full h-full"
         src="https://www.youtube.com/embed/vfMBtKlBH78?si=p0h56E1N3qlOiwKv&amp;controls=0" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-4 sm:px-6 lg:px-8 bg-white dark:bg-gray-900">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4">
              Funcionalidades Completas
            </h2>
            <p className="text-xl text-gray-600 dark:text-gray-400">
              Tudo que você precisa para gerenciar seu Negócio de IPTV
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <div
                key={index}
                className="p-6 bg-gradient-to-br from-gray-50 to-white dark:from-gray-800 dark:to-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 hover:shadow-xl hover:border-primary-500 dark:hover:border-primary-500 transition-all transform hover:-translate-y-1"
              >
                <div className="text-4xl mb-4">{feature.icon}</div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                  {feature.title}
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-gray-50 to-white dark:from-gray-950 dark:to-gray-900">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4">
              Investimento Único
            </h2>
            <p className="text-xl text-gray-600 dark:text-gray-400">
              Uma única vez, use para sempre
            </p>
          </div>

          <div className="max-w-md mx-auto">
            <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border-2 border-primary-500 p-8 transform hover:scale-105 transition-all">
              <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                <span className="bg-gradient-to-r from-primary-600 to-accent-600 text-white px-4 py-1 rounded-full text-sm font-semibold">
                  Mais Popular
                </span>
              </div>

              <div className="text-center mt-4">
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Painel Completo
                </h3>
                <div className="my-6">
                  <span className="text-5xl font-bold text-gray-900 dark:text-white">
                    R$ 600,00
                  </span>
                  <span className="text-gray-600 dark:text-gray-400">/única vez</span>
                </div>

                <ul className="text-left space-y-4 mb-8">
                  <li className="flex items-center text-gray-700 dark:text-gray-300">
                    <span className="text-green-500 mr-2">✓</span>
                    Painel administrativo completo
                  </li>
                  <li className="flex items-center text-gray-700 dark:text-gray-300">
                    <span className="text-green-500 mr-2">✓</span>
                    Sistema de notificações WhatsApp
                  </li>
                  <li className="flex items-center text-gray-700 dark:text-gray-300">
                    <span className="text-green-500 mr-2">✓</span>
                    Integração com XUI.ONE
                  </li>
                  <li className="flex items-center text-gray-700 dark:text-gray-300">
                    <span className="text-green-500 mr-2">✓</span>
                    Sistema de pagamentos Asaas
                  </li>
                  <li className="flex items-center text-gray-700 dark:text-gray-300">
                    <span className="text-green-500 mr-2">✓</span>
                    Dashboard financeiro
                  </li>
                  <li className="flex items-center text-gray-700 dark:text-gray-300">
                    <span className="text-green-500 mr-2">✓</span>
                    Sistema de backups automáticos
                  </li>
                  <li className="flex items-center text-gray-700 dark:text-gray-300">
                    <span className="text-green-500 mr-2">✓</span>
                    Suporte e atualizações
                  </li>
                  <li className="flex items-center text-gray-700 dark:text-gray-300">
                    <span className="text-green-500 mr-2">✓</span>
                    Código-fonte completo
                  </li>
                </ul>

                <a
                  href="https://t.me/+5524993337836"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full block px-6 py-4 bg-gradient-to-r from-primary-600 to-accent-600 text-white text-center font-semibold rounded-xl hover:shadow-2xl hover:shadow-primary-500/50 transition-all"
                >
                  Comprar Agora
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-white dark:bg-gray-900">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4">
              O que nossos clientes dizem
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {testimonials.map((testimonial, index) => (
              <div
                key={index}
                className="p-6 bg-gradient-to-br from-gray-50 to-white dark:from-gray-800 dark:to-gray-900 rounded-xl border border-gray-200 dark:border-gray-700"
              >
                <div className="flex items-center mb-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-primary-500 to-accent-500 rounded-full flex items-center justify-center text-white font-bold text-xl">
                    {testimonial.initials}
                  </div>
                  <div className="ml-4">
                    <div className="font-semibold text-gray-900 dark:text-white">
                      {testimonial.name}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      {testimonial.role}
                    </div>
                  </div>
                </div>
                <p className="text-gray-700 dark:text-gray-300 italic">
                  "{testimonial.text}"
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-gray-50 to-white dark:from-gray-950 dark:to-gray-900">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4">
              Perguntas Frequentes
            </h2>
          </div>

          <div className="space-y-4">
            {faqs.map((faq, index) => (
              <div
                key={index}
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6"
              >
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                  {faq.question}
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  {faq.answer}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section id="contact" className="py-20 px-4 sm:px-6 lg:px-8 bg-white dark:bg-gray-900">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4">
              Entre em Contato
            </h2>
            <p className="text-xl text-gray-600 dark:text-gray-400 mb-4">
              Tire suas dúvidas ou faça seu pedido
            </p>
            <a
              href="https://t.me/+5524993337836"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-6 py-3 bg-[#0088cc] hover:bg-[#0077b5] text-white font-semibold rounded-xl transition-all transform hover:scale-105"
            >
              <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.172 1.899-.915 6.517-1.284 8.627-.154.893-.459 1.19-.753 1.221-.641.062-1.127-.423-1.749-.827-3.08-2.069-4.824-3.357-7.789-5.406-3.39-2.454-1.194-3.803.741-6.002.513-.588 1.127-.682 1.684-.694.467-.011 1.217.087 1.776.64.366.365 1.27 1.304 1.546 1.51.351.261.6.402.967.402.307 0 .767-.151 1.171-.305 3.246-1.38 5.677-2.293 6.513-2.643.298-.125.567-.187.778-.187.26 0 .679.127 1.005.465.283.295.447.695.523 1.19z"/>
              </svg>
              Falar no Telegram
            </a>
          </div>

          <form onSubmit={handleSubmit} className="bg-gradient-to-br from-gray-50 to-white dark:from-gray-800 dark:to-gray-900 rounded-2xl p-8 border border-gray-200 dark:border-gray-700">
            <div className="mb-6">
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Seu Email
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 dark:text-white"
                placeholder="seu@email.com"
              />
            </div>

            <div className="mb-6">
              <label htmlFor="message" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Mensagem
              </label>
              <textarea
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                rows={6}
                className="w-full px-4 py-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 dark:text-white"
                placeholder="Descreva sua necessidade ou dúvida..."
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full px-6 py-4 bg-gradient-to-r from-primary-600 to-accent-600 text-white font-semibold rounded-xl hover:shadow-2xl hover:shadow-primary-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Enviando...' : 'Enviar Mensagem'}
            </button>
          </form>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <div className="flex items-center justify-center space-x-3 mb-4">
              {logoUrl ? (
                <img src={logoUrl} alt="PainelMaster" className="h-14 md:h-16 w-auto max-w-[250px]" />
              ) : (
                <div className="w-14 h-14 md:w-16 md:h-16 bg-gradient-to-br from-primary-500 to-accent-500 rounded-lg"></div>
              )}
              <span className="text-xl md:text-2xl font-bold">PainelMaster</span>
            </div>
            <p className="text-gray-400 mb-4">
              Painel Master Profissional e Completo
            </p>
            <p className="text-gray-500 text-sm">
              © {new Date().getFullYear()} PainelMaster. Todos os direitos reservados.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Data
const features = [
  {
    icon: '👥',
    title: 'Gestão de Clientes',
    description: 'Gerencie todos os seus clientes em um único lugar, com controle completo de planos, renovações e status.',
  },
  {
    icon: '💬',
    title: 'Notificações Automáticas',
    description: 'Sistema completo de notificações via WhatsApp para vencimentos, renovações e testes.',
  },
  {
    icon: '💳',
    title: 'Pagamentos Integrados',
    description: 'Receba pagamentos via PIX através do Asaas com renovação automática de clientes.',
  },
  {
    icon: '📊',
    title: 'Dashboard Financeiro',
    description: 'Acompanhe receitas, despesas e estatísticas financeiras em tempo real.',
  },
  {
    icon: '🔄',
    title: 'Integração XUI.ONE',
    description: 'Integração completa com XUI.ONE para sincronização automática de dados.',
  },
  {
    icon: '💾',
    title: 'Backups Automáticos',
    description: 'Sistema de backup automático para garantir segurança dos seus dados.',
  },
  {
    icon: '👨‍💼',
    title: 'Multi-Revendedor',
    description: 'Sistema completo de hierarquia com revendedores e controle de créditos.',
  },
  {
    icon: '📦',
    title: 'Gestão de Pacotes',
    description: 'Crie e gerencie pacotes personalizados com diferentes durações e preços.',
  },
  {
    icon: '🔐',
    title: 'Segurança Total',
    description: 'Sistema seguro com autenticação, criptografia e proteção de dados.',
  },
];

const testimonials = [
  {
    initials: 'JO',
    name: 'João Silva',
    role: 'Operador IPTV',
    text: 'O melhor painel que já usei! Facilita muito minha gestão diária.',
  },
  {
    initials: 'MA',
    name: 'Maria Santos',
    role: 'Revendedora',
    text: 'Sistema muito completo e fácil de usar. Recomendo!',
  },
  {
    initials: 'PE',
    name: 'Pedro Costa',
    role: 'Empresário',
    text: 'Investimento que valeu muito a pena. Melhorou muito minha operação.',
  },
];

const faqs = [
  {
    question: 'Como funciona o pagamento?',
    answer: 'O pagamento é único de R$ 600,00. Após a confirmação, você recebe acesso completo ao código-fonte e instalação.',
  },
  {
    question: 'Preciso de conhecimento técnico?',
    answer: 'Básico conhecimento de servidor Linux é recomendado. Fornecemos documentação completa de instalação.',
  },
  {
    question: 'Recebo suporte após a compra?',
    answer: 'Sim! Oferecemos suporte para instalação e configuração inicial do painel.',
  },
  {
    question: 'O painel funciona em qualquer servidor?',
    answer: 'Funciona em qualquer servidor VPS com Linux (Ubuntu/Debian recomendado). Fornecemos os requisitos mínimos.',
  },
  {
    question: 'Posso personalizar o painel?',
    answer: 'Sim! Como você recebe o código-fonte completo, pode personalizar conforme sua necessidade.',
  },
  {
    question: 'Há atualizações futuras?',
    answer: 'Sim, você recebe todas as atualizações e melhorias que desenvolvemos para o painel.',
  },
];
