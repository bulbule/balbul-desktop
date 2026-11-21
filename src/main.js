'use strict';
// "Otak" balBul: jendela karakter, dashboard, penyimpanan tugas, dan penjadwal pengingat.
const {
  app, BrowserWindow, ipcMain, Menu, Notification, Tray, screen, powerMonitor, nativeImage, safeStorage, dialog,
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');

app.setAppUserModelId('com.balbul.desktop'); // wajib di Windows supaya notifikasi muncul

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// ---------------------------------------------------------------- konstanta
const ROOT = path.join(__dirname, '..');
const colorLib = require('./color');
const sprite = (name) => path.join(ROOT, 'assets', 'sprites', `${name}.png`);
const WIN_W = 340; // lebar jendela karakter
const BUBBLE_H = 150; // ruang di atas karakter untuk bubble chat
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const REPEATS = ['none', 'daily', 'weekdays', 'weekly'];

const DEFAULT_SETTINGS = {
  size: 150, // ukuran karakter (px)
  opacity: 100, // transparansi karakter (30-100)
  sound: true,
  showCharacter: true,
  quietStart: '22:00', // jam tidur balBul
  quietEnd: '06:00',
  encourageEveryMin: 60, // 0 = mati
  autoStart: false,
  trackCursor: false, // mata & badan balBul mengikuti kursor
  color: '#35e0ff', // warna balBul & aksen tampilan (biru = asli)
  x: null,
  y: null,
};

// ---------------------------------------------------------------- state
let settings = { ...DEFAULT_SETTINGS };
let tasks = [];
let charWin = null;
let dashWin = null;
let tray = null;
let quitting = false;
let override = null; // ekspresi sementara { state, text, until, sound, taskId }
let lastKey = '';
let lastEncourage = Date.now();
let pendingError = null;
let dragStart = null;

// ---------------------------------------------------------------- penyimpanan (file JSON)
const tasksPath = () => path.join(app.getPath('userData'), 'tasks.json');
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const authSessionPath = () => path.join(app.getPath('userData'), 'auth-session.enc');

function readJson(file, fallback, label) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`Gagal baca ${label}:`, err);
    try { fs.copyFileSync(file, `${file}.rusak-${Date.now()}`); } catch (_) { /* abaikan */ }
    pendingError = `File ${label} rusak. Sudah dicadangkan, mulai dari kosong.`;
    return fallback;
  }
}

function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
    return true;
  } catch (err) {
    console.error('Gagal simpan:', err);
    pendingError = 'Gagal menyimpan data. Cek izin folder.';
    return false;
  }
}

