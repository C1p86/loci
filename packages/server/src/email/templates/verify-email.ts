import { escapeHtml } from './_escape.js';

export function verifyEmailTemplate(params: { link: string; email: string }) {
  const { link, email } = params;
  const safeLink = escapeHtml(link);
  const safeEmail = escapeHtml(email);
  return {
    subject: 'Verify your xci email',
    html: `<p>Hello ${safeEmail},</p><p>Click to verify your account: <a href="${safeLink}">${safeLink}</a></p><p>Link expires in 24 hours.</p>`,
    text: `Hello ${email},\n\nVerify your account: ${link}\n\nLink expires in 24 hours.`,
  };
}
