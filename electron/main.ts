import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomFillSync } from 'node:crypto';
import { startLocalServer } from './local-server';
import { setupAutoUpdate } from './auto-update';

const PORT = 17463;

app.setName('Bible Study Tool');

function getOrCreateJwtSecret(userDataDir: string): string {
  const secretFile = join(userDataDir, 'jwt-secret.txt');
  if (existsSync(secretFile)) return readFileSync(secretFile, 'utf8').trim();
  const bytes = Buffer.alloc(32);
  randomFillSync(bytes);
  const secret = bytes.toString('hex');
  writeFileSync(secretFile, secret, 'utf8');
  return secret;
}

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    title: 'Bible Study Tool',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
    },
  });
  mainWindow.loadURL(`http://localhost:${PORT}/`);
}

app.whenReady().then(() => {
  const userDataDir = app.getPath('userData');
  if (!existsSync(userDataDir)) mkdirSync(userDataDir, { recursive: true });

  const dbFile = join(userDataDir, 'local.sqlite');
  const jwtSecret = getOrCreateJwtSecret(userDataDir);

  // Packaged builds run from app.asar — public/ and migrations/ are bundled
  // as extraResources (see electron-builder config) rather than inside the
  // asar, since better-sqlite3 and plain file reads need real disk paths.
  // In dev, __dirname differs depending on whether this runs via tsx
  // directly (electron/) or the compiled output (electron/dist/electron/),
  // so pick whichever candidate actually has the project's migrations/.
  function findProjectRoot(): string {
    const candidates = [join(__dirname, '..'), join(__dirname, '..', '..', '..')];
    return candidates.find((p) => existsSync(join(p, 'migrations'))) ?? candidates[0];
  }
  const projectRoot = app.isPackaged ? process.resourcesPath : findProjectRoot();

  startLocalServer({
    port: PORT,
    dbFile,
    migrationsDir: join(projectRoot, 'migrations'),
    publicDir: join(projectRoot, 'public'),
    jwtSecret,
  });

  createWindow();
  setupAutoUpdate(() => mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