function broadcast(channel, payload) {
  for (const win of [charWin, dashWin]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function saveTasks() {
  writeJson(tasksPath(), tasks);
  broadcast('tasks-changed', tasks);
  refreshState(true);
}

function saveSettings() {
  writeJson(settingsPath(), settings);
}

// ---------------------------------------------------------------- helper tugas
const isoOrNull = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const isPast = (iso) => !!iso && Date.parse(iso) <= Date.now();
const isReminder = (t) => t.kind === 'reminder';
// "tugas" = yang punya deadline/dikerjakan; pengingat biasa tidak ikut dihitung
const pendingTasks = () => tasks.filter((t) => t.status === 'pending' && !isReminder(t));

// jadwal berikutnya untuk pengingat berulang (selalu di masa depan)
function nextOccurrence(iso, repeat) {
  const d = new Date(iso);
  const now = Date.now();
  let guard = 0;
  do {
    d.setDate(d.getDate() + (repeat === 'weekly' ? 7 : 1));
    if (repeat === 'weekdays') {
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    }
    guard += 1;
  } while (d.getTime() <= now && guard < 4000);
  return d.toISOString();
}

function addTask(data) {
  const title = String((data && data.title) || '').trim().slice(0, 200);
  if (!title) return null;
  const now = new Date().toISOString();
  const kind = data.kind === 'reminder' ? 'reminder' : 'task';
  const deadline = kind === 'reminder' ? null : isoOrNull(data.deadline);
  const reminderAt = isoOrNull(data.reminder_at);
  if (kind === 'reminder' && !reminderAt) return null; // pengingat wajib punya waktu
  const task = {
    id: crypto.randomUUID(),
    kind,
    repeat: kind === 'reminder' && REPEATS.includes(data.repeat) ? data.repeat : 'none',
    title,
    description: String(data.description || '').trim().slice(0, 2000) || null,
    priority: PRIORITIES.includes(data.priority) ? data.priority : 'medium',
    status: 'pending',
    deadline,
    reminder_at: reminderAt,
    created_at: now,
    updated_at: now,
    // penanda lokal: sudah pernah dikasih tahu atau belum
    reminded: isPast(reminderAt),
    overdue_notified: isPast(deadline),
    snooze_until: null,
  };
  // pengingat berulang yang waktunya sudah lewat: langsung loncat ke jadwal berikutnya
  if (task.kind === 'reminder' && task.repeat !== 'none' && task.reminded) {
    task.reminder_at = nextOccurrence(task.reminder_at, task.repeat);
    task.reminded = false;
  }
  tasks.push(task);
  saveTasks();
  setOverride('thinking', 'Oke, dicatat!', 2500);
  return task;
}

function updateTask(id, patch) {
  const t = tasks.find((x) => x.id === id);
  if (!t || !patch) return null;
  if (typeof patch.title === 'string' && patch.title.trim()) t.title = patch.title.trim().slice(0, 200);
  if ('description' in patch) t.description = String(patch.description || '').trim().slice(0, 2000) || null;
  if (PRIORITIES.includes(patch.priority)) t.priority = patch.priority;
  if (patch.kind === 'task' || patch.kind === 'reminder') t.kind = patch.kind;
  if ('repeat' in patch) t.repeat = REPEATS.includes(patch.repeat) ? patch.repeat : 'none';
  if (t.kind === 'reminder') {
    t.deadline = null;
    t.overdue_notified = true;
  } else {
    t.repeat = 'none';
  }
  if ('deadline' in patch && t.kind !== 'reminder') {
    t.deadline = isoOrNull(patch.deadline);
    t.overdue_notified = isPast(t.deadline);
  }
  if ('reminder_at' in patch) {
    t.reminder_at = isoOrNull(patch.reminder_at);
    t.reminded = isPast(t.reminder_at);
    t.snooze_until = null;
    if (t.kind === 'reminder' && t.repeat !== 'none' && t.reminded && t.reminder_at) {
      t.reminder_at = nextOccurrence(t.reminder_at, t.repeat);
      t.reminded = false;
    }
  }
  t.updated_at = new Date().toISOString();
  saveTasks();
  return t;
}

function toggleTask(id) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return null;
  t.status = t.status === 'done' ? 'pending' : 'done';
  t.updated_at = new Date().toISOString();
  saveTasks();
  if (t.status === 'done' && !isReminder(t)) {
    const left = pendingTasks().length;
    if (left === 0) setOverride('proud', 'Semua tugas beres! Kerja bagus.', 8000, { sound: true });
    else setOverride('happy', `Mantap! Tinggal ${left} tugas lagi.`, 5000, { sound: true });
  }
  return t;
}

function deleteTask(id) {
  tasks = tasks.filter((x) => x.id !== id);
  saveTasks();
  return true;
}

function snoozeTask(id, minutes) {
  const t = tasks.find((x) => x.id === id);
  const m = Math.min(Math.max(Number(minutes) || 10, 1), 1440);
  if (!t) return null;
  t.snooze_until = new Date(Date.now() + m * 60000).toISOString();
  t.updated_at = new Date().toISOString();
  saveTasks();
  setOverride('thinking', `Oke, aku ingatkan lagi ${m} menit lagi.`, 4000);
  return t;
}

// tombol "Oke" pada pengingat: pengingat sekali jalan jadi selesai, yang berulang tetap hidup
function ackTask(id) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return null;
  t.snooze_until = null;
  if (t.repeat === 'none' && t.status === 'pending') t.status = 'done';
  t.updated_at = new Date().toISOString();
  saveTasks();
  return t;
}

