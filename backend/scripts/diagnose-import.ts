/**
 * Diagnóstico LEVE: Bug de Importação de Filmes
 * NÃO carrega todos os filmes na memória (evita OOM)
 */
import { PrismaClient } from '@prisma/client';
import mysql from 'mysql2/promise';
import { decrypt } from '../src/utils/crypto.js';

const prisma = new PrismaClient();

async function diagnose() {
  let conn: mysql.Connection | null = null;
  try {
    const server = await prisma.xuiServer.findFirst({ where: { isActive: true } });
    if (!server) { console.log('Sem servidor'); return; }
    console.log(`Servidor: ${server.name} (${server.dbHost})`);

    const dbPassword = server.dbPassword ? decrypt(server.dbPassword) : '';
    conn = await mysql.createConnection({
      host: server.dbHost!,
      port: server.dbPort || 3306,
      user: server.dbUser!,
      password: dbPassword,
      database: server.dbName || 'xui',
    });
    console.log('Conectado ao MySQL');

    // 1. Contar filmes
    const [r1] = await conn.query<any[]>('SELECT COUNT(*) as cnt FROM streams WHERE type = 2');
    console.log(`Total filmes: ${r1[0].cnt}`);

    // 2. Tamanho médio do stream_source
    const [r2] = await conn.query<any[]>('SELECT AVG(LENGTH(stream_source)) as avg_len, MAX(LENGTH(stream_source)) as max_len, SUM(LENGTH(stream_source)) as total_len FROM streams WHERE type = 2');
    const totalMB = (r2[0].total_len / 1024 / 1024).toFixed(1);
    console.log(`stream_source: avg=${Math.round(r2[0].avg_len)}b, max=${r2[0].max_len}b, total=${totalMB}MB`);

    // 3. Tamanho da tabela
    const [r3] = await conn.query<any[]>("SHOW TABLE STATUS LIKE 'streams'");
    console.log(`Tabela streams: rows=${r3[0].Rows}, data=${(r3[0].Data_length/1024/1024).toFixed(1)}MB`);

    // 4. Memória do Node
    const mem = process.memoryUsage();
    console.log(`Node memory: RSS=${(mem.rss/1024/1024).toFixed(0)}MB, Heap=${(mem.heapUsed/1024/1024).toFixed(0)}MB`);

    // 5. Memória livre do sistema
    console.log('--- FIM ---');
  } catch (error: any) {
    console.error('ERRO:', error.message, error.code);
  } finally {
    if (conn) await conn.end();
    await prisma.$disconnect();
  }
}

diagnose();
