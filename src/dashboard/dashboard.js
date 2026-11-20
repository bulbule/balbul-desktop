'use strict';
const api = window.balbul;

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
const REMIND_OPTIONS = ['0', '10', '30', '60', '1440'];

let tasks = [];
let settings = {};
let view = 'today';
let editingId = null;

// ---------- helper kecil untuk bikin elemen (aman dari HTML injection) ----------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(props)) {
    if (val == null || val === false) continue;
    if (key === 'class') el.className = val;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), val);
    else if (val === true) el.setAttribute(key, '');
    else el.setAttribute(key, val);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const $ = (sel) => document.querySelector(sel);
const sameDay = (a, b) => a.toDateString() === b.toDateString();

function isToday(t) {
  const now = new Date();
  if (t.status === 'done') return sameDay(new Date(t.updated_at), now);
  if (!t.deadline) return true;
  const d = new Date(t.deadline);
  return d < now || sameDay(d, now);
}

function fmtWhen(iso) {
  return new Date(iso).toLocaleString('id-ID', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function sortTasks(list) {
  return [...list].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'done' ? 1 : -1;
    if (a.status === 'done') return Date.parse(b.updated_at) - Date.parse(a.updated_at);
    const da = a.deadline ? Date.parse(a.deadline) : Infinity;
    const db = b.deadline ? Date.parse(b.deadline) : Infinity;
    if (da !== db) return da - db;
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  });
}

// ---------- tampilan ----------
function ring(done, total) {
  const r = 29;
  const c = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '70');
  svg.setAttribute('height', '70');
  svg.setAttribute('viewBox', '0 0 70 70');
  const mk = (cls) => {
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('class', cls);
    circle.setAttribute('cx', '35');
    circle.setAttribute('cy', '35');
    circle.setAttribute('r', String(r));
    return circle;
  };
  const fg = mk('fg');
  fg.setAttribute('stroke-dasharray', String(c));
  fg.setAttribute('stroke-dashoffset', String(c * (1 - pct)));
  svg.append(mk('bg'), fg);
  return h('div', { class: 'ring' }, svg,
    h('div', { class: 'label' }, h('div', {}, `${done}/${total}`, h('small', {}, `${Math.round(pct * 100)}%`))));
}

function taskRow(t) {
  const late = t.status === 'pending' && t.deadline && Date.parse(t.deadline) < Date.now();
  return h('div', { class: `task ${t.status}` },
    h('input', { type: 'checkbox', checked: t.status === 'done', onchange: () => api.toggleTask(t.id) }),
    h('div', { class: 'body' },
      h('div', { class: 'title' }, t.title),
      t.description ? h('div', { class: 'desc' }, t.description) : null),
    h('span', { class: `chip ${t.priority}` }, PRIORITY_LABEL[t.priority]),
    t.deadline ? h('span', { class: `when${late ? ' late' : ''}` }, (late ? 'Telat · ' : '') + fmtWhen(t.deadline)) : null,
    h('button', { class: 'icon-btn', type: 'button', onclick: () => openForm(t) }, 'Edit'),
    h('button', {
      class: 'icon-btn del',
      type: 'button',
      onclick: () => { if (confirm(`Hapus "${t.title}"?`)) api.deleteTask(t.id); },
    }, 'Hapus'));
}

function renderTasksView() {
  const now = new Date();
  let list;
  let title;
  let subtitle = null;

  if (view === 'today') {
    list = tasks.filter(isToday);
    title = 'Tugas Hari Ini';
    subtitle = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } else if (view === 'done') {
    list = tasks.filter((t) => t.status === 'done');
    title = 'Selesai';
  } else {
    list = tasks;
    title = 'Semua Tugas';
  }

  const done = list.filter((t) => t.status === 'done').length;
  const head = h('div', { class: 'head' },
    h('div', {}, h('h1', {}, title), subtitle ? h('div', { class: 'date' }, subtitle) : null),
    view === 'done' ? null : ring(done, list.length));

  const rows = sortTasks(list).map(taskRow);
  const body = rows.length
    ? h('div', { class: 'list' }, rows)
    : h('div', { class: 'empty' }, view === 'done' ? 'Belum ada tugas yang selesai.' : 'Belum ada tugas. Klik "Tambah Tugas" di bawah.');

  const main = $('#main');
  main.replaceChildren(head, body,
    h('button', { class: 'add-btn', type: 'button', onclick: () => openForm(null) }, '+  Tambah Tugas'));

  const allDone = view === 'today' && list.length > 0 && done === list.length;
  $('#side-sprite').src = `../../assets/sprites/${allDone ? 'proud' : 'idle'}.png`;
}

function settingRow(name, hint, control) {
  return h('div', { class: 'setting' },
    h('div', {}, h('div', { class: 'name' }, name), hint ? h('div', { class: 'hint' }, hint) : null),
    h('div', { class: 'ctl' }, control));
}

