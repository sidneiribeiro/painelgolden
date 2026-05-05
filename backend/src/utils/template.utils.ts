/**
 * Utilitários para formatação de templates de acesso
 */

export interface CustomerTemplateData {
  username: string;
  password: string;
  dns?: string;
  m3uUrl?: string;
  expiresAt: Date;
  connections: number;
  name?: string;
  packageName?: string;
}

/**
 * Formata data para exibição
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Formata data completa para exibição
 */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Template padrão XCIPTV/Smarters
 */
export function generateXciptvTemplate(data: CustomerTemplateData, customTemplate?: string): string {
  if (customTemplate) {
    return formatTemplate(customTemplate, data);
  }

  const template = `📺 *DADOS DE ACESSO - IPTV*

👤 *Usuário:* ${data.username}
🔑 *Senha:* ${data.password}

📱 *Configuração para XCIPTV:*
🌐 DNS: ${data.dns || 'Não configurado'}
👤 Usuário: ${data.username}
🔑 Senha: ${data.password}

🔗 *Link M3U:*
${data.m3uUrl || 'Não disponível'}

📅 Vencimento: ${formatDate(data.expiresAt)}
📶 Conexões: ${data.connections}`;

  return template;
}

/**
 * Template para Aplicativo Parceiro
 */
export function generateAppParceiroTemplate(data: CustomerTemplateData, customTemplate?: string): string {
  if (customTemplate) {
    return formatTemplate(customTemplate, data);
  }

  const template = `🎬 *SEU ACESSO FOI CRIADO!*

📱 *DADOS PARA O APLICATIVO*
🌐 Servidor: ${data.dns || 'Não configurado'}
👤 Login: ${data.username}
🔑 Senha: ${data.password}

📅 Válido até: ${formatDate(data.expiresAt)}
📶 Dispositivos: ${data.connections}`;

  return template;
}

/**
 * Template completo (padrão)
 */
export function generateCompleteTemplate(data: CustomerTemplateData, customTemplate?: string): string {
  if (customTemplate) {
    return formatTemplate(customTemplate, data);
  }

  const template = `📺 *ACESSO IPTV CRIADO COM SUCESSO!*

👤 *Usuário:* ${data.username}
🔑 *Senha:* ${data.password}
📦 *Pacote:* ${data.packageName || 'Não informado'}

📱 *Para XCIPTV/Smarters:*
🌐 DNS: ${data.dns || 'Não configurado'}
👤 Usuário: ${data.username}
🔑 Senha: ${data.password}

🔗 *Link M3U:*
${data.m3uUrl || 'Não disponível'}

📅 *Vencimento:* ${formatDate(data.expiresAt)}
📶 *Conexões simultâneas:* ${data.connections}

⚠️ *Importante:* Não compartilhe suas credenciais!`;

  return template;
}

/**
 * Substitui variáveis no template
 */
function formatTemplate(template: string, data: CustomerTemplateData): string {
  return template
    .replace(/\$\{username\}/g, data.username)
    .replace(/\$\{password\}/g, data.password)
    .replace(/\$\{dns\}/g, data.dns || 'Não configurado')
    .replace(/\$\{m3uUrl\}/g, data.m3uUrl || 'Não disponível')
    .replace(/\$\{expiresAt\}/g, formatDate(data.expiresAt))
    .replace(/\$\{expiresAtFull\}/g, formatDateTime(data.expiresAt))
    .replace(/\$\{connections\}/g, String(data.connections))
    .replace(/\$\{name\}/g, data.name || 'Cliente')
    .replace(/\$\{packageName\}/g, data.packageName || 'Não informado');
}

/**
 * Detecta tipo de template baseado no conteúdo
 */
export function detectTemplateType(template: string): 'xciptv' | 'app-parceiro' | 'complete' {
  const lower = template.toLowerCase();
  
  if (lower.includes('xciptv') || lower.includes('smarters')) {
    return 'xciptv';
  }
  
  if (lower.includes('aplicativo') || lower.includes('app parceiro')) {
    return 'app-parceiro';
  }
  
  return 'complete';
}


