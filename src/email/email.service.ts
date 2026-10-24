import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/**
 * Envío de correos. Si hay configuración SMTP (p. ej. Zoho), envía de verdad;
 * si no, cae a modo "log" y registra el contenido (útil en desarrollo).
 *
 * Variables de entorno (todas opcionales; sin ellas = modo log):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE ("true"/"false"),
 *   SMTP_FROM (remitente, p. ej. "Undead Grid <no-reply@tudominio.com>")
 *   APP_WEB_URL (base pública del front para construir enlaces)
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    if (host && user && pass) {
      const port = Number(this.config.get<string>('SMTP_PORT') ?? 465);
      const secure = (this.config.get<string>('SMTP_SECURE') ?? 'true') === 'true';
      this.transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
      this.logger.log(`SMTP configurado (${host}:${port})`);
    } else {
      this.logger.warn('SMTP no configurado: los correos se registrarán en el log (modo desarrollo).');
    }
  }

  private from(): string {
    return (
      this.config.get<string>('SMTP_FROM') ??
      this.config.get<string>('SMTP_USER') ??
      'Undead Grid <no-reply@undeadgrid.local>'
    );
  }

  private webUrl(): string {
    return (this.config.get<string>('APP_WEB_URL') ?? 'https://undeadgrid.axiorapath.com.mx').replace(/\/$/, '');
  }

  /** Envía (o registra) el correo de recuperación de contraseña. */
  async sendPasswordReset(to: string, token: string): Promise<void> {
    const link = `${this.webUrl()}/recuperar?token=${encodeURIComponent(token)}`;
    const subject = 'Restablece tu contraseña — Undead Grid';
    const text = `Recibimos una solicitud para restablecer tu contraseña.\n\nAbre este enlace para elegir una nueva (válido 1 hora):\n${link}\n\nSi no fuiste tú, ignora este correo.`;
    const html = `
      <div style="font-family:system-ui,sans-serif;background:#0b0f17;color:#e8ecf2;padding:24px">
        <h1 style="color:#ff2a2f">UNDEAD GRID</h1>
        <h2>Restablece tu contraseña</h2>
        <p>Recibimos una solicitud para restablecer tu contraseña.</p>
        <p><a href="${link}" style="display:inline-block;background:#c4161c;color:#fff;padding:12px 20px;text-decoration:none">Elegir nueva contraseña</a></p>
        <p style="color:#a9b4c4">El enlace es válido durante 1 hora. Si no fuiste tú, ignora este correo.</p>
      </div>`;

    if (!this.transporter) {
      this.logger.warn(`[EMAIL-LOG] Para: ${to}\nAsunto: ${subject}\nEnlace: ${link}`);
      return;
    }
    await this.transporter.sendMail({ from: this.from(), to, subject, text, html });
    this.logger.log(`Correo de recuperación enviado a ${to}`);
  }
}