// ---------------------------------------------------------------- pengaturan
function sanitizeSettings(p) {
  const out = {};
  const num = (v, min, max) => Math.min(Math.max(Math.round(Number(v)), min), max);
  const time = (v) => (/^\d{2}:\d{2}$/.test(v) ? v : null);
  if ('size' in p) out.size = num(p.size, 100, 260);
  if ('opacity' in p) out.opacity = num(p.opacity, 30, 100);
  if ('sound' in p) out.sound = !!p.sound;
  if ('showCharacter' in p) out.showCharacter = !!p.showCharacter;
  if ('autoStart' in p) out.autoStart = !!p.autoStart;
  if ('trackCursor' in p) out.trackCursor = !!p.trackCursor;
  if ('color' in p && colorLib.normalizeHex(p.color)) out.color = colorLib.normalizeHex(p.color);
  if ('encourageEveryMin' in p) out.encourageEveryMin = num(p.encourageEveryMin, 0, 240);
  if ('quietStart' in p && time(p.quietStart)) out.quietStart = p.quietStart;
  if ('quietEnd' in p && time(p.quietEnd)) out.quietEnd = p.quietEnd;
  if ('x' in p) out.x = Number.isFinite(p.x) ? Math.round(p.x) : null;
  if ('y' in p) out.y = Number.isFinite(p.y) ? Math.round(p.y) : null;
  return out;
}

function applySettings(patch) {
  const prev = settings;
  settings = { ...settings, ...sanitizeSettings(patch || {}) };
  saveSettings();

  if (charWin && !charWin.isDestroyed()) {
    if (patch && patch.x === null && patch.y === null) {
      const b = defaultBounds();
      charWin.setBounds(b);
    } else if (prev.size !== settings.size) {
      const b = charWin.getBounds();
      const h = settings.size + BUBBLE_H;
      charWin.setBounds({ x: b.x, y: b.y + b.height - h, width: WIN_W, height: h });
    }
    if (settings.showCharacter && !charWin.isVisible()) charWin.showInactive();
    if (!settings.showCharacter && charWin.isVisible()) charWin.hide();
  }
  if (prev.autoStart !== settings.autoStart && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: settings.autoStart });
  }
  broadcast('settings-changed', settings);
  updateCursorPolling();
  refreshState(true);
  if (tray) tray.setContextMenu(buildMenu());
  return settings;
}

