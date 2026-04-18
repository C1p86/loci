import { escapeHtml } from './_escape.js';

export function inviteTemplate(params: {
  link: string;
  orgName: string;
  inviterEmail: string;
  role: 'member' | 'viewer';
}) {
  const { link, orgName, inviterEmail, role } = params;
  const safeLink = escapeHtml(link);
  const safeOrg = escapeHtml(orgName);
  const safeInviter = escapeHtml(inviterEmail);
  return {
    subject: `You've been invited to join ${orgName} on xci`,
    html: `<p>${safeInviter} invited you to join <strong>${safeOrg}</strong> as a ${role}.</p><p><a href="${safeLink}">${safeLink}</a></p><p>This link expires in 7 days.</p>`,
    text: `${inviterEmail} invited you to join ${orgName} on xci as a ${role}.\n\nAccept: ${link}\n\nLink expires in 7 days.`,
  };
}
