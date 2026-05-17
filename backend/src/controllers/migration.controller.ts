import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { prisma } from '../config/database.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { hashPassword } from '../utils/crypto.js';
import { createLogger } from '../utils/logger.js';
import { XUIDBClient } from '../services/xui.db.client.js';
import { importPainelmasterDumpFromFile } from '../scripts/importPainelmasterDump.js';
import { importCustomersCsvFromFile } from '../scripts/importCustomersCsv.js';

const logger = createLogger('MigrationController');

// =====================================================
// TIPOS
// =====================================================
interface ParsedReseller {
  id: number;
  cadUser: string; // quem criou
  nome: string;
  usuario: string;
  senha: string;
  email: string;
  celular: string;
  perfil: string;
  bloqueado: string;
  inativo: string;
  valorCobrado: string;
  limiteTeste: string;
  limiteUser: string;
  conexao: number | null;
}

interface ParsedClient {
  id: number;
  cadUser: string; // revenda dona
  nome: string;
  usuario: string;
  senha: string;
  email: string;
  celular: string;
  conexao: number;
  perfil: string;
  bloqueado: string;
  dataPremio: string; // Unix timestamp como string
  valorCobrado: string;
  idXtream: number | null;
  isTrial: boolean;
}

// =====================================================
// PARSER DO SQL
// =====================================================
function parseSQLDump(filePath: string) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const resellers: ParsedReseller[] = [];
  const clients: ParsedClient[] = [];
  const trials: ParsedClient[] = [];

  let currentTable = '';
  let inInsert = false;

  for (const line of lines) {
    // Detectar INSERT INTO
    if (line.startsWith('INSERT INTO `rev`')) {
      currentTable = 'rev';
      inInsert = true;
    } else if (line.startsWith('INSERT INTO `usuario`')) {
      currentTable = 'usuario';
      inInsert = true;
    } else if (line.startsWith('INSERT INTO `teste`')) {
      currentTable = 'teste';
      inInsert = true;
    } else if (inInsert && !line.startsWith('(') && !line.startsWith('INSERT')) {
      inInsert = false;
      currentTable = '';
    }

    if (!inInsert || !line.startsWith('(')) continue;

    if (currentTable === 'rev') {
      const rev = parseRevLine(line);
      if (rev) resellers.push(rev);
    } else if (currentTable === 'usuario') {
      const usr = parseClientLine(line, false);
      if (usr) clients.push(usr);
    } else if (currentTable === 'teste') {
      const tst = parseClientLine(line, true);
      if (tst) trials.push(tst);
    }
  }

  return { resellers, clients, trials };
}

function parseRevLine(line: string): ParsedReseller | null {
  // (id, 'CadUser', 'nome', 'sobrenome', 'usuario', 'senha', 'email', 'celular', foto, 'perfil', 'bloqueado', 'inativo', 'data_cadastro', 'data_premio', 'data_nascimento', 'VencEmail', 'VencSMS', 'PrePago', Cota, CotaDias, 'ValorCobrado', 'ValorCobradoCabo', 'DataEnviado', 'xml', MensagemInterna, 'obs', 'LimiteTeste', 'LimiteUser', conexao, grupo)
  try {
    const match = line.match(
      /^\((\d+),\s*'([^']*)',\s*'([^']*)',\s*'[^']*',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*(?:NULL|'[^']*'),\s*(?:'([^']*)'|NULL),\s*'([^']*)',\s*'([^']*)',\s*'[^']*',\s*'[^']*',\s*'[^']*',\s*'[^']*',\s*'[^']*',\s*'[^']*',\s*(\d+|NULL),\s*(\d+|NULL),\s*'([^']*)',\s*'[^']*',\s*'[^']*',\s*'[^']*',\s*(?:NULL|'[^']*'),\s*(?:'([^']*)'|NULL),\s*'([^']*)',\s*'([^']*)',\s*(\d+|NULL)/
    );
    if (!match) return null;

    return {
      id: parseInt(match[1]),
      cadUser: match[2],
      nome: match[3],
      usuario: match[4],
      senha: match[5],
      email: match[6],
      celular: match[7],
      perfil: match[8] || '',
      bloqueado: match[9],
      inativo: match[10],
      valorCobrado: match[13] || '0',
      limiteTeste: match[15] || '0',
      limiteUser: match[16] || '0',
      conexao: match[17] && match[17] !== 'NULL' ? parseInt(match[17]) : null,
    };
  } catch (e) {
    return null;
  }
}

