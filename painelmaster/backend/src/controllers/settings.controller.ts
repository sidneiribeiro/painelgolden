import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/error.middleware.js';
import path from 'path';
import fs from 'fs/promises';

export const getPanelSettings = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  // Busca configurações do usuário atual
  let settings = await prisma.panelSettings.findUnique({
    where: { userId },
  });
  
  // Se não tiver configurações próprias, busca as do SUPER_ADMIN como padrão
  if (!settings) {
    const superAdmin = await prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN' },
      select: { id: true },
    });

    if (superAdmin) {
      const superAdminSettings = await prisma.panelSettings.findUnique({
        where: { userId: superAdmin.id },
      });

      if (superAdminSettings) {
        // Retorna as configurações do SUPER_ADMIN como padrão (sem criar registro próprio)
        res.json({
          success: true,
          data: superAdminSettings,
        });
        return;
      }
    }

    // Se não houver SUPER_ADMIN ou ele não tiver configurações, retorna padrão
    res.json({
      success: true,
      data: {
        id: 'default',
        userId: userId,
        panelName: 'Painel IPTV',
        logoUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return;
  }
  
  res.json({
    success: true,
    data: settings,
  });
});

// Endpoint público para buscar configurações (para tela de login)
// Retorna as configurações do SUPER_ADMIN como padrão
export const getPublicPanelSettings = asyncHandler(async (req: Request, res: Response) => {
  const reseller = typeof req.query.reseller === 'string' ? req.query.reseller.trim() : '';

  if (reseller) {
    const user = await prisma.user.findFirst({
      where: { username: reseller },
      select: { id: true },
    });
    if (user) {
      const userSettings = await prisma.panelSettings.findUnique({
        where: { userId: user.id },
      });
      if (userSettings) {
        res.json({
          success: true,
          data: userSettings,
        });
        return;
      }
    }
  }

  // Busca configurações do SUPER_ADMIN para usar como padrão na tela de login
  const superAdmin = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' },
    select: { id: true },
  });

  if (superAdmin) {
    const superAdminSettings = await prisma.panelSettings.findUnique({
      where: { userId: superAdmin.id },
    });

    if (superAdminSettings) {
      res.json({
        success: true,
        data: superAdminSettings,
      });
      return;
    }
  }

  // Se não houver SUPER_ADMIN ou ele não tiver configurações, retorna padrão
  res.json({
    success: true,
    data: {
      id: 'default',
      panelName: 'Painel IPTV',
      logoUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
});

export const updatePanelName = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { panelName } = req.body;
  
  if (!panelName || typeof panelName !== 'string' || panelName.trim().length === 0) {
    throw new AppError('Nome do painel é obrigatório', 400);
  }
  
  if (panelName.length > 100) {
    throw new AppError('Nome do painel deve ter no máximo 100 caracteres', 400);
  }
  
  const settings = await prisma.panelSettings.upsert({
    where: { userId },
    create: {
      userId,
      panelName: panelName.trim(),
    },
    update: {
      panelName: panelName.trim(),
    },
  });
  
  res.json({
    success: true,
    data: settings,
    message: 'Nome do painel atualizado com sucesso',
  });
});

export const updatePublicBaseUrl = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { publicBaseUrl } = req.body;

  if (publicBaseUrl !== null && publicBaseUrl !== undefined && typeof publicBaseUrl !== 'string') {
    throw new AppError('publicBaseUrl inválido', 400);
  }

  const value = typeof publicBaseUrl === 'string' ? publicBaseUrl.trim() : '';
  let normalized: string | null = null;
  if (value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('invalid protocol');
      }
      normalized = `${url.protocol}//${url.host}`;
    } catch {
      throw new AppError('publicBaseUrl deve ser uma URL válida (ex: https://revenda.seudominio.com)', 400);
    }
  }

  const settings = await prisma.panelSettings.upsert({
    where: { userId },
    create: {
      userId,
      panelName: 'Painel IPTV',
      logoUrl: null,
      publicBaseUrl: normalized,
    },
    update: {
      publicBaseUrl: normalized,
    },
  });

  res.json({
    success: true,
    data: settings,
    message: 'URL pública atualizada com sucesso',
  });
});

export const uploadLogo = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const file = (req as any).file;
  
  if (!file) {
    throw new AppError('Nenhum arquivo enviado', 400);
  }
  
  // Validar tipo de arquivo
  const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedMimes.includes(file.mimetype)) {
    await fs.unlink(file.path).catch(() => {});
    throw new AppError('Formato de arquivo não permitido. Use JPG, PNG, GIF ou WebP', 400);
  }
  
  // Validar tamanho (máximo 5MB)
  const maxSize = 5 * 1024 * 1024; // 5MB
  if (file.size > maxSize) {
    await fs.unlink(file.path).catch(() => {});
    throw new AppError('Arquivo muito grande. Tamanho máximo: 5MB', 400);
  }
  
  // Salvar no volume persistente /app/storage/logos/
  const uploadsDir = '/app/storage/logos';
  await fs.mkdir(uploadsDir, { recursive: true });
  
  const fileName = `logo-${userId}-${Date.now()}.${file.originalname.split('.').pop()}`;
  const filePath = path.join(uploadsDir, fileName);
  
  // Usar copyFile + unlink pois temp e storage podem estar em filesystems diferentes (Docker volume)
  await fs.copyFile(file.path, filePath);
  await fs.unlink(file.path).catch(() => {});
  
  // URL relativa que será servida pelo Express via express.static('/app/storage')
  const logoUrl = `/uploads/logos/${fileName}`;
  
  // Buscar configurações existentes para remover logo antigo e pegar nome padrão
  const existingSettings = await prisma.panelSettings.findUnique({
    where: { userId },
  });
  
  if (existingSettings?.logoUrl) {
    const oldLogoPath = path.join('/app/storage', existingSettings.logoUrl);
    await fs.unlink(oldLogoPath).catch(() => {});
  }
  
  // Buscar nome padrão do SUPER_ADMIN se não tiver configurações próprias
  let defaultPanelName = 'Painel IPTV';
  if (!existingSettings) {
    const superAdmin = await prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN' },
      select: { id: true },
    });
    if (superAdmin) {
      const superAdminSettings = await prisma.panelSettings.findUnique({
        where: { userId: superAdmin.id },
      });
      if (superAdminSettings?.panelName) {
        defaultPanelName = superAdminSettings.panelName;
      }
    }
  }

  // Atualizar ou criar configurações
  const settings = await prisma.panelSettings.upsert({
    where: { userId },
    create: {
      userId,
      panelName: defaultPanelName,
      logoUrl,
    },
    update: {
      logoUrl,
    },
  });
  
  res.json({
    success: true,
    data: settings,
    message: 'Logo atualizado com sucesso',
  });
});

export const removeLogo = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  
  const settings = await prisma.panelSettings.findUnique({
    where: { userId },
  });
  
  if (settings?.logoUrl) {
    const logoPath = path.join('/app/storage', settings.logoUrl);
    await fs.unlink(logoPath).catch(() => {});
    
    await prisma.panelSettings.update({
      where: { userId },
      data: {
        logoUrl: null,
      },
    });
  } else {
    // Se não existir configuração, cria uma vazia
    await prisma.panelSettings.upsert({
      where: { userId },
      create: {
        userId,
        panelName: 'Painel IPTV',
        logoUrl: null,
      },
      update: {
        logoUrl: null,
      },
    });
  }
  
  const updatedSettings = await prisma.panelSettings.findUnique({
    where: { userId },
  });
  
  res.json({
    success: true,
    data: updatedSettings,
    message: 'Logo removido com sucesso',
  });
});
