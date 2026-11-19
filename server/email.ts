import crypto from 'node:crypto';
import { captureServerException } from './monitoring';

export interface OutboundEmail {
  id: string;
  to_email: string;
  subject: string;
  text: string;
  action_url: string;
  provider: 'local_outbox' | 'resend_webhook';
  created_at: string;
}

function escapeHtmlBasic(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function dispatchEmail(params: {
  to: string;
  subject: string;
  text: string;
  actionUrl: string;
  ctaLabel?: string;
  unsubscribeUrl?: string;
  recordOutbox: (entry: OutboundEmail) => Promise<void> | void;
}): Promise<{ delivered: boolean; provider: 'local_outbox' | 'resend_webhook'; previewUrl?: string }> {
  const entry: OutboundEmail = {
    id: `mail-${crypto.randomUUID().slice(0, 8)}`,
    to_email: params.to,
    subject: params.subject,
    text: params.unsubscribeUrl ? `${params.text}\n\nUnsubscribe: ${params.unsubscribeUrl}` : params.text,
    action_url: params.actionUrl,
    provider: 'local_outbox',
    created_at: new Date().toISOString(),
  };

  const resendKey = process.env.RESEND_API_KEY?.trim();
  const fromEmail = process.env.EMAIL_FROM?.trim() || 'StrangeTheory <noreply@strangetheory.app>';
  const ctaLabel = params.ctaLabel || 'Continue to StrangeTheory';

  if (resendKey) {
    try {
      const safeText = escapeHtmlBasic(params.text).replace(/\n/g, '<br/>');
      const safeUrl = escapeHtmlBasic(params.actionUrl);
      const safeSubject = escapeHtmlBasic(params.subject);
      const safeCta = escapeHtmlBasic(ctaLabel);
      const safeUnsub = params.unsubscribeUrl ? escapeHtmlBasic(params.unsubscribeUrl) : '';
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [params.to],
          subject: params.subject,
          text: `${params.text}\n\nOpen link: ${params.actionUrl}${params.unsubscribeUrl ? `\n\nUnsubscribe: ${params.unsubscribeUrl}` : ''}`,
          html: `<div style="font-family:system-ui,-apple-system,sans-serif;background:#070B14;color:#F1F5F9;padding:32px;border-radius:12px;">
            <h2 style="margin:0 0 12px;color:#22D3EE;">${safeSubject}</h2>
            <p style="line-height:1.6;color:#CBD5E1;">${safeText}</p>
            <p style="margin:24px 0;"><a href="${safeUrl}" style="display:inline-block;background:#22D3EE;color:#020617;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px;">${safeCta}</a></p>
            <p style="font-size:12px;color:#64748B;">If the button does not work, open this link:<br/><a href="${safeUrl}" style="color:#94A3B8;">${safeUrl}</a></p>
            ${safeUnsub ? `<p style="margin-top:20px;padding-top:16px;border-top:1px solid #1E293B;font-size:12px;color:#64748B;">Don&apos;t want The Weekly Synapse? <a href="${safeUnsub}" style="color:#94A3B8;">Unsubscribe with one click</a>.</p>` : ''}
          </div>`,
        }),
      });
      if (resp.ok) {
        entry.provider = 'resend_webhook';
        await params.recordOutbox(entry);
        return { delivered: true, provider: 'resend_webhook' };
      }
      const errText = await resp.text().catch(() => '');
      console.error(`Resend API error (${resp.status}): ${errText}`);
      captureServerException(new Error(`Resend API error ${resp.status}: ${errText}`), { route: 'email' });
    } catch (err) {
      console.error('Resend API dispatch failed:', err);
      captureServerException(err, { route: 'email' });
    }
  }

  await params.recordOutbox(entry);
  const isDev = process.env.NODE_ENV !== 'production';
  return {
    delivered: !isDev || Boolean(resendKey),
    provider: 'local_outbox',
    ...(isDev ? { previewUrl: params.actionUrl } : {}),
  };
}
