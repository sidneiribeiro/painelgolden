import { PrismaClient } from '@prisma/client';
import mysql from 'mysql2/promise';
import { decrypt } from '../src/utils/crypto.js';

const prisma = new PrismaClient();

async function checkXuiDB() {
  try {
    // 1. Buscar servidor XUI
    const server = await prisma.xuiServer.findFirst();
    if (!server) {
      console.log('❌ Nenhum servidor XUI encontrado');
      return;
    }

    const serverType = ((server as any).serverType || 'XUIONE') as string;

    console.log('📦 Servidor XUI:', server.name);
    console.log('  Type:', serverType);
    console.log('  Host:', server.dbHost);
    console.log('  User:', server.dbUser);
    console.log('  Database:', server.dbName);

    // 2. Descriptografar senha
    const dbPassword = server.dbPassword ? decrypt(server.dbPassword) : '';
    console.log('  Password (decrypted):', dbPassword ? '***' : 'VAZIO');

    // 3. Conectar ao MySQL
    const conn = await mysql.createConnection({
      host: server.dbHost!,
      port: server.dbPort || 3306,
      user: server.dbUser!,
      password: dbPassword,
      database: server.dbName || 'xui',
    });

    console.log('\n✅ Conectado ao MySQL do XUI');

    if (serverType === 'XTREAMUI') {
      console.log('\n📊 === XTREAM UI: DIAGNÓSTICO TABELA users ===');

      try {
        const [tables] = await conn.query<any[]>(`SHOW TABLES LIKE 'users'`);
        console.log('Tabela users existe:', Array.isArray(tables) && tables.length > 0 ? 'SIM' : 'NÃO');
      } catch (e: any) {
        console.log('Falha ao checar tabela users:', e.message);
      }

      try {
        const [cols] = await conn.query<any[]>(`SHOW COLUMNS FROM \`users\``);
        console.log(`Total de colunas em users: ${(cols as any[]).length}`);
        console.table(
          (cols as any[]).map((c) => ({
            Field: c.Field,
            Type: c.Type,
            Null: c.Null,
            Key: c.Key,
            Default: c.Default,
            Extra: c.Extra,
          }))
        );
      } catch (e: any) {
        console.log('❌ Erro ao ler colunas de users:', e.message);
      }

      try {
        const [required] = await conn.query<any[]>(`
          SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'users'
            AND IS_NULLABLE = 'NO'
            AND COLUMN_DEFAULT IS NULL
            AND EXTRA NOT LIKE '%auto_increment%'
          ORDER BY ORDINAL_POSITION
        `);
        console.log('\nCampos obrigatórios (NOT NULL sem default) em users:');
        console.table(required as any[]);
      } catch (e: any) {
        console.log('Falha ao listar campos obrigatórios:', e.message);
      }

      await conn.end();
      await prisma.$disconnect();
      return;
    }

    // 4. Verificar tabelas relacionadas a filmes
    console.log('\n📊 TABELAS RELACIONADAS A FILMES:');
    const [tables] = await conn.query("SHOW TABLES LIKE '%movie%'");
    console.log(tables);

    // 5. Verificar estrutura da tabela streams
    console.log('\n📊 ESTRUTURA DA TABELA streams (campos relevantes):');
    const [streamsCols] = await conn.query<any[]>("DESCRIBE streams");
    const relevantCols = streamsCols.filter((c: any) => 
      ['id', 'type', 'category_id', 'stream_display_name', 'movie_properties', 
       'tmdb_id', 'rating', 'direct_source', 'stream_icon', 'added', 'updated'].includes(c.Field)
    );
    console.table(relevantCols);

    // 6. Verificar filmes com IDs específicos da última importação (3149491-3149513)
    console.log('\n📊 FILMES DA ÚLTIMA IMPORTAÇÃO (IDs 3149491-3149513):');
    const [lastMovies] = await conn.query<any[]>(`
      SELECT id, stream_display_name, category_id, tmdb_id, rating, direct_source,
             added, FROM_UNIXTIME(added) as added_date
      FROM streams 
      WHERE id BETWEEN 3149491 AND 3149500
      ORDER BY id ASC
    `);
    
    console.log('\nHora atual:', new Date().toISOString());
    console.log('Unix agora:', Math.floor(Date.now() / 1000));
    
    lastMovies.forEach((m: any) => {
      console.log(`ID ${m.id}: added=${m.added} (${m.added_date}) | cat=${m.category_id} | tmdb=${m.tmdb_id} | direct=${m.direct_source}`);
    });

    // 7. Verificar vinculação ao servidor
    console.log('\n📊 VINCULAÇÃO DOS ÚLTIMOS FILMES AO SERVIDOR (streams_servers):');
    if (lastMovies.length > 0) {
      const ids = lastMovies.map((m: any) => m.id).join(',');
      const [serverLinks] = await conn.query<any[]>(`
        SELECT ss.stream_id, ss.server_id, ss.on_demand, s.stream_display_name
        FROM streams_servers ss
        JOIN streams s ON s.id = ss.stream_id
        WHERE ss.stream_id IN (${ids})
      `);
      console.table(serverLinks);
    }

    // 8. Verificar se existe tabela movie_properties separada
    console.log('\n📊 VERIFICANDO TABELA movie_properties:');
    try {
      const [mpStructure] = await conn.query("DESCRIBE movie_properties");
      console.log('✅ Tabela movie_properties EXISTE');
      console.table(mpStructure);
    } catch (e: any) {
      console.log('❌ Tabela movie_properties NÃO EXISTE:', e.message);
    }

    // 9. Verificar filme com dados TMDB corretos (para comparação)
    console.log('\n📊 EXEMPLO DE FILME COM TMDB (para comparação):');
    const [movieWithTmdb] = await conn.query<any[]>(`
      SELECT id, stream_display_name, category_id, tmdb_id, rating,
             LEFT(movie_properties, 500) as movie_props
      FROM streams 
      WHERE type = 2 AND tmdb_id IS NOT NULL AND tmdb_id > 0
      ORDER BY id DESC 
      LIMIT 1
    `);
    if (movieWithTmdb.length > 0) {
      console.log('ID:', movieWithTmdb[0].id);
      console.log('Nome:', movieWithTmdb[0].stream_display_name);
      console.log('Category:', movieWithTmdb[0].category_id);
      console.log('TMDB ID:', movieWithTmdb[0].tmdb_id);
      console.log('Rating:', movieWithTmdb[0].rating);
      console.log('Movie Props (preview):', movieWithTmdb[0].movie_props);
    }

    // ===== DIAGNÓSTICO DE LENTIDÃO =====
    console.log('\n🔍 === DIAGNÓSTICO DE LENTIDÃO ===');
    
    // 1. Processos MySQL ativos
    console.log('\n📊 PROCESSOS MySQL ATIVOS:');
    const [processes] = await conn.query<any[]>('SHOW PROCESSLIST');
    console.log(`Total de processos: ${processes.length}`);
    processes.forEach((p: any) => {
      if (p.Command !== 'Sleep' || p.Time > 10) {
        console.log(`  ID:${p.Id} User:${p.User} Command:${p.Command} Time:${p.Time}s State:${p.State || 'N/A'}`);
      }
    });
    
    // 2. Transações ativas
    console.log('\n📊 TRANSAÇÕES ATIVAS:');
    try {
      const [trx] = await conn.query<any[]>('SELECT * FROM information_schema.INNODB_TRX');
      console.log(`Transações: ${trx.length}`);
      trx.forEach((t: any) => {
        console.log(`  TRX:${t.trx_id} State:${t.trx_state} Query:${t.trx_query?.substring(0,80) || 'N/A'}`);
      });
    } catch (e) {
      console.log('N/A');
    }
    
    // 3. Conexões
    const [connStatus] = await conn.query<any[]>('SHOW GLOBAL STATUS LIKE "Threads_connected"');
    console.log('\n📊 CONEXÕES:');
    connStatus.forEach((s: any) => console.log(`  ${s.Variable_name}: ${s.Value}`));
    
    // 4. Lock waits
    const [lockStatus] = await conn.query<any[]>('SHOW GLOBAL STATUS LIKE "Innodb_row_lock%"');
    console.log('\n📊 LOCKS:');
    lockStatus.forEach((s: any) => console.log(`  ${s.Variable_name}: ${s.Value}`));

    // 5. COMPARAÇÃO: Filme que FUNCIONA vs Últimos importados
    console.log('\n📊 === FILME QUE FUNCIONA (ID 3132709) ===');
    const [goodMovie] = await conn.query<any[]>(`
      SELECT id, type, category_id, stream_display_name, tmdb_id, rating, direct_source, added, movie_properties
      FROM streams WHERE id = 3132709
    `);
    if (goodMovie.length > 0) {
      const m = goodMovie[0];
      console.log(`  ID: ${m.id}`);
      console.log(`  Nome: ${m.stream_display_name}`);
      console.log(`  category_id: "${m.category_id}" (tipo: ${typeof m.category_id})`);
      console.log(`  tmdb_id: "${m.tmdb_id}"`);
      console.log(`  rating: "${m.rating}"`);
      console.log(`  direct_source: ${m.direct_source}`);
      console.log(`  added: ${m.added}`);
      console.log(`  movie_properties (primeiros 200 chars): ${String(m.movie_properties || '').substring(0, 200)}`);
    }
    
    // Servidor do filme que funciona
    const [goodServer] = await conn.query<any[]>(`SELECT * FROM streams_servers WHERE stream_id = 3132709`);
    console.log(`\n  SERVIDOR (streams_servers):`);
    if (goodServer.length > 0) {
      console.log(`    server_id: ${goodServer[0].server_id}`);
      console.log(`    parent_id: ${goodServer[0].parent_id}`);
      console.log(`    Colunas: ${Object.keys(goodServer[0]).join(', ')}`);
    }
    
    // ESTADO ATUAL DO BANCO
    console.log('\n📊 === ESTADO ATUAL DO BANCO ===');
    const [stats] = await conn.query<any[]>(`SELECT MAX(id) as maxId, COUNT(*) as total FROM streams WHERE type = 2`);
    console.log(`  Max ID filme: ${stats[0].maxId}`);
    console.log(`  Total filmes: ${stats[0].total}`);
    
    // AUTO_INCREMENT da tabela streams
    const [autoInc] = await conn.query<any[]>(`SHOW TABLE STATUS LIKE 'streams'`);
    console.log(`  AUTO_INCREMENT: ${autoInc[0]?.Auto_increment || 'N/A'}`);
    
    // Verificar DB atual
    const [dbInfo] = await conn.query<any[]>(`SELECT DATABASE() as db, CONNECTION_ID() as connId`);
    console.log(`  Database: ${dbInfo[0].db}`);
    console.log(`  Connection ID: ${dbInfo[0].connId}`);
    
    // Últimos 10 filmes por ID
    console.log('\n📊 === ÚLTIMOS 10 FILMES (por ID) ===');
    const [recentMovies] = await conn.query<any[]>(`
      SELECT id, type, category_id, stream_display_name, tmdb_id, rating, direct_source, added
      FROM streams WHERE type = 2 ORDER BY id DESC LIMIT 10
    `);
    for (const m of recentMovies) {
      console.log(`  [${m.id}] ${m.stream_display_name?.substring(0,30)} | cat="${m.category_id}" | tmdb=${m.tmdb_id} | direct=${m.direct_source}`);
    }
    
    // Servidores dos últimos filmes
    console.log('\n📊 === SERVIDORES DOS ÚLTIMOS FILMES ===');
    if (recentMovies.length > 0) {
      const ids = recentMovies.map((m: any) => m.id).join(',');
      const [lastServers] = await conn.query<any[]>(`SELECT stream_id, server_id, parent_id FROM streams_servers WHERE stream_id IN (${ids})`);
      for (const s of lastServers) {
        console.log(`  stream_id=${s.stream_id} -> server_id=${s.server_id}, parent_id=${s.parent_id}`);
      }
      if (lastServers.length === 0) {
        console.log(`  ❌ NENHUM servidor vinculado!`);
      }
    }

    console.log('\n✅ Diagnóstico concluído');
    
    await conn.end();
    await prisma.$disconnect();
  } catch (error: any) {
    console.error('❌ Erro:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkXuiDB();
