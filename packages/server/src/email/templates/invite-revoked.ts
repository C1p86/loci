import { escapeHtml } from './_escape.js';

export function inviteRevokedTemplate(params: { orgName: string; revokerEmail: string }) {
  const safeOrg = escapeHtml(params.orgName);
  const safeRevoker = escapeHtml(params.revokerEmail);
  return {
    subject: `Your invite to ${params.orgName} was revoked`,
    html: `<p>${safeRevoker} has revoked your pending invitation to join ${safeOrg}.</p><p>No action is needed.</p>`,
    text: `${params.revokerEmail} has revoked your pending invitation to join ${params.orgName} on xci.`,
  };
}