function parseClientLine(line: string, isTrial: boolean): ParsedClient | null {
  // usuario: (id, 'CadUser', 'nome', 'sobrenome', 'usuario', 'senha', 'email', 'celular', foto, conexao, 'perfil', 'bloqueado', 'data_cadastro', 'data_premio', 'data_nascimento', 'VencEmail', 'VencSMS', 'ValorCobrado', 'ValorCobradoCab'?, 'DataEnviado', 'PrePago', 'xml', MensagemInterna, 'obs', grupo, id_xtream, 'url_curta')
  try {
    const match = line.match(
      /^\((\d+),\s*'([^']*)',\s*'([^']*)',\s*'[^']*',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*(?:NULL|'[^']*'),\s*(\d+),\s*(?:'([^']*)'|NULL),\s*'([^']*)',\s*'[^']*',\s*'([^']*)',/
    );
    if (!match) return null;

    // Extrair id_xtream - está perto do final: ..., grupo, id_xtream, 'url_curta')
    const idXtreamMatch = line.match(/,\s*(\d+|NULL),\s*'[^']*'\)[,;]?\s*$/);
    let idXtream: number | null = null;
    if (idXtreamMatch && idXtreamMatch[1] !== 'NULL') {
      idXtream = parseInt(idXtreamMatch[1]);
    }

    // Extrair ValorCobrado
    const valorMatch = line.match(/'VencSMS'|'[NS]',\s*'[NS]',\s*'([^']*)',/);
    let valorCobrado = '0';
    // Simpler: get the value after bloqueado section
    const allValues = line.match(/'([^']*)'/g);

    return {
      id: parseInt(match[1]),
      cadUser: match[2],
      nome: match[3],
      usuario: match[4],
      senha: match[5],
      email: match[6],
      celular: match[7],
      conexao: parseInt(match[8]) || 1,
      perfil: match[9] || '',
      bloqueado: match[10],
      dataPremio: match[11] || '0',
      valorCobrado: '0',
      idXtream: idXtream,
      isTrial: isTrial,
    };
  } catch (e) {
    return null;
  }
}

// =====================================================
// MIGRAÇÃO - DRY RUN / EXECUTE
// =====================================================

/**
 * POST /api/migration/import-php-panel
 * Importar dados do painel PHP (gro_acessos)
 * Query params:
 *   - dryRun=true (padrão) - apenas simula
 *   - dryRun=false - executa de verdade
 *   - serverId - ID do servidor XUI (obrigatório)
 */
