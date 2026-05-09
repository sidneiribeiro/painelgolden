import { Request, Response } from 'express';
import { XUIClient } from '../services/xui.client.js';
import { prisma } from '../config/database.js';
import { decryptApiKey } from './xuiSettings.controller.js';
import { asyncHandler } from '../middleware/error.middleware.js';

// Helper para obter cliente XUI do servidor padrão
async function getDefaultXuiClient(): Promise<XUIClient> {
  const server = await prisma.xuiServer.findFirst({
    where: { isDefault: true, isActive: true },
  }) || await prisma.xuiServer.findFirst({ where: { isActive: true } });
  
  if (!server) {
    throw new Error('Nenhum servidor XUI disponível');
  }
  
  return new XUIClient(server);
}

/**
 * GET /api/packages
 */
export const listPackages = asyncHandler(async (req: Request, res: Response) => {
  const client = await getDefaultXuiClient();
  const packages = await client.getPackages();
  
  // Formata para o padrão do painel
  const formattedPackages = packages.map(pkg => ({
    id: String(pkg.id),
    name: pkg.package_name,
    status: 'ACTIVE',
    is_trial: pkg.is_trial ? 'YES' : 'NO',
    credits: pkg.is_trial ? pkg.trial_credits : pkg.official_credits,
    duration: pkg.is_trial ? pkg.trial_duration : pkg.official_duration,
    duration_in: (pkg.is_trial ? pkg.trial_duration_in : pkg.official_duration_in).toUpperCase(),
    bouquets: pkg.groups,
    output_formats: pkg.output_formats,
  }));

  res.json({ data: formattedPackages });
});

/**
 * GET /api/packages/price
 */
export const getPackagesPrice = asyncHandler(async (req: Request, res: Response) => {
  const client = await getDefaultXuiClient();
  const packages = await client.getPackages();
  
  // Retorna pacotes com informações de preço/créditos
  const formattedPackages = packages.map(pkg => ({
    id: String(pkg.id),
    name: pkg.package_name,
    credits: pkg.is_trial ? pkg.trial_credits : pkg.official_credits,
    is_trial: pkg.is_trial ? 'YES' : 'NO',
  }));

  res.json({ data: formattedPackages });
});

/**
 * GET /api/packages/trials
 */
export const getTrialPackages = asyncHandler(async (req: Request, res: Response) => {
  const client = await getDefaultXuiClient();
  const packages = await client.getPackages();
  const trials = packages.filter(pkg => pkg.is_trial === 1);
  
  const formattedTrials = trials.map(pkg => ({
    id: String(pkg.id),
    name: pkg.package_name,
    duration: pkg.trial_duration,
    duration_in: pkg.trial_duration_in.toUpperCase(),
    credits: pkg.trial_credits,
    bouquets: pkg.groups,
  }));

  res.json({ data: formattedTrials });
});

/**
 * GET /api/packages/:id
 */
export const getPackage = asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const client = await getDefaultXuiClient();
  const pkg = await client.getPackage(id);
  
  res.json({
    data: {
      id: String(pkg.id),
      name: pkg.package_name,
      is_trial: pkg.is_trial ? 'YES' : 'NO',
      credits: pkg.is_trial ? pkg.trial_credits : pkg.official_credits,
      duration: pkg.is_trial ? pkg.trial_duration : pkg.official_duration,
      duration_in: (pkg.is_trial ? pkg.trial_duration_in : pkg.official_duration_in).toUpperCase(),
      bouquets: pkg.groups,
    },
  });
});

/**
 * GET /api/bouquets
 */
export const listBouquets = asyncHandler(async (req: Request, res: Response) => {
  const client = await getDefaultXuiClient();
  const bouquets = await client.getBouquets();
  
  res.json({
    data: bouquets.map(b => ({
      id: b.id,
      name: b.bouquet_name,
    })),
  });
});
