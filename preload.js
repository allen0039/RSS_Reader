const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Feeds
  getFeeds: () => ipcRenderer.invoke('get-feeds'),
  saveFeeds: (feeds) => ipcRenderer.invoke('save-feeds', feeds),
  fetchFeed: (url) => ipcRenderer.invoke('fetch-feed', url),

  // AI Config
  getAiConfig: () => ipcRenderer.invoke('get-ai-config'),
  saveAiConfig: (config) => ipcRenderer.invoke('save-ai-config', config),

  // Reader Preferences
  getReaderPreferences: () => ipcRenderer.invoke('get-reader-preferences'),
  saveReaderPreferences: (prefs) => ipcRenderer.invoke('save-reader-preferences', prefs),

  // AI Request
  aiRequest: (payload) => ipcRenderer.invoke('ai-request', payload),
  aiHealthCheck: () => ipcRenderer.invoke('ai-health-check'),


  // External
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Telegram
  getTgConfig: () => ipcRenderer.invoke('get-tg-config'),
  saveTgConfig: (cfg) => ipcRenderer.invoke('save-tg-config', cfg),
  generateDigest: (feeds) => ipcRenderer.invoke('generate-digest', feeds),
  sendTelegram: (text) => ipcRenderer.invoke('send-telegram', text),

  // FreshRSS
  getFreshRssConfig: () => ipcRenderer.invoke('get-freshrss-config'),
  saveFreshRssConfig: (cfg) => ipcRenderer.invoke('save-freshrss-config', cfg),
  freshRssLogin: (payload) => ipcRenderer.invoke('freshrss-login', payload),
  freshRssSync: (payload) => ipcRenderer.invoke('freshrss-sync', payload),
  freshRssFetchGroup: (options) => ipcRenderer.invoke('freshrss-fetch-group', options),
  freshRssMarkRead: (payload) => ipcRenderer.invoke('freshrss-mark-read', payload),
  onAutoRefreshTick: (cb) => ipcRenderer.on('auto-refresh-tick', cb),

  // Theme
  getTheme: () => ipcRenderer.invoke('get-theme'),
  saveTheme: (theme) => ipcRenderer.invoke('save-theme', theme),

  // Import / Export feeds
  exportFeeds: () => ipcRenderer.invoke('export-feeds'),
  importFeeds: () => ipcRenderer.invoke('import-feeds'),

  // Backup / Restore
  createBackup: (options) => ipcRenderer.invoke('create-backup', options),
  restoreBackup: () => ipcRenderer.invoke('restore-backup')
});
