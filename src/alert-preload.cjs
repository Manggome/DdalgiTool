const { contextBridge, ipcRenderer } = require('electron');

// 플로팅 알림 카드 창(alert.html) 전용 — 승인 요청·작업 완료 카드만 다룬다.
contextBridge.exposeInMainWorld('alertApi', {
  onItems: (cb) => ipcRenderer.on('alert:items', (_e, items) => cb(items)),
  decide: (id, decision) => ipcRenderer.send('alert:decide', { id, decision }),
  dismiss: (key) => ipcRenderer.send('alert:dismiss', { key }),
  open: (key) => ipcRenderer.send('alert:open', { key }),
  resize: (height) => ipcRenderer.send('alert:resize', height),
});