export const importPhpPanel = asyncHandler(async (req: Request, res: Response) => {
  const dryRun = req.query.dryRun !== 'false';
  const serverId = req.query.serverId as string;
  const sqlFile = req.query.sqlFile as string || '/home/ubuntu/transfer011/localhost.sql';

  if (!serverId) {
    throw new AppError(400, 'serverId é obrigatório');
  }

  // Validar servidor
  const server = await prisma.xuiServer.findUnique({ where: { id: serverId } });
  if (!server) {
    throw new AppError(404, 'Servidor não encontrado');
  }

  // Buscar admin user (pai dos resellers de nível 1)
  const adminUser = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' },
  });
  if (!adminUser) {
    throw new AppError(500, 'Admin user não encontrado');
  }

  // Verificar arquivo SQL
  if (!fs.existsSync(sqlFile)) {
    throw new AppError(404, `Arquivo SQL não encontrado: ${sqlFile}`);
  }

  logger.info(`[Migration] Iniciando ${dryRun ? 'DRY RUN' : 'EXECUÇÃO REAL'}`, {
    serverId,
    sqlFile,
    serverName: server.name,
  });

  // 1. PARSE DO SQL
  const { resellers, clients, trials } = parseSQLDump(sqlFile);
  logger.info(`[Migration] SQL parsed: ${resellers.length} revendas, ${clients.length} clientes, ${trials.length} testes`);

  // 2. BUSCAR LINHAS NO XTREAM UI (read-only!)
  let xuiLines: Map<string, number> = new Map(); // username -> lineId
  let xuiLinesById: Map<number, string> = new Map(); // lineId -> username
  
  try {
    const dbClient = new XUIDBClient(server);
    const conn = await dbClient.connect();
    
    const tableName = server.serverType === 'XTREAMUI' ? 'users' : 'lines';
    const [rows] = await conn.execute(`SELECT id, username FROM \`${tableName}\``);
    
    for (const row of rows as any[]) {
      xuiLines.set(row.username, row.id);
      xuiLinesById.set(row.id, row.username);
    }
    
    await dbClient.disconnect();
    logger.info(`[Migration] Xtream UI: ${xuiLines.size} linhas encontradas`);
  } catch (err: any) {
    logger.warn(`[Migration] Falha ao conectar ao Xtream UI (continuando sem validação): ${err.message}`);
  }

  // 3. BUSCAR PACOTES LOCAIS (para vincular clientes)
  const localPackages = await prisma.package.findMany({
    where: { serverId },
    select: { id: true, name: true, externalId: true },
  });
  const defaultPackage = localPackages[0]; // Primeiro pacote como fallback

  // 4. BUSCAR USERS EXISTENTES (para evitar duplicatas)
  const existingUsers = await prisma.user.findMany({
    select: { id: true, username: true },
  });
  const existingUserMap = new Map(existingUsers.map(u => [u.username.toLowerCase(), u.id]));

  // 5. BUSCAR CUSTOMERS EXISTENTES
  const existingCustomers = await prisma.customer.findMany({
    where: { serverId },
    select: { externalId: true, username: true },
  });
  const existingCustomerUsernames = new Set(existingCustomers.map(c => c.username.toLowerCase()));
  const existingCustomerExtIds = new Set(existingCustomers.map(c => c.externalId));

  // =====================================================
  // FASE 1: PROCESSAR REVENDAS
  // =====================================================
  const resellerResults = {
    total: resellers.length,
    toCreate: 0,
    skipped: 0,
    errors: [] as string[],
    created: [] as { username: string; nome: string; parentUsername: string }[],
  };

  // Mapa username -> userId para vincular clientes
  const resellerIdMap = new Map<string, string>();
  // Inicializar com admin
  resellerIdMap.set('admin', adminUser.id);

  // Ordenar revendas: primeiro os criados pelo admin, depois sub-revendas
  // Isso garante que os pais existam antes dos filhos
  const sortedResellers = [...resellers].sort((a, b) => {
    if (a.cadUser === 'admin' && b.cadUser !== 'admin') return -1;
    if (a.cadUser !== 'admin' && b.cadUser === 'admin') return 1;
    return 0;
  });

  // Múltiplas passadas para resolver dependências profundas
  const pendingResellers = [...sortedResellers];
  const maxPasses = 5;
  
  for (let pass = 0; pass < maxPasses && pendingResellers.length > 0; pass++) {
    const stillPending: ParsedReseller[] = [];
    
    for (const rev of pendingResellers) {
      const usernameLC = rev.usuario.toLowerCase();
      
      // Já existe no painel?
      if (existingUserMap.has(usernameLC)) {
        resellerIdMap.set(rev.usuario, existingUserMap.get(usernameLC)!);
        resellerResults.skipped++;
        continue;
      }
      
      // Já criado nesta migração?
      if (resellerIdMap.has(rev.usuario)) {
        resellerResults.skipped++;
        continue;
      }

      // Pai existe?
      const parentId = resellerIdMap.get(rev.cadUser);
      if (!parentId) {
        // Pai ainda não foi criado, tentar na próxima passada
        stillPending.push(rev);
        continue;
      }

      // Gerar email único se vazio
      const email = rev.email && rev.email.trim()
        ? rev.email.trim()
        : `${rev.usuario.toLowerCase()}@imported.local`;

      const status = rev.bloqueado === 'S' || rev.inativo === 'S' ? 'BLOCKED' : 'ACTIVE';

      if (!dryRun) {
        try {
          const hashedPassword = await hashPassword(rev.senha || rev.usuario);
          
          const newUser = await prisma.user.create({
            data: {
              username: rev.usuario,
              email: email,
              password: hashedPassword,
              name: rev.nome || rev.usuario,
              whatsapp: rev.celular || null,
              role: 'RESELLER',
              status: status,
              parentId: parentId,
              credits: 0,
              allowedServers: JSON.stringify([serverId]),
            },
          });

          resellerIdMap.set(rev.usuario, newUser.id);
          existingUserMap.set(usernameLC, newUser.id);
          resellerResults.toCreate++;
          resellerResults.created.push({
            username: rev.usuario,
            nome: rev.nome,
            parentUsername: rev.cadUser,
          });
        } catch (err: any) {
          // Email duplicado? Tentar com sufixo
          if (err.code === 'P2002' && err.meta?.target?.includes('email')) {
            try {
              const altEmail = `${rev.usuario.toLowerCase()}_${rev.id}@imported.local`;
              const hashedPassword = await hashPassword(rev.senha || rev.usuario);
              
              const newUser = await prisma.user.create({
                data: {
                  username: rev.usuario,
                  email: altEmail,
                  password: hashedPassword,
                  name: rev.nome || rev.usuario,
                  whatsapp: rev.celular || null,
                  role: 'RESELLER',
                  status: status,
                  parentId: parentId,
                  credits: 0,
                  allowedServers: JSON.stringify([serverId]),
                },
              });

              resellerIdMap.set(rev.usuario, newUser.id);
              existingUserMap.set(usernameLC, newUser.id);
              resellerResults.toCreate++;
              resellerResults.created.push({
                username: rev.usuario,
                nome: rev.nome,
                parentUsername: rev.cadUser,
              });
            } catch (err2: any) {
              resellerResults.errors.push(`${rev.usuario}: ${err2.message}`);
            }
          } else {
            resellerResults.errors.push(`${rev.usuario}: ${err.message}`);
          }
        }
      } else {
        // Dry run - simular criação
        resellerIdMap.set(rev.usuario, `dry-run-${rev.id}`);
        resellerResults.toCreate++;
        resellerResults.created.push({
          username: rev.usuario,
          nome: rev.nome,
          parentUsername: rev.cadUser,
        });
      }
    }
    
    pendingResellers.length = 0;
    pendingResellers.push(...stillPending);
  }

  if (pendingResellers.length > 0) {
    for (const rev of pendingResellers) {
      resellerResults.errors.push(`${rev.usuario}: pai '${rev.cadUser}' não encontrado após ${maxPasses} passadas`);
    }
  }

  // =====================================================
  // FASE 2: PROCESSAR CLIENTES + TESTES
  // =====================================================
  const allClients = [...clients, ...trials];
  
  const clientResults = {
    totalClients: clients.length,
    totalTrials: trials.length,
    total: allClients.length,
    toCreate: 0,
    skippedDuplicate: 0,
    skippedNoReseller: 0,
    skippedNoExternalId: 0,
    errors: [] as string[],
    created: [] as { username: string; reseller: string; externalId: string; isTrial: boolean }[],
    warnings: [] as string[],
  };

  for (const client of allClients) {
    const usernameLC = client.usuario.toLowerCase();

    // Já existe como customer?
    if (existingCustomerUsernames.has(usernameLC)) {
      clientResults.skippedDuplicate++;
      continue;
    }

    // Encontrar reseller owner
    let resellerId = resellerIdMap.get(client.cadUser);
    
    // Se CadUser é 'N' ou 'S' (valores de campo bloqueado nos testes), usar admin
    if (!resellerId && (client.cadUser === 'N' || client.cadUser === 'S')) {
      resellerId = adminUser.id;
    }
    
    // Tentar buscar reseller pelo username no banco
    if (!resellerId) {
      const existingResellerId = existingUserMap.get(client.cadUser.toLowerCase());
      if (existingResellerId) {
        resellerId = existingResellerId;
      }
    }

    if (!resellerId) {
      clientResults.skippedNoReseller++;
      clientResults.warnings.push(`${client.usuario}: reseller '${client.cadUser}' não encontrado`);
      continue;
    }

    // Determinar externalId (ID da linha no Xtream UI)
    let externalId: string | null = null;

    // Primeiro: usar id_xtream do painel PHP se disponível
    if (client.idXtream && client.idXtream > 0) {
      // Validar que esse ID realmente existe no Xtream UI
      if (xuiLinesById.has(client.idXtream)) {
        const xuiUsername = xuiLinesById.get(client.idXtream);
        if (xuiUsername === client.usuario) {
          externalId = String(client.idXtream);
        } else {
          clientResults.warnings.push(
            `${client.usuario}: id_xtream=${client.idXtream} existe mas username no XUI é '${xuiUsername}' (diferente)`
          );
          // Tentar buscar pelo username
          const foundId = xuiLines.get(client.usuario);
          if (foundId) {
            externalId = String(foundId);
          }
        }
      } else {
        // ID não existe no XUI, tentar buscar pelo username
        const foundId = xuiLines.get(client.usuario);
        if (foundId) {
          externalId = String(foundId);
          clientResults.warnings.push(
            `${client.usuario}: id_xtream=${client.idXtream} não existe no XUI, usando ${foundId} (por username)`
          );
        }
      }
    }

    // Segundo: buscar pelo username no Xtream UI
    if (!externalId) {
      const foundId = xuiLines.get(client.usuario);
      if (foundId) {
        externalId = String(foundId);
      }
    }

    if (!externalId) {
      clientResults.skippedNoExternalId++;
      clientResults.warnings.push(`${client.usuario}: não encontrado no Xtream UI (sem externalId)`);
      continue;
    }

    // Verificar se externalId já existe como customer
    if (existingCustomerExtIds.has(externalId)) {
      clientResults.skippedDuplicate++;
      continue;
    }

    // Calcular expiração
    let expiresAt: Date;
    const premioTs = parseInt(client.dataPremio);
    if (premioTs && premioTs > 0) {
      expiresAt = new Date(premioTs * 1000);
    } else {
      // Sem data de vencimento, usar 30 dias a partir de agora
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);
    }

    // Status
    const status = client.bloqueado === 'S' ? 'BANNED' : 
                   (expiresAt < new Date() ? 'EXPIRED' : 'ACTIVE');

    if (!dryRun) {
      try {
        await prisma.customer.create({
          data: {
            externalId: externalId,
            serverId: serverId,
            username: client.usuario,
            password: client.senha,
            name: client.nome || null,
            email: client.email || null,
            whatsapp: client.celular || null,
            packageId: defaultPackage?.id || null,
            resellerUserId: resellerId,
            status: status,
            isTrial: client.isTrial,
            connections: client.conexao || 1,
            expiresAt: expiresAt,
          },
        });

        existingCustomerUsernames.add(usernameLC);
        existingCustomerExtIds.add(externalId);
        clientResults.toCreate++;
        clientResults.created.push({
          username: client.usuario,
          reseller: client.cadUser,
          externalId: externalId,
          isTrial: client.isTrial,
        });
      } catch (err: any) {
        clientResults.errors.push(`${client.usuario}: ${err.message}`);
      }
    } else {
      existingCustomerUsernames.add(usernameLC);
      existingCustomerExtIds.add(externalId);
      clientResults.toCreate++;
      clientResults.created.push({
        username: client.usuario,
        reseller: client.cadUser,
        externalId: externalId,
        isTrial: client.isTrial,
      });
    }
  }

  // =====================================================
  // RESULTADO
  // =====================================================
  const result = {
    mode: dryRun ? 'DRY_RUN' : 'EXECUTED',
    server: { id: server.id, name: server.name, type: server.serverType },
    xuiLinesTotal: xuiLines.size,
    localPackages: localPackages.length,
    defaultPackage: defaultPackage ? { id: defaultPackage.id, name: defaultPackage.name } : null,
    resellers: {
      ...resellerResults,
      created: dryRun ? resellerResults.created : resellerResults.created.slice(0, 20),
    },
    customers: {
      ...clientResults,
      created: dryRun ? clientResults.created.slice(0, 50) : clientResults.created.slice(0, 20),
      warnings: clientResults.warnings.slice(0, 50),
    },
  };

  logger.info(`[Migration] ${dryRun ? 'DRY RUN' : 'EXECUÇÃO'} concluída`, {
    resellersCreated: resellerResults.toCreate,
    customersCreated: clientResults.toCreate,
    errors: resellerResults.errors.length + clientResults.errors.length,
  });

  res.json({ data: result });
});

