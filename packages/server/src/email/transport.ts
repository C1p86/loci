import nodemailer, { type Transporter } from 'nodemailer';
import { EmailTransportError } from '../errors.js';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailTransport {
  send(msg: EmailMessage): Promise<void>;
  /** Only set when kind === 'stub' — exposed for test inspection. */
  captured?: EmailMessage[];
}

export interface TransportConfig {
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM?: string;
  logger: { info: (obj: object, msg: string) => void };
}

export function createTransport(
  kind: 'log' | 'stub' | 'smtp',
  cfg: TransportConfig,
): EmailTransport {
  if (kind === 'log') {
    return {
      async send(msg) {
        // D-10: never log body or html — only {to, subject} metadata
        cfg.logger.info({ to: msg.to, subject: msg.subject }, '[email:log] would send');
      },
    };
  }
  if (kind === 'stub') {
    const captured: EmailMessage[] = [];
    return {
      captured,
      async send(msg) {
        captured.push(msg);
      },
    };
  }
  // kind === 'smtp'
  if (!cfg.SMTP_HOST || !cfg.SMTP_FROM) {
    throw new EmailTransportError('EMAIL_TRANSPORT=smtp requires SMTP_HOST and SMTP_FROM env vars');
  }
  const transporter: Transporter = nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT ?? 587,
    secure: false, // STARTTLS auto-upgrade via Nodemailer
    ...(cfg.SMTP_USER !== undefined && {
      auth: { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS ?? '' },
    }),
  });
  const from = cfg.SMTP_FROM;
  return {
    async send(msg) {
      try {
        await transporter.sendMail({
          from,
          to: msg.to,
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
        });
      } catch (cause) {
        throw new EmailTransportError('SMTP send failed', cause);
      }
    },
  };
}
