import { Card, Spinner } from '../components/ui';
import { useFinancial } from '../hooks/useFinancial';

export function FinancialPage() {
  const { stats, isLoading, error } = useFinancial();

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="p-6">
          <p className="text-red-600 dark:text-red-400">
            Erro ao carregar dados financeiros. Tente novamente.
          </p>
        </Card>
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  // Calcular máximo para escala dos gráficos
  const maxRevenueByMonth = Math.max(...stats.revenueByMonth.map((r) => r.revenue), 0);
  const maxRevenueByPackage = Math.max(...stats.revenueByPackage.map((r) => r.revenue), 0);

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-zinc-900 dark:text-white">💰 Dashboard Financeiro</h1>
        <p className="text-zinc-600 dark:text-zinc-400 text-sm lg:text-base mt-1">
          Visão geral das finanças do painel
        </p>
      </div>

      {/* Cards de Estatísticas Principais */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Receita Total */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Receita Total</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-white mt-1">
                {formatCurrency(stats.totalRevenue)}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">Recebida</p>
            </div>
            <div className="w-12 h-12 bg-green-100 dark:bg-green-500/20 rounded-full flex items-center justify-center">
              <span className="text-2xl">💰</span>
            </div>
          </div>
        </Card>

        {/* Receita Potencial */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Receita Potencial</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-white mt-1">
                {formatCurrency(stats.potentialRevenue || 0)}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">Clientes ativos</p>
            </div>
            <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-500/20 rounded-full flex items-center justify-center">
              <span className="text-2xl">📈</span>
            </div>
          </div>
        </Card>

        {/* Receita do Mês */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Receita do Mês</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-white mt-1">
                {formatCurrency(stats.monthlyRevenue)}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">Este mês</p>
            </div>
            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-500/20 rounded-full flex items-center justify-center">
              <span className="text-2xl">📅</span>
            </div>
          </div>
        </Card>

        {/* Assinaturas Ativas */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Assinaturas Ativas</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-white mt-1">
                {stats.activeSubscriptions}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">Não vencidas</p>
            </div>
            <div className="w-12 h-12 bg-purple-100 dark:bg-purple-500/20 rounded-full flex items-center justify-center">
              <span className="text-2xl">👥</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Cards Secundários */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total de Clientes */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Total de Clientes</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-white mt-1">
                {stats.totalCustomers}
              </p>
            </div>
            <div className="w-12 h-12 bg-cyan-100 dark:bg-cyan-500/20 rounded-full flex items-center justify-center">
              <span className="text-2xl">👤</span>
            </div>
          </div>
        </Card>

        {/* Pagamentos Pagos */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Pagamentos Pagos</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-white mt-1">
                {formatCurrency(stats.paidPayments)}
              </p>
            </div>
            <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-500/20 rounded-full flex items-center justify-center">
              <span className="text-2xl">✅</span>
            </div>
          </div>
        </Card>

        {/* Taxa de Conversão */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Taxa de Ativos</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-white mt-1">
                {stats.totalCustomers > 0
                  ? `${Math.round((stats.activeSubscriptions / stats.totalCustomers) * 100)}%`
                  : '0%'}
              </p>
            </div>
            <div className="w-12 h-12 bg-pink-100 dark:bg-pink-500/20 rounded-full flex items-center justify-center">
              <span className="text-2xl">📊</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Receita por Mês */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-white mb-4">
            Receita por Mês (Últimos 12 meses)
          </h2>
          {stats.revenueByMonth.length > 0 ? (
            <div className="space-y-3">
              {stats.revenueByMonth.map((item, index) => {
                const percentage = maxRevenueByMonth > 0 ? (item.revenue / maxRevenueByMonth) * 100 : 0;
                return (
                  <div key={index} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-700 dark:text-zinc-300 font-medium">
                        {item.month}
                      </span>
                      <span className="text-zinc-900 dark:text-white font-semibold">
                        {formatCurrency(item.revenue)}
                      </span>
                    </div>
                    <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-3">
                      <div
                        className="bg-gradient-to-r from-blue-500 to-cyan-500 h-3 rounded-full transition-all duration-500"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-zinc-600 dark:text-zinc-400 text-center py-8">
              Nenhuma receita registrada no período
            </p>
          )}
        </Card>

        {/* Receita por Pacote */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-white mb-4">
            Receita por Pacote
          </h2>
          {stats.revenueByPackage.length > 0 ? (
            <div className="space-y-3">
              {stats.revenueByPackage.map((item, index) => {
                const percentage = maxRevenueByPackage > 0 ? (item.revenue / maxRevenueByPackage) * 100 : 0;
                return (
                  <div key={index} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-700 dark:text-zinc-300 font-medium">
                          {item.packageName}
                        </span>
                        <span className="text-xs text-zinc-500 dark:text-zinc-500">
                          ({item.count} vendas)
                        </span>
                      </div>
                      <span className="text-zinc-900 dark:text-white font-semibold">
                        {formatCurrency(item.revenue)}
                      </span>
                    </div>
                    <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-3">
                      <div
                        className="bg-gradient-to-r from-purple-500 to-pink-500 h-3 rounded-full transition-all duration-500"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-zinc-600 dark:text-zinc-400 text-center py-8">
              Nenhuma receita por pacote registrada
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

