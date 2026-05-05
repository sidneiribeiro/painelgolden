import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../utils/crypto.js';

const prisma = new PrismaClient();

async function createAdmin() {
  const username = 'admin';
  const email = 'admin@painel.com';
  const password = 'admin123';
  const name = 'Administrador';

  console.log('🔍 Verificando usuário admin...');

  // Verifica se já existe
  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { username },
        { email },
      ],
    },
  });

  if (existing) {
    console.log('📝 Usuário admin já existe, atualizando senha...');
    
    const hashedPassword = await hashPassword(password);
    
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        password: hashedPassword,
        email: email, // Atualiza email também
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        credits: 999999,
      },
    });
    
    console.log('✅ Senha do admin atualizada!');
    console.log(`   Usuário: ${username}`);
    console.log(`   Senha: ${password}`);
    console.log(`   Email: ${email}`);
    console.log(`   Role: SUPER_ADMIN`);
  } else {
    console.log('➕ Criando usuário admin...');
    
    const hashedPassword = await hashPassword(password);
    
    const user = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        name,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        credits: 999999,
      },
    });
    
    console.log('✅ Usuário admin criado!');
    console.log(`   ID: ${user.id}`);
    console.log(`   Usuário: ${username}`);
    console.log(`   Senha: ${password}`);
    console.log(`   Email: ${email}`);
    console.log(`   Role: SUPER_ADMIN`);
    console.log(`   Créditos: 999999`);
  }

  // Listar todos os usuários
  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      status: true,
      credits: true,
    },
  });

  console.log('\n📋 Usuários no banco:');
  users.forEach(u => {
    console.log(`   - ${u.username} (${u.email}) [${u.role}] - ${u.status} - Créditos: ${u.credits}`);
  });
}

createAdmin()
  .then(() => {
    console.log('\n🎉 Processo concluído!');
    console.log('   Agora você pode fazer login com:');
    console.log('   Usuário: admin');
    console.log('   Senha: admin123');
  })
  .catch(console.error)
  .finally(() => prisma.$disconnect());

