import { escapeHtml } from './_escape.js';

export function passwordResetTemplate(params: { link: string; email: string }) {
  const safeLink = escapeHtml(params.link);
  const safeEmail = escapeHtml(params.email);
  return {
    subject: 'xci password reset',
    html: `<p>Hello ${safeEmail},</p><p>A password reset was requested. If this was you, click: <a href="${safeLink}">${safeLink}</a></p><p>Link expires in 1 hour and can only be used once. If you did not request this, ignore this email.</p>`,
    text: `Hello ${params.email},\n\nReset your password: ${params.link}\n\nLink expires in 1 hour, single-use. Ignore if you did not request this.`,
  };
}
