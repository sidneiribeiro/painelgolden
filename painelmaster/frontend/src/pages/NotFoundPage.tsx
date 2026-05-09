import { Link } from 'react-router-dom';
import { Button, Card } from '../components/ui';

export function NotFoundPage() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6">
      <Card className="p-8 text-center max-w-md">
        <span className="text-6xl mb-4 block">🔍</span>
        <h1 className="text-2xl font-bold text-white mb-2">Página não encontrada</h1>
        <p className="text-zinc-400 mb-6">
          A página que você está procurando não existe ou foi movida.
        </p>
        <Link to="/">
          <Button>🏠 Voltar ao início</Button>
        </Link>
      </Card>
    </div>
  );
}

export default NotFoundPage;
