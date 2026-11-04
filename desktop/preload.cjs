// The bridge between the app (web build, sandboxed) and the desktop main process. The app reads it
// as globalThis.dorkDesktop (components/desktop.ts); a plain browser (the layout tests) has none.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dorkDesktop', {
  platform: process.platform,
  fetchStart: (id, url, init) => ipcRenderer.invoke('net:fetch', id, url, init),
  fetchAbort: (id) => ipcRenderer.send('net:abort', id),
  /** One listener for every request's body: (id, kind: 'chunk' | 'end' | 'error', data). */
  onFetchEvent: (fn) => {
    ipcRenderer.on('net:event', (_e, id, kind, data) => fn(id, kind, data));
  },
  storeGet: (key) => ipcRenderer.invoke('store:get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store:set', key, value),
  storeDelete: (key) => ipcRenderer.invoke('store:delete', key),
  storeBackend: () => ipcRenderer.invoke('store:backend'),
  openAuth: (url) => ipcRenderer.invoke('auth:open', url),
  closeAuth: () => ipcRenderer.send('auth:close'),
  message: (opts) => ipcRenderer.invoke('dialog:message', opts),
});
