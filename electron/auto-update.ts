// electron-updater checks GitHub Releases on the project's own dedicated
// repo (markon88/simple-bible-study-tool) for a newer version. Rather than
// the bare OS notification from checkForUpdatesAndNotify(), this sends an
// IPC event so the renderer can show an in-app banner and let the user
// choose when to restart.
import { autoUpdater } from 'electron-updater';
import { ipcMain, type BrowserWindow } from 'electron';

export function setupAutoUpdate(getWindow: () => BrowserWindow | null): void {
  autoUpdater.autoDownload = true;

  autoUpdater.on('update-downloaded', (info) => {
    getWindow()?.webContents.send('update-available', info.version);
  });

  autoUpdater.on('error', (err) => {
    console.error('auto-update error:', err);
  });

  ipcMain.handle('quit-and-install', () => {
    autoUpdater.quitAndInstall();
  });

  autoUpdater.checkForUpdates().catch(() => {
    // Offline at launch, or no network — silently skip. The next launch
    // (or periodic check) will try again.
  });
}
