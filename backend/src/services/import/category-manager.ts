/**
 * Category Manager - Gerencia categorias no XUI
 * 
 * SEGURO: Apenas leitura e criação de categorias
 * NÃO modifica categorias existentes
 */

import { createLogger } from '../../utils/logger.js';
import { XUIConnection } from './xui-connection.js';
import type { XuiServer } from '@prisma/client';

const logger = createLogger('CategoryManager');

export interface XUICategory {
  id: number;
  category_name: string;
  category_type: 'movie' | 'series' | 'live';
  parent_id: number;
  cat_order: number;
}

export class CategoryManager {
  private conn: XUIConnection;
  private cache: Map<string, XUICategory[]> = new Map();
  private catTableName: string | null = null;

  constructor(server: XuiServer) {
    this.conn = new XUIConnection(server);
  }

  /**
   * Detecta o nome da tabela de categorias (streams_categories vs stream_categories)
   */
  private async getCatTable(): Promise<string> {
    if (this.catTableName) return this.catTableName;
    const candidates = ['streams_categories', 'stream_categories'];
    for (const name of candidates) {
      try {
        const rows = await this.conn.query<any>(`SHOW TABLES LIKE '${name}'`);
        if (rows.length > 0) { this.catTableName = name; return name; }
      } catch { /* ignorar */ }
    }
    this.catTableName = 'streams_categories';
    return this.catTableName;
  }

  /**
   * Lista todas as categorias de um tipo
   */
  async getCategories(type: 'movie' | 'series' | 'live'): Promise<XUICategory[]> {
    // Verificar cache
    if (this.cache.has(type)) {
      return this.cache.get(type)!;
    }

    const catTable = await this.getCatTable();
    const categories = await this.conn.query<XUICategory>(
      `SELECT id, category_name, category_type, parent_id, cat_order 
       FROM ${catTable} 
       WHERE category_type = ?
       ORDER BY cat_order, category_name`,
      [type]
    );

    this.cache.set(type, categories);
    logger.info(`[CategoryManager] ${categories.length} categorias '${type}' carregadas`);
    return categories;
  }

  /**
   * Busca categoria por ID
   */
  async getCategoryById(id: number): Promise<XUICategory | null> {
    const catTable = await this.getCatTable();
    const rows = await this.conn.query<XUICategory>(
      `SELECT id, category_name, category_type, parent_id, cat_order 
       FROM ${catTable} 
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  /**
   * Busca categoria por nome e tipo
   */
  async findCategoryByName(name: string, type: 'movie' | 'series' | 'live'): Promise<XUICategory | null> {
    const catTable = await this.getCatTable();
    const rows = await this.conn.query<XUICategory>(
      `SELECT id, category_name, category_type, parent_id, cat_order 
       FROM ${catTable} 
       WHERE category_name = ? AND category_type = ?
       LIMIT 1`,
      [name, type]
    );
    return rows[0] || null;
  }

  /**
   * Verifica se categoria existe por ID
   */
  async categoryExists(id: number): Promise<boolean> {
    const catTable = await this.getCatTable();
    const rows = await this.conn.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${catTable} WHERE id = ?`,
      [id]
    );
    return rows[0]?.count > 0;
  }

  /**
   * Cria nova categoria
   * SEGURO: Apenas INSERT, não modifica existentes
   */
  async createCategory(
    name: string, 
    type: 'movie' | 'series' | 'live',
    parentId: number = 0
  ): Promise<number> {
    // Verificar se já existe
    const existing = await this.findCategoryByName(name, type);
    if (existing) {
      logger.info(`[CategoryManager] Categoria '${name}' já existe (ID: ${existing.id})`);
      return existing.id;
    }

    // Buscar próximo cat_order
    const catTable = await this.getCatTable();
    const maxOrder = await this.conn.query<{ max_order: number }>(
      `SELECT MAX(cat_order) as max_order FROM ${catTable} WHERE category_type = ?`,
      [type]
    );
    const nextOrder = (maxOrder[0]?.max_order || 0) + 1;

    // Inserir
    const result = await this.conn.execute(
      `INSERT INTO ${catTable} (category_name, category_type, parent_id, cat_order) 
       VALUES (?, ?, ?, ?)`,
      [name, type, parentId, nextOrder]
    );

    // Limpar cache
    this.cache.delete(type);

    logger.info(`[CategoryManager] Categoria '${name}' criada (ID: ${result.insertId})`);
    return result.insertId;
  }

