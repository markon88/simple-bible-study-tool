import type { Env } from './types';
import {
  handleLogin,
  handleLogout,
  handleChangePassword,
  handleSignup,
  handleVerifyEmail,
  handleForgotPassword,
  handleResetPassword,
  requireAuth,
} from './auth';
import { handleGetChapterNotes, handleSaveNote, handleSearchNotes, handleWordSearch } from './notes';
import {
  handleListAbbreviations,
  handleAddAbbreviation,
  handleDeleteAbbreviation,
  handleParseReference,
} from './abbreviations';
import { handleLogView, handleLastPosition, handleJournal } from './activity';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ── Auth ─────────────────────────────────────────────────────────────
    if (path === '/auth/login' && method === 'POST') return handleLogin(request, env);
    if (path === '/auth/logout' && method === 'POST') return handleLogout(request);
    if (path === '/auth/signup' && method === 'POST') return handleSignup(request, env);
    if (path === '/auth/verify-email' && method === 'POST') return handleVerifyEmail(request, env);
    if (path === '/auth/forgot-password' && method === 'POST') return handleForgotPassword(request, env);
    if (path === '/auth/reset-password' && method === 'POST') return handleResetPassword(request, env);

    // ── Everything under /api requires auth ─────────────────────────────
    if (path.startsWith('/api/')) {
      const user = await requireAuth(request, env);
      if (user instanceof Response) return user;

      if (path === '/api/me' && method === 'GET') return json({ username: user.username });
      if (path === '/api/account/password' && method === 'POST') return handleChangePassword(request, env, user.id);

      if (path === '/api/notes' && method === 'GET') {
        const book = url.searchParams.get('book');
        const chapter = parseInt(url.searchParams.get('chapter') ?? '', 10);
        if (!book || !chapter) return json({ error: 'book and chapter required' }, 400);
        return handleGetChapterNotes(env, user.id, book, chapter);
      }

      if (path === '/api/notes' && method === 'PUT') {
        const book = url.searchParams.get('book');
        const chapter = parseInt(url.searchParams.get('chapter') ?? '', 10);
        const verse = parseInt(url.searchParams.get('verse') ?? '', 10);
        if (!book || !chapter || !verse) return json({ error: 'book, chapter, verse required' }, 400);
        return handleSaveNote(request, env, user.id, book, chapter, verse);
      }

      if (path === '/api/notes/search' && method === 'GET') {
        const q = url.searchParams.get('q') ?? '';
        if (!q) return json({ results: [] });
        return handleSearchNotes(env, user.id, q);
      }

      if (path === '/api/word-search' && method === 'GET') {
        const word = url.searchParams.get('word') ?? '';
        if (!word) return json({ results: [] });
        return handleWordSearch(env, user.id, word);
      }

      if (path === '/api/abbreviations' && method === 'GET') return handleListAbbreviations(env, user.id);
      if (path === '/api/abbreviations' && method === 'POST') return handleAddAbbreviation(request, env, user.id);
      if (path.startsWith('/api/abbreviations/') && method === 'DELETE') {
        const id = path.slice('/api/abbreviations/'.length);
        return handleDeleteAbbreviation(env, user.id, id);
      }

      if (path === '/api/reference' && method === 'GET') {
        const q = url.searchParams.get('q') ?? '';
        return handleParseReference(env, user.id, q);
      }

      if (path === '/api/activity/view' && method === 'POST') return handleLogView(request, env, user.id);
      if (path === '/api/last-position' && method === 'GET') return handleLastPosition(env, user.id);
      if (path === '/api/journal' && method === 'GET') {
        const days = parseInt(url.searchParams.get('days') ?? '30', 10);
        return handleJournal(env, user.id, days);
      }

      return json({ error: 'Not found' }, 404);
    }

    // ── Static assets (reader UI, login page, etc.) ─────────────────────
    return env.ASSETS.fetch(request);
  },
};
