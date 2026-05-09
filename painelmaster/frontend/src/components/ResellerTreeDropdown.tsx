import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';

interface TreeUser {
  id: string;
  username: string;
  name: string;
  _count?: { children: number; customers: number };
  children?: TreeUser[];
}

interface FlatOption {
  id: string;
  label: string;
  username: string;
  depth: number;
  customers: number;
}

interface ResellerTreeDropdownProps {
  value: string;
  onChange: (userId: string, username: string) => void;
  placeholder?: string;
  className?: string;
  showAllOption?: boolean;
  allOptionLabel?: string;
}

function flattenTree(nodes: TreeUser[], parentPath = 'admin', depth = 0): FlatOption[] {
  const result: FlatOption[] = [];
  for (const node of nodes) {
    const path = depth === 0 ? `admin > ${node.username}` : `${parentPath} > ${node.username}`;
    result.push({
      id: node.id,
      label: path,
      username: node.username,
      depth,
      customers: node._count?.customers || 0,
    });
    if (node.children && node.children.length > 0) {
      result.push(...flattenTree(node.children, path, depth + 1));
    }
  }
  return result;
}

export function ResellerTreeDropdown({
  value,
  onChange,
  placeholder = 'Selecione um revendedor...',
  className = '',
  showAllOption = true,
  allOptionLabel = 'Todos os revendedores',
}: ResellerTreeDropdownProps) {
  const [options, setOptions] = useState<FlatOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchTree = async () => {
      try {
        const res = await api.get('/users/hierarchy');
        const tree: TreeUser[] = res.data.tree || [];
        const flat = flattenTree(tree);
        setOptions(flat);
      } catch (err) {
        console.error('Erro ao carregar hierarquia:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchTree();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = options.filter(
    (opt) =>
      !search ||
      opt.username.toLowerCase().includes(search.toLowerCase()) ||
      opt.label.toLowerCase().includes(search.toLowerCase())
  );

  const selectedOption = options.find((o) => o.id === value);
  const displayText = selectedOption ? selectedOption.label : (value ? value : '');

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) setTimeout(() => inputRef.current?.focus(), 50);
        }}
        className="w-full flex items-center justify-between px-3 py-2 text-sm border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors"
      >
        <span className={`truncate ${!value ? 'text-zinc-500 dark:text-zinc-400' : ''}`}>
          {value ? displayText : placeholder}
        </span>
        <svg className={`w-4 h-4 ml-2 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full min-w-[400px] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl max-h-80 overflow-hidden">
          <div className="p-2 border-b border-zinc-200 dark:border-zinc-700">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar revendedor..."
              className="w-full px-3 py-1.5 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="overflow-y-auto max-h-64">
            {loading ? (
              <div className="p-4 text-center text-zinc-500 text-sm">Carregando...</div>
            ) : (
              <>
                {showAllOption && (
                  <button
                    type="button"
                    onClick={() => {
                      onChange('', '');
                      setIsOpen(false);
                      setSearch('');
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors ${
                      !value ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-medium' : 'text-zinc-700 dark:text-zinc-300'
                    }`}
                  >
                    {allOptionLabel}
                  </button>
                )}

                {filtered.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      onChange(opt.id, opt.username);
                      setIsOpen(false);
                      setSearch('');
                    }}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors flex items-center justify-between ${
                      value === opt.id
                        ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-medium'
                        : 'text-zinc-700 dark:text-zinc-300'
                    }`}
                  >
                    <span className="truncate font-mono text-xs">{opt.label}</span>
                    {opt.customers > 0 && (
                      <span className="ml-2 text-xs text-zinc-400 whitespace-nowrap">
                        {opt.customers} cli
                      </span>
                    )}
                  </button>
                ))}

                {filtered.length === 0 && !loading && (
                  <div className="p-4 text-center text-zinc-500 text-sm">
                    Nenhum revendedor encontrado
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