/**
 * POST /api/migration/fix-reseller-billing
 * Corrige billingType, dueDate, customerPrice e billingCycleDays dos resellers importados
 * Lê os dados diretamente do SQL dump
 */
export const fixResellerBilling = asyncHandler(async (req: Request, res: Response) => {
  const dryRun = req.query.dryRun !== 'false';
  const sqlFile = req.query.sqlFile as string || '/app/localhost.sql';

  if (!fs.existsSync(sqlFile)) {
    throw new AppError(404, `Arquivo SQL não encontrado: ${sqlFile}`);
  }

  logger.info(`[Migration] fixResellerBilling ${dryRun ? 'DRY RUN' : 'EXECUTANDO'}`);

  const content = fs.readFileSync(sqlFile, 'utf-8');
  const allLines = content.split('\n');

  // Encontrar segundo bloco INSERT INTO `rev` (dados reais no final do arquivo)
  const revLines: string[] = [];
  let inRev = false;
  let foundCount = 0;
  for (const line of allLines) {
    if (line.includes('INSERT INTO `rev`')) {
      foundCount++;
      if (foundCount === 2) inRev = true;
    }
    if (inRev && line.trim().startsWith('(')) {
      revLines.push(line.trim());
    } else if (inRev && revLines.length > 0 && !line.trim().startsWith('(')) {
      break;
    }
  }

  logger.info(`[Migration] Encontradas ${revLines.length} linhas de revendas`);

  const results = {
    total: revLines.length,
    updated: 0,
    notFound: 0,
    errors: [] as string[],
    details: [] as any[],
  };

  for (const line of revLines) {
    // Extrair usuario
    const uMatch = line.match(/^\(\d+,\s*'[^']*',\s*'[^']*',\s*'[^']*',\s*'([^']*)'/);
    if (!uMatch) continue;
    const usuario = uMatch[1];

    // Extrair VencEmail, VencSMS, PrePago, Cota, CotaDias, ValorCobrado, ValorCobradoCabo
    const ppMatch = line.match(/'([NS])',\s*'([NS])',\s*'([NS])',\s*(\d+|NULL),\s*(\d+|NULL),\s*'([^']*)',\s*'([^']*)'/);
    if (!ppMatch) {
      results.errors.push(`${usuario}: regex billing não encontrado`);
      continue;
    }

    const prePago = ppMatch[3];
    const cotaDias = ppMatch[5] !== 'NULL' ? parseInt(ppMatch[5]) : 30;
    const valorCobradoCabo = ppMatch[7]; // preço por cliente

    // Extrair bloqueado, inativo
    const biMatch = line.match(/'([NS])',\s*'([NS])',\s*'\d{4}-\d{2}/);
    const bloqueado = biMatch ? biMatch[1] : 'N';
    const inativo = biMatch ? biMatch[2] : 'N';

    // Extrair data_premio (Unix timestamp)
    const dpMatch = line.match(/'(\d{9,13})'/);
    const dataPremio = dpMatch ? dpMatch[1] : '0';

    // Calcular valores
    const billingType = prePago === 'S' ? 'PREPAID' : 'POSTPAID';
    const billingCycleDays = cotaDias || 30;

    let customerPrice: number | null = null;
    try {
      const val = parseFloat(valorCobradoCabo.replace(',', '.'));
      if (!isNaN(val) && val > 0) customerPrice = val;
    } catch {}

    let dueDate: Date | null = null;
    try {
      const ts = parseInt(dataPremio);
      if (ts > 1000000000) {
        const d = new Date(ts * 1000);
        // Ignorar datas absurdas (> 2100)
        if (d.getFullYear() <= 2100) {
          dueDate = d;
        }
      }
    } catch {}

    const status = (bloqueado === 'S' || inativo === 'S') ? 'BLOCKED' : 'ACTIVE';

    // Buscar user no banco
    const user = await prisma.user.findFirst({
      where: { username: usuario, role: 'RESELLER' },
      select: { id: true, username: true, billingType: true, dueDate: true, status: true },
    });

    if (!user) {
      results.notFound++;
      continue;
    }

    const updateData: any = {
      billingType: billingType,
      billingCycleDays: billingCycleDays,
      status: status,
    };

    if (customerPrice !== null) {
      updateData.customerPrice = customerPrice;
    }

    if (dueDate) {
      updateData.dueDate = dueDate;
    }

    if (!dryRun) {
      try {
        await prisma.user.update({
          where: { id: user.id },
          data: updateData,
        });
        results.updated++;
      } catch (err: any) {
        results.errors.push(`${usuario}: ${err.message}`);
      }
    } else {
      results.updated++;
    }

    results.details.push({
      username: usuario,
      billingType,
      billingCycleDays,
      customerPrice,
      dueDate: dueDate ? dueDate.toISOString().slice(0, 10) : null,
      status,
    });
  }

  logger.info(`[Migration] fixResellerBilling: ${results.updated} atualizados, ${results.notFound} não encontrados`);

  res.json({
    data: {
      mode: dryRun ? 'DRY_RUN' : 'EXECUTED',
      ...results,
      details: results.details.slice(0, dryRun ? 200 : 20),
    },
  });
});

/**
 * GET /api/migration/status
 * Retorna o estado atual da migração
 */
export const migrationStatus = asyncHandler(async (req: Request, res: Response) => {
  const serverId = req.query.serverId as string;

  const [totalUsers, totalResellers, totalCustomers, totalTrials] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: 'RESELLER' } }),
    prisma.customer.count({ where: serverId ? { serverId } : undefined }),
    prisma.customer.count({ where: { isTrial: true, ...(serverId ? { serverId } : {}) } }),
  ]);

  res.json({
    data: {
      totalUsers,
      totalResellers,
      totalCustomers,
      totalTrials,
    },
  });
});

