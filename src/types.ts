export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  JWT_SECRET: string;
  ENVIRONMENT: string;
}

export interface User {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
}

export interface JWTPayload {
  sub: string;   // user id
  username: string;
  iat: number;
  exp: number;
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
