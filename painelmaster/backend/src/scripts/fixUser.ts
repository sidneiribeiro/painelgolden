import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../utils/crypto.js';

const prisma = new PrismaClient();

async function fixUser() {
  const username = 'admin';
  const email = 'portalrioinfo@gmail.com';
  const password = 'Rioinfo@2024###';
  const name = 'André Oliveira';
  const whatsapp = '5524993337836';

  console.log('🔍 Verificando usuário admin...');

  const existing = await prisma.user.findFirst({
    where: { username },
  });

  if (existing) {
    console.log('📝 Usuário admin já existe, atualizando...');
    const hashedPassword = await hashPassword(password);
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        password: hashedPassword,
        email,
        name,
        whatsapp,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        credits: 999999,
      },
    });
    console.log('✅ Usuário atualizado!');
  } else {
    console.log('➕ Criando usuário admin...');
    const hashedPassword = await hashPassword(password);
    await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        name,
        whatsapp,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        credits: 999999,
      },
    });
    console.log('✅ Usuário criado!');
  }

  console.log(`   Usuário: ${username}`);
  console.log(`   Email: ${email}`);
  console.log(`   Nome: ${name}`);
  console.log(`   Role: SUPER_ADMIN`);
}

fixUser()
  .then(() => {
    console.log('\n🎉 Concluído!');
  })
  .catch(console.error)
  .finally(() => prisma.$disconnect());