function renderSettingsView() {
  const s = settings;
  const sizeVal = h('span', {}, `${s.size}px`);
  const opacityVal = h('span', {}, `${s.opacity}%`);

  const size = h('input', {
    type: 'range', min: '100', max: '260', step: '10', value: String(s.size),
    oninput: (e) => { sizeVal.textContent = `${e.target.value}px`; },
    onchange: (e) => api.setSettings({ size: Number(e.target.value) }),
  });
  const opacity = h('input', {
    type: 'range', min: '30', max: '100', step: '5', value: String(s.opacity),
    oninput: (e) => { opacityVal.textContent = `${e.target.value}%`; },
    onchange: (e) => api.setSettings({ opacity: Number(e.target.value) }),
  });
  const check = (key) => h('input', {
    type: 'checkbox', checked: !!s[key], onchange: (e) => api.setSettings({ [key]: e.target.checked }),
  });
  const time = (key) => h('input', {
    type: 'time', value: s[key], onchange: (e) => { if (e.target.value) api.setSettings({ [key]: e.target.value }); },
  });
  const encourage = h('select', { onchange: (e) => api.setSettings({ encourageEveryMin: Number(e.target.value) }) },
    [[0, 'Mati'], [30, 'Tiap 30 menit'], [60, 'Tiap 1 jam'], [120, 'Tiap 2 jam']].map(([v, label]) =>
      h('option', { value: String(v), selected: v === s.encourageEveryMin }, label)));

  $('#main').replaceChildren(
    h('div', { class: 'head' }, h('h1', {}, 'Pengaturan')),
    settingRow('Tampilkan karakter', 'Karakter balBul melayang di desktop.', check('showCharacter')),
    settingRow('Ukuran karakter', null, [size, sizeVal]),
    settingRow('Transparansi', null, [opacity, opacityVal]),
    settingRow('Posisi karakter', 'Tarik karakter dengan mouse untuk memindahkan.',
      h('button', { class: 'icon-btn', type: 'button', onclick: () => api.setSettings({ x: null, y: null }) }, 'Reset posisi')),
    settingRow('Suara notifikasi', null, check('sound')),
    settingRow('Kata semangat', 'balBul sesekali menyemangati kalau masih ada tugas.', encourage),
    settingRow('Jam tidur balBul', 'Saat jam ini balBul tidur (pengingat tetap bunyi).', [time('quietStart'), '–', time('quietEnd')]),
    settingRow('Jalan otomatis saat Windows nyala', 'Hanya berfungsi di versi .exe hasil build (npm run dist).', check('autoStart')));
}

function render() {
  for (const btn of document.querySelectorAll('#nav button')) {
    btn.classList.toggle('active', btn.dataset.view === view);
  }
  if (view === 'settings') renderSettingsView();
  else renderTasksView();
}

// ---------- form tambah / edit ----------
const dlg = $('#dlg');
const fRemind = $('#f-remind');

function showError(msg) {
  const el = $('#form-error');
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
}

function openForm(task) {
  editingId = task ? task.id : null;
  $('#form-title').textContent = task ? 'Edit Tugas' : 'Tambah Tugas';
  $('#f-title').value = task ? task.title : '';
  $('#f-desc').value = task && task.description ? task.description : '';
  $('#f-priority').value = task ? task.priority : 'medium';
  $('#f-deadline').value = task ? toLocalInput(task.deadline) : '';

  let remind = 'none';
  let custom = '';
  if (task && task.reminder_at) {
    const diff = task.deadline ? Math.round((Date.parse(task.deadline) - Date.parse(task.reminder_at)) / 60000) : null;
    if (diff !== null && REMIND_OPTIONS.includes(String(diff))) remind = String(diff);
    else { remind = 'custom'; custom = toLocalInput(task.reminder_at); }
  }
  fRemind.value = remind;
  $('#f-custom').value = custom;
  $('#custom-wrap').classList.toggle('hidden', remind !== 'custom');
  showError('');
  dlg.showModal();
  $('#f-title').focus();
}

fRemind.addEventListener('change', () => {
  $('#custom-wrap').classList.toggle('hidden', fRemind.value !== 'custom');
});
$('#btn-cancel').addEventListener('click', () => dlg.close());

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('#f-title').value.trim();
  if (!title) return showError('Judul tidak boleh kosong.');

  const deadlineVal = $('#f-deadline').value;
  const deadline = deadlineVal ? new Date(deadlineVal).toISOString() : null;
  let reminderAt = null;

  if (fRemind.value === 'custom') {
    if (!$('#f-custom').value) return showError('Isi waktu pengingatnya dulu.');
    reminderAt = new Date($('#f-custom').value).toISOString();
  } else if (fRemind.value !== 'none') {
    if (!deadline) return showError('Isi deadline dulu supaya bisa diingatkan sebelum deadline.');
    reminderAt = new Date(Date.parse(deadline) - Number(fRemind.value) * 60000).toISOString();
  }

  const data = {
    title,
    description: $('#f-desc').value,
    priority: $('#f-priority').value,
    deadline,
    reminder_at: reminderAt,
  };
  if (editingId) await api.updateTask(editingId, data);
  else await api.addTask(data);
  dlg.close();
});

// ---------- navigasi & event ----------
$('#nav').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  view = btn.dataset.view;
  render();
});

api.on('tasks-changed', (list) => {
  tasks = list;
  if (view !== 'settings') render();
});
api.on('settings-changed', (s) => {
  settings = s;
  if (view === 'settings') render();
});

// perbarui label "Telat" tiap 30 detik
setInterval(() => { if (view !== 'settings' && !dlg.open) render(); }, 30000);

Promise.all([api.listTasks(), api.getSettings()]).then(([list, s]) => {
  tasks = list;
  settings = s;
  render();
});
