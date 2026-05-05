import { PrismaClient } from '@prisma/client';
import { hashPassword, verifyPassword } from '../utils/crypto.js';

const prisma = new PrismaClient();

async function fixAdminPassword() {
  const username = 'admin';
  const password = 'admin123';

  console.log('🔧 Corrigindo senha do admin...\n');

  // Busca usuário
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ username }, { email: username }],
    },
  });

  if (!user) {
    console.log('❌ Usuário não encontrado! Criando...');
    
    const hashedPassword = await hashPassword(password);
    const newUser = await prisma.user.create({
      data: {
        username,
        email: 'admin@painel.com',
        password: hashedPassword,
        name: 'Administrador',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        credits: 999999,
      },
    });
    
    console.log('✅ Usuário criado!');
    console.log(`   ID: ${newUser.id}`);
    console.log(`   Usuário: ${username}`);
    console.log(`   Senha: ${password}`);
    return;
  }

  console.log('📝 Usuário encontrado, resetando senha...');
  console.log(`   ID: ${user.id}`);
  console.log(`   Username: ${user.username}`);
  console.log(`   Email: ${user.email}`);
  console.log(`   Status: ${user.status}\n`);

  // Gera novo hash
  console.log('🔐 Gerando novo hash de senha...');
  const newHash = await hashPassword(password);
  console.log(`   Hash gerado: ${newHash.substring(0, 30)}...\n`);

  // Atualiza senha
  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: newHash,
      status: 'ACTIVE',
      role: 'SUPER_ADMIN',
    },
  });

  console.log('✅ Senha atualizada!\n');

  // Verifica se funciona
  console.log('🔍 Verificando se a senha funciona...');
  const updatedUser = await prisma.user.findUnique({
    where: { id: user.id },
  });

  if (updatedUser) {
    const isValid = await verifyPassword(password, updatedUser.password);
    if (isValid) {
      console.log('✅ Senha verificada e funcionando!\n');
    } else {
      console.log('❌ ERRO: Senha não funciona após atualização!\n');
    }
  }

  console.log('📋 Credenciais finais:');
  console.log(`   Usuário: ${username}`);
  console.log(`   Senha: ${password}`);
  console.log(`   Email: ${user.email}`);
  console.log(`   Role: SUPER_ADMIN`);
  console.log(`   Status: ACTIVE`);
}

fixAdminPassword()
  .then(() => {
    console.log('\n🎉 Processo concluído!');
    console.log('   Agora tente fazer login novamente.');
  })
  .catch((error) => {
    console.error('❌ Erro:', error);
  })
  .finally(() => prisma.$disconnect());