// ---------------------------------------------------------------- ekspresi karakter
function toMin(s) {
  const [h, m] = String(s).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function inQuietHours() {
  const d = new Date();
  const cur = d.getHours() * 60 + d.getMinutes();
  const a = toMin(settings.quietStart);
  const b = toMin(settings.quietEnd);
  if (a === b) return false;
  return a < b ? cur >= a && cur < b : cur >= a || cur < b;
}

function baseState() {
  const now = Date.now();
  if (inQuietHours()) return { state: 'sleep' };
  if (powerMonitor.getSystemIdleTime() > 600) return { state: 'afk' };

  const pending = pendingTasks();
  const overdue = pending.filter((t) => t.deadline && Date.parse(t.deadline) < now);
  if (overdue.length) return { state: 'marah', text: `${overdue.length} tugas sudah terlambat!` };

  const soon = pending.filter((t) => t.deadline && Date.parse(t.deadline) - now < 60 * 60000);
  if (soon.length) return { state: 'urgent', text: `Deadline dekat: ${soon[0].title}` };

  if (dashWin && !dashWin.isDestroyed() && dashWin.isVisible()) return { state: 'working' };
  if (new Date().getHours() >= 20 && pending.length) return { state: 'overtime', text: 'Masih lembur nih? Jangan lupa istirahat.' };
  return { state: 'idle' };
}

function currentView() {
  if (override && Date.now() < override.until) return override;
  override = null;
  return baseState();
}

function refreshState(force) {
  if (!charWin || charWin.isDestroyed()) return;
  const v = currentView();
  const key = JSON.stringify([v.state, v.text || '', v.taskId || '', v.until || 0]);
  if (key === lastKey && !force) return;
  lastKey = key;
  charWin.webContents.send('character:state', {
    state: v.state,
    text: v.text || '',
    sound: !!v.sound && settings.sound,
    taskId: v.taskId || null,
    kind: v.kind || 'task',
    ttl: v.until ? Math.max(v.until - Date.now(), 1000) : 8000,
  });
}

function setOverride(state, text, ms, opts = {}) {
  override = {
    state, text, until: Date.now() + ms, sound: !!opts.sound, taskId: opts.taskId || null, kind: opts.kind || 'task',
  };
  refreshState(true);
}

// ---------------------------------------------------------------- mata ikut kursor
let cursorTimer = null;
let lastLook = { x: 99, y: 99 };

function sendCursor() {
  if (!charWin || charWin.isDestroyed() || !charWin.isVisible()) return;
  const p = screen.getCursorScreenPoint();
  const b = charWin.getBounds();
  const cx = b.x + b.width / 2; // titik tengah kepala karakter
  const cy = b.y + b.height - settings.size * 0.5;
  const R = 300; // jarak (px) sampai mata mentok ke pojok
  const nx = Math.max(-1, Math.min(1, (p.x - cx) / R));
  const ny = Math.max(-1, Math.min(1, (p.y - cy) / R));
  if (Math.abs(nx - lastLook.x) < 0.02 && Math.abs(ny - lastLook.y) < 0.02) return;
  lastLook = { x: nx, y: ny };
  charWin.webContents.send('character:cursor', { x: +nx.toFixed(3), y: +ny.toFixed(3) });
}

function updateCursorPolling() {
  const want = settings.trackCursor && settings.showCharacter && charWin && !charWin.isDestroyed();
  if (want && !cursorTimer) {
    cursorTimer = setInterval(sendCursor, 50);
  } else if (!want && cursorTimer) {
    clearInterval(cursorTimer);
    cursorTimer = null;
    lastLook = { x: 99, y: 99 };
    if (charWin && !charWin.isDestroyed()) charWin.webContents.send('character:cursor', { x: 0, y: 0 });
  }
}

// ---------------------------------------------------------------- notifikasi + penjadwal
function notify(title, body) {
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, icon: nativeImage.createFromPath(sprite('idle')) });
    n.on('click', showDashboard);
    n.show();
  } catch (err) {
    console.error('Notifikasi gagal:', err);
  }
}

