import { Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';
import { prisma } from '../config/database.js';

const logger = createLogger('FinancialController');

interface FinancialStats {
  totalRevenue: number;
  monthlyRevenue: number;
  potentialRevenue: number; // Receita potencial baseada nos pacotes dos clientes ativos
  pendingPayments: number;
  paidPayments: number;
  totalCustomers: number;
  activeSubscriptions: number;
  revenueByMonth: Array<{ month: string; revenue: number }>;
  revenueByPackage: Array<{ packageName: string; revenue: number; count: number }>;
}

/**
 * Obter estatísticas financeiras
 */
export const getFinancialStats = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    throw new AppError(401, 'Não autenticado');
  }

  logger.info(`[Financial] Buscando estatísticas financeiras para usuário: ${userId}`);

  try {
    // Obter usuário e suas permissões
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, id: true },
    });

    if (!user) {
      throw new AppError(404, 'Usuário não encontrado');
    }

    // Definir filtro de usuário baseado na role
    let customerFilter: any = {};
    if (user.role === 'RESELLER') {
      customerFilter.resellerUserId = userId;
    } else if (user.role === 'MASTER_RESELLER') {
      // MASTER_RESELLER vê seus clientes e dos seus RESELLERs
      const resellers = await prisma.user.findMany({
        where: { parentId: userId, role: 'RESELLER' },
        select: { id: true },
      });
      const resellerIds = resellers.map((r) => r.id);
      customerFilter.resellerUserId = { in: [userId, ...resellerIds] };
    }
    // SUPER_ADMIN e ADMIN veem tudo (sem filtro)

    // Receita total (soma de todos os pagamentos recebidos via Asaas + pagamentos manuais)
    // Pagamentos Asaas (value está em centavos)
    const totalRevenueResult = await prisma.asaasPayment.aggregate({
      where: {
        status: 'RECEIVED',
        ...(user.role === 'RESELLER' || user.role === 'MASTER_RESELLER'
          ? {
              customer: customerFilter,
            }
          : {}),
      },
      _sum: {
        value: true,
      },
    });
    // Converter de centavos para reais
    const asaasRevenue = (totalRevenueResult._sum.value || 0) / 100;

    // Pagamentos manuais (value já está em reais)
    const manualRevenueResult = await prisma.manualPayment.aggregate({
      where: {
        ...(user.role === 'RESELLER' || user.role === 'MASTER_RESELLER'
          ? {
              customer: customerFilter,
            }
          : {}), // SUPER_ADMIN e ADMIN veem todos os pagamentos manuais
      },
      _sum: {
        value: true,
      },
    });
    const manualRevenue = manualRevenueResult._sum.value || 0;

    // Receita total = Asaas + Manual
    const totalRevenue = Math.round((asaasRevenue + manualRevenue) * 100) / 100;

    // Receita do mês atual (Asaas + Manual)
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    // Receita do mês via Asaas (value está em centavos)
    const monthlyRevenueResult = await prisma.asaasPayment.aggregate({
      where: {
        status: 'RECEIVED',
        paidAt: {
          gte: startOfMonth,
        },
        ...(user.role === 'RESELLER' || user.role === 'MASTER_RESELLER'
          ? {
              customer: customerFilter,
            }
          : {}),
      },
      _sum: {
        value: true,
      },
    });
    const monthlyAsaasRevenue = (monthlyRevenueResult._sum.value || 0) / 100;

    // Receita do mês via pagamentos manuais (value já está em reais)
    const monthlyManualRevenueResult = await prisma.manualPayment.aggregate({
      where: {
        paymentDate: {
          gte: startOfMonth,
        },
        ...(user.role === 'RESELLER' || user.role === 'MASTER_RESELLER'
          ? {
              customer: customerFilter,
            }
          : {}), // SUPER_ADMIN e ADMIN veem todos os pagamentos manuais
      },
      _sum: {
        value: true,
      },
    });
    const monthlyManualRevenue = monthlyManualRevenueResult._sum.value || 0;

    // Receita do mês = Asaas + Manual
    const monthlyRevenue = Math.round((monthlyAsaasRevenue + monthlyManualRevenue) * 100) / 100;

    // Pagamentos pendentes
    const pendingPaymentsResult = await prisma.asaasPayment.aggregate({
      where: {
        status: {
          in: ['PENDING', 'OVERDUE'],
        },
        ...(user.role === 'RESELLER' || user.role === 'MASTER_RESELLER'
          ? {
              customer: customerFilter,
            }
          : {}),
      },
      _sum: {
        value: true,
      },
      _count: {
        id: true,
      },
    });
    // Converter de centavos para reais e arredondar para 2 casas decimais
    const pendingPayments = Math.round((pendingPaymentsResult._sum.value || 0) / 100 * 100) / 100;
    const pendingCount = pendingPaymentsResult._count.id || 0;

    // Pagamentos pagos
    const paidPaymentsResult = await prisma.asaasPayment.aggregate({
      where: {
        status: 'RECEIVED',
        ...(user.role === 'RESELLER' || user.role === 'MASTER_RESELLER'
          ? {
              customer: customerFilter,
            }
          : {}),
      },
      _sum: {
        value: true,
      },
      _count: {
        id: true,
      },
    });
    // Converter de centavos para reais e arredondar para 2 casas decimais
    const paidPayments = Math.round((paidPaymentsResult._sum.value || 0) / 100 * 100) / 100;
    const paidCount = paidPaymentsResult._count.id || 0;

    // Total de clientes (todos, exceto testes)
    const totalCustomers = await prisma.customer.count({
      where: {
        ...customerFilter,
        isTrial: false,
      },
    });

    // Assinaturas ativas (clientes não vencidos e não testes)
    const activeSubscriptions = await prisma.customer.count({
      where: {
        ...customerFilter,
        isTrial: false,
        expiresAt: {
          gte: new Date(),
        },
      },
    });
    // Receita Potencial: soma do valor dos pacotes dos clientes ativos
    const activeCustomersWithPackages = await prisma.customer.findMany({
      where: {
        ...customerFilter,
        isTrial: false,
        expiresAt: {
          gte: new Date(),
        },
        packageId: {
          not: null,
        },
      },
      include: {
        package: {
          select: {
            planPrice: true, // planPrice está em centavos
          },
        },
      },
    });

    // Calcular receita potencial (soma dos planPrice dos clientes ativos)
    const potentialRevenue = activeCustomersWithPackages.reduce((sum, customer) => {
      const planPrice = customer.package?.planPrice || 0;
      // planPrice está em centavos, converter para reais
      return sum + (planPrice / 100);
    }, 0);


    // Receita por mês (últimos 12 meses) - Asaas + Manual
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    // Pagamentos Asaas
    const paymentsByMonth = await prisma.asaasPayment.findMany({
      where: {
        status: 'RECEIVED',
        createdAt: {
          gte: twelveMonthsAgo,
        },
        ...(user.role === 'RESELLER' || user.role === 'MASTER_RESELLER'
          ? {
              customer: customerFilter,
            }
          : {}),
      },
      select: {
        value: true,
        createdAt: true,
      },
    });

    // Pagamentos manuais
    const manualPaymentsByMonth = await prisma.manualPayment.findMany({
      where: {
        paymentDate: {
          gte: twelveMonthsAgo,
        },
        ...(user.role === 'RESELLER' || user.role === 'MASTER_RESELLER'
          ? {
              customer: customerFilter,
            }
          : {}), // SUPER_ADMIN e ADMIN veem todos os pagamentos manuais
      },
      select: {
        value: true,
        paymentDate: true,
      },
    });

    // Agrupar por mês (value está em centavos para Asaas, reais para Manual)
    const revenueByMonthMap = new Map<string, number>();
    
    // Processar pagamentos Asaas (converter de centavos para reais)
    paymentsByMonth.forEach((payment) => {
      const monthKey = `${payment.createdAt.getFullYear()}-${String(payment.createdAt.getMonth() + 1).padStart(2, '0')}`;
      const current = revenueByMonthMap.get(monthKey) || 0;
      revenueByMonthMap.set(monthKey, current + payment.value / 100);
    });

    // Processar pagamentos manuais (já está em reais)
    manualPaymentsByMonth.forEach((payment) => {
      const monthKey = `${payment.paymentDate.getFullYear()}-${String(payment.paymentDate.getMonth() + 1).padStart(2, '0')}`;
      const current = revenueByMonthMap.get(monthKey) || 0;
      revenueByMonthMap.set(monthKey, current + payment.value);
    });

    const revenueByMonth = Array.from(revenueByMonthMap.entries())
      .map(([monthKey, revenue]) => {
        const [year, month] = monthKey.split('-');
        return {
          monthKey, // Manter a chave para ordenação
          month: `${parseInt(month)}/${year}`, // Formato mais simples: "1/2025"
          revenue,
        };
      })
      .sort((a, b) => {
        // Ordenar por monthKey (formato: "2025-01")
        return a.monthKey.localeCompare(b.monthKey);
      })
      .map(({ monthKey, ...rest }) => rest); // Remover monthKey do resultado final

    // Receita por pacote
    const paymentsWithPackages = await prisma.asaasPayment.findMany({
      where: {
        status: 'RECEIVED',
        ...(user.role === 'RESELLER' || user.role === 'MASTER_RESELLER'
          ? {
              customer: {
                ...customerFilter,
                package: {
                  isNot: null,
                },
              },
            }
          : {
              customer: {
                package: {
                  isNot: null,
                },
              },
            }),
      },
      include: {
        customer: {
          include: {
            package: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    const revenueByPackageMap = new Map<string, { revenue: number; count: number }>();
    paymentsWithPackages.forEach((payment) => {
      const packageName = payment.customer.package?.name || 'Sem Pacote';
      const current = revenueByPackageMap.get(packageName) || { revenue: 0, count: 0 };
      // Converter de centavos para reais
      revenueByPackageMap.set(packageName, {
        revenue: current.revenue + payment.value / 100,
        count: current.count + 1,
      });
    });

    const revenueByPackage = Array.from(revenueByPackageMap.entries())
      .map(([packageName, data]) => ({
        packageName,
        revenue: data.revenue,
        count: data.count,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const stats: FinancialStats = {
      totalRevenue,
      monthlyRevenue,
      potentialRevenue: Math.round(potentialRevenue * 100) / 100, // Arredondar para 2 casas decimais
      pendingPayments,
      paidPayments,
      totalCustomers,
      activeSubscriptions,
      revenueByMonth,
      revenueByPackage,
    };

    logger.info(`[Financial] Estatísticas calculadas: Receita Total: R$ ${totalRevenue.toFixed(2)}, Receita Potencial: R$ ${potentialRevenue.toFixed(2)}`);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    logger.error(`[Financial] Erro ao buscar estatísticas: ${error.message}`);
    throw error;
  }
});