export const importPainelmasterDump = asyncHandler(async (req: Request, res: Response) => {
  const dryRun = req.query.dryRun !== 'false';
  const filename =
    (typeof (req.body as any)?.filename === 'string' ? String((req.body as any).filename) : '') ||
    (typeof (req.query as any)?.filename === 'string' ? String((req.query as any).filename) : '');

  const clean = String(filename || '').trim();
  if (!clean) throw new AppError(400, 'filename é obrigatório');

  const data = await importPainelmasterDumpFromFile({ filename: clean, dryRun });
  res.json({ success: true, dryRun, data });
});

export const importCustomersCsv = asyncHandler(async (req: Request, res: Response) => {
  const dryRun = req.query.dryRun !== 'false';
  const filename =
    (typeof (req.body as any)?.filename === 'string' ? String((req.body as any).filename) : '') ||
    (typeof (req.query as any)?.filename === 'string' ? String((req.query as any).filename) : '');
  const serverId = typeof (req.query as any)?.serverId === 'string' ? String((req.query as any).serverId) : '';

  const clean = String(filename || '').trim();
  if (!clean) throw new AppError(400, 'filename é obrigatório');
  if (!serverId) throw new AppError(400, 'serverId é obrigatório');

  const createMissingResellers = String((req.query as any)?.createMissingResellers || '').toLowerCase() === 'true';
  const defaultExpiresDaysRaw = parseInt(String((req.query as any)?.defaultExpiresDays || '30'), 10);
  const maxRowsRaw = parseInt(String((req.query as any)?.maxRows || '5000'), 10);

  const defaultExpiresDays = Number.isFinite(defaultExpiresDaysRaw) && defaultExpiresDaysRaw > 0 ? defaultExpiresDaysRaw : 30;
  const maxRows = Number.isFinite(maxRowsRaw) && maxRowsRaw > 0 ? maxRowsRaw : 5000;

  const data = await importCustomersCsvFromFile({
    filename: clean,
    serverId,
    dryRun,
    createMissingResellers,
    defaultExpiresDays,
    maxRows,
  });

  res.json({ success: true, dryRun, data });
});
