import React, { useState, useEffect } from 'react';
import { Save, X, Calendar, DollarSign, Users, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import { toast } from 'react-hot-toast';
import api from '../api/client';

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
  parentId?: string;
}

interface ResellerFormProps {
  user?: User;
  isOpen: boolean;
  onClose: () => void;
  onSave: (user: User) => void;
  parentUser?: User;
}

export default function ResellerForm({ user, isOpen, onClose, onSave, parentUser }: ResellerFormProps) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    name: '',
    email: '',
    password: '',
    whatsapp: '',
    telegram: '',
    role: 'RESELLER' as 'RESELLER' | 'ADMIN',
    billingType: 'PREPAID' as 'PREPAID' | 'POSTPAID',
    dueDate: '',
    customerPrice: '',
    billingCycleDays: '30',
    credits: '0',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
    parentId: ''
  });

  const [showBillingFields, setShowBillingFields] = useState(false);

  useEffect(() => {
    if (user) {
      setFormData({
        username: user.username || '',
        name: user.name || '',
        email: user.email || '',
        password: '',
        whatsapp: '',
        telegram: '',
        role: user.role as 'RESELLER' | 'ADMIN' || 'RESELLER',
        billingType: user.billingType || 'PREPAID',
        dueDate: user.dueDate ? new Date(user.dueDate).toISOString().split('T')[0] : '',
        customerPrice: user.customerPrice?.toString() || '',
        billingCycleDays: user.billingCycleDays?.toString() || '30',
        credits: user.credits?.toString() || '0',
        status: user.status as 'ACTIVE' | 'INACTIVE' || 'ACTIVE',
        parentId: user.parentId || ''
      });
      setShowBillingFields(user.billingType === 'POSTPAID');
    } else if (parentUser) {
      setFormData(prev => ({
        ...prev,
        parentId: parentUser.id,
        // Herdar tipo de cobrança do pai
        billingType: parentUser.billingType || 'PREPAID'
      }));
      setShowBillingFields(parentUser.billingType === 'POSTPAID');
    }
  }, [user, parentUser]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const payload: any = {
        username: formData.username,
        name: formData.name,
        email: formData.email,
        role: formData.role,
        status: formData.status,
        billingType: formData.billingType,
        parentId: formData.parentId || null
      };

      // Adicionar campos específicos por tipo
      if (formData.billingType === 'PREPAID') {
        payload.credits = Number(formData.credits);
        payload.creditsReadonly = false;
      } else {
        payload.dueDate = formData.dueDate ? new Date(formData.dueDate).toISOString() : null;
        payload.customerPrice = formData.customerPrice ? Number(formData.customerPrice) : null;
        payload.billingCycleDays = Number(formData.billingCycleDays);
      }

      // Adicionar senha apenas se for novo usuário ou se foi preenchida
      if (formData.password) {
        payload.password = formData.password;
      }

      // Adicionar campos de contato se preenchidos
      if (formData.whatsapp) payload.whatsapp = formData.whatsapp;
      if (formData.telegram) payload.telegram = formData.telegram;

      let response;
      if (user) {
        response = await api.put(`/users/${user.id}`, payload);
        toast.success('Revendedor atualizado com sucesso!');
      } else {
        response = await api.post('/users', payload);
        toast.success('Revendedor criado com sucesso!');
      }

      onSave(response.data.user);
      onClose();
    } catch (error: any) {
      console.error('Erro ao salvar revendedor:', error);
      toast.error(error.response?.data?.error || 'Erro ao salvar revendedor');
    } finally {
      setLoading(false);
    }
  };

  const handleBillingTypeChange = (type: 'PREPAID' | 'POSTPAID') => {
    setFormData(prev => ({ ...prev, billingType: type }));
    setShowBillingFields(type === 'POSTPAID');
  };

  const calculatePreview = () => {
    if (formData.billingType !== 'POSTPAID' || !formData.customerPrice) return null;
    
    // Simulação - em produção buscaria do backend
    const activeCustomers = 10; // Placeholder
    const totalToPay = Number(formData.customerPrice) * activeCustomers;
    
    return { activeCustomers, totalToPay };
  };

  if (!isOpen) return null;

  const preview = calculatePreview();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-gray-900">
              {user ? 'Editar Revendedor' : 'Novo Revendedor'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Dados Básicos */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Usuário *
                </label>
                <input
                  type="text"
                  required
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  disabled={!!user}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  E-mail *
                </label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {!user && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Senha *
                  </label>
                  <input
                    type="password"
                    required
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  WhatsApp
                </label>
                <input
                  type="text"
                  value={formData.whatsapp}
                  onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value })}
                  placeholder="+55 00 00000-0000"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Telegram
                </label>
                <input
                  type="text"
                  value={formData.telegram}
                  onChange={(e) => setFormData({ ...formData, telegram: e.target.value })}
                  placeholder="@username"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tipo de Acesso
                </label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="RESELLER">Revendedor</option>
                  <option value="ADMIN">Administrador</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ACTIVE">Ativo</option>
                  <option value="INACTIVE">Inativo</option>
                </select>
              </div>
            </div>

            {/* Tipo de Cobrança */}
            <div className="border-t pt-4">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Tipo de Cobrança</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Selecione o modelo
                  </label>
                  <div className="space-y-2">
                    <label className="flex items-center p-3 border rounded-md cursor-pointer hover:bg-gray-50">
                      <input
                        type="radio"
                        name="billingType"
                        value="PREPAID"
                        checked={formData.billingType === 'PREPAID'}
                        onChange={() => handleBillingTypeChange('PREPAID')}
                        className="mr-3"
                      />
                      <div>
                        <div className="font-medium">Pré-Pago</div>
                        <div className="text-sm text-gray-500">Compra de créditos antecipados</div>
                      </div>
                    </label>

                    <label className="flex items-center p-3 border rounded-md cursor-pointer hover:bg-gray-50">
                      <input
                        type="radio"
                        name="billingType"
                        value="POSTPAID"
                        checked={formData.billingType === 'POSTPAID'}
                        onChange={() => handleBillingTypeChange('POSTPAID')}
                        className="mr-3"
                      />
                      <div>
                        <div className="font-medium">Pós-Pago</div>
                        <div className="text-sm text-gray-500">Pagamento por cliente ativo</div>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Campos específicos do tipo */}
                <div>
                  {formData.billingType === 'PREPAID' ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Créditos Iniciais
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={formData.credits}
                        onChange={(e) => setFormData({ ...formData, credits: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          <Calendar className="inline h-4 w-4 mr-1" />
                          Data de Vencimento
                        </label>
                        <input
                          type="date"
                          value={formData.dueDate}
                          onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          <DollarSign className="inline h-4 w-4 mr-1" />
                          Preço por Cliente (R$)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={formData.customerPrice}
                          onChange={(e) => setFormData({ ...formData, customerPrice: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Ciclo de Cobrança (dias)
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={formData.billingCycleDays}
                          onChange={(e) => setFormData({ ...formData, billingCycleDays: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Preview para pós-pago */}
              {preview && (
                <div className="mt-4 p-4 bg-blue-50 rounded-md">
                  <h4 className="font-medium text-blue-900 mb-2">
                    <Users className="inline h-4 w-4 mr-1" />
                    Simulação de Cobrança
                  </h4>
                  <div className="text-sm text-blue-800">
                    <div>Clientes ativos (simulação): {preview.activeCustomers}</div>
                    <div>Total a pagar: R$ {preview.totalToPay.toFixed(2)}</div>
                  </div>
                </div>
              )}
            </div>

            {/* Avisos */}
            {parentUser && parentUser.billingType && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                <div className="flex">
                  <AlertCircle className="h-5 w-5 text-yellow-600 mr-2 flex-shrink-0" />
                  <div className="text-sm text-yellow-800">
                    <strong>Atenção:</strong> Este revendedor herdarará o tipo de cobrança do pai (
                    {parentUser.billingType === 'PREPAID' ? 'Pré-Pago' : 'Pós-Pago'}). 
                    Não é possível misturar tipos na mesma hierarquia.
                  </div>
                </div>
              </div>
            )}

            {/* Botões */}
            <div className="flex justify-end space-x-3 pt-4 border-t">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center"
              >
                {loading ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                {user ? 'Atualizar' : 'Criar'} Revendedor
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
