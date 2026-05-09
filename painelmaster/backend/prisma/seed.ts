/**
 * Seed inicial do PainelMaster.
 * Cria o primeiro usuário SUPER_ADMIN se nenhum existir.
 * Credenciais via env: SEED_ADMIN_USERNAME, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const username = process.env.SEED_ADMIN_USERNAME || 'admin';
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@painelmaster.local';
  const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe@123';

  const existing = await prisma.user.findFirst({
    where: { OR: [{ username }, { email }, { role: 'SUPER_ADMIN' }] },
  });
  if (existing) {
    console.log(`[seed] SUPER_ADMIN ja existe (${existing.username}).`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      username, email, password: passwordHash,
      name: 'Administrador',
      role: 'SUPER_ADMIN', status: 'ACTIVE',
      credits: 999999, creditsReadonly: true,
      billingType: 'PREPAID', canCreateResellers: true,
    },
  });
  console.log(`[seed] SUPER_ADMIN criado: ${user.username} / ${user.email}`);
  console.log(`[seed] Senha inicial: ${password} (troque no primeiro login)`);
}

main().catch((e) => { console.error(e); process.exit(1); })
      .finally(() => prisma.$disconnect());
