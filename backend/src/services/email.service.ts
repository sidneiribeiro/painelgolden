import nodemailer from 'nodemailer';
import { logger } from '../utils/logger.js';
import type { EmailPayload } from '../types/index.js';

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from?: string;
}

class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private config: SmtpConfig | null = null;

  /**
   * Configura o transporter SMTP
   */
  configure(config: SmtpConfig): void {
    this.config = config;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });
  }

  /**
   * Envia email
   */
  async send(payload: EmailPayload, config?: SmtpConfig): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      let transporter = this.transporter;

      // Se config fornecido, criar transporter temporário
      if (config) {
        transporter = nodemailer.createTransport({
          host: config.host,
          port: config.port,
          secure: config.port === 465,
          auth: {
            user: config.user,
            pass: config.pass,
          },
        });
      }

      if (!transporter) {
        return { success: false, error: 'SMTP não configurado' };
      }

      const from = config?.from || this.config?.from || config?.user || this.config?.user;

      const info = await transporter.sendMail({
        from: `Painel IPTV <${from}>`,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
      });

      logger.info(`[Email] Enviado para ${payload.to}: ${info.messageId}`);

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro ao enviar email';
      logger.error('[Email] Erro:', error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Verifica conexão SMTP
   */
  async verify(config?: SmtpConfig): Promise<{ valid: boolean; error?: string }> {
    try {
      let transporter = this.transporter;

      if (config) {
        transporter = nodemailer.createTransport({
          host: config.host,
          port: config.port,
          secure: config.port === 465,
          auth: {
            user: config.user,
            pass: config.pass,
          },
        });
      }

      if (!transporter) {
        return { valid: false, error: 'SMTP não configurado' };
      }

      await transporter.verify();
      return { valid: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro de conexão SMTP';
      return { valid: false, error: errorMessage };
    }
  }

  /**
   * Gera HTML de email a partir de template
   */
  generateHtml(template: string, variables: Record<string, string>): string {
    let html = template;

    for (const [key, value] of Object.entries(variables)) {
      html = html.replace(new RegExp(`{${key}}`, 'g'), value);
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
            border-radius: 10px 10px 0 0;
          }
          .content {
            background: #fff;
            padding: 30px;
            border: 1px solid #e5e5e5;
          }
          .footer {
            background: #f5f5f5;
            padding: 20px;
            text-align: center;
            font-size: 12px;
            color: #666;
            border-radius: 0 0 10px 10px;
          }
          .button {
            display: inline-block;
            background: #667eea;
            color: white;
            padding: 12px 30px;
            text-decoration: none;
            border-radius: 5px;
            margin: 20px 0;
          }
          .highlight {
            background: #f0f0f0;
            padding: 15px;
            border-radius: 5px;
            font-family: monospace;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>📺 Painel IPTV</h1>
        </div>
        <div class="content">
          ${html}
        </div>
        <div class="footer">
          Este é um email automático. Por favor, não responda.
        </div>
      </body>
      </html>
    `;
  }
}

export const emailService = new EmailService();

