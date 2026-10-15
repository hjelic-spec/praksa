// Windows aplikacija: pokreće lokalni poslužitelj na slobodnom portu (samo 127.0.0.1) i
// prikazuje sučelje u vlastitom prozoru. Podaci se spremaju u korisnikov profil
// (%APPDATA%\Praksa): prijava, postavke (API ključ), predmeti i međuspremnik stranica.
import { app, BrowserWindow, Menu, shell } from 'electron';

if (!app.requestSingleInstanceLock()) app.quit();

let win;

async function createWindow() {
  // Mora biti postavljeno prije učitavanja poslužitelja (config.js ga čita pri učitavanju).
  process.env.PRAKSA_DATA_DIR ??= app.getPath('userData');
  const { start } = await import('../src/server.js');
  const { port } = await start({ port: 0 });
  const origin = `http://127.0.0.1:${port}`;

  win = new BrowserWindow({
    width: 1200,
    height: 900,
    title: 'Preglednik sudske prakse',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  // Poveznice na odluke, EUR-Lex i CURIA otvaraju se u zadanom pregledniku.
  const openExternal = (url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(origin)) openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) { e.preventDefault(); openExternal(url); }
  });

  await win.loadURL(`${origin}/`);
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Datoteka', submenu: [{ role: 'quit', label: 'Izlaz' }] },
    { label: 'Uredi', submenu: [{ role: 'undo', label: 'Poništi' }, { role: 'redo', label: 'Ponovi' }, { type: 'separator' }, { role: 'cut', label: 'Izreži' }, { role: 'copy', label: 'Kopiraj' }, { role: 'paste', label: 'Zalijepi' }, { role: 'selectAll', label: 'Odaberi sve' }] },
    { label: 'Prikaz', submenu: [{ role: 'reload', label: 'Osvježi' }, { role: 'zoomIn', label: 'Povećaj' }, { role: 'zoomOut', label: 'Smanji' }, { role: 'resetZoom', label: 'Izvorna veličina' }] },
  ]));
  return createWindow();
}).catch((e) => {
  console.error(e);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
