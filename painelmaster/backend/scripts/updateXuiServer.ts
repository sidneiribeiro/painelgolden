import { prisma } from '../src/config/database.js';
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

async function updateXuiServer() {
  try {
    // Buscar o primeiro servidor
    const server = await prisma.xuiServer.findFirst();
    
    if (!server) {
      console.log('❌ Nenhum servidor encontrado. Criando novo servidor...');
      
      const newServer = await prisma.xuiServer.create({
        data: {
          name: 'Servidor Principal',
          baseUrl: 'http://seu-ip-aqui', // ← Configure com o IP/domínio do seu servidor XUI.ONE
          accessCode: 'seu-access-code', // ← Configure com seu Access Code
          apiKey: encrypt('SUA_API_KEY_AQUI'), // ← Configure com sua API Key
          isActive: true,
          isDefault: true,
          status: 'ONLINE',
        },
      });
      
      console.log('✅ Servidor criado:', newServer.id);
      return;
    }
    
    console.log('📝 Atualizando servidor:', server.id);
    console.log('  - Access Code antigo:', server.accessCode);
    console.log('  - Base URL:', server.baseUrl);
    
    // Atualizar com novos dados
    const updated = await prisma.xuiServer.update({
      where: { id: server.id },
      data: {
        accessCode: 'loGPGjDV',
        apiKey: encrypt('49693139D957BB355765519CF7F728D8'),
        status: 'ONLINE',
      },
    });
    
    console.log('✅ Servidor atualizado!');
    console.log('  - Access Code novo:', updated.accessCode);
    console.log('  - ID:', updated.id);
    
  } catch (error: any) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

updateXuiServer();

