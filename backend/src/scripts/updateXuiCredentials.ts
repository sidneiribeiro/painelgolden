/**
 * Script para atualizar credenciais do servidor XUI e testar conexão
 */

import { prisma } from '../config/database.js';
import { encrypt } from '../utils/crypto.js';
import mysql from 'mysql2/promise';

async function updateAndTest() {
  const serverId = 'fcc2b435-f75f-4311-88b9-62ee4f05b107';
  
  console.log('🔄 Atualizando credenciais do servidor XUI...');
  
  // Atualizar credenciais
  const updated = await prisma.xuiServer.update({
    where: { id: serverId },
    data: {
      dbHost: '200.9.155.230',
      dbUser: 'koffice_user',
      dbPassword: encrypt('senha_segura'),
      dbPort: 3306,
      dbName: 'xui',
    },
  });
  
  console.log('✅ Credenciais atualizadas!');
  console.log(`   Host: ${updated.dbHost}`);
  console.log(`   User: ${updated.dbUser}`);
  console.log(`   Port: ${updated.dbPort}`);
  console.log(`   Database: ${updated.dbName || 'xui'}`);
  
  console.log('\n🔌 Testando conexão...');
  
  try {
    const connection = await mysql.createConnection({
      host: '200.9.155.230',
      port: 3306,
      user: 'koffice_user',
      password: 'senha_segura',
      database: 'xui',
      connectTimeout: 10000,
    });
    
    console.log('✅ Conexão estabelecida com sucesso!');
    
    // Verificar usuário atual
    const [userInfo]: any = await connection.query('SELECT USER(), CURRENT_USER()');
    console.log('\n👤 Usuário MySQL atual:');
    console.log(`   USER(): ${userInfo[0]['USER()']}`);
    console.log(`   CURRENT_USER(): ${userInfo[0]['CURRENT_USER()']}`);
    
    // Testar permissões
    console.log('\n🔐 Testando permissões...');
    
    try {
      await connection.query('SELECT 1');
      console.log('   ✅ SELECT básico: OK');
    } catch (e: any) {
      console.log('   ❌ SELECT básico: FALHOU -', e.message);
    }
    
    try {
      const [streams]: any = await connection.query('SELECT COUNT(*) as total FROM streams LIMIT 1');
      console.log('   ✅ SELECT em streams: OK');
      console.log(`   📊 Total de streams: ${streams[0].total}`);
    } catch (e: any) {
      console.log('   ❌ SELECT em streams: FALHOU -', e.message);
    }
    
    try {
      const [bouquets]: any = await connection.query('SELECT id, bouquet_channels FROM bouquets WHERE id = 1 LIMIT 1');
      console.log('   ✅ SELECT em bouquets: OK');
      
      if (bouquets.length > 0) {
        const currentChannels = JSON.parse(bouquets[0].bouquet_channels || '[]');
        console.log(`   📊 Bouquet 1 tem ${currentChannels.length} canais`);
        
        // Tentar UPDATE (sem realmente atualizar, apenas testar permissão)
        try {
          await connection.query('SELECT id FROM bouquets WHERE id = 1 FOR UPDATE');
          console.log('   ✅ LOCK em bouquets: OK (permite UPDATE)');
        } catch (e: any) {
          console.log('   ⚠️ LOCK em bouquets: Pode ter problema -', e.message);
        }
      }
    } catch (e: any) {
      console.log('   ❌ SELECT em bouquets: FALHOU -', e.message);
    }
    
    await connection.end();
    console.log('\n✅ Teste concluído com sucesso!');
    
  } catch (error: any) {
    console.error('\n❌ ERRO ao conectar:', error.message);
    console.error('\n📋 DETALHES DO ERRO:');
    console.error(`   Código: ${error.code}`);
    console.error(`   Errno: ${error.errno}`);
    console.error(`   SQL State: ${error.sqlState || 'N/A'}`);
    
    if (error.message.includes('Access denied')) {
      console.error('\n⚠️ O MySQL está rejeitando a conexão.');
      console.error('   Possíveis causas:');
      console.error('   1. Usuário não existe ou não tem permissão para o IP 216.106.182.217');
      console.error('   2. Senha incorreta');
      console.error('   3. MySQL não está permitindo conexões remotas');
      console.error('   4. Firewall bloqueando a porta 3306');
    }
  }
  
  await prisma.$disconnect();
}

updateAndTest().catch(console.error);






