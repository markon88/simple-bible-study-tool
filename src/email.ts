import type { Env } from './types';

const FROM = 'Bible Study Tool <noreply@mail.churchtree.app>';

export async function sendEmail(env: Env, to: string, subject: string, html: string): Promise<void> {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
}

export function verifyEmailHtml(link: string): string {
  return `<p>Welcome! Click the link below to verify your email and finish signing in.</p>
<p><a href="${link}">${link}</a></p>
<p>This link expires in 24 hours. If you didn't sign up, you can ignore this email.</p>`;
}

export function resetPasswordHtml(link: string): string {
  return `<p>Click the link below to reset your password. It expires in 1 hour.</p>
<p><a href="${link}">${link}</a></p>
<p>If you didn't request this, you can ignore this email — your password won't be changed.</p>`;
}
