/**
 * Import Module - Exportações centralizadas
 * 
 * NOVO SISTEMA DE IMPORTAÇÃO REFATORADO
 * 
 * Características:
 * - Modular e limpo
 * - Apenas INSERT, não modifica dados existentes
 * - Não usa API edit_movie (que sobrescreve dados)
 * - Validação de categorias antes de inserir
 * - ~1000 linhas vs ~7500 linhas do sistema antigo
 * 
 * USO BÁSICO:
 *   import { ImportService } from './services/import';
 *   const service = new ImportService(xuiServer);
 *   const result = await service.importFromM3U(url, { vodType: 'movie' });
 * 
 * USO AVANÇADO (módulos individuais):
 *   import { MovieImporter, CategoryManager } from './services/import';
 *   const movieImporter = new MovieImporter(server);
 *   const categoryManager = new CategoryManager(server);
 */

// Conexão
export { XUIConnection } from './xui-connection.js';

// Gerenciadores
export { CategoryManager, type XUICategory } from './category-manager.js';
export { BouquetManager, type XUIBouquet } from './bouquet-manager.js';

// Importadores
export { MovieImporter, type MovieData, type ImportResult as MovieImportResult } from './movie-importer.js';
export { SeriesImporter, type SeriesInfo, type EpisodeData, type SeriesWithEpisodes } from './series-importer.js';
export { LiveImporter, type LiveChannelData } from './live-importer.js';

// Parser
export { M3UParser, type M3UItem, type M3UCategory, type ParseResult } from './m3u-parser.js';

// Serviço unificado
export { ImportService, type ImportOptions, type ImportProgress, type ImportResult } from './import-service.js';
