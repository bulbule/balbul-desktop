'use strict';
// Jembatan aman antara tampilan (HTML) dan "otak" aplikasi (main.js).
const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_EVENTS = ['tasks-changed', 'settings-changed', 'character:state', 'character:cursor'];

contextBridge.exposeInMainWorld('balbul', {
  // tugas
  listTasks: () => ipcRenderer.invoke('tasks:list'),
  addTask: (data) => ipcRenderer.invoke('tasks:add', data),
  updateTask: (id, patch) => ipcRenderer.invoke('tasks:update', id, patch),
  toggleTask: (id) => ipcRenderer.invoke('tasks:toggle', id),
  deleteTask: (id) => ipcRenderer.invoke('tasks:delete', id),
  snoozeTask: (id, minutes) => ipcRenderer.invoke('tasks:snooze', id, minutes),
  ackTask: (id) => ipcRenderer.invoke('tasks:ack', id),

  // pengaturan
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  // karakter
  ignoreMouse: (ignore) => ipcRenderer.send('char:ignore', ignore),
  dragStart: () => ipcRenderer.send('char:drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('char:drag-move', dx, dy),
  dragEnd: () => ipcRenderer.send('char:drag-end'),
  clickCharacter: () => ipcRenderer.send('char:click'),
  characterMenu: () => ipcRenderer.send('char:menu'),
  openDashboard: () => ipcRenderer.send('app:open-dashboard'),

  // event dari main.js
  on: (channel, callback) => {
    if (!ALLOWED_EVENTS.includes(channel)) return;
    ipcRenderer.on(channel, (_event, payload) => callback(payload));
  },
});
