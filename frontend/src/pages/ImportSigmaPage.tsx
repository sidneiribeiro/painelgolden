import { useState } from 'react';
import { Card, Button, Spinner } from '../components/ui';
import { api } from '../api/client';
import toast from 'react-hot-toast';
import { useMutation } from '@tanstack/react-query';

interface ImportResult {
  total: number;
  success: number;
  errors: number;
  duplicates: number;
  notFoundInXui: number;
  details: Array<{
    username: string;
    status: 'success' | 'error' | 'duplicate' | 'not_found' | 'package_not_found';
    message: string;
  }>;
}

export function ImportSigmaPage() {
  const [csvContent, setCsvContent] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importProgress, setImportProgress] = useState<{
    current: number;
    total: number;
    isImporting: boolean;
  }>({ current: 0, total: 0, isImporting: false });

  const importMutation = useMutation({
    mutationFn: async (csv: string) => {
      // Estimar total de linhas (descontando header)
      const estimatedTotal = csv.split('\n').length - 1;
      setImportProgress({ current: 0, total: estimatedTotal, isImporting: true });

      try {
        const response = await api.post('/customers/import-sigma', { csv });
        
        // Atualizar progresso para 100%
        setImportProgress(prev => ({ ...prev, current: prev.total, isImporting: false }));
        
        return response.data;
      } catch (error) {
        setImportProgress({ current: 0, total: 0, isImporting: false });
        throw error;
      }
    },
    onSuccess: (data) => {
      if (data.success && data.data) {
        setImportResult(data.data);
        setImportProgress({ current: 0, total: 0, isImporting: false });
        toast.success(
          `Importação concluída! ${data.data.success} sucesso, ${data.data.errors} erros, ${data.data.duplicates} duplicados`
        );
      } else {
        setImportProgress({ current: 0, total: 0, isImporting: false });
        toast.error('Erro na importação');
      }
    },
    onError: (error: any) => {
      setImportProgress({ current: 0, total: 0, isImporting: false });
      toast.error(error.response?.data?.error || 'Erro ao importar clientes');
    },
  });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setCsvContent(text);
      setImportResult(null);
    };
    reader.onerror = () => {
      toast.error('Erro ao ler arquivo');
    };
    reader.readAsText(file);
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData('text');
    setCsvContent(text);
    setImportResult(null);
  };

  const handleImport = () => {
    if (!csvContent.trim()) {
      toast.error('Por favor, faça upload de um arquivo CSV ou cole o conteúdo');
      return;
    }

    if (!confirm('Tem certeza que deseja importar os clientes? Esta ação não pode ser desfeita.')) {
      return;
    }

    importMutation.mutate(csvContent);
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      success: 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300',
      error: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300',
      duplicate: 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-300',
      not_found: 'bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300',
      package_not_found: 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300',
    };

    const labels = {
      success: '✅ Sucesso',
      error: '❌ Erro',
      duplicate: '⚠️ Duplicado',
      not_found: '🔍 Não encontrado no XUI',
      package_not_found: '📦 Pacote não encontrado',
    };

    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${styles[status as keyof typeof styles] || styles.error}`}>
        {labels[status as keyof typeof labels] || status}
      </span>
    );
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-zinc-900 dark:text-white">
          📥 Importar Clientes do SIGMA
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400 text-sm lg:text-base mt-1">
          Importe clientes do painel SIGMA para o seu painel
        </p>
      </div>

      {/* Instruções */}
      <Card className="bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30">
        <div className="p-4">
          <h3 className="text-blue-900 dark:text-blue-200 font-semibold mb-2">
            ⚠️ Instruções Importantes
          </h3>
          <ul className="text-blue-700 dark:text-blue-300 text-sm space-y-1 list-disc list-inside">
            <li>Os clientes devem já estar cadastrados no XUI.ONE</li>
            <li>O sistema buscará as datas de vencimento diretamente do XUI (não do CSV)</li>
            <li>O sistema NÃO modifica dados no XUI.ONE, apenas cria registros locais</li>
            <li>Clientes duplicados serão ignorados</li>
            <li>Clientes não encontrados no XUI serão ignorados</li>
          </ul>
        </div>
      </Card>

      {/* Upload Area */}
      <Card>
        <div className="p-4 lg:p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-900 dark:text-white mb-2">
              Upload de Arquivo CSV
            </label>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="block w-full text-sm text-zinc-600 dark:text-zinc-400
                file:mr-4 file:py-2 file:px-4
                file:rounded-md file:border-0
                file:text-sm file:font-semibold
                file:bg-cyan-500 file:text-zinc-900 dark:file:text-white
                hover:file:bg-cyan-600
                cursor-pointer
                bg-white dark:bg-zinc-800
                border border-zinc-300 dark:border-zinc-700 rounded-md"
            />
            {fileName && (
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Arquivo selecionado: <span className="font-medium">{fileName}</span>
              </p>
            )}
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-zinc-300 dark:border-zinc-700"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400">OU</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-900 dark:text-white mb-2">
              Cole o conteúdo do CSV aqui
            </label>
            <textarea
              value={csvContent}
              onChange={(e) => {
                setCsvContent(e.target.value);
                setImportResult(null);
              }}
              onPaste={handlePaste}
              placeholder="Cole aqui o conteúdo do arquivo CSV..."
              rows={10}
              className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-md
                text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500
                focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent
                font-mono text-sm"
            />
          </div>

          <div className="space-y-4">
            {/* Barra de Progresso */}
            {importProgress.isImporting && (
              <div className="bg-zinc-100 dark:bg-zinc-800/50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-zinc-900 dark:text-white">
                    Importando clientes...
                  </span>
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    {importProgress.current} / {importProgress.total}
                  </span>
                </div>
                <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-2.5">
                  <div
                    className="bg-cyan-500 h-2.5 rounded-full transition-all duration-300"
                    style={{
                      width: `${importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-2">
                  Processando clientes do CSV... Isso pode levar alguns minutos.
                </p>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                onClick={handleImport}
                disabled={!csvContent.trim() || importMutation.isPending || importProgress.isImporting}
                className="bg-cyan-500 hover:bg-cyan-600 text-zinc-900 dark:text-white"
              >
                {importMutation.isPending || importProgress.isImporting ? (
                  <>
                    <Spinner className="mr-2" />
                    Importando...
                  </>
                ) : (
                  '📥 Importar Clientes'
                )}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Resultado da Importação */}
      {importResult && (
        <Card>
          <div className="p-4 lg:p-6 space-y-4">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
              📊 Resultado da Importação
            </h2>

            {/* Estatísticas */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-zinc-100 dark:bg-zinc-800/50 p-3 rounded-lg">
                <div className="text-2xl font-bold text-zinc-900 dark:text-white">
                  {importResult.total}
                </div>
                <div className="text-xs text-zinc-600 dark:text-zinc-400">Total</div>
              </div>
              <div className="bg-green-100 dark:bg-green-500/20 p-3 rounded-lg">
                <div className="text-2xl font-bold text-green-700 dark:text-green-300">
                  {importResult.success}
                </div>
                <div className="text-xs text-green-600 dark:text-green-400">Sucesso</div>
              </div>
              <div className="bg-red-100 dark:bg-red-500/20 p-3 rounded-lg">
                <div className="text-2xl font-bold text-red-700 dark:text-red-300">
                  {importResult.errors}
                </div>
                <div className="text-xs text-red-600 dark:text-red-400">Erros</div>
              </div>
              <div className="bg-yellow-100 dark:bg-yellow-500/20 p-3 rounded-lg">
                <div className="text-2xl font-bold text-yellow-700 dark:text-yellow-300">
                  {importResult.duplicates}
                </div>
                <div className="text-xs text-yellow-600 dark:text-yellow-400">Duplicados</div>
              </div>
              <div className="bg-orange-100 dark:bg-orange-500/20 p-3 rounded-lg">
                <div className="text-2xl font-bold text-orange-700 dark:text-orange-300">
                  {importResult.notFoundInXui}
                </div>
                <div className="text-xs text-orange-600 dark:text-orange-400">Não encontrado</div>
              </div>
            </div>

            {/* Detalhes */}
            {importResult.details.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-zinc-900 dark:text-white mb-2">
                  Detalhes da Importação
                </h3>
                <div className="max-h-96 overflow-y-auto border border-zinc-200 dark:border-zinc-800 rounded-md">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-100 dark:bg-zinc-800/50 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left text-zinc-600 dark:text-zinc-400">Username</th>
                        <th className="px-4 py-2 text-left text-zinc-600 dark:text-zinc-400">Status</th>
                        <th className="px-4 py-2 text-left text-zinc-600 dark:text-zinc-400">Mensagem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                      {importResult.details.map((detail, index) => (
                        <tr key={index} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                          <td className="px-4 py-2 text-zinc-900 dark:text-white font-mono">
                            {detail.username}
                          </td>
                          <td className="px-4 py-2">
                            {getStatusBadge(detail.status)}
                          </td>
                          <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">
                            {detail.message}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

