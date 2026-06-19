// Runs src/index.ts's exported `fetch` handler — completely unmodified —
// against a local SQLite-backed D1 adapter, inside a plain Node HTTP
// server. The renderer (Electron's BrowserWindow) just points at this
// server's URL like it would point at the Cloudflare Worker; it has no
// idea it isn't talking to the cloud.
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { Env } from '../src/types';
import workerModule from '../src/index';
import { LocalD1, openLocalDatabase, runMigrations } from './d1-adapter';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function staticAssetFetcher(publicDir: string): Fetcher {
  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/') pathname = '/index.html';
      // Mirror Cloudflare's clean-URL asset serving: /login -> /login.html
      let filePath = join(publicDir, pathname);
      if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
        const withHtml = `${filePath}.html`;
        if (existsSync(withHtml)) filePath = withHtml;
      }
      if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
        return new Response('Not found', { status: 404 });
      }
      const body = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        createReadStream(filePath)
          .on('data', (c) => chunks.push(c as Buffer))
          .on('end', () => resolve(Buffer.concat(chunks)))
          .on('error', reject);
      });
      const mime = MIME[extname(filePath)] ?? 'application/octet-stream';
      return new Response(body, { status: 200, headers: { 'Content-Type': mime } });
    },
  } as Fetcher;
}

async function nodeRequestToFetchRequest(req: IncomingMessage, baseUrl: string): Promise<Request> {
  const chunks: Buffer[] = [];
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    for await (const chunk of req) chunks.push(chunk as Buffer);
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(', '));
  }
  return new Request(`${baseUrl}${req.url}`, {
    method: req.method,
    headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
}

async function sendFetchResponse(response: Response, res: ServerResponse): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => { headers[key] = value; });
  res.writeHead(response.status, headers);
  if (response.body) {
    const buf = Buffer.from(await response.arrayBuffer());
    res.end(buf);
  } else {
    res.end();
  }
}

export function startLocalServer(opts: { port: number; dbFile: string; migrationsDir: string; publicDir: string; jwtSecret: string }) {
  const sqlite = openLocalDatabase(opts.dbFile);
  runMigrations(sqlite, opts.migrationsDir);
  const db = new LocalD1(sqlite);
  const assets = staticAssetFetcher(opts.publicDir);

  const env: Env = {
    DB: db as unknown as Env['DB'],
    ASSETS: assets,
    JWT_SECRET: opts.jwtSecret,
    ENVIRONMENT: 'electron',
    RESEND_API_KEY: '', // signup/reset email isn't sent from the offline-first local app
    APP_URL: `http://localhost:${opts.port}`,
  };

  const baseUrl = `http://localhost:${opts.port}`;
  const server = createServer(async (req, res) => {
    try {
      const request = await nodeRequestToFetchRequest(req, baseUrl);
      const response = await workerModule.fetch(request, env, { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext);
      await sendFetchResponse(response, res);
    } catch (err) {
      console.error('local-server error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal error' }));
    }
  });

  server.listen(opts.port);
  return { server, sqlite };
}