function deadlineText(t) {
  if (!t.deadline) return '';
  return new Date(t.deadline).toLocaleString('id-ID', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function fireReminder(t) {
  if (isReminder(t)) {
    // pengingat biasa: santai, bukan deadline
    const jam = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    notify(`Pengingat: ${t.title}`, t.description || `Sekarang jam ${jam}`);
    setOverride('reminder', `Pengingat: ${t.title}`, 20000, { sound: true, taskId: t.id, kind: 'reminder' });
    return;
  }
  const soon = t.deadline && Date.parse(t.deadline) - Date.now() < 60 * 60000;
  const state = t.priority === 'urgent' || soon ? 'urgent' : 'reminder';
  notify(`Pengingat: ${t.title}`, t.deadline ? `Deadline ${deadlineText(t)}` : 'Jangan lupa ya!');
  setOverride(state, `Jangan lupa! ${t.title}`, 20000, { sound: true, taskId: t.id });
}

function fireOverdue(t) {
  notify(`Terlambat: ${t.title}`, `Deadline ${deadlineText(t)} sudah lewat.`);
  setOverride('marah', `"${t.title}" sudah lewat deadline!`, 20000, { sound: true, taskId: t.id });
}

function maybeEncourage(now) {
  const every = settings.encourageEveryMin * 60000;
  if (!every || now - lastEncourage < every) return;
  lastEncourage = now;
  if (inQuietHours() || powerMonitor.getSystemIdleTime() > 600) return;
  const n = pendingTasks().length;
  if (!n) return;
  setOverride('encourage', `Semangat! Masih ada ${n} tugas yang menunggu.`, 8000);
}

function tick() {
  const now = Date.now();
  let changed = false;
  for (const t of tasks) {
    if (t.status !== 'pending') continue;
    if (t.reminder_at && !t.reminded && Date.parse(t.reminder_at) <= now) {
      if (isReminder(t) && t.repeat !== 'none') {
        t.reminder_at = nextOccurrence(t.reminder_at, t.repeat); // jadwal berikutnya
        t.reminded = false;
      } else {
        t.reminded = true;
      }
      changed = true;
      fireReminder(t);
    }
    if (t.snooze_until && Date.parse(t.snooze_until) <= now) {
      t.snooze_until = null;
      changed = true;
      fireReminder(t);
    }
    if (!isReminder(t) && t.deadline && !t.overdue_notified && Date.parse(t.deadline) < now) {
      t.overdue_notified = true;
      changed = true;
      fireOverdue(t);
    }
  }
  if (changed) saveTasks();
  if (pendingError && charWin) {
    setOverride('error', pendingError, 12000);
    pendingError = null;
  }
  maybeEncourage(now);
  refreshState(false);
}

// ---------------------------------------------------------------- jendela
function defaultBounds() {
  const h = settings.size + BUBBLE_H;
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - WIN_W - 20, y: wa.y + wa.height - h - 10, width: WIN_W, height: h };
}

function initialBounds() {
  const def = defaultBounds();
  if (!Number.isFinite(settings.x) || !Number.isFinite(settings.y)) return def;
  const cx = settings.x + WIN_W / 2;
  const cy = settings.y + def.height / 2;
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height;
  });
  return visible ? { ...def, x: settings.x, y: settings.y } : def;
}

function createCharacterWindow() {
  const b = initialBounds();
  charWin = new BrowserWindow({
    ...b,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  charWin.setAlwaysOnTop(true, 'screen-saver');
  charWin.setIgnoreMouseEvents(true, { forward: true });
  charWin.loadFile(path.join(__dirname, 'character', 'index.html'));
  charWin.once('ready-to-show', () => {
    if (settings.showCharacter) charWin.showInactive();
  });
  charWin.webContents.on('did-finish-load', () => {
    charWin.webContents.send('settings-changed', settings);
    updateCursorPolling();
    refreshState(true);
    setTimeout(() => {
      const n = pendingTasks().length;
      setOverride('happy', n ? `Halo! Ada ${n} tugas yang belum selesai.` : 'Halo! Belum ada tugas, santai dulu.', 6000);
    }, 1500);
  });
  charWin.on('closed', () => { charWin = null; });
}

function showDashboard({ silent = false } = {}) {
  if (dashWin && !dashWin.isDestroyed()) {
    if (dashWin.isMinimized()) dashWin.restore();
    dashWin.show();
    dashWin.focus();
    return;
  }
  dashWin = new BrowserWindow({
    width: 940,
    height: 640,
    minWidth: 760,
    minHeight: 520,
    title: 'balBul',
    backgroundColor: '#08161f',
    autoHideMenuBar: true,
    show: false,
    icon: sprite('idle'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Dashboard tetap menerima Realtime meski jendelanya disembunyikan/minimize.
      backgroundThrottling: false,
    },
  });
  dashWin.setMenu(null);
  dashWin.loadFile(path.join(__dirname, 'dashboard', 'index.html'));
  dashWin.once('ready-to-show', () => { if (!silent && dashWin && !dashWin.isDestroyed()) dashWin.show(); });
  // tombol X hanya menyembunyikan, balBul tetap jalan di tray
  dashWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      dashWin.hide();
    }
  });
  dashWin.on('show', () => refreshState(true));
  dashWin.on('hide', () => refreshState(true));
  dashWin.on('closed', () => { dashWin = null; });
}

