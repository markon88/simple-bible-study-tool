import type { BookAbbreviation, Env } from './types';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export interface ParsedReference {
  book: string;
  chapter: number;
  verse: number | null;
  verseEnd: number | null;
}

// Accepts e.g. "Jn 3:16", "Joh3:16", "John 3:16", "1Jn1:9", "1 Jn 1:9",
// "1 Joh 1:9", "1 John 1:9" — strips all whitespace, then matches an
// optional leading book-number digit, book letters, chapter, and an
// optional :verse or :verse-verse.
export async function parseReference(env: Env, userId: string, input: string): Promise<ParsedReference | null> {
  const stripped = input.replace(/\s+/g, '').toLowerCase();
  const match = stripped.match(/^(\d)?([a-z]+)(\d+)(?::(\d+)(?:-(\d+))?)?$/);
  if (!match) return null;
  const [, digit, letters, chapterStr, verseStr, verseEndStr] = match;
  const token = (digit ?? '') + letters;

  const row = await env.DB.prepare(
    'SELECT book FROM book_abbreviations WHERE user_id = ? AND abbrev = ?'
  ).bind(userId, token).first<{ book: string }>();
  if (!row) return null;

  return {
    book: row.book,
    chapter: parseInt(chapterStr, 10),
    verse: verseStr ? parseInt(verseStr, 10) : null,
    verseEnd: verseEndStr ? parseInt(verseEndStr, 10) : null,
  };
}

export async function handleParseReference(env: Env, userId: string, q: string): Promise<Response> {
  const parsed = await parseReference(env, userId, q);
  return json({ reference: parsed });
}

export async function handleListAbbreviations(env: Env, userId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM book_abbreviations WHERE user_id = ? ORDER BY book, abbrev'
  ).bind(userId).all<BookAbbreviation>();
  return json({ abbreviations: results });
}

export async function handleAddAbbreviation(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json() as { book?: string; abbrev?: string };
  const book = (body.book ?? '').trim();
  const abbrev = (body.abbrev ?? '').replace(/\s+/g, '').toLowerCase();
  if (!book || !abbrev) return json({ error: 'book and abbrev required' }, 400);

  try {
    await env.DB.prepare(
      'INSERT INTO book_abbreviations (id, user_id, book, abbrev) VALUES (?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), userId, book, abbrev).run();
  } catch {
    return json({ error: 'Abbreviation already in use' }, 409);
  }
  return json({ ok: true });
}

export async function handleDeleteAbbreviation(env: Env, userId: string, id: string): Promise<Response> {
  await env.DB.prepare('DELETE FROM book_abbreviations WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return json({ ok: true });
}
