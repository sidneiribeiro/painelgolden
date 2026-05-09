/**
 * SISTEMA INTELIGENTE DE DETECÇÃO DE DUPLICATAS
 * Prevenção rigorosa usando múltiplos critérios em cascata
 */

import crypto from 'crypto';
import { createLogger } from './logger.js';

const logger = createLogger('DuplicateDetector');

export interface MovieItem {
  name: string;
  year?: number;
  tmdb_id?: number;
  imdb_id?: string;
  stream_url?: string;
  duration?: number;
}

export interface SeriesItem {
  name: string;
  tmdb_id?: number;
  imdb_id?: string;
  season: number;
  episode: number;
  stream_url?: string;
}

/**
 * Normaliza título para comparação
 * Remove acentos, pontuação, anos, subtítulos e converte para minúsculas
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    // Remover anos entre parênteses: (2023)
    .replace(/\(\d{4}\)/g, '')
    // Remover ano no final: "Filme 2023"
    .replace(/\b(19\d{2}|20\d{2})\b\s*$/g, '')
    // Remover subtítulos após : ou -
    .replace(/[:\-–—].*/g, '')
    // Remover texto entre colchetes: [HD], [DUAL]
    .replace(/\[.*?\]/g, '')
    // Remover acentos
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Remover pontuação e caracteres especiais
    .replace(/[^\w\s]/g, '')
    // Remover palavras comuns
    .replace(/\b(the|a|an|o|os|as|um|uma)\b/g, '')
    // Remover espaços extras
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calcula similaridade entre duas strings usando algoritmo de Levenshtein
 * Retorna valor entre 0 (completamente diferentes) e 1 (idênticas)
 */
export function calculateSimilarity(str1: string, str2: string): number {
  const s1 = normalizeTitle(str1);
  const s2 = normalizeTitle(str2);
  
  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0.0;
  
  const matrix: number[][] = [];
  
  // Inicializar matriz
  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j;
  }
  
  // Calcular distância de Levenshtein
  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,     // Deleção
        matrix[i][j - 1] + 1,     // Inserção
        matrix[i - 1][j - 1] + cost  // Substituição
      );
    }
  }
  
  const distance = matrix[s1.length][s2.length];
  const maxLength = Math.max(s1.length, s2.length);
  
  return maxLength === 0 ? 1.0 : 1 - (distance / maxLength);
}

/**
 * Gera hash único para uma URL de stream
 */
export function generateStreamHash(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex');
}

/**
 * Extrai ano do título (formato: "Filme (2023)" ou "Filme 2023")
 */
export function extractYear(title: string): number | null {
  // Procurar ano entre parênteses: (2023)
  const matchParen = title.match(/\((\d{4})\)/);
  if (matchParen) {
    return parseInt(matchParen[1], 10);
  }
  
  // Procurar ano no final: "Filme 2023"
  const matchEnd = title.match(/\s(\d{4})$/);
  if (matchEnd) {
    return parseInt(matchEnd[1], 10);
  }
  
  return null;
}

/**
 * VERIFICAÇÃO CASCATA: Detecta se um filme é duplicado
 * 
 * NÍVEIS DE VALIDAÇÃO (em ordem de prioridade):
 * 1️⃣ TMDB ID (100% confiável)
 * 2️⃣ IMDB ID (100% confiável)
 * 3️⃣ Nome Normalizado + Ano (80% confiável)
 * 4️⃣ Similaridade de String > 90% + Ano próximo (70% confiável)
 * 5️⃣ Hash de Stream URL (evita mesmo stream duplicado)
 * 
 * @returns true se é duplicata, false se é único
 */
export function isMovieDuplicate(
  newMovie: MovieItem,
  existingMovies: MovieItem[]
): boolean {
  for (const existing of existingMovies) {
    // ✅ NÍVEL 1: TMDB ID (mais confiável)
    if (newMovie.tmdb_id && existing.tmdb_id) {
      if (newMovie.tmdb_id === existing.tmdb_id) {
        logger.debug(`[DuplicateDetector] 🔴 Duplicata por TMDB ID: ${newMovie.name} (TMDB: ${newMovie.tmdb_id})`);
        return true;
      }
    }
    
    // ✅ NÍVEL 2: IMDB ID
    if (newMovie.imdb_id && existing.imdb_id) {
      if (newMovie.imdb_id === existing.imdb_id) {
        logger.debug(`[DuplicateDetector] 🔴 Duplicata por IMDB ID: ${newMovie.name} (IMDB: ${newMovie.imdb_id})`);
        return true;
      }
    }
    
    // Extrair anos
    const newYear = newMovie.year || extractYear(newMovie.name);
    const existingYear = existing.year || extractYear(existing.name);

    // ✅ NÍVEL 2.5: Mesmo nome normalizado (ignorando ano), mesmo que só um tenha ano
    // Isso evita duplicar entre fonte primária (sem ano) e secundária (com ano no título)
    const newNameNormLoose = normalizeTitle(newMovie.name);
    const existingNameNormLoose = normalizeTitle(existing.name);
    if (newNameNormLoose && newNameNormLoose === existingNameNormLoose) {
      // Se ambos têm ano, precisa bater; se um deles não tem, aceitar como duplicata
      if (!newYear || !existingYear || newYear === existingYear) {
        logger.debug(`[DuplicateDetector] 🔴 Duplicata por Nome Normalizado (loose): "${newMovie.name}" vs "${existing.name}"`);
        return true;
      }
    }
    
    // ✅ NÍVEL 3: Nome normalizado + Ano exato
    if (newYear && existingYear) {
      const newNameNorm = normalizeTitle(newMovie.name);
      const existingNameNorm = normalizeTitle(existing.name);
      
      if (newNameNorm === existingNameNorm && newYear === existingYear) {
        logger.debug(`[DuplicateDetector] 🔴 Duplicata por Nome+Ano: "${newMovie.name}" (${newYear})`);
        return true;
      }
    }
    
    // ✅ NÍVEL 4: Similaridade alta (> 90%) + Ano próximo (±1 ano)
    const similarity = calculateSimilarity(newMovie.name, existing.name);
    if (similarity > 0.90) {
      if (newYear && existingYear) {
        const yearDiff = Math.abs(newYear - existingYear);
        if (yearDiff <= 1) {
          logger.debug(`[DuplicateDetector] 🔴 Duplicata por Similaridade: "${newMovie.name}" vs "${existing.name}" (${(similarity * 100).toFixed(1)}% similar)`);
          return true;
        }
      } else if (!newYear && !existingYear) {
        // Se ambos não têm ano, considerar duplicata se muito similar
        if (similarity > 0.95) {
          logger.debug(`[DuplicateDetector] 🔴 Duplicata por Alta Similaridade: "${newMovie.name}" vs "${existing.name}" (${(similarity * 100).toFixed(1)}%)`);
          return true;
        }
      }
    }
    
    // ✅ NÍVEL 5: Hash de Stream (mesmo link = duplicata)
    if (newMovie.stream_url && existing.stream_url) {
      const newHash = generateStreamHash(newMovie.stream_url);
      const existingHash = generateStreamHash(existing.stream_url);
      
      if (newHash === existingHash) {
        logger.debug(`[DuplicateDetector] 🔴 Duplicata por Stream Hash: ${newMovie.name}`);
        return true;
      }
    }
  }
  
  return false; // ✅ NÃO é duplicata
}

