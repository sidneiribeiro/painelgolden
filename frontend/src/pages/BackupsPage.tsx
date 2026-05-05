import { useState } from 'react';
import { Card, Button, Spinner } from '../components/ui';
import { useBackups } from '../hooks/useBackups';
import { api } from '../api/client';
import toast from 'react-hot-toast';

export function BackupsPage() {
  const { backups, isLoading, createBackup, restoreBackup, deleteBackup, isCreating, isRestoring, isDeleting } = useBackups();
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const handleCreateBackup = () => {
    createBackup(undefined, {
      onSuccess: (data) => {
        toast.success(data.message || 'Backup criado com sucesso!');
      },
      onError: (error: any) => {
        toast.error(error.response?.data?.error || 'Erro ao criar backup');
      },
    });
  };

  const handleRestore = (filename: string) => {
    setRestoreTarget(filename);
  };

  const confirmRestore = () => {
    if (!restoreTarget) return;

    restoreBackup(restoreTarget, {
      onSuccess: (data) => {
        toast.success(
          data.message || 'Backup restaurado com sucesso!',
          { duration: 8000 }
        );
        setRestoreTarget(null);
      },
      onError: (error: any) => {
        toast.error(error.response?.data?.error || 'Erro ao restaurar backup');
        setRestoreTarget(null);
      },
    });
  };

  const handleDelete = (filename: string) => {
    setDeleteTarget(filename);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;

    deleteBackup(deleteTarget, {
      onSuccess: (data) => {
        toast.success(data.message || 'Backup deletado com sucesso!');
        setDeleteTarget(null);
      },
      onError: (error: any) => {
        toast.error(error.response?.data?.error || 'Erro ao deletar backup');
        setDeleteTarget(null);
      },
    });
  };

  const handleDownload = async (filename: string) => {
    try {
      // Usa o api client que já adiciona o token automaticamente
      const response = await api.get(`/backups/download/${encodeURIComponent(filename)}`, {
        responseType: 'blob',
      });

      // Criar blob e fazer download
      const blob = new Blob([response.data]);
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      toast.success('Download iniciado!');
    } catch (error: any) {
      console.error('Erro no download:', error);
      const errorMessage = error.response?.data?.error || error.message || 'Erro ao fazer download do backup';
      toast.error(errorMessage);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'short',
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-zinc-900 dark:text-white">📦 Backups</h1>
        <p className="text-zinc-600 dark:text-zinc-400 text-sm lg:text-base mt-1">
          Gerencie seus backups do banco de dados
        </p>
      </div>

      {/* Criar Backup */}
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-white mb-2">
              Criar Novo Backup
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400 text-sm">
              Crie um backup manual do banco de dados. Os backups são salvos automaticamente.
            </p>
          </div>
          <Button
            onClick={handleCreateBackup}
            disabled={isCreating}
            className="bg-cyan-500 hover:bg-cyan-600 text-white"
          >
            {isCreating ? (
              <>
                <Spinner className="w-4 h-4 mr-2" />
                Criando...
              </>
            ) : (
              '📦 Criar Backup'
            )}
          </Button>
        </div>
      </Card>

      {/* Lista de Backups */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-white mb-4">
          Backups Disponíveis ({backups.length})
        </h2>

        {backups.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-zinc-600 dark:text-zinc-400">Nenhum backup encontrado</p>
            <p className="text-zinc-500 dark:text-zinc-500 text-sm mt-2">
              Crie seu primeiro backup clicando no botão acima
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="text-left py-3 px-4 text-zinc-600 dark:text-zinc-400 font-medium">
                    Arquivo
                  </th>
                  <th className="text-left py-3 px-4 text-zinc-600 dark:text-zinc-400 font-medium">
                    Tamanho
                  </th>
                  <th className="text-left py-3 px-4 text-zinc-600 dark:text-zinc-400 font-medium">
                    Data de Criação
                  </th>
                  <th className="text-right py-3 px-4 text-zinc-600 dark:text-zinc-400 font-medium">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => (
                  <tr
                    key={backup.filename}
                    className="border-b border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="font-mono text-sm text-zinc-900 dark:text-white">
                        {backup.filename}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-zinc-700 dark:text-zinc-300">
                      {backup.sizeFormatted}
                    </td>
                    <td className="py-3 px-4 text-zinc-700 dark:text-zinc-300">
                      {backup.createdAtFormatted || formatDate(backup.createdAt)}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          onClick={() => handleDownload(backup.filename)}
                          variant="outline"
                          size="sm"
                          className="text-xs"
                        >
                          ⬇️ Download
                        </Button>
                        <Button
                          onClick={() => handleRestore(backup.filename)}
                          variant="outline"
                          size="sm"
                          className="text-xs text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-500/10"
                          disabled={isRestoring}
                        >
                          🔄 Restaurar
                        </Button>
                        <Button
                          onClick={() => handleDelete(backup.filename)}
                          variant="outline"
                          size="sm"
                          className="text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10"
                          disabled={isDeleting}
                        >
                          🗑️ Deletar
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Modal de Confirmação - Restaurar */}
      {restoreTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-semibold text-zinc-900 dark:text-white mb-4">
              ⚠️ Confirmar Restauração
            </h3>
            <p className="text-zinc-700 dark:text-zinc-300 mb-2">
              Tem certeza que deseja restaurar o backup?
            </p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
              <strong>Arquivo:</strong> {restoreTarget}
            </p>
            <p className="text-sm text-amber-600 dark:text-amber-400 mb-6 bg-amber-50 dark:bg-amber-500/10 p-3 rounded-lg">
              ⚠️ Isso irá substituir o banco de dados atual. Um backup de segurança será criado automaticamente antes da restauração.
              As alterações serão aplicadas imediatamente.
            </p>
            <div className="flex gap-3 justify-end">
              <Button
                onClick={() => setRestoreTarget(null)}
                variant="outline"
                disabled={isRestoring}
              >
                Cancelar
              </Button>
              <Button
                onClick={confirmRestore}
                disabled={isRestoring}
                className="bg-green-500 hover:bg-green-600 text-white"
              >
                {isRestoring ? (
                  <>
                    <Spinner className="w-4 h-4 mr-2" />
                    Restaurando...
                  </>
                ) : (
                  '✅ Confirmar Restauração'
                )}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Modal de Confirmação - Deletar */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-semibold text-zinc-900 dark:text-white mb-4">
              ⚠️ Confirmar Exclusão
            </h3>
            <p className="text-zinc-700 dark:text-zinc-300 mb-2">
              Tem certeza que deseja deletar este backup?
            </p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
              <strong>Arquivo:</strong> {deleteTarget}
            </p>
            <p className="text-sm text-red-600 dark:text-red-400 mb-6 bg-red-50 dark:bg-red-500/10 p-3 rounded-lg">
              ⚠️ Esta ação não pode ser desfeita.
            </p>
            <div className="flex gap-3 justify-end">
              <Button
                onClick={() => setDeleteTarget(null)}
                variant="outline"
                disabled={isDeleting}
              >
                Cancelar
              </Button>
              <Button
                onClick={confirmDelete}
                disabled={isDeleting}
                className="bg-red-500 hover:bg-red-600 text-white"
              >
                {isDeleting ? (
                  <>
                    <Spinner className="w-4 h-4 mr-2" />
                    Deletando...
                  </>
                ) : (
                  '🗑️ Confirmar Exclusão'
                )}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

