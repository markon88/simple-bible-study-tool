import type { Env, User } from './types';
import { signJWT, verifyJWT, getSessionToken, sessionCookie, clearSessionCookie } from './jwt';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// PBKDF2 password hashing via native WebCrypto — runs natively on Workers
// (better-auth's default scrypt hasher exceeds the CPU limit there).
// Hashes stored as "pbkdf2:<saltHex>:<hashHex>".
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256,
  );
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${saltHex}:${hashHex}`;
}

async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const parts = hash.split(':');
  if (parts.length !== 3 || parts[0] !== 'pbkdf2') return false;
  const [, saltHex, keyHex] = parts;
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256,
  );
  const computedHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  if (computedHex.length !== keyHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) {
    diff |= computedHex.charCodeAt(i) ^ keyHex.charCodeAt(i);
  }
  return diff === 0;
}

export async function getCurrentUser(request: Request, env: Env): Promise<User | null> {
  const token = getSessionToken(request);
  if (!token) return null;
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return null;
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(payload.sub).first<User>();
  return user ?? null;
}

export async function requireAuth(request: Request, env: Env): Promise<User | Response> {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);
  return user;
}

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { username?: string; password?: string };
  const username = (body.username ?? '').trim();
  const password = body.password ?? '';
  if (!username || !password) return json({ error: 'Username and password required' }, 400);

  const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<User>();
  if (!user) return json({ error: 'Invalid username or password' }, 401);

  const valid = await verifyPassword(user.password_hash, password);
  if (!valid) return json({ error: 'Invalid username or password' }, 401);

  const jwt = await signJWT({ sub: user.id, username: user.username }, env.JWT_SECRET);
  const secure = new URL(request.url).protocol === 'https:';
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie(jwt, secure) },
  });
}

export async function handleChangePassword(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json() as { currentPassword?: string; newPassword?: string };
  const currentPassword = body.currentPassword ?? '';
  const newPassword = body.newPassword ?? '';
  if (!currentPassword || !newPassword) return json({ error: 'Current and new password required' }, 400);
  if (newPassword.length < 8) return json({ error: 'New password must be at least 8 characters' }, 400);

  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<User>();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const valid = await verifyPassword(user.password_hash, currentPassword);
  if (!valid) return json({ error: 'Current password is incorrect' }, 401);

  const newHash = await hashPassword(newPassword);
  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, userId).run();
  return json({ ok: true });
}

export function handleLogout(request: Request): Response {
  const secure = new URL(request.url).protocol === 'https:';
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearSessionCookie(secure) },
  });
}