function toggleDashboard() {
  if (dashWin && !dashWin.isDestroyed() && dashWin.isVisible() && dashWin.isFocused()) dashWin.hide();
  else showDashboard();
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: 'Buka balBul', click: showDashboard },
    {
      label: settings.showCharacter ? 'Sembunyikan karakter' : 'Tampilkan karakter',
      click: () => applySettings({ showCharacter: !settings.showCharacter }),
    },
    { type: 'separator' },
    { label: 'Keluar', click: () => { quitting = true; app.quit(); } },
  ]);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(sprite('idle')).resize({ width: 20, height: 20 }));
  tray.setToolTip('balBul');
  tray.setContextMenu(buildMenu());
  tray.on('click', showDashboard);
}

// ---------------------------------------------------------------- IPC
ipcMain.handle('tasks:list', () => tasks);
ipcMain.handle('tasks:add', (_e, data) => addTask(data));
ipcMain.handle('tasks:update', (_e, id, patch) => updateTask(id, patch));
ipcMain.handle('tasks:toggle', (_e, id) => toggleTask(id));
ipcMain.handle('tasks:delete', (_e, id) => deleteTask(id));
ipcMain.handle('tasks:snooze', (_e, id, minutes) => snoozeTask(id, minutes));
ipcMain.handle('tasks:ack', (_e, id) => ackTask(id));
// ---- sprite berwarna: biru asli diputar ke warna pilihan, hasilnya disimpan sementara (cache)
const SPRITE_NAMES = ['idle', 'happy', 'reminder', 'urgent', 'marah', 'thinking', 'working', 'proud',
  'encourage', 'wait', 'sleep', 'afk', 'overtime', 'error', 'offline'];
const spriteCache = new Map();
function coloredDataUrl(file) {
  const key = file + '|' + settings.color;
  if (spriteCache.has(key)) return spriteCache.get(key);
  let img = nativeImage.createFromPath(file);
  if (!img.isEmpty() && colorLib.normalizeHex(settings.color) !== colorLib.DEFAULT) {
    const { width, height } = img.getSize();
    const buf = Buffer.from(img.toBitmap());
    colorLib.recolorPixels(buf, settings.color, 'bgra');
    img = nativeImage.createFromBitmap(buf, { width, height });
  }
  const url = img.toDataURL();
  if (spriteCache.size > 80) spriteCache.clear();
  spriteCache.set(key, url);
  return url;
}
ipcMain.handle('sprite:get', (_e, name, noeyes) => {
  if (!SPRITE_NAMES.includes(name)) return null;
  return coloredDataUrl(sprite(name + (noeyes ? '-noeyes' : '')));
});
ipcMain.handle('avatar:get', () => coloredDataUrl(path.join(ROOT, 'assets', 'avatar.png')));
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (_e, patch) => applySettings(patch));

// Token sesi Supabase disimpan terenkripsi memakai Windows DPAPI melalui safeStorage.
ipcMain.handle('auth-storage:get', () => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Penyimpanan aman Windows tidak tersedia.');
  const file = authSessionPath();
  if (!fs.existsSync(file)) return null;
  try { return safeStorage.decryptString(fs.readFileSync(file)); }
  catch (err) { console.error('Gagal membuka sesi akun:', err); return null; }
});
ipcMain.handle('auth-storage:set', (_e, value) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Penyimpanan aman Windows tidak tersedia.');
  if (typeof value !== 'string' || value.length > 200000) throw new Error('Data sesi tidak valid.');
  fs.mkdirSync(path.dirname(authSessionPath()), { recursive: true });
  fs.writeFileSync(authSessionPath(), safeStorage.encryptString(value));
  return true;
});
ipcMain.handle('auth-storage:remove', () => {
  try { fs.rmSync(authSessionPath(), { force: true }); } catch (_) { /* abaikan */ }
  return true;
});

