import type { AuthToken, Env, User } from './types';
import { signJWT, verifyJWT, getSessionToken, sessionCookie, clearSessionCookie } from './jwt';
import { sendEmail, verifyEmailHtml, resetPasswordHtml } from './email';
import { defaultAbbreviations } from './default-abbreviations';

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

function generateToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('');
}

// password_changed_at is embedded in the JWT at sign time ("pcv" = password
// change version). If the user's stored password_changed_at no longer
// matches what a given token was signed with, that token predates a
// password change/reset and is treated as invalid — this is what makes
// "log out everywhere on password change" work without a DB-backed
// sessions table.
async function signUserJWT(user: User, env: Env): Promise<string> {
  return signJWT({ sub: user.id, username: user.username, pcv: user.password_changed_at ?? '' }, env.JWT_SECRET);
}

export async function getCurrentUser(request: Request, env: Env): Promise<User | null> {
  const token = getSessionToken(request);
  if (!token) return null;
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return null;
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(payload.sub).first<User>();
  if (!user) return null;
  if (payload.pcv !== (user.password_changed_at ?? '')) return null;
  return user;
}

export async function requireAuth(request: Request, env: Env): Promise<User | Response> {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);
  return user;
}

function sessionResponse(jwt: string, secure: boolean, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ ok: true, ...extra }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie(jwt, secure) },
  });
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

  if (!user.email_verified) return json({ error: 'Please verify your email before signing in', unverified: true }, 403);

  const jwt = await signUserJWT(user, env);
  const secure = new URL(request.url).protocol === 'https:';
  return sessionResponse(jwt, secure);
}

export async function handleSignup(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { username?: string; email?: string; password?: string };
  const username = (body.username ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  if (!username || !email || !password) return json({ error: 'Username, email, and password required' }, 400);
  if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
  if (!email.includes('@')) return json({ error: 'Invalid email' }, 400);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ? OR email = ?').bind(username, email).first();
  if (existing) return json({ error: 'Username or email already in use' }, 409);

  const hash = await hashPassword(password);
  const userId = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO users (id, username, email, email_verified, password_hash, created_at) VALUES (?, ?, ?, 0, ?, ?)'
  ).bind(userId, username, email, hash, now).run();

  // Seed default book abbreviations so reference search works immediately,
  // before the user has had a chance to personalize it via Settings.
  // Batched into one round-trip rather than ~200 sequential inserts.
  const seedStmt = env.DB.prepare('INSERT INTO book_abbreviations (id, user_id, book, abbrev, updated_at) VALUES (?, ?, ?, ?, ?)');
  const seedStatements = Object.entries(defaultAbbreviations).flatMap(([book, abbrevs]) =>
    abbrevs.map((abbrev) => seedStmt.bind(crypto.randomUUID(), userId, book, abbrev, now))
  );
  await env.DB.batch(seedStatements);

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    'INSERT INTO auth_tokens (id, user_id, email, token, type, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), userId, email, token, 'verify_email', expiresAt, now).run();

  const link = `${env.APP_URL}/verify-email.html?token=${token}`;
  await sendEmail(env, email, 'Verify your email — Bible Study Tool', verifyEmailHtml(link));

  return json({ ok: true });
}

export async function handleVerifyEmail(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { token?: string };
  const token = body.token ?? '';
  if (!token) return json({ error: 'Token required' }, 400);

  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT * FROM auth_tokens WHERE token = ? AND type = 'verify_email' AND used_at IS NULL AND expires_at > ?`
  ).bind(token, now).first<AuthToken>();
  if (!row) return json({ error: 'Invalid or expired link' }, 400);

  await env.DB.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ?').bind(now, row.id).run();
  await env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(row.user_id).run();

  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(row.user_id).first<User>();
  if (!user) return json({ error: 'Account not found' }, 404);

  const jwt = await signUserJWT(user, env);
  const secure = new URL(request.url).protocol === 'https:';
  return sessionResponse(jwt, secure, { username: user.username });
}

export async function handleForgotPassword(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { email?: string };
  const email = (body.email ?? '').trim().toLowerCase();
  if (!email) return json({ error: 'Email required' }, 400);

  // Always return ok — never reveal whether an email is registered.
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();
  if (user) {
    const token = generateToken();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await env.DB.prepare(
      'INSERT INTO auth_tokens (id, user_id, email, token, type, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), user.id, email, token, 'reset_password', expiresAt, now).run();

    const link = `${env.APP_URL}/reset-password.html?token=${token}`;
    await sendEmail(env, email, 'Reset your password — Bible Study Tool', resetPasswordHtml(link));
  }

  return json({ ok: true });
}

export async function handleResetPassword(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { token?: string; newPassword?: string };
  const token = body.token ?? '';
  const newPassword = body.newPassword ?? '';
  if (!token || !newPassword) return json({ error: 'Token and new password required' }, 400);
  if (newPassword.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);

  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT * FROM auth_tokens WHERE token = ? AND type = 'reset_password' AND used_at IS NULL AND expires_at > ?`
  ).bind(token, now).first<AuthToken>();
  if (!row) return json({ error: 'Invalid or expired link' }, 400);

  const hash = await hashPassword(newPassword);
  await env.DB.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?').bind(hash, now, row.user_id).run();
  await env.DB.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ?').bind(now, row.id).run();

  return json({ ok: true });
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
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?').bind(newHash, now, userId).run();
  return json({ ok: true });
}

export function handleLogout(request: Request): Response {
  const secure = new URL(request.url).protocol === 'https:';
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearSessionCookie(secure) },
  });
}
