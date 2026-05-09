interface PaginationProps {
  currentPage: number;
  lastPage: number;
  total: number;
  from: number;
  to: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ currentPage, lastPage, total, from, to, onPageChange }: PaginationProps) {
  const pages = [];
  const maxVisiblePages = 5;

  // Calcula quais páginas mostrar
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(lastPage, startPage + maxVisiblePages - 1);

  if (endPage - startPage < maxVisiblePages - 1) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
      <div className="flex items-center gap-2">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Mostrando <span className="font-medium text-zinc-900 dark:text-white">{from}</span> -{' '}
          <span className="font-medium text-zinc-900 dark:text-white">{to}</span> de{' '}
          <span className="font-medium text-zinc-900 dark:text-white">{total}</span>
        </p>
      </div>

      <div className="flex items-center gap-1">
        {/* Botão Anterior */}
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="px-3 py-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Anterior
        </button>

        {/* Primeira página */}
        {startPage > 1 && (
          <>
            <button
              onClick={() => onPageChange(1)}
              className="px-3 py-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
            >
              1
            </button>
            {startPage > 2 && <span className="px-2 text-zinc-500">...</span>}
          </>
        )}

        {/* Páginas visíveis */}
        {pages.map((page) => (
          <button
            key={page}
            onClick={() => onPageChange(page)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md border transition-colors ${
              page === currentPage
                ? 'bg-blue-600 text-white border-blue-600 dark:bg-cyan-600 dark:border-cyan-600'
                : 'text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-700'
            }`}
          >
            {page}
          </button>
        ))}

        {/* Última página */}
        {endPage < lastPage && (
          <>
            {endPage < lastPage - 1 && <span className="px-2 text-zinc-500">...</span>}
            <button
              onClick={() => onPageChange(lastPage)}
              className="px-3 py-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
            >
              {lastPage}
            </button>
          </>
        )}

        {/* Botão Próximo */}
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === lastPage}
          className="px-3 py-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Próximo
        </button>
      </div>
    </div>
  );
}

