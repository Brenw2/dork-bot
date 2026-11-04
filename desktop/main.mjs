// Dork Bot for the Linux desktop: the app's web build in an Electron window.
//
// Why not just a browser tab: Hermes's API server refuses browser (CORS) requests, and bot keys
// shouldn't sit in browser storage. So this main process does the app's network calls itself
// (net.fetch, streamed back over IPC), keeps keys in an encrypted file (safeStorage, the system
// keyring), opens connector sign-ins in a pop-up window, and handles dorkbot:// links.
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol, safeStorage, shell } from 'electron';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, 'web');
const ORIGIN = 'app://dorkbot';

app.setName('Dork Bot');
// The app is dark only: dark scrollbars, form controls and dialogs instead of the bright defaults.
nativeTheme.themeSource = 'dark';
// A second, separate copy for testing (own sign-in and window): DORK_DESKTOP_PROFILE=test.
if (process.env.DORK_DESKTOP_PROFILE) app.setPath('userData', join(app.getPath('appData'), `Dork Bot (${process.env.DORK_DESKTOP_PROFILE})`));
// Keeps the window grouped under the .desktop entry (StartupWMClass) on Wayland/X11.
app.commandLine.appendSwitch('class', 'dork-bot');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// On the Hermes machine itself, its own Tailscale name may not resolve (MagicDNS off on the host,
// --accept-dns=false). Point that one name at this machine's Tailscale address, so the desktop app
// uses the same https://<host>.ts.net addresses as the phone and the same bots line up.
const selfName = tailscaleSelf();
if (selfName) app.commandLine.appendSwitch('host-resolver-rules', `MAP ${selfName.name} ${selfName.ip}`);

function tailscaleSelf() {
  try {
    const s = JSON.parse(execFileSync('tailscale', ['status', '--json'], { timeout: 3000, encoding: 'utf8' }));
    const name = String(s?.Self?.DNSName ?? '').replace(/\.$/, '');
    const ip = (s?.Self?.TailscaleIPs ?? []).find((a) => a.includes('.'));
    return name && ip ? { name, ip } : null;
  } catch {
    return null;
  }
}

// One window. A dorkbot:// link opened while it runs (xdg-open, scripts/pair-hermes.sh --desktop)
// lands in the running app instead of a second one.
if (!app.requestSingleInstanceLock()) app.quit();

/** dorkbot://connect?… → app://dorkbot/connect?… (the app's own expo-router screens). */
function routeFor(link) {
  try {
    const u = new URL(link);
    if (u.protocol !== 'dorkbot:') return null;
    const path = `${u.host}${u.pathname}`.replace(/^\/+/, '');
    return `${ORIGIN}/${path}${u.search}`;
  } catch {
    return null;
  }
}
const linkIn = (argv) => argv.find((a) => a.startsWith('dorkbot://'));

let win = null;

function createWindow(start) {
  win = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 380,
    minHeight: 520,
    title: 'Dork Bot',
    backgroundColor: '#0F1012',
    icon: join(HERE, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: join(HERE, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.removeMenu();
  // Dark scrollbars and form controls (nativeTheme alone doesn't reach the page on Linux).
  win.webContents.on('dom-ready', () => void win?.webContents.insertCSS(':root { color-scheme: dark; }'));
  // Links in replies open in the normal browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(ORIGIN)) return;
    e.preventDefault();
    const route = routeFor(url);
    if (route) void win.loadURL(route);
    else if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  win.on('closed', () => (win = null));
  void win.loadURL(start ?? `${ORIGIN}/`);
}

app.on('second-instance', (_e, argv) => {
  const route = routeFor(linkIn(argv) ?? '');
  if (!win) return createWindow(route);
  if (route) void win.loadURL(route);
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  // The app's files. Unknown paths get index.html (the app routes on its own: /chat/assistant, ...).
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = normalize(join(WEB, decodeURIComponent(pathname)));
    const inside = file.startsWith(WEB + '/') && isFile(file);
    return net.fetch(pathToFileURL(inside ? file : join(WEB, 'index.html')).toString());
  });
  createWindow(routeFor(linkIn(process.argv) ?? ''));
});
app.on('window-all-closed', () => app.quit());

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

