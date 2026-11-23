'use strict';
// Jembatan aman antara tampilan (HTML) dan "otak" aplikasi (main.js).
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const ALLOWED_EVENTS = ['tasks-changed', 'settings-changed', 'character:state', 'character:cursor', 'character:edge', 'character:placement', 'chat:open-conversation', 'chat:quick-reply', 'character:chat-message', 'character:share-received', 'share:ready', 'share:error', 'share:expired', 'share:closed', 'share:copied', 'share:pick-friend', 'receive:ready', 'receive:file', 'receive:error', 'receive:expired', 'receive:closed'];

contextBridge.exposeInMainWorld('balbul', {
  // penyimpanan sesi akun (terenkripsi oleh main process)
  authStorage: {
    get: () => ipcRenderer.invoke('auth-storage:get'),
    set: (value) => ipcRenderer.invoke('auth-storage:set', value),
    remove: () => ipcRenderer.invoke('auth-storage:remove'),
  },

  // tugas
  listTasks: () => ipcRenderer.invoke('tasks:list'),
  replaceCloudPersonalTasks: (list) => ipcRenderer.invoke('tasks:replace-cloud-personal', list),
  addTask: (data) => ipcRenderer.invoke('tasks:add', data),
  updateTask: (id, patch) => ipcRenderer.invoke('tasks:update', id, patch),
  toggleTask: (id) => ipcRenderer.invoke('tasks:toggle', id),
  deleteTask: (id) => ipcRenderer.invoke('tasks:delete', id),
  snoozeTask: (id, minutes) => ipcRenderer.invoke('tasks:snooze', id, minutes),
  ackTask: (id) => ipcRenderer.invoke('tasks:ack', id),

  // pengaturan
  getSettings: () => ipcRenderer.invoke('settings:get'),
  getSprite: (name, noeyes) => ipcRenderer.invoke('sprite:get', name, !!noeyes),
  getAvatar: (color) => ipcRenderer.invoke('avatar:get', color),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  // karakter
  ignoreMouse: (ignore) => ipcRenderer.send('char:ignore', ignore),
  dragStart: (x, y) => ipcRenderer.send('char:drag-start', x, y),
  dragEnd: () => ipcRenderer.send('char:drag-end'),
  clickCharacter: () => ipcRenderer.send('char:click'),
  characterMenu: () => ipcRenderer.send('char:menu'),
  openDashboard: () => ipcRenderer.send('app:open-dashboard'),
  notifyChat: (payload) => ipcRenderer.send('app:notify-chat', payload),
  sendQuickReply: (payload) => ipcRenderer.send('char:quick-reply', payload),
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); }
    catch (_) { return typeof file?.path === 'string' ? file.path : ''; }
  },
  startShare: (filePath) => ipcRenderer.invoke('share:start', filePath),
  stopShare: () => ipcRenderer.invoke('share:stop'),
  shareToFriend: (share) => ipcRenderer.send('app:share-to-friend', share),
  openShareDownload: (url) => ipcRenderer.send('app:open-share-download', url),
  openExternalLink: (url) => ipcRenderer.send('app:open-external-link', url),
  startReceive: () => ipcRenderer.invoke('receive:start'),
  stopReceive: () => ipcRenderer.invoke('receive:stop'),
  openReceiveFolder: () => ipcRenderer.invoke('receive:open-folder'),

  // event dari main.js
  on: (channel, callback) => {
    if (!ALLOWED_EVENTS.includes(channel)) return;
    ipcRenderer.on(channel, (_event, payload) => callback(payload));
  },
});
