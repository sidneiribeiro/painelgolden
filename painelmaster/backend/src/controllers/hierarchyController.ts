import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const userSelect = {
  id: true,
  username: true,
  name: true,
  email: true,
  role: true,
  billingType: true,
  dueDate: true,
  customerPrice: true,
  billingCycleDays: true,
  status: true,
  credits: true,
  isBlockedByBilling: true,
  createdAt: true,
  _count: {
    select: {
      children: true,
      customers: { where: { status: 'ACTIVE' } }
    }
  }
};

// Obter hierarquia de usuários
export const getUserHierarchy = async (req: Request, res: Response) => {
  try {
    const userRole = req.user?.role || '';
    const userId = req.user?.userId;
    const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'MASTER'].includes(userRole);

    // Buscar todos os usuários (exceto SUPER_ADMIN)
    const allUsers = await prisma.user.findMany({
      where: { role: { not: 'SUPER_ADMIN' } },
      select: { ...userSelect, parentId: true },
      orderBy: { createdAt: 'desc' }
    });

    // Montar árvore em memória
    const userMap = new Map<string, any>();
    allUsers.forEach(u => userMap.set(u.id, { ...u, children: [] }));

    const tree: any[] = [];
    allUsers.forEach(u => {
      const node = userMap.get(u.id);
      if (u.parentId && userMap.has(u.parentId)) {
        userMap.get(u.parentId).children.push(node);
      } else {
        tree.push(node);
      }
    });

    // Calcular financeiro bottom-up em cada nó da árvore
    // revenue = soma de (filho.customerPrice * filho.activeCustomers) para filhos diretos
    // cost = meu customerPrice * meus activeCustomers (o que pago ao meu pai)
    // profit = revenue - cost
    // totalRevenue = revenue recursiva (inclui sub-sub-revendas)
    const calculateFinancials = (node: any): void => {
      let revenue = 0;
      let totalRevenueRecursive = 0;
      let totalCustomersRecursive = node._count?.customers || 0;

      for (const child of (node.children || [])) {
        calculateFinancials(child); // recursão primeiro

        const childPrice = child.customerPrice ? Number(child.customerPrice) : 0;
        const childActiveCustomers = child._count?.customers || 0;

        // Receita direta: o que cada filho me paga
        revenue += childPrice * childActiveCustomers;

        // Receita recursiva: inclui o que os filhos dos filhos geram
        totalRevenueRecursive += childPrice * childActiveCustomers;
        totalCustomersRecursive += child.financial?.totalCustomersRecursive || 0;
      }

      const myPrice = node.customerPrice ? Number(node.customerPrice) : 0;
      const myActiveCustomers = node._count?.customers || 0;
      const cost = myPrice * myActiveCustomers; // o que eu pago ao meu pai
      const profit = revenue - cost;

      node.financial = {
        revenue: Math.round(revenue * 100) / 100,
        cost: Math.round(cost * 100) / 100,
        profit: Math.round(profit * 100) / 100,
        totalCustomersRecursive,
        myActiveCustomers,
        myPricePerClient: myPrice,
      };
    };

    // Aplicar cálculo financeiro em toda a árvore
    for (const root of tree) {
      calculateFinancials(root);
    }

    // Se for reseller, filtrar para mostrar apenas a própria sub-árvore
    let visibleTree: any[];
    let visibleUsers: any[];

    if (isAdmin) {
      visibleTree = tree;
      visibleUsers = allUsers;
    } else {
      // Encontrar o nó do reseller atual e retornar ele como raiz
      const myNode = userMap.get(userId);
      visibleTree = myNode ? [myNode] : [];

      // Coletar todos os descendentes para estatísticas
      const collectDescendants = (node: any): any[] => {
        let result = [node];
        for (const child of (node.children || [])) {
          result = result.concat(collectDescendants(child));
        }
        return result;
      };
      visibleUsers = myNode ? collectDescendants(myNode) : [];
    }

    // Estatísticas baseadas nos usuários visíveis
    const now = new Date();
    const userIds = visibleUsers.map((u: any) => u.id);
    const totalCustomers = await prisma.customer.count({
      where: {
        status: 'ACTIVE',
        ...(isAdmin ? {} : { resellerUserId: { in: userIds } })
      }
    });

    // Totais financeiros
    let totalRevenue = 0;
    let totalCost = 0;
    for (const root of visibleTree) {
      totalRevenue += root.financial?.revenue || 0;
      totalCost += root.financial?.cost || 0;
    }

    const stats = {
      totalUsers: visibleUsers.length,
      totalResellers: visibleUsers.length,
      totalCustomers,
      blockedUsers: visibleUsers.filter((u: any) => u.status !== 'ACTIVE').length,
      overdueUsers: visibleUsers.filter((u: any) => u.dueDate && new Date(u.dueDate) < now).length,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      totalProfit: Math.round((totalRevenue - totalCost) * 100) / 100,
    };

    res.json({ tree: visibleTree, stats });
  } catch (error) {
    console.error('Erro ao buscar hierarquia:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};
