import type { ActivityAction, ActivityLogEntry, Env } from './types';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function logActivity(
  env: Env, userId: string, book: string, chapter: number, verse: number | null, action: ActivityAction
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO activity_log (id, user_id, book, chapter, verse, action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), userId, book, chapter, verse, action, new Date().toISOString()).run();
}

export async function handleLogView(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json() as { book?: string; chapter?: number };
  if (!body.book || !body.chapter) return json({ error: 'book and chapter required' }, 400);
  await logActivity(env, userId, body.book, body.chapter, null, 'view');
  return json({ ok: true });
}

export async function handleLastPosition(env: Env, userId: string): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT * FROM activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(userId).first<ActivityLogEntry>();
  return json({ position: row ?? null });
}

export async function handleJournal(env: Env, userId: string, days: number): Promise<Response> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT * FROM activity_log WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 500`
  ).bind(userId, since).all<ActivityLogEntry>();

  const byDay = new Map<string, ActivityLogEntry[]>();
  for (const entry of results) {
    const day = entry.created_at.slice(0, 10); // YYYY-MM-DD
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(entry);
  }

  const days_out = [...byDay.entries()].map(([day, entries]) => ({ day, entries }));
  return json({ days: days_out });
}
