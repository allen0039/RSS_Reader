const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Feeds
  getFeeds: () => ipcRenderer.invoke('get-feeds'),
  saveFeeds: (feeds) => ipcRenderer.invoke('save-feeds', feeds),
  fetchFeed: (url) => ipcRenderer.invoke('fetch-feed', url),

  // AI Config
  getAiConfig: () => ipcRenderer.invoke('get-ai-config'),
  saveAiConfig: (config) => ipcRenderer.invoke('save-ai-config', config),

  // AI Request
  aiRequest: (payload) => ipcRenderer.invoke('ai-request', payload),

  // External
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Telegram
  getTgConfig: () => ipcRenderer.invoke('get-tg-config'),
  saveTgConfig: (cfg) => ipcRenderer.invoke('save-tg-config', cfg),
  generateDigest: (feeds) => ipcRenderer.invoke('generate-digest', feeds),
  sendTelegram: (text) => ipcRenderer.invoke('send-telegram', text),

  // Theme
  getTheme: () => ipcRenderer.invoke('get-theme'),
  saveTheme: (theme) => ipcRenderer.invoke('save-theme', theme),

  // Import / Export feeds
  exportFeeds: () => ipcRenderer.invoke('export-feeds'),
  importFeeds: () => ipcRenderer.invoke('import-feeds'),

  // Backup / Restore
  createBackup: () => ipcRenderer.invoke('create-backup'),
  restoreBackup: () => ipcRenderer.invoke('restore-backup')
});