import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Users, UserPlus, Search, Filter, RefreshCw, AlertCircle, CheckCircle, Calendar, DollarSign, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { toast } from 'react-hot-toast';
import api from '../../api/client';
import ResellerForm from '../../components/ResellerForm';

interface User {
  id: string;
  username: string;
  name: string;
  email: string;
  role: string;
  billingType?: 'PREPAID' | 'POSTPAID';
  dueDate?: string;
  customerPrice?: number;
  billingCycleDays?: number;
  status: string;
  credits?: number;
  isBlockedByBilling?: boolean;
  parentId?: string;
  _count?: {
    children: number;
    customers: number;
  };
  children?: User[];
  financial?: {
    revenue: number;
    cost: number;
    profit: number;
    totalCustomersRecursive: number;
    myActiveCustomers: number;
    myPricePerClient: number;
  };
}

interface TreeNodeProps {
  user: User;
  level: number;
  onEdit: (user: User) => void;
  onRefresh: () => void;
  expandedNodes: Set<string>;
  toggleNode: (userId: string) => void;
}

const TreeNode: React.FC<TreeNodeProps> = ({ user, level, onEdit, onRefresh, expandedNodes, toggleNode }) => {
  const hasChildren = user._count?.children > 0;
  const isExpanded = expandedNodes.has(user.id);
  const isBlocked = user.isBlockedByBilling;
  const isOverdue = user.dueDate && new Date(user.dueDate) < new Date();

  const getStatusColor = () => {
    if (user.status !== 'ACTIVE') return 'text-gray-500';
    if (isBlocked) return 'text-red-600';
    if (isOverdue) return 'text-yellow-600';
    return 'text-green-600';
  };

  const getStatusIcon = () => {
    if (user.status !== 'ACTIVE') return <AlertCircle className="h-4 w-4" />;
    if (isBlocked) return <AlertCircle className="h-4 w-4" />;
    if (isOverdue) return <AlertCircle className="h-4 w-4" />;
    return <CheckCircle className="h-4 w-4" />;
  };

  const getStatusText = () => {
    if (user.status !== 'ACTIVE') return 'Inativo';
    if (isBlocked) return 'Bloqueado';
    if (isOverdue) return 'Vencido';
    return 'Ativo';
  };

  return (
    <div className="select-none">
      <div 
        className={`flex items-center py-2 px-3 hover:bg-gray-50 dark:hover:bg-zinc-700/50 rounded-md cursor-pointer transition-colors`}
        style={{ paddingLeft: `${level * 24 + 12}px` }}
      >
        {/* Expand/Collapse */}
        {hasChildren && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleNode(user.id);
            }}
            className="mr-2 p-1 hover:bg-gray-200 dark:hover:bg-zinc-600 rounded"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-gray-600 dark:text-zinc-400" />
            ) : (
              <ChevronRight className="h-4 w-4 text-gray-600 dark:text-zinc-400" />
            )}
          </button>
        )}
        {!hasChildren && <div className="w-7 mr-2" />}

        {/* User Info */}
        <div className="flex-1 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {/* Avatar */}
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium ${
              user.role === 'MASTER' ? 'bg-purple-600' :
              user.role === 'ADMIN' ? 'bg-blue-600' :
              user.billingType === 'POSTPAID' ? 'bg-green-600' : 'bg-gray-600'
            }`}>
              {(user.name || user.username || "?").charAt(0).toUpperCase()}
            </div>

            {/* Name and Username */}
            <div>
              <div className="font-medium text-gray-900 dark:text-white">
                {user.name || user.username}
              </div>
              <div className="text-sm text-gray-500 dark:text-zinc-400">
                @{user.username}
              </div>
            </div>

            {/* Badges */}
            <div className="flex items-center space-x-2">
              {/* Role Badge */}
              <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                user.role === 'MASTER' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' :
                user.role === 'ADMIN' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                'bg-gray-100 text-gray-800 dark:bg-zinc-700 dark:text-zinc-300'
              }`}>
                {user.role === 'MASTER' ? 'Master' :
                 user.role === 'ADMIN' ? 'Admin' : 'Revendedor'}
              </span>

              {/* Billing Type Badge */}
              <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                user.billingType === 'POSTPAID' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400'
              }`}>
                {user.billingType === 'POSTPAID' ? 'Pós-Pago' : 'Pré-Pago'}
              </span>

              {/* Status Badge */}
              <span className={`inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor()} bg-opacity-10`}>
                {getStatusIcon()}
                <span className="ml-1">{getStatusText()}</span>
              </span>
            </div>
          </div>

          {/* Stats and Financial */}
          <div className="flex items-center space-x-3">
            {/* Basic Stats */}
            <div className="flex items-center space-x-3 text-sm text-gray-600 dark:text-zinc-400">
              {user._count?.children > 0 && (
                <div className="flex items-center">
                  <Users className="h-4 w-4 mr-1" />
                  {user._count.children} sub-rev
                </div>
              )}
              
              {user._count?.customers > 0 && (
                <div className="flex items-center">
                  <Users className="h-4 w-4 mr-1 text-purple-500" />
                  {user._count.customers} cli
                </div>
              )}

              {user.billingType === 'PREPAID' && (
                <div className="flex items-center">
                  <span className="font-medium">{user.credits}</span> créditos
                </div>
              )}

              {user.dueDate && (
                <div className={`flex items-center ${isOverdue ? 'text-red-600' : 'text-gray-600 dark:text-zinc-400'}`}>
                  <Calendar className="h-4 w-4 mr-1" />
                  {new Date(user.dueDate).toLocaleDateString('pt-BR')}
                </div>
              )}
            </div>

            {/* Financial Info */}
            {user.billingType === 'POSTPAID' && user.financial && (
              <div className="flex items-center space-x-2 text-xs">
                {user.financial.cost > 0 && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 font-medium" title={`Paga R$ ${user.financial.myPricePerClient.toFixed(2)}/cli × ${user.financial.myActiveCustomers} cli`}>
                    <ArrowUpRight className="h-3 w-3 mr-0.5" />
                    Paga R$ {user.financial.cost.toFixed(2)}
                  </span>
                )}
                {user.financial.revenue > 0 && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-medium" title="Receita das sub-revendas">
                    <ArrowDownRight className="h-3 w-3 mr-0.5" />
                    Recebe R$ {user.financial.revenue.toFixed(2)}
                  </span>
                )}
                {(user.financial.revenue > 0 || user.financial.cost > 0) && (
                  <span className={`inline-flex items-center px-2 py-1 rounded-full font-semibold ${
                    user.financial.profit >= 0
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                      : 'bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                  }`} title="Lucro = Receita - Custo">
                    {user.financial.profit >= 0 ? (
                      <TrendingUp className="h-3 w-3 mr-0.5" />
                    ) : (
                      <TrendingDown className="h-3 w-3 mr-0.5" />
                    )}
                    {user.financial.profit >= 0 ? '+' : ''}R$ {user.financial.profit.toFixed(2)}
                  </span>
                )}
              </div>
            )}

            {/* Actions */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(user);
              }}
              className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-sm font-medium"
            >
              Editar
            </button>
          </div>
        </div>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && user.children && (
        <div>
          {user.children.map((child) => (
            <TreeNode
              key={child.id}
              user={child}
              level={level + 1}
              onEdit={onEdit}
              onRefresh={onRefresh}
              expandedNodes={expandedNodes}
              toggleNode={toggleNode}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default function HierarchicalView() {
  const [tree, setTree] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'PREPAID' | 'POSTPAID'>('ALL');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'ACTIVE' | 'BLOCKED'>('ALL');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalCustomers: 0,
    totalResellers: 0,
    blockedUsers: 0,
    overdueUsers: 0,
    totalRevenue: 0,
    totalCost: 0,
    totalProfit: 0,
  });

  const fetchTree = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        ...(searchTerm && { search: searchTerm }),
        ...(filterType !== 'ALL' && { billingType: filterType }),
        ...(filterStatus !== 'ALL' && { 
          status: filterStatus === 'BLOCKED' ? 'BLOCKED' : 'ACTIVE' 
        })
      });

      const response = await api.get(`/users/hierarchy?${params}`);
      setTree(response.data.tree);
      setStats(response.data.stats);
      
      // Auto-expand all nodes
      if (response.data.tree.length > 0) {
        const allIds = new Set<string>();
        const collectIds = (users: User[]) => {
          users.forEach(u => {
            allIds.add(u.id);
            if (u.children) collectIds(u.children);
          });
        };
        collectIds(response.data.tree);
        setExpandedNodes(allIds);
      }
    } catch (error) {
      console.error('Erro ao buscar hierarquia:', error);
      toast.error('Erro ao carregar hierarquia de revendedores');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTree();
  }, [searchTerm, filterType, filterStatus]);

  const toggleNode = (userId: string) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) {
        newSet.delete(userId);
      } else {
        newSet.add(userId);
      }
      return newSet;
    });
  };

  const expandAll = () => {
    const allIds = new Set<string>();
    const collectIds = (users: User[]) => {
      users.forEach(user => {
        allIds.add(user.id);
        if (user.children) {
          collectIds(user.children);
        }
      });
    };
    collectIds(tree);
    setExpandedNodes(allIds);
  };

  const collapseAll = () => {
    setExpandedNodes(new Set());
  };

  const handleEdit = (user: User) => {
    setSelectedUser(user);
    setShowForm(true);
  };

  const handleFormSave = () => {
    setShowForm(false);
    setSelectedUser(null);
    fetchTree();
  };

  const handleNewSubReseller = (parentUser: User) => {
    setSelectedUser(null);
    setShowForm(true);
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Visão Hierárquica</h1>
        <p className="text-gray-600 dark:text-zinc-400">Visualize e gerencie a estrutura de revendedores</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-4">
          <div className="flex items-center">
            <Users className="h-8 w-8 text-blue-500" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-600 dark:text-zinc-400">Total Usuários</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{stats.totalUsers}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-4">
          <div className="flex items-center">
            <Users className="h-8 w-8 text-green-500" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-600 dark:text-zinc-400">Revendedores</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{stats.totalResellers}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-4">
          <div className="flex items-center">
            <Users className="h-8 w-8 text-purple-500" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-600 dark:text-zinc-400">Clientes Ativos</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{stats.totalCustomers}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-4">
          <div className="flex items-center">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-600 dark:text-zinc-400">Bloqueados</p>
              <p className="text-xl font-bold text-red-600">{stats.blockedUsers}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-4">
          <div className="flex items-center">
            <Calendar className="h-8 w-8 text-yellow-500" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-600 dark:text-zinc-400">Vencidos</p>
              <p className="text-xl font-bold text-yellow-600">{stats.overdueUsers}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Financial Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-4 border-l-4 border-green-500">
          <div className="flex items-center">
            <ArrowDownRight className="h-8 w-8 text-green-500" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-600 dark:text-zinc-400">Receita Total (sub-revendas)</p>
              <p className="text-xl font-bold text-green-600">R$ {stats.totalRevenue.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-4 border-l-4 border-red-500">
          <div className="flex items-center">
            <ArrowUpRight className="h-8 w-8 text-red-500" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-600 dark:text-zinc-400">Custo Total (pago ao master)</p>
              <p className="text-xl font-bold text-red-600">R$ {stats.totalCost.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className={`bg-white dark:bg-zinc-800 rounded-lg shadow p-4 border-l-4 ${stats.totalProfit >= 0 ? 'border-blue-500' : 'border-orange-500'}`}>
          <div className="flex items-center">
            {stats.totalProfit >= 0 ? (
              <TrendingUp className="h-8 w-8 text-blue-500" />
            ) : (
              <TrendingDown className="h-8 w-8 text-orange-500" />
            )}
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-600 dark:text-zinc-400">Lucro Estimado</p>
              <p className={`text-xl font-bold ${stats.totalProfit >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                {stats.totalProfit >= 0 ? '+' : ''}R$ {stats.totalProfit.toFixed(2)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">
              Buscar
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Nome, usuário, e-mail..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-zinc-600 dark:bg-zinc-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">
              Tipo de Cobrança
            </label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 dark:bg-zinc-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">Todos</option>
              <option value="PREPAID">Pré-Pago</option>
              <option value="POSTPAID">Pós-Pago</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">
              Status
            </label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 dark:bg-zinc-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">Todos</option>
              <option value="ACTIVE">Ativos</option>
              <option value="BLOCKED">Bloqueados/Vencidos</option>
            </select>
          </div>

          <div className="flex items-end space-x-2">
            <button
              onClick={expandAll}
              className="flex-1 bg-gray-600 text-white px-3 py-2 rounded-md hover:bg-gray-700 text-sm"
            >
              Expandir Tudo
            </button>
            <button
              onClick={collapseAll}
              className="flex-1 bg-gray-600 text-white px-3 py-2 rounded-md hover:bg-gray-700 text-sm"
            >
              Recolher Tudo
            </button>
          </div>
        </div>
      </div>

      {/* Tree */}
      <div className="bg-white dark:bg-zinc-800 rounded-lg shadow overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-zinc-700">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">Estrutura Hierárquica</h3>
            <button
              onClick={() => fetchTree()}
              className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 flex items-center"
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Atualizar
            </button>
          </div>
        </div>

        <div className="max-h-[600px] overflow-y-auto">
          {loading ? (
            <div className="flex justify-center items-center py-12">
              <RefreshCw className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : tree.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-zinc-400">
              Nenhum revendedor encontrado
            </div>
          ) : (
            <div className="py-2">
              {tree.map((user) => (
                <TreeNode
                  key={user.id}
                  user={user}
                  level={0}
                  onEdit={handleEdit}
                  onRefresh={fetchTree}
                  expandedNodes={expandedNodes}
                  toggleNode={toggleNode}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <ResellerForm
          user={selectedUser}
          isOpen={showForm}
          onClose={() => {
            setShowForm(false);
            setSelectedUser(null);
          }}
          onSave={handleFormSave}
        />
      )}
    </div>
  );
}
