import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, Plus, Edit2, Trash2, Play, ToggleLeft, ToggleRight, Calendar, Hash } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import {
  useImportSources,
  useCreateImportSource,
  useUpdateImportSource,
  useDeleteImportSource,
  useImportFromSource,
} from '../../hooks/use-import-sources';
import type { ImportSource, CreateImportSourceData, UpdateImportSourceData } from '../../api/import-sources';
import { toast } from 'react-hot-toast';

export function ImportSourcesPage() {
  const navigate = useNavigate();
  const { data: sources, isLoading } = useImportSources();
  const createMutation = useCreateImportSource();
  const updateMutation = useUpdateImportSource();
  const deleteMutation = useDeleteImportSource();
  const importMutation = useImportFromSource();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedSource, setSelectedSource] = useState<ImportSource | null>(null);

  // Form states
  const [formData, setFormData] = useState<CreateImportSourceData>({
    name: '',
    type: 'secondary',
    url: '',
    isActive: true,
  });

  const handleCreate = () => {
    if (!formData.name || !formData.url) {
      toast.error('Preencha nome e URL');
      return;
    }

    createMutation.mutate(formData, {
      onSuccess: () => {
        setShowCreateModal(false);
        setFormData({ name: '', type: 'secondary', url: '', isActive: true });
      },
    });
  };

  const handleEdit = () => {
    if (!selectedSource) return;

    const updateData: UpdateImportSourceData = {
      name: formData.name,
      type: formData.type,
      url: formData.url,
      isActive: formData.isActive,
    };

    updateMutation.mutate(
      { id: selectedSource.id, data: updateData },
      {
        onSuccess: () => {
          setShowEditModal(false);
          setSelectedSource(null);
          setFormData({ name: '', type: 'secondary', url: '', isActive: true });
        },
      }
    );
  };

  const handleDelete = () => {
    if (!selectedSource) return;

    deleteMutation.mutate(selectedSource.id, {
      onSuccess: () => {
        setShowDeleteModal(false);
        setSelectedSource(null);
      },
    });
  };

  const handleToggleActive = (source: ImportSource) => {
    updateMutation.mutate({
      id: source.id,
      data: { isActive: !source.isActive },
    });
  };

  const handleImport = (source: ImportSource) => {
    // Redirecionar para página de importação com fonte pré-selecionada
    navigate(`/vod/import?sourceId=${source.id}`);
  };

  const openEditModal = (source: ImportSource) => {
    setSelectedSource(source);
    setFormData({
      name: source.name,
      type: source.type,
      url: source.url,
      isActive: source.isActive,
    });
    setShowEditModal(true);
  };

  const openDeleteModal = (source: ImportSource) => {
    setSelectedSource(source);
    setShowDeleteModal(true);
  };

  // Separar fontes por tipo
  const primarySources = sources?.filter((s) => s.type === 'primary') || [];
  const secondarySources = sources?.filter((s) => s.type === 'secondary') || [];

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Database className="w-7 h-7 text-blue-500" />
            Fontes de Importação M3U
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Gerencie fontes primárias e secundárias para importação automatizada
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/vod')}>
            ← Voltar
          </Button>
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Nova Fonte
          </Button>
        </div>
      </div>

      {/* Info Card */}
      <Card className="p-4 bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30">
        <div className="flex items-start gap-3">
          <span className="text-blue-600 dark:text-blue-400 text-xl">ℹ️</span>
          <div className="flex-1">
            <p className="font-semibold text-blue-900 dark:text-blue-100 text-sm">
              Como funciona o sistema de fontes?
            </p>
            <ul className="text-xs text-blue-700 dark:text-blue-300 mt-2 space-y-1 list-disc list-inside">
              <li>
                <strong>Fontes Primárias:</strong> Importadas primeiro, definem o catálogo base
              </li>
              <li>
                <strong>Fontes Secundárias:</strong> Complementam com conteúdo que não está nas primárias (sem duplicatas)
              </li>
              <li>
                <strong>Detecção Inteligente:</strong> Sistema em cascata previne duplicatas por TMDB ID, IMDB ID, nome normalizado e stream hash
              </li>
            </ul>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <Card className="p-8 text-center">
          <p className="text-gray-500">Carregando fontes...</p>
        </Card>
      ) : (
        <>
          {/* Fontes Primárias */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                🎯 Fontes Primárias
              </h2>
              <span className="text-sm text-gray-500">({primarySources.length})</span>
            </div>

            {primarySources.length === 0 ? (
              <Card className="p-6 text-center border-dashed">
                <p className="text-gray-500 text-sm">Nenhuma fonte primária cadastrada</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => {
                    setFormData({ name: '', type: 'primary', url: '', isActive: true });
                    setShowCreateModal(true);
                  }}
                >
                  + Adicionar Fonte Primária
                </Button>
              </Card>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {primarySources.map((source) => (
                  <SourceCard
                    key={source.id}
                    source={source}
                    onEdit={openEditModal}
                    onDelete={openDeleteModal}
                    onToggleActive={handleToggleActive}
                    onImport={handleImport}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Fontes Secundárias */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                📦 Fontes Secundárias
              </h2>
              <span className="text-sm text-gray-500">({secondarySources.length})</span>
            </div>

            {secondarySources.length === 0 ? (
              <Card className="p-6 text-center border-dashed">
                <p className="text-gray-500 text-sm">Nenhuma fonte secundária cadastrada</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => {
                    setFormData({ name: '', type: 'secondary', url: '', isActive: true });
                    setShowCreateModal(true);
                  }}
                >
                  + Adicionar Fonte Secundária
                </Button>
              </Card>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {secondarySources.map((source) => (
                  <SourceCard
                    key={source.id}
                    source={source}
                    onEdit={openEditModal}
                    onDelete={openDeleteModal}
                    onToggleActive={handleToggleActive}
                    onImport={handleImport}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Modal: Criar Fonte */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setFormData({ name: '', type: 'secondary', url: '', isActive: true });
        }}
        title="Nova Fonte de Importação"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Nome da Fonte
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              placeholder="Ex: IPTV Provider X"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Tipo
            </label>
            <select
              value={formData.type}
              onChange={(e) =>
                setFormData({ ...formData, type: e.target.value as 'primary' | 'secondary' })
              }
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              <option value="primary">Primária (catálogo base)</option>
              <option value="secondary">Secundária (complemento)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              URL do M3U
            </label>
            <input
              type="url"
              value={formData.url}
              onChange={(e) => setFormData({ ...formData, url: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-mono text-sm"
              placeholder="http://exemplo.com/playlist.m3u"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isActive"
              checked={formData.isActive}
              onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
              className="w-4 h-4 text-blue-500 rounded"
            />
            <label htmlFor="isActive" className="text-sm text-gray-700 dark:text-gray-300">
              Ativar fonte imediatamente
            </label>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowCreateModal(false);
                setFormData({ name: '', type: 'secondary', url: '', isActive: true });
              }}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              className="flex-1"
            >
              {createMutation.isPending ? 'Criando...' : 'Criar Fonte'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Editar Fonte */}
      <Modal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setSelectedSource(null);
          setFormData({ name: '', type: 'secondary', url: '', isActive: true });
        }}
        title="Editar Fonte"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Nome da Fonte
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Tipo
            </label>
            <select
              value={formData.type}
              onChange={(e) =>
                setFormData({ ...formData, type: e.target.value as 'primary' | 'secondary' })
              }
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              <option value="primary">Primária</option>
              <option value="secondary">Secundária</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              URL do M3U
            </label>
            <input
              type="url"
              value={formData.url}
              onChange={(e) => setFormData({ ...formData, url: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-mono text-sm"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowEditModal(false);
                setSelectedSource(null);
                setFormData({ name: '', type: 'secondary', url: '', isActive: true });
              }}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleEdit}
              disabled={updateMutation.isPending}
              className="flex-1"
            >
              {updateMutation.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Deletar Fonte */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setSelectedSource(null);
        }}
        title="Deletar Fonte"
      >
        <div className="space-y-4">
          <p className="text-gray-700 dark:text-gray-300">
            Tem certeza que deseja deletar a fonte{' '}
            <strong className="text-gray-900 dark:text-white">
              {selectedSource?.name}
            </strong>
            ?
          </p>
          <p className="text-sm text-red-600 dark:text-red-400">
            Esta ação não pode ser desfeita. Os conteúdos já importados não serão removidos.
          </p>

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowDeleteModal(false);
                setSelectedSource(null);
              }}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="flex-1"
            >
              {deleteMutation.isPending ? 'Deletando...' : 'Deletar'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// Componente de Card de Fonte
interface SourceCardProps {
  source: ImportSource;
  onEdit: (source: ImportSource) => void;
  onDelete: (source: ImportSource) => void;
  onToggleActive: (source: ImportSource) => void;
  onImport: (source: ImportSource) => void;
}

function SourceCard({ source, onEdit, onDelete, onToggleActive, onImport }: SourceCardProps) {
  const formatDate = (date: string | null) => {
    if (!date) return 'Nunca';
    return new Date(date).toLocaleString('pt-BR');
  };

  return (
    <Card
      className={`p-4 ${
        source.isActive
          ? 'border-green-200 dark:border-green-700'
          : 'border-gray-300 dark:border-gray-700 opacity-60'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 dark:text-white">{source.name}</h3>
            {source.type === 'primary' && (
              <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 rounded">
                Primária
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-mono truncate">
            {source.url}
          </p>
        </div>

        <button
          onClick={() => onToggleActive(source)}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          title={source.isActive ? 'Desativar' : 'Ativar'}
        >
          {source.isActive ? (
            <ToggleRight className="w-6 h-6 text-green-500" />
          ) : (
            <ToggleLeft className="w-6 h-6" />
          )}
        </button>
      </div>

      {/* Estatísticas */}
      <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
        <div className="flex items-center gap-1 text-gray-600 dark:text-gray-400">
          <Calendar className="w-3.5 h-3.5" />
          <span>Última: {formatDate(source.lastImportAt)}</span>
        </div>
        <div className="flex items-center gap-1 text-gray-600 dark:text-gray-400">
          <Hash className="w-3.5 h-3.5" />
          <span>Total: {source.totalItemsImported.toLocaleString()}</span>
        </div>
      </div>

      {/* Ações */}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => onImport(source)}
          disabled={!source.isActive}
          className="flex-1"
        >
          <Play className="w-3.5 h-3.5 mr-1" />
          Importar
        </Button>
        <Button size="sm" variant="outline" onClick={() => onEdit(source)}>
          <Edit2 className="w-3.5 h-3.5" />
        </Button>
        <Button size="sm" variant="danger" onClick={() => onDelete(source)}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </Card>
  );
}
