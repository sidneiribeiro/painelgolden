import React, { useState, useEffect } from 'react';
import { Search, Filter, Download, Calendar, DollarSign, Users, AlertCircle, CheckCircle, RefreshCw, ArrowUpRight, TrendingUp } from 'lucide-react';
import { toast } from 'react-hot-toast';
import api from '../../api/client';
import { ResellerTreeDropdown } from '../../components/ResellerTreeDropdown';

interface BillingReport {
  id: string;
  username: string;
  name: string;
  email: string;
  dueDate: string | null;
  customerPrice: number | null;
  activeCustomers: number;
  totalToPay: number;
  status: 'EM DIA' | 'VENCIDO';
  daysUntilDue: number | null;
}

interface MyCost {
  pricePerClient: number;
  activeCustomers: number;
  totalCost: number;
  dueDate: string | null;
  isOverdue: boolean;
  daysUntilDue: number | null;
}

interface ReportSummary {
  totalResellers: number;
  totalActiveCustomers: number;
  totalOverdue: number;
  totalToPay: number;
  overdueAmount: number;
  viewMode?: 'admin' | 'reseller';
  myCost?: MyCost | null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export default function BillingReport() {
  const [report, setReport] = useState<BillingReport[]>([]);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    status: 'ALL' as 'ALL' | 'OVERDUE' | 'UP_TO_DATE',
    startDate: '',
    endDate: '',
    search: ''
  });
  const [selectedResellerId, setSelectedResellerId] = useState('');
  const [selectedResellerName, setSelectedResellerName] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [billSortBy, setBillSortBy] = useState('');
  const [billSortDir, setBillSortDir] = useState<'asc' | 'desc'>('asc');

  const toggleBillSort = (field: string) => {
    if (billSortBy === field) {
      setBillSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setBillSortBy(field);
      setBillSortDir('asc');
    }
  };

  const BillSortIcon = ({ field }: { field: string }) => (
    <span className="ml-1 inline-block w-3 text-[10px] leading-none">
      {billSortBy === field ? (billSortDir === 'asc' ? '▲' : '▼') : '⇅'}
    </span>
  );

  const fetchReport = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: '50',
        ...(filters.status !== 'ALL' && { status: filters.status }),
        ...(filters.startDate && { startDate: filters.startDate }),
        ...(filters.endDate && { endDate: filters.endDate }),
        ...(selectedResellerId && { resellerId: selectedResellerId })
      });

      const response = await api.get(`/billing/report?${params}`);
      
      setReport(response.data.report);
      setSummary(response.data.summary);
      setPagination(response.data.pagination);
    } catch (error) {
      console.error('Erro ao buscar relatório:', error);
      toast.error('Erro ao carregar relatório financeiro');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [currentPage, filters, selectedResellerId]);

  const handleExport = async (format: 'csv' | 'pdf') => {
    try {
      const params = new URLSearchParams({
        format,
        ...(filters.status !== 'ALL' && { status: filters.status }),
        ...(filters.startDate && { startDate: filters.startDate }),
        ...(filters.endDate && { endDate: filters.endDate }),
        ...(selectedResellerId && { resellerId: selectedResellerId })
      });

      const response = await api.get(`/billing/report/export?${params}`, {
        responseType: 'blob'
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `relatorio-financeiro.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      toast.success(`Relatório exportado como ${format.toUpperCase()}`);
    } catch (error) {
      console.error('Erro ao exportar:', error);
      toast.error('Erro ao exportar relatório');
    }
  };

  const handleRenew = async (userId: string, username: string) => {
    try {
      const days = prompt(`Quantos dias deseja renovar o acesso de ${username}?`, '30');
      if (!days || isNaN(Number(days))) return;

      await api.post(`/billing/users/${userId}/renew`, { days: Number(days) });
      toast.success(`Acesso renovado por ${days} dias`);
      fetchReport();
    } catch (error) {
      console.error('Erro ao renovar:', error);
      toast.error('Erro ao renovar acesso');
    }
  };

  const filteredReport = report.filter(item => 
    !filters.search || 
    item.username.toLowerCase().includes(filters.search.toLowerCase()) ||
    item.name.toLowerCase().includes(filters.search.toLowerCase()) ||
    item.email.toLowerCase().includes(filters.search.toLowerCase())
  );

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Relatório Financeiro</h1>
        <p className="text-gray-600 dark:text-zinc-400">
          {summary?.viewMode === 'reseller'
            ? 'Acompanhe os valores a receber das suas sub-revendas e seu custo mensal'
            : 'Acompanhe o status de pagamentos dos revendedores'
          }
        </p>
      </div>

      {/* My Cost Card (only for resellers) */}
      {summary?.myCost && (
        <div className="mb-6 bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-950/30 dark:to-red-950/30 border border-orange-200 dark:border-orange-800 rounded-lg p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
                <ArrowUpRight className="h-5 w-5 text-red-500 mr-2" />
                Meu Custo Mensal (pago ao master)
              </h3>
              <p className="text-sm text-gray-600 dark:text-zinc-400 mt-1">
                R$ {summary.myCost.pricePerClient.toFixed(2)}/cliente × {summary.myCost.activeCustomers} clientes ativos
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-red-600">
                R$ {summary.myCost.totalCost.toFixed(2)}
              </p>
              {summary.myCost.dueDate && (
                <p className={`text-sm mt-1 ${summary.myCost.isOverdue ? 'text-red-600 font-semibold' : 'text-gray-600 dark:text-zinc-400'}`}>
                  {summary.myCost.isOverdue
                    ? `Vencido em ${new Date(summary.myCost.dueDate).toLocaleDateString('pt-BR')}`
                    : `Vence em ${new Date(summary.myCost.dueDate).toLocaleDateString('pt-BR')} (${summary.myCost.daysUntilDue} dias)`
                  }
                </p>
              )}
            </div>
          </div>
          {summary.totalToPay > 0 && (
            <div className="mt-3 pt-3 border-t border-orange-200 dark:border-orange-800 flex items-center">
              <TrendingUp className="h-4 w-4 text-green-600 mr-2" />
              <span className="text-sm text-gray-700 dark:text-zinc-300">
                <strong className="text-green-600">Lucro estimado:</strong> R$ {(summary.totalToPay - summary.myCost.totalCost).toFixed(2)}
                <span className="text-gray-500 dark:text-zinc-500 ml-2">(Receita R$ {summary.totalToPay.toFixed(2)} - Custo R$ {summary.myCost.totalCost.toFixed(2)})</span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-4">
            <div className="flex items-center">
              <Users className="h-8 w-8 text-blue-500" />
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-600 dark:text-zinc-400">{summary.viewMode === 'reseller' ? 'Sub-Revendas' : 'Revendedores'}</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{summary.totalResellers}</p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-4">
            <div className="flex items-center">
              <Users className="h-8 w-8 text-green-500" />
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-600 dark:text-zinc-400">Clientes Ativos</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{summary.totalActiveCustomers}</p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-4">
            <div className="flex items-center">
              <AlertCircle className="h-8 w-8 text-red-500" />
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-600 dark:text-zinc-400">Vencidos</p>
                <p className="text-xl font-bold text-red-600">{summary.totalOverdue}</p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-4">
            <div className="flex items-center">
              <DollarSign className="h-8 w-8 text-blue-500" />
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-600 dark:text-zinc-400">{summary.viewMode === 'reseller' ? 'Total a Receber' : 'Total a Receber'}</p>
                <p className="text-xl font-bold text-green-600">
                  R$ {summary.totalToPay.toFixed(2)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-4">
            <div className="flex items-center">
              <AlertCircle className="h-8 w-8 text-red-500" />
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-600 dark:text-zinc-400">Inadimplência</p>
                <p className="text-xl font-bold text-red-600">
                  R$ {summary.overdueAmount.toFixed(2)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-4 mb-6">
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">
            Filtrar por Revendedor
          </label>
          <ResellerTreeDropdown
            value={selectedResellerId}
            onChange={(id, name) => {
              setSelectedResellerId(id);
              setSelectedResellerName(name);
              setCurrentPage(1);
            }}
            placeholder="Todos os revendedores"
            allOptionLabel="Todos os revendedores"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">
              Status
            </label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value as any })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 dark:bg-zinc-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">Todos</option>
              <option value="UP_TO_DATE">Em Dia</option>
              <option value="OVERDUE">Vencidos</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">
              Data Início
            </label>
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 dark:bg-zinc-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">
              Data Fim
            </label>
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 dark:bg-zinc-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">
              Buscar
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Nome, e-mail..."
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-zinc-600 dark:bg-zinc-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="flex items-end space-x-2">
            <button
              onClick={() => handleExport('csv')}
              className="flex-1 bg-green-600 text-white px-3 py-2 rounded-md hover:bg-green-700 flex items-center justify-center"
            >
              <Download className="h-4 w-4 mr-1" />
              CSV
            </button>
            <button
              onClick={() => handleExport('pdf')}
              className="flex-1 bg-red-600 text-white px-3 py-2 rounded-md hover:bg-red-700 flex items-center justify-center"
            >
              <Download className="h-4 w-4 mr-1" />
              PDF
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-zinc-800 rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-zinc-700">
            <thead className="bg-gray-50 dark:bg-zinc-900/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-900 dark:hover:text-white" onClick={() => toggleBillSort('username')}>
                  Revendedor<BillSortIcon field="username" />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-900 dark:hover:text-white" onClick={() => toggleBillSort('dueDate')}>
                  Vencimento<BillSortIcon field="dueDate" />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-900 dark:hover:text-white" onClick={() => toggleBillSort('activeCustomers')}>
                  Clientes Ativos<BillSortIcon field="activeCustomers" />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-900 dark:hover:text-white" onClick={() => toggleBillSort('customerPrice')}>
                  Valor por Cliente<BillSortIcon field="customerPrice" />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-900 dark:hover:text-white" onClick={() => toggleBillSort('totalToPay')}>
                  Total a Pagar/Receber<BillSortIcon field="totalToPay" />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-900 dark:hover:text-white" onClick={() => toggleBillSort('status')}>
                  Status<BillSortIcon field="status" />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-zinc-800 divide-y divide-gray-200 dark:divide-zinc-700">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto text-blue-500" />
                  </td>
                </tr>
              ) : filteredReport.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center text-gray-500 dark:text-zinc-400">
                    Nenhum resultado encontrado
                  </td>
                </tr>
              ) : (
                (billSortBy
                  ? [...filteredReport].sort((a: any, b: any) => {
                      const dir = billSortDir === 'asc' ? 1 : -1;
                      const va = a[billSortBy] ?? '';
                      const vb = b[billSortBy] ?? '';
                      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
                      return String(va).localeCompare(String(vb), 'pt-BR') * dir;
                    })
                  : filteredReport
                ).map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-zinc-700/50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {item.name || item.username}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-zinc-400">{item.email}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {item.dueDate ? (
                        <div>
                          <div className="text-sm text-gray-900 dark:text-zinc-200">
                            {new Date(item.dueDate).toLocaleDateString('pt-BR')}
                          </div>
                          {item.daysUntilDue !== null && (
                            <div className={`text-xs ${
                              item.daysUntilDue <= 0 ? 'text-red-600' : 
                              item.daysUntilDue <= 7 ? 'text-yellow-600' : 'text-green-600'
                            }`}>
                              {item.daysUntilDue <= 0 ? 'Vencido' : `${item.daysUntilDue} dias`}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400 dark:text-zinc-500">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-zinc-200">
                      {item.activeCustomers}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-zinc-200">
                      {item.customerPrice ? `R$ ${Number(item.customerPrice).toFixed(2)}` : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        R$ {item.totalToPay.toFixed(2)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        item.status === 'EM DIA' 
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' 
                          : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                      }`}>
                        {item.status === 'EM DIA' ? (
                          <CheckCircle className="h-3 w-3 mr-1" />
                        ) : (
                          <AlertCircle className="h-3 w-3 mr-1" />
                        )}
                        {item.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {item.status === 'VENCIDO' && (
                        <button
                          onClick={() => handleRenew(item.id, item.username)}
                          className="text-blue-600 hover:text-blue-900 font-medium"
                        >
                          Renovar
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination && pagination.pages > 1 && (
          <div className="bg-white dark:bg-zinc-800 px-4 py-3 flex items-center justify-between border-t border-gray-200 dark:border-zinc-700">
            <div className="flex-1 flex justify-between sm:hidden">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 dark:border-zinc-600 text-sm font-medium rounded-md text-gray-700 dark:text-zinc-300 bg-white dark:bg-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-600 disabled:opacity-50"
              >
                Anterior
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.min(pagination.pages, p + 1))}
                disabled={currentPage === pagination.pages}
                className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 dark:border-zinc-600 text-sm font-medium rounded-md text-gray-700 dark:text-zinc-300 bg-white dark:bg-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-600 disabled:opacity-50"
              >
                Próximo
              </button>
            </div>
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700 dark:text-zinc-300">
                  Mostrando <span className="font-medium">{(currentPage - 1) * pagination.limit + 1}</span> a{' '}
                  <span className="font-medium">
                    {Math.min(currentPage * pagination.limit, pagination.total)}
                  </span>{' '}
                  de <span className="font-medium">{pagination.total}</span> resultados
                </p>
              </div>
              <div>
                <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-sm font-medium text-gray-500 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-600 disabled:opacity-50"
                  >
                    Anterior
                  </button>
                  {Array.from({ length: Math.min(5, pagination.pages) }, (_, i) => {
                    const page = i + 1;
                    return (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                          currentPage === page
                            ? 'z-10 bg-blue-50 dark:bg-blue-900/30 border-blue-500 text-blue-600 dark:text-blue-400'
                            : 'bg-white dark:bg-zinc-700 border-gray-300 dark:border-zinc-600 text-gray-500 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-600'
                        }`}
                      >
                        {page}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setCurrentPage(p => Math.min(pagination.pages, p + 1))}
                    disabled={currentPage === pagination.pages}
                    className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-sm font-medium text-gray-500 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-600 disabled:opacity-50"
                  >
                    Próximo
                  </button>
                </nav>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
