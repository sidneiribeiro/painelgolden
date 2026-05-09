import { useState } from 'react';
import { copyToClipboard } from '../utils/clipboard';
import toast from 'react-hot-toast';
import { Button } from './ui/Button';
import { cn } from '../utils/cn';

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
  variant?: 'default' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

export function CopyButton({ 
  text, 
  label = 'Copiar', 
  className,
  variant = 'outline',
  size = 'sm',
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const success = await copyToClipboard(text);
    
    if (success) {
      setCopied(true);
      toast.success('Copiado!');
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error('Falha ao copiar');
    }
  };

  return (
    <Button
      onClick={handleCopy}
      variant={variant}
      size={size}
      className={cn('gap-2', className)}
    >
      {copied ? (
        <>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>Copiado!</span>
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <span>{label}</span>
        </>
      )}
    </Button>
  );
}

