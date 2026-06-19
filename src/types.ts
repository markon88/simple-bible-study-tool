export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  JWT_SECRET: string;
  ENVIRONMENT: string;
  RESEND_API_KEY: string;
  APP_URL: string;
}

export interface User {
  id: string;
  username: string;
  email: string | null;
  email_verified: number;
  password_hash: string;
  password_changed_at: string | null;
  created_at: string;
}

export interface JWTPayload {
  sub: string;   // user id
  username: string;
  pcv: string;   // password_changed_at at time of signing, '' if never changed
  iat: number;
  exp: number;
}

export interface AuthToken {
  id: string;
  user_id: string;
  email: string;
  token: string;
  type: 'verify_email' | 'reset_password';
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export interface Note {
  id: string;
  user_id: string;
  book: string;
  chapter: number;
  verse: number;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface BookAbbreviation {
  id: string;
  user_id: string;
  book: string;
  abbrev: string;
  updated_at: string;
}

export type ActivityAction = 'view' | 'note';

export interface ActivityLogEntry {
  id: string;
  user_id: string;
  book: string;
  chapter: number;
  verse: number | null;
  action: ActivityAction;
  created_at: string;
}