  /**
   * Cria múltiplas categorias de uma vez
   */
  async createCategories(
    names: string[], 
    type: 'movie' | 'series' | 'live'
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();

    for (const name of names) {
      const id = await this.createCategory(name, type);
      result.set(name, id);
    }

    return result;
  }

  /**
   * Mapeia categorias do M3U para IDs do XUI
   * Se não existir, cria automaticamente
   */
  async mapM3UCategories(
    m3uCategories: string[],
    type: 'movie' | 'series' | 'live',
    autoCreate: boolean = true
  ): Promise<Map<string, number>> {
    const mapping = new Map<string, number>();

    for (const catName of m3uCategories) {
      // Tentar encontrar categoria existente com múltiplos padrões
      let category = await this.findCategoryWithVariations(catName, type);
      
      // Criar se não existir e autoCreate está ativo
      if (!category && autoCreate) {
        // Usar nome original do M3U ao criar
        const id = await this.createCategory(catName, type);
        mapping.set(catName, id);
      } else if (category) {
        mapping.set(catName, category.id);
        logger.info(`[CategoryManager] Categoria M3U '${catName}' mapeada para XUI '${category.category_name}' (ID: ${category.id})`);
      }
    }

    return mapping;
  }

  /**
   * Remove todas as categorias de um tipo
   */
  async deleteCategoriesByType(type: 'movie' | 'series' | 'live'): Promise<number> {
    const catTable = await this.getCatTable();
    const countRows = await this.conn.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${catTable} WHERE category_type = ?`,
      [type]
    );
    const count = countRows[0]?.count || 0;
    if (count === 0) {
      this.cache.delete(type);
      return 0;
    }

    await this.conn.execute(
      `DELETE FROM ${catTable} WHERE category_type = ?`,
      [type]
    );
    this.cache.delete(type);
    logger.info(`[CategoryManager] ${count} categorias '${type}' removidas`);
    return count;
  }

  /**
   * Busca categoria tentando múltiplas variações do nome
   * Isso resolve o problema de nomes diferentes entre M3U e XUI
   */
  async findCategoryWithVariations(name: string, type: 'movie' | 'series' | 'live'): Promise<XUICategory | null> {
    // 1. Buscar pelo nome exato
    let category = await this.findCategoryByName(name, type);
    if (category) return category;

    // 2. Limpar nome e buscar
    const cleanName = this.cleanCategoryName(name);
    if (cleanName !== name) {
      category = await this.findCategoryByName(cleanName, type);
      if (category) return category;
    }

    // 3. Buscar com prefixos comuns do XUI
    const prefixes = {
      movie: ['Filmes | ', 'Filmes |', 'Movies | ', 'Movies |'],
      series: ['Séries | ', 'Séries |', 'Series | ', 'Series |'],
      live: ['TV | ', 'TV |', 'Live | ', 'Live |']
    };

    for (const prefix of prefixes[type]) {
      // Tentar: "Filmes | {cleanName}"
      category = await this.findCategoryByName(`${prefix}${cleanName}`, type);
      if (category) return category;
      
      // Tentar: "Filmes | {originalName}"
      category = await this.findCategoryByName(`${prefix}${name}`, type);
      if (category) return category;
    }

    // 4. Busca parcial por LIKE (última tentativa)
    category = await this.findCategoryByPartialName(cleanName, type);
    if (category) return category;

    return null;
  }

  /**
   * Busca categoria por nome parcial (LIKE)
   */
  async findCategoryByPartialName(name: string, type: 'movie' | 'series' | 'live'): Promise<XUICategory | null> {
    const catTable = await this.getCatTable();
    const rows = await this.conn.query<XUICategory>(
      `SELECT id, category_name, category_type, parent_id, cat_order 
       FROM ${catTable} 
       WHERE category_name LIKE ? AND category_type = ?
       ORDER BY LENGTH(category_name) ASC
       LIMIT 1`,
      [`%${name}%`, type]
    );
    return rows[0] || null;
  }

  /**
   * Limpa nome da categoria removendo prefixos comuns do M3U
   */
  private cleanCategoryName(name: string): string {
    return name
      .replace(/^(Filmes?\s*\|\s*)/i, '')
      .replace(/^(Movies?\s*\|\s*)/i, '')
      .replace(/^(Series?\s*\|\s*)/i, '')
      .replace(/^(Séries?\s*\|\s*)/i, '')
      .replace(/^(Live\s*\|\s*)/i, '')
      .replace(/^(TV\s*\|\s*)/i, '')
      .trim();
  }

  async disconnect(): Promise<void> {
    await this.conn.disconnect();
  }
}