ipcMain.on('char:ignore', (_e, ignore) => {
  if (charWin && !charWin.isDestroyed()) charWin.setIgnoreMouseEvents(!!ignore, { forward: true });
});
ipcMain.on('char:drag-start', () => {
  if (!charWin || charWin.isDestroyed()) return;
  const [x, y] = charWin.getPosition();
  dragStart = { x, y };
});
ipcMain.on('char:drag-move', (_e, dx, dy) => {
  if (!dragStart || !charWin || charWin.isDestroyed()) return;
  const area = screen.getDisplayMatching(charWin.getBounds()).workArea;
  const x = Math.max(area.x, Math.min(area.x + area.width - WIN_W, Math.round(dragStart.x + dx)));
  const y = Math.max(area.y, Math.min(area.y + area.height - settings.size - BUBBLE_H, Math.round(dragStart.y + dy)));
  charWin.setBounds({ x, y, width: WIN_W, height: settings.size + BUBBLE_H });
});
ipcMain.on('char:drag-end', () => {
  if (!charWin || charWin.isDestroyed() || !dragStart) return;
  const [x, y] = charWin.getPosition();
  dragStart = null;
  settings.x = x;
  settings.y = y;
  saveSettings();
});
ipcMain.on('char:click', toggleDashboard);
ipcMain.on('char:menu', () => {
  if (charWin && !charWin.isDestroyed()) buildMenu().popup({ window: charWin });
});
ipcMain.on('app:open-dashboard', () => showDashboard());
ipcMain.on('char:quick-reply', (_e, payload) => {
  if (!payload || typeof payload.conversationId !== 'string' || !dashWin || dashWin.isDestroyed()) return;
  const body = String(payload.body || '').trim().slice(0, 4000);
  if (body) dashWin.webContents.send('chat:quick-reply', { conversationId: payload.conversationId, body });
});
ipcMain.on('app:notify-chat', (_e, payload) => {
  if (!payload || typeof payload.conversationId !== 'string') return;
  const title = String(payload.title || 'Pesan baru').slice(0, 120);
  const body = String(payload.body || '').slice(0, 500);
  if (charWin && !charWin.isDestroyed()) charWin.webContents.send('character:chat-message', { conversationId: payload.conversationId, sender: title, body });

  if (!Notification.isSupported()) return;
  try {
    const n = new Notification({ title: `Pesan baru · ${title}`, body, icon: nativeImage.createFromPath(sprite('idle')) });
    n.on('click', () => {
      showDashboard();
      if (dashWin && !dashWin.isDestroyed()) {
        const conversationId = payload.conversationId;
        dashWin.webContents.send('chat:open-conversation', { conversationId });
      }
    });
    n.show();
  } catch (err) { console.error('Notifikasi chat gagal:', err); }
});

// ---------------------------------------------------------------- start
app.whenReady().then(() => {
  settings = { ...DEFAULT_SETTINGS, ...sanitizeSettings(readJson(settingsPath(), {}, 'pengaturan')) };
  const firstRun = !fs.existsSync(tasksPath());
  const loaded = readJson(tasksPath(), [], 'tugas');
  tasks = Array.isArray(loaded) ? loaded : [];

  createTray();
  createCharacterWindow();
  showDashboard({ silent: true });
  if (app.isPackaged) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('error', (err) => console.error('Auto-update gagal:', err));
    autoUpdater.on('update-downloaded', async (info) => {
      const result = await dialog.showMessageBox({
        type: 'info',
        title: 'Update balBul siap',
        message: `balBul versi ${info.version} sudah siap dipasang.`,
        detail: 'Simpan pekerjaanmu. balBul akan dimulai ulang untuk menyelesaikan update.',
        buttons: ['Update sekarang', 'Nanti saja'],
        defaultId: 0,
        cancelId: 1,
      });
      if (result.response === 0) autoUpdater.quitAndInstall();
    });
    setTimeout(() => autoUpdater.checkForUpdates().catch(err => console.error('Cek update gagal:', err)), 15000);
    setInterval(() => autoUpdater.checkForUpdates().catch(err => console.error('Cek update gagal:', err)), 6 * 60 * 60 * 1000);
  }
  setInterval(tick, 10000);
  setTimeout(tick, 2000);
  if (firstRun) showDashboard();
});

app.on('second-instance', showDashboard);
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* tetap hidup di tray */ });