// ---- Network: the app's fetch, done here so Hermes's CORS rules don't apply. ----
const inflight = new Map();
ipcMain.handle('net:fetch', async (e, id, url, init = {}) => {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) addresses.');
  const abort = new AbortController();
  inflight.set(id, abort);
  const sender = e.sender;
  let res;
  try {
    res = await net.fetch(url, { method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body, signal: abort.signal });
  } catch (err) {
    inflight.delete(id);
    throw err;
  }
  // Stream the body back in chunks (chat replies are SSE).
  (async () => {
    try {
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!sender.isDestroyed()) sender.send('net:event', id, 'chunk', value);
        }
      }
      if (!sender.isDestroyed()) sender.send('net:event', id, 'end');
    } catch (err) {
      if (!sender.isDestroyed()) sender.send('net:event', id, 'error', abort.signal.aborted ? 'aborted' : String(err?.message ?? err));
    } finally {
      inflight.delete(id);
    }
  })();
  return { status: res.status, ok: res.ok };
});
ipcMain.on('net:abort', (_e, id) => inflight.get(id)?.abort());

// ---- Key store: the iOS Keychain's stand-in. One file, each value encrypted with safeStorage. ----
const STORE = join(app.getPath('userData'), 'store.json');
function readStore() {
  try {
    return JSON.parse(readFileSync(STORE, 'utf8'));
  } catch {
    return {};
  }
}
function writeStore(data) {
  mkdirSync(dirname(STORE), { recursive: true });
  const tmp = `${STORE}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  renameSync(tmp, STORE);
}
const seal = (v) => (safeStorage.isEncryptionAvailable() ? { e: safeStorage.encryptString(v).toString('base64') } : { p: v });
const unseal = (s) => (s?.e ? safeStorage.decryptString(Buffer.from(s.e, 'base64')) : (s?.p ?? null));

ipcMain.handle('store:get', (_e, key) => {
  try {
    return unseal(readStore()[key]);
  } catch {
    return null;
  }
});
ipcMain.handle('store:set', (_e, key, value) => {
  const data = readStore();
  data[key] = seal(String(value));
  writeStore(data);
});
ipcMain.handle('store:delete', (_e, key) => {
  const data = readStore();
  delete data[key];
  writeStore(data);
});
ipcMain.handle('store:backend', () => (process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'os'));

// ---- Connector sign-in: a pop-up window, closed by the app once Hermes says it's approved. ----
let authWin = null;
ipcMain.handle('auth:open', (_e, url) => {
  if (!/^https:\/\//i.test(url)) throw new Error('Sign-in pages are https only.');
  authWin?.close();
  return new Promise((resolve) => {
    authWin = new BrowserWindow({ parent: win ?? undefined, width: 520, height: 720, title: 'Sign in', autoHideMenuBar: true, backgroundColor: '#ffffff' });
    authWin.removeMenu();
    // The provider may end on a dorkbot:// page: that's the end of the flow too.
    authWin.webContents.on('will-redirect', (e, to) => to.startsWith('dorkbot://') && (e.preventDefault(), authWin?.close()));
    authWin.webContents.on('will-navigate', (e, to) => to.startsWith('dorkbot://') && (e.preventDefault(), authWin?.close()));
    authWin.on('closed', () => {
      authWin = null;
      resolve();
    });
    void authWin.loadURL(url);
  });
});
ipcMain.on('auth:close', () => authWin?.close());

// ---- Dialogs: the phone's Alert, as native desktop dialogs. ----
ipcMain.handle('dialog:message', async (_e, opts) => {
  const r = await dialog.showMessageBox(win, {
    type: opts.destructive ? 'warning' : 'none',
    title: 'Dork Bot',
    message: String(opts.title ?? ''),
    detail: opts.message ? String(opts.message) : undefined,
    buttons: opts.buttons ?? ['OK'],
    cancelId: opts.cancelId ?? -1,
    defaultId: opts.defaultId ?? 0,
    checkboxLabel: opts.checkboxLabel,
    noLink: true,
  });
  return { response: r.response, checked: r.checkboxChecked };
});
