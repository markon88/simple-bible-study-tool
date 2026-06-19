const { contextBridge, ipcRenderer } = require('electron');

// app.js checks this to know it's running inside the Electron shell
// (e.g. to show the sync status indicator, which makes no sense on the web).
contextBridge.exposeInMainWorld('__ELECTRON__', true);

contextBridge.exposeInMainWorld('electronAPI', {
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (_event, version) => callback(version));
  },
  quitAndInstallUpdate: () => ipcRenderer.invoke('quit-and-install'),
});