/**
 * VERIFICAÇÃO CASCATA: Detecta se um episódio de série é duplicado
 * 
 * NÍVEIS DE VALIDAÇÃO:
 * 1️⃣ TMDB ID + Temporada + Episódio (mais confiável)
 * 2️⃣ IMDB ID + Temporada + Episódio
 * 3️⃣ Nome normalizado + Temporada + Episódio
 * 4️⃣ Hash de Stream URL
 * 
 * @returns true se é duplicata, false se é único
 */
export function isEpisodeDuplicate(
  newEpisode: SeriesItem,
  existingEpisodes: SeriesItem[]
): boolean {
  for (const existing of existingEpisodes) {
    // ✅ NÍVEL 1: TMDB ID + Temporada + Episódio
    if (newEpisode.tmdb_id && existing.tmdb_id) {
      if (
        newEpisode.tmdb_id === existing.tmdb_id &&
        newEpisode.season === existing.season &&
        newEpisode.episode === existing.episode
      ) {
        logger.debug(`[DuplicateDetector] 🔴 Duplicata de episódio por TMDB: ${newEpisode.name} S${newEpisode.season}E${newEpisode.episode}`);
        return true;
      }
    }
    
    // ✅ NÍVEL 2: IMDB ID + Temporada + Episódio
    if (newEpisode.imdb_id && existing.imdb_id) {
      if (
        newEpisode.imdb_id === existing.imdb_id &&
        newEpisode.season === existing.season &&
        newEpisode.episode === existing.episode
      ) {
        logger.debug(`[DuplicateDetector] 🔴 Duplicata de episódio por IMDB: ${newEpisode.name} S${newEpisode.season}E${newEpisode.episode}`);
        return true;
      }
    }
    
    // ✅ NÍVEL 3: Mesmo número de temporada/episódio
    // (Para a mesma série, temporada+episódio são únicos)
    if (
      newEpisode.season === existing.season &&
      newEpisode.episode === existing.episode
    ) {
      // Verificar se é realmente a mesma série (nome similar)
      const similarity = calculateSimilarity(newEpisode.name, existing.name);
      if (similarity > 0.85) {
        logger.debug(`[DuplicateDetector] 🔴 Duplicata de episódio por S/E: ${newEpisode.name} S${newEpisode.season}E${newEpisode.episode}`);
        return true;
      }
    }
    
    // ✅ NÍVEL 4: Hash de Stream
    if (newEpisode.stream_url && existing.stream_url) {
      const newHash = generateStreamHash(newEpisode.stream_url);
      const existingHash = generateStreamHash(existing.stream_url);
      
      if (newHash === existingHash) {
        logger.debug(`[DuplicateDetector] 🔴 Duplicata de episódio por Stream Hash`);
        return true;
      }
    }
  }
  
  return false; // ✅ NÃO é duplicata
}

/**
 * Remove duplicatas de uma lista de filmes
 */
export function removeDuplicateMovies(movies: MovieItem[]): MovieItem[] {
  const unique: MovieItem[] = [];
  
  for (const movie of movies) {
    if (!isMovieDuplicate(movie, unique)) {
      unique.push(movie);
    }
  }
  
  const removed = movies.length - unique.length;
  if (removed > 0) {
    logger.info(`[DuplicateDetector] 🧹 Removidos ${removed} filmes duplicados de ${movies.length} total`);
  }
  
  return unique;
}

/**
 * Remove duplicatas de uma lista de episódios
 */
export function removeDuplicateEpisodes(episodes: SeriesItem[]): SeriesItem[] {
  const unique: SeriesItem[] = [];
  
  for (const episode of episodes) {
    if (!isEpisodeDuplicate(episode, unique)) {
      unique.push(episode);
    }
  }
  
  const removed = episodes.length - unique.length;
  if (removed > 0) {
    logger.info(`[DuplicateDetector] 🧹 Removidos ${removed} episódios duplicados de ${episodes.length} total`);
  }
  
  return unique;
}
