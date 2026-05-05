import { prisma } from '../src/config/database.js';
import { XUIClient } from '../src/services/xui.client.js';
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'painel-iptv-encryption-key-32ch';
const IV_LENGTH = 16;

function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

async function setSuperNeoReseller() {
  try {
    // Buscar servidor
    const server = await prisma.xuiServer.findFirst();
    if (!server) {
      console.log('❌ Nenhum servidor encontrado');
      return;
    }

    console.log('🔍 Buscando usuário super-neo no XUI...');
    const client = new XUIClient(server);
    
    // Tentar buscar pelo ID 2 primeiro (sabemos que é o super-neo)
    let superNeo: any = null;
    try {
      superNeo = await client.getUser(2);
      if (superNeo && superNeo.username.toLowerCase() === 'super-neo') {
        console.log('✅ Usuário super-neo encontrado pelo ID');
      } else {
        superNeo = null;
      }
    } catch (error) {
      console.log('⚠️ Não foi possível buscar pelo ID, tentando lista...');
    }
    
    // Se não encontrou, buscar na lista
    if (!superNeo) {
      const users = await client.getUsers();
      superNeo = users.find((u: any) => u.username && u.username.toLowerCase() === 'super-neo');
    }
    
    if (!superNeo) {
      console.log('❌ Usuário super-neo não encontrado na lista');
      console.log('💡 Usando ID 2 diretamente (conforme teste anterior)');
      // Usar ID 2 diretamente
      superNeo = { id: 2, user_id: 2, username: 'super-neo' };
    }

    // Garantir que temos o ID correto
    const superNeoId = superNeo.id || superNeo.user_id || 2;
    const superNeoUsername = superNeo.username || 'super-neo';

    console.log('✅ Usuário super-neo configurado:');
    console.log(`  ID: ${superNeoId}`);
    console.log(`  Username: ${superNeoUsername}`);

    // Buscar API key do super-neo
    let apiKey: string | null = null;
    try {
      const userInfo = await client.getUser(superNeoId);
      if (userInfo && userInfo.api_key) {
        apiKey = userInfo.api_key;
        console.log('✅ API key do super-neo obtida');
      }
    } catch (error: any) {
      console.log('⚠️ Não foi possível obter API key do super-neo:', error.message);
    }

    // Atualizar servidor
    await prisma.xuiServer.update({
      where: { id: server.id },
      data: {
        xuiResellerId: superNeoId,
        xuiResellerUsername: superNeoUsername,
        xuiResellerApiKey: apiKey ? encrypt(apiKey) : null,
      },
    });

    console.log('✅ Servidor atualizado com super-neo como reseller!');
    console.log(`  Reseller ID: ${superNeoId}`);
    console.log(`  Reseller Username: ${superNeoUsername}`);
    if (apiKey) {
      console.log(`  Reseller API Key: ✅ Salva`);
    }

  } catch (error: any) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

setSuperNeoReseller();

