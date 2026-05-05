import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

// Schema para validação
const updateUserBillingSchema = z.object({
  billingType: z.enum(['PREPAID', 'POSTPAID']).optional(),
  dueDate: z.string().datetime().optional(),
  customerPrice: z.number().min(0).optional(),
  billingCycleDays: z.number().min(1).optional()
});

const renewUserSchema = z.object({
  days: z.number().min(1).default(30)
});

// Obter informações de cobrança do usuário logado
export const getBillingInfo = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        role: true,
        billingType: true,
        dueDate: true,
        customerPrice: true,
        billingCycleDays: true,
        isBlockedByBilling: true,
        credits: true,
        _count: {
          select: {
            customers: { where: { status: 'ACTIVE' } }
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const activeCustomers = user._count.customers;
    const totalToPay = user.customerPrice ? Number(user.customerPrice) * activeCustomers : 0;
    let daysUntilDue = 0;
    if (user.dueDate) {
      daysUntilDue = Math.ceil((new Date(user.dueDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    }

    res.json({
      billing: {
        billingType: user.billingType,
        isBlocked: user.isBlockedByBilling,
        dueDate: user.dueDate,
        daysUntilDue,
        customerPrice: user.customerPrice ? Number(user.customerPrice) : null,
        activeCustomers,
        totalToPay,
        credits: user.credits
      },
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Erro ao buscar informações de cobrança:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// Atualizar informações de cobrança (apenas MASTER ou admin)
export const updateUserBilling = async (req: Request, res: Response) => {
  try {
    // Apenas MASTER ou ADMIN pode alterar cobrança
    if (!['SUPER_ADMIN', 'ADMIN', 'MASTER'].includes(req.user?.role || '')) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const { id } = req.params;
    const validatedData = updateUserBillingSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { id }
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    // Validar regras de negócio
    if (validatedData.billingType === 'POSTPAID') {
      if (!validatedData.dueDate || !validatedData.customerPrice) {
        return res.status(400).json({ 
          error: 'Para pós-pago, informe data de vencimento e preço por cliente' 
        });
      }
    }

    // Verificar hierarquia (não permitir misturar tipos na mesma árvore)
    if (validatedData.billingType && validatedData.billingType !== user.billingType) {
      const hasSubResellers = await prisma.user.count({
        where: { parentId: id }
      });

      if (hasSubResellers > 0) {
        return res.status(400).json({ 
          error: 'Não é possível alterar tipo de cobrança de revendedor com sub-revendas' 
        });
      }

      // Verificar se o pai tem o mesmo tipo
      if (user.parentId) {
        const parent = await prisma.user.findUnique({
          where: { id: user.parentId },
          select: { billingType: true }
        });

        if (parent && parent.billingType !== validatedData.billingType) {
          return res.status(400).json({ 
            error: 'Tipo de cobrança deve ser o mesmo do revendedor pai' 
          });
        }
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: validatedData,
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        role: true,
        billingType: true,
        dueDate: true,
        customerPrice: true,
        billingCycleDays: true,
        status: true
      }
    });

    res.json({
      message: 'Informações de cobrança atualizadas com sucesso',
      user: updatedUser
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Dados inválidos', 
        details: error.errors 
      });
    }

    console.error('Erro ao atualizar cobrança:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// Renovar acesso do revendedor
export const renewUserAccess = async (req: Request, res: Response) => {
  try {
    // Apenas MASTER ou ADMIN pode renovar
    if (!['SUPER_ADMIN', 'ADMIN', 'MASTER'].includes(req.user?.role || '')) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const { id } = req.params;
    const { days } = renewUserSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { id }
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    if (user.billingType !== 'POSTPAID') {
      return res.status(400).json({ error: 'Apenas revendedores pós-pago podem ser renovados' });
    }

    // Calcular nova data de vencimento
    const currentDueDate = user.dueDate ? new Date(user.dueDate) : new Date();
    const newDueDate = new Date(currentDueDate);
    newDueDate.setDate(newDueDate.getDate() + days);

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        dueDate: newDueDate,
        isBlockedByBilling: false
      },
      select: {
        id: true,
        username: true,
        name: true,
        dueDate: true,
        isBlockedByBilling: true
      }
    });

    res.json({
      message: `Acesso renovado por ${days} dias com sucesso`,
      user: updatedUser,
      newDueDate: newDueDate
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Dados inválidos', 
        details: error.errors 
      });
    }

    console.error('Erro ao renovar acesso:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// Exportar relatório financeiro (CSV ou PDF)
export const exportBillingReport = async (req: Request, res: Response) => {
  try {
    const userRole = req.user?.role || '';
    const userId = req.user?.userId;

    const { status, startDate, endDate, format = 'csv', resellerId } = req.query;

    const where: any = { billingType: 'POSTPAID' };

    // RESELLER/MASTER_RESELLER: só exporta o próprio
    if (['RESELLER', 'MASTER_RESELLER'].includes(userRole)) {
      where.id = userId;
    } else if (resellerId) {
      where.parentId = resellerId as string;
    }

    if (status === 'OVERDUE') {
      where.dueDate = { lt: new Date() };
    } else if (status === 'UP_TO_DATE') {
      where.OR = [
        { dueDate: { gte: new Date() } },
        { dueDate: null }
      ];
    }

    if (startDate || endDate) {
      if (!where.dueDate) where.dueDate = {};
      if (startDate) where.dueDate.gte = new Date(startDate as string);
      if (endDate) where.dueDate.lte = new Date(endDate as string);
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        username: true,
        name: true,
        email: true,
        dueDate: true,
        customerPrice: true,
        _count: { select: { customers: { where: { status: 'ACTIVE' } } } }
      },
      orderBy: { dueDate: 'asc' }
    });

    const now = new Date();
    const reportRows = users.map(user => {
      const activeCustomers = user._count.customers;
      const price = user.customerPrice ? Number(user.customerPrice) : 0;
      const totalToPay = price * activeCustomers;
      const dueDateStr = user.dueDate ? new Date(user.dueDate).toLocaleDateString('pt-BR') : '-';
      const isOverdue = user.dueDate ? new Date(user.dueDate) < now : false;
      const statusStr = isOverdue ? 'VENCIDO' : 'EM DIA';
      return { username: user.username, name: user.name || '', email: user.email || '', dueDateStr, activeCustomers, price, totalToPay, statusStr };
    });

    // CSV
    if (format === 'csv') {
      const header = '"Usuário","Nome","Email","Vencimento","Clientes Ativos","Preço/Cliente","Total a Pagar","Status"';
      const csvRows = reportRows.map(r =>
        `"${r.username}","${r.name}","${r.email}","${r.dueDateStr}",${r.activeCustomers},"R$ ${r.price.toFixed(2)}","R$ ${r.totalToPay.toFixed(2)}","${r.statusStr}"`
      );
      const csv = '\uFEFF' + header + '\n' + csvRows.join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=relatorio-financeiro.csv');
      return res.send(csv);
    }

    // PDF
    if (format === 'pdf') {
      const PDFDocument = (await import('pdfkit')).default;
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=relatorio-financeiro.pdf');
      doc.pipe(res);

      // Header
      doc.fontSize(16).font('Helvetica-Bold').text('Relatório Financeiro - Revendedores', { align: 'center' });
      doc.fontSize(9).font('Helvetica').text(`Gerado em: ${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR')}`, { align: 'center' });
      doc.moveDown(0.5);

      // Summary
      const totalOverdue = reportRows.filter(r => r.statusStr === 'VENCIDO').length;
      const totalToPay = reportRows.reduce((s, r) => s + r.totalToPay, 0);
      const overdueAmount = reportRows.filter(r => r.statusStr === 'VENCIDO').reduce((s, r) => s + r.totalToPay, 0);

      doc.fontSize(9).font('Helvetica-Bold');
      doc.text(`Revendedores: ${reportRows.length}  |  Vencidos: ${totalOverdue}  |  Total a Pagar: R$ ${totalToPay.toFixed(2)}  |  Inadimplência: R$ ${overdueAmount.toFixed(2)}`, { align: 'center' });
      doc.moveDown(0.5);

      // Table
      const cols = [
        { label: 'Usuário', width: 100, x: 30 },
        { label: 'Nome', width: 130, x: 130 },
        { label: 'Email', width: 160, x: 260 },
        { label: 'Vencimento', width: 75, x: 420 },
        { label: 'Clientes', width: 50, x: 495 },
        { label: 'R$/Cli', width: 55, x: 545 },
        { label: 'Total', width: 65, x: 600 },
        { label: 'Status', width: 55, x: 665 },
      ];

      let y = doc.y;

      // Table header
      doc.font('Helvetica-Bold').fontSize(8);
      doc.rect(30, y - 2, 690, 16).fill('#e5e7eb');
      doc.fill('#111827');
      for (const col of cols) {
        doc.text(col.label, col.x, y, { width: col.width, height: 14 });
      }
      y += 18;

      // Table rows
      doc.font('Helvetica').fontSize(7.5);
      for (let i = 0; i < reportRows.length; i++) {
        if (y > 540) {
          doc.addPage();
          y = 30;
          // Re-draw header on new page
          doc.font('Helvetica-Bold').fontSize(8);
          doc.rect(30, y - 2, 690, 16).fill('#e5e7eb');
          doc.fill('#111827');
          for (const col of cols) {
            doc.text(col.label, col.x, y, { width: col.width, height: 14 });
          }
          y += 18;
          doc.font('Helvetica').fontSize(7.5);
        }

        const r = reportRows[i];

        // Alternate row bg
        if (i % 2 === 1) {
          doc.rect(30, y - 2, 690, 14).fill('#f9fafb');
          doc.fill('#111827');
        }

        // Status color
        const statusColor = r.statusStr === 'VENCIDO' ? '#dc2626' : '#16a34a';

        doc.fill('#111827');
        doc.text(r.username, cols[0].x, y, { width: cols[0].width, height: 12 });
        doc.text(r.name.substring(0, 22), cols[1].x, y, { width: cols[1].width, height: 12 });
        doc.text(r.email.substring(0, 28), cols[2].x, y, { width: cols[2].width, height: 12 });
        doc.text(r.dueDateStr, cols[3].x, y, { width: cols[3].width, height: 12 });
        doc.text(String(r.activeCustomers), cols[4].x, y, { width: cols[4].width, height: 12 });
        doc.text(`R$ ${r.price.toFixed(2)}`, cols[5].x, y, { width: cols[5].width, height: 12 });
        doc.text(`R$ ${r.totalToPay.toFixed(2)}`, cols[6].x, y, { width: cols[6].width, height: 12 });
        doc.fill(statusColor).text(r.statusStr, cols[7].x, y, { width: cols[7].width, height: 12 });
        doc.fill('#111827');

        y += 14;
      }

      doc.end();
      return;
    }

    return res.status(400).json({ error: 'Formato não suportado. Use csv ou pdf.' });
  } catch (error) {
    console.error('Erro ao exportar relatório:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// Obter relatório financeiro
export const getBillingReport = async (req: Request, res: Response) => {
  try {
    const userRole = req.user?.role || '';
    const userId = req.user?.userId;

    const { 
      status, // 'OVERDUE' | 'UP_TO_DATE' | 'ALL'
      startDate,
      endDate,
      resellerId, // Filtrar por revendedor específico (e seus sub-revendedores)
      page = 1,
      limit = 50
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    // Construir filtros
    const where: any = {
      billingType: 'POSTPAID'
    };

    // RESELLER/MASTER_RESELLER: vê suas sub-revendas (o que elas devem pagar a ele)
    const isReseller = ['RESELLER', 'MASTER_RESELLER'].includes(userRole);
    if (isReseller) {
      where.parentId = userId;
    }

    // Filtro por revendedor específico (admin pode filtrar por qualquer revendedor)
    if (resellerId && !isReseller) {
      where.parentId = resellerId as string;
    }

    if (status === 'OVERDUE') {
      where.dueDate = { lt: new Date() };
    } else if (status === 'UP_TO_DATE') {
      where.OR = [
        { dueDate: { gte: new Date() } },
        { dueDate: null }
      ];
    }

    if (startDate || endDate) {
      where.dueDate = {};
      if (startDate) {
        where.dueDate.gte = new Date(startDate as string);
      }
      if (endDate) {
        where.dueDate.lte = new Date(endDate as string);
      }
    }

    // Buscar revendedores com contagem de clientes
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: Number(limit),
        select: {
          id: true,
          username: true,
          name: true,
          email: true,
          dueDate: true,
          customerPrice: true,
          isBlockedByBilling: true,
          createdAt: true,
          _count: {
            select: {
              customers: {
                where: { status: 'ACTIVE' }
              }
            }
          }
        },
        orderBy: {
          dueDate: 'asc'
        }
      }),
      prisma.user.count({ where })
    ]);

    // Calcular totais
    const now = new Date();
    const reportData = users.map(user => {
      const activeCustomers = user._count.customers;
      const totalToPay = user.customerPrice ? 
        Number(user.customerPrice) * activeCustomers : 0;

      const daysUntilDue = user.dueDate ? 
        Math.ceil((new Date(user.dueDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 
        null;

      // Status baseado na data de vencimento real (não apenas isBlockedByBilling)
      const isOverdue = user.dueDate ? new Date(user.dueDate) < now : false;

      return {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        dueDate: user.dueDate,
        customerPrice: user.customerPrice ? Number(user.customerPrice) : null,
        activeCustomers,
        totalToPay,
        status: isOverdue ? 'VENCIDO' as const : 'EM DIA' as const,
        daysUntilDue
      };
    });

    // Buscar contagem global (não paginada) para o summary
    const allUsersForSummary = await prisma.user.findMany({
      where: { ...where },
      select: {
        dueDate: true,
        customerPrice: true,
        _count: { select: { customers: { where: { status: 'ACTIVE' } } } }
      }
    });

    let summaryTotalCustomers = 0;
    let summaryTotalToPay = 0;
    let summaryOverdue = 0;
    let summaryOverdueAmount = 0;

    for (const u of allUsersForSummary) {
      const ac = u._count.customers;
      const tp = u.customerPrice ? Number(u.customerPrice) * ac : 0;
      const overdue = u.dueDate ? new Date(u.dueDate) < now : false;
      summaryTotalCustomers += ac;
      summaryTotalToPay += tp;
      if (overdue) {
        summaryOverdue++;
        summaryOverdueAmount += tp;
      }
    }

    // Para resellers: calcular myCost (o que eu pago ao meu master)
    let myCost: any = null;
    if (isReseller && userId) {
      const me = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          customerPrice: true,
          dueDate: true,
          billingType: true,
          _count: { select: { customers: { where: { status: 'ACTIVE' } } } }
        }
      });
      if (me) {
        const myPrice = me.customerPrice ? Number(me.customerPrice) : 0;
        const myClients = me._count.customers;
        const myDueDate = me.dueDate;
        const myIsOverdue = myDueDate ? new Date(myDueDate) < now : false;
        myCost = {
          pricePerClient: myPrice,
          activeCustomers: myClients,
          totalCost: Math.round(myPrice * myClients * 100) / 100,
          dueDate: myDueDate,
          isOverdue: myIsOverdue,
          daysUntilDue: myDueDate ? Math.ceil((new Date(myDueDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null,
        };
      }
    }

    const summary = {
      totalResellers: total,
      totalActiveCustomers: summaryTotalCustomers,
      totalOverdue: summaryOverdue,
      totalToPay: summaryTotalToPay,
      overdueAmount: summaryOverdueAmount,
      myCost,
      viewMode: isReseller ? 'reseller' : 'admin',
    };

    res.json({
      report: reportData,
      summary,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Erro ao gerar relatório:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};
