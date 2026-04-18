import { escapeHtml } from './_escape.js';

export function roleChangedTemplate(params: {
  orgName: string;
  newRole: 'owner' | 'member' | 'viewer';
  changedByEmail: string;
}) {
  const safeOrg = escapeHtml(params.orgName);
  const safeChanger = escapeHtml(params.changedByEmail);
  return {
    subject: `Your role in ${params.orgName} changed`,
    html: `<p>${safeChanger} set your role in ${safeOrg} to <strong>${params.newRole}</strong>.</p>`,
    text: `${params.changedByEmail} set your role in ${params.orgName} to ${params.newRole}.`,
  };
}
