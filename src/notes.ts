import type { Env, Note } from './types';
import { logActivity } from './activity';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function normalizeWord(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

function extractBoldSpans(content: string): string[] {
  const matches = content.matchAll(/\*\*(.+?)\*\*/g);
  const words = new Set<string>();
  for (const m of matches) {
    const w = normalizeWord(m[1]);
    if (w) words.add(w);
  }
  return [...words];
}

export async function handleGetChapterNotes(env: Env, userId: string, book: string, chapter: number): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT verse, content FROM notes WHERE user_id = ? AND book = ? AND chapter = ?'
  ).bind(userId, book, chapter).all<{ verse: number; content: string }>();

  const notes: Record<number, string> = {};
  for (const row of results) notes[row.verse] = row.content;
  return json({ notes });
}

export async function handleSaveNote(
  request: Request, env: Env, userId: string, book: string, chapter: number, verse: number
): Promise<Response> {
  const body = await request.json() as { content?: string };
  const content = body.content ?? '';
  const now = new Date().toISOString();

  const existing = await env.DB.prepare(
    'SELECT id FROM notes WHERE user_id = ? AND book = ? AND chapter = ? AND verse = ?'
  ).bind(userId, book, chapter, verse).first<{ id: string }>();

  let noteId: string;
  if (existing) {
    noteId = existing.id;
    await env.DB.prepare(
      'UPDATE notes SET content = ?, updated_at = ? WHERE id = ?'
    ).bind(content, now, noteId).run();
  } else {
    noteId = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO notes (id, user_id, book, chapter, verse, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(noteId, userId, book, chapter, verse, content, now, now).run();
  }

  await env.DB.prepare('DELETE FROM word_tags WHERE note_id = ?').bind(noteId).run();
  const words = extractBoldSpans(content);
  for (const word of words) {
    await env.DB.prepare(
      'INSERT INTO word_tags (id, note_id, user_id, book, chapter, verse, word_normalized, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), noteId, userId, book, chapter, verse, word, now).run();
  }

  await logActivity(env, userId, book, chapter, verse, 'note');

  return json({ ok: true });
}

export async function handleSearchNotes(env: Env, userId: string, q: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT book, chapter, verse, content FROM notes WHERE user_id = ? AND content LIKE ? ORDER BY updated_at DESC LIMIT 50'
  ).bind(userId, `%${q}%`).all<Note>();
  return json({ results });
}

export async function handleWordSearch(env: Env, userId: string, word: string): Promise<Response> {
  const normalized = normalizeWord(word);
  if (!normalized) return json({ results: [] });
  // Prefix match so this can drive a live filter-as-you-type search
  // ("m" -> "market", "manifest", ...), not just exact-word lookup.
  const { results } = await env.DB.prepare(
    `SELECT wt.word_normalized, wt.book, wt.chapter, wt.verse, n.content
     FROM word_tags wt
     JOIN notes n ON n.id = wt.note_id
     WHERE wt.user_id = ? AND wt.word_normalized LIKE ? ESCAPE '\\'
     ORDER BY wt.word_normalized, wt.created_at DESC`
  ).bind(userId, `${normalized.replace(/[%_\\]/g, (c) => `\\${c}`)}%`).all();
  return json({ results });
}
