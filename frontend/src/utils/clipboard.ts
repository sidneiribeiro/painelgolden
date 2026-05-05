/**
 * Utilitário para copiar texto para a área de transferência
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // Método moderno
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    
    // Fallback para navegadores antigos
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    
    try {
      const result = document.execCommand('copy');
      document.body.removeChild(textarea);
      return result;
    } catch (err) {
      document.body.removeChild(textarea);
      throw err;
    }
  } catch (err) {
    console.error('Falha ao copiar:', err);
    return false;
  }
}

