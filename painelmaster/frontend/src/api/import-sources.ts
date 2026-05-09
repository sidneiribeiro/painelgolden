import { api } from './client';

export interface ImportSource {
  id: string;
  name: string;
  type: 'primary' | 'secondary';
  url: string;
  isActive: boolean;
  lastImportAt: string | null;
  totalItemsImported: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateImportSourceData {
  name: string;
  type: 'primary' | 'secondary';
  url: string;
  isActive?: boolean;
}

export interface UpdateImportSourceData {
  name?: string;
  type?: 'primary' | 'secondary';
  url?: string;
  isActive?: boolean;
}

export interface ImportFromSourceData {
  clearBeforeImport?: boolean;
  enrichWithTMDB?: boolean;
  categoryId?: number;
  createYearCategory?: boolean;
  selectedYears?: number[];
}

export interface ImportFromSourceResult {
  success: boolean;
  result?: {
    added: number;
    skipped: number;
    errors: number;
    duration: number;
  };
  error?: string;
}

// Listar todas as fontes
export async function listImportSources(): Promise<ImportSource[]> {
  const response = await api.get<{ success: boolean; sources: ImportSource[] }>('/import-sources');
  return response.data.sources;
}

// Buscar fonte por ID
export async function getImportSource(id: string): Promise<ImportSource> {
  const response = await api.get<{ success: boolean; source: ImportSource }>(`/import-sources/${id}`);
  return response.data.source;
}

// Criar nova fonte
export async function createImportSource(data: CreateImportSourceData): Promise<ImportSource> {
  const response = await api.post<{ success: boolean; source: ImportSource }>('/import-sources', data);
  return response.data.source;
}

// Atualizar fonte
export async function updateImportSource(id: string, data: UpdateImportSourceData): Promise<ImportSource> {
  const response = await api.put<{ success: boolean; source: ImportSource }>(`/import-sources/${id}`, data);
  return response.data.source;
}

// Deletar fonte
export async function deleteImportSource(id: string): Promise<void> {
  await api.delete(`/import-sources/${id}`);
}

// Executar importação de uma fonte
export async function importFromSource(id: string, data: ImportFromSourceData): Promise<ImportFromSourceResult> {
  const response = await api.post<ImportFromSourceResult>(`/import-sources/${id}/import`, data);
  return response.data;
}
