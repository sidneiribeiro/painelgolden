import { formatCurrency, formatDate } from './formatters.js';

export interface TemplateData {
  username: string;
  password: string;
  name?: string;
  package: string;
  plan_price: number;
  expires_at: string;
  days_until_expiry?: number;
  renew_url?: string;
  m3u_url?: string;
  xmltv_url?: string;
  xc_api_url?: string;
  invoice_url?: string;
  checkout_url?: string;
  pix_copy_paste?: string;
  due_date?: string;
  server?: string;
  connections?: number;
}

/**
 * Processa template substituindo variáveis
 */
export function processTemplate(template: string, data: TemplateData): string {
  return template
    .replace(/{username}/g, data.username)
    .replace(/{password}/g, data.password)
    .replace(/{name}/g, data.name || 'Cliente')
    .replace(/{package}/g, data.package)
    .replace(/{plan_price}/g, formatCurrency(data.plan_price))
    .replace(/{expires_at}/g, formatDate(data.expires_at))
    .replace(/{days_until_expiry}/g, String(data.days_until_expiry ?? 0))
    .replace(/{renew_url}/g, data.renew_url || '')
    .replace(/{pay_url}/g, data.renew_url || '')
    .replace(/{m3u_url}/g, data.m3u_url || '')
    .replace(/{xmltv_url}/g, data.xmltv_url || '')
    .replace(/{xc_api_url}/g, data.xc_api_url || '')
    .replace(/{invoice_url}/g, data.invoice_url || '')
    .replace(/{checkout_url}/g, data.checkout_url || '')
    .replace(/{pix}/g, data.pix_copy_paste || '')
    .replace(/{pix_copy_paste}/g, data.pix_copy_paste || '')
    .replace(/{due_date}/g, data.due_date ? formatDate(data.due_date) : '')
    .replace(/{server}/g, data.server || '')
    .replace(/{connections}/g, String(data.connections ?? 1));
}

// Templates padrão
export const defaultTemplates = {
  reminder7Days: `Olá {name} 👋

Sua assinatura *{package}* vence em *7 dias*!

📅 Vencimento: {expires_at}
💰 Valor: {plan_price}

Renove agora e evite interrupções:

👉 {renew_url}

📺 Painel IPTV`,

  reminder3Days: `⚠️ *ATENÇÃO* ⚠️

Olá {name}!

Sua assinatura vence em *3 dias*!

📦 Plano: {package}
📅 Vencimento: {expires_at}
💰 Valor: {plan_price}

Renove agora:
👉 {renew_url}

📺 Painel IPTV`,

  reminder1Day: `⚠️ *ÚLTIMO AVISO* ⚠️

{name}, sua assinatura vence *AMANHÃ*!

Renove AGORA para não perder seu acesso:
👉 {renew_url}

📦 Plano: {package}
💰 Valor: {plan_price}

📺 Painel IPTV`,

  reminderToday: `🚨 *VENCIMENTO HOJE* 🚨

{name}, sua assinatura vence HOJE!

⚡ Renove imediatamente para evitar interrupção:
👉 {renew_url}

📦 Plano: {package}
💰 Valor: {plan_price}

📺 Painel IPTV`,

  renewalConfirmation: `✅ *Renovação Confirmada!*

Olá {name}!

Sua assinatura foi renovada com sucesso!

👤 Usuário: {username}
🔑 Senha: {password}
📅 Novo vencimento: {expires_at}
📦 Plano: {package}

Obrigado pela preferência!
📺 Painel IPTV`,

  welcome: `🎉 *Bem-vindo ao Painel IPTV!*

Olá {name}!

Seus dados de acesso:

👤 Usuário: {username}
🔑 Senha: {password}
📦 Plano: {package}
📅 Vencimento: {expires_at}

📺 Link M3U:
{m3u_url}

Aproveite!
📺 Painel IPTV`,

  welcomeTrial: `🎁 *Teste Ativado!*

Olá {name}!

Seu teste foi ativado com sucesso!

👤 Usuário: {username}
🔑 Senha: {password}
📅 Expira em: {expires_at}

📺 Link M3U:
{m3u_url}

Aproveite seu teste!
📺 Painel IPTV`,
};

/**
 * Retorna template baseado em dias até vencimento
 */
export function getReminderTemplate(daysUntilExpiry: number): string {
  if (daysUntilExpiry === 0) return defaultTemplates.reminderToday;
  if (daysUntilExpiry === 1) return defaultTemplates.reminder1Day;
  if (daysUntilExpiry <= 3) return defaultTemplates.reminder3Days;
  return defaultTemplates.reminder7Days;
}
