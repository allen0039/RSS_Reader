const { app, BrowserWindow, ipcMain, shell, dialog, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const StoreModule = require('electron-store');
const Store = StoreModule.default || StoreModule;
const Parser = require('rss-parser');

const store = new Store();
const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) RSS Reader'
  }
});

let mainWindow;

function createWindow() {
  // Apply saved theme to nativeTheme before window creation
  const savedTheme = store.get('theme', 'dark');
  if (savedTheme === 'light') nativeTheme.themeSource = 'light';
  else if (savedTheme === 'system') nativeTheme.themeSource = 'system';
  else nativeTheme.themeSource = 'dark';

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── Store: Feeds ────────────────────────────────────────────────────────────
ipcMain.handle('get-feeds', () => {
  return store.get('feeds', []);
});

ipcMain.handle('save-feeds', (_, feeds) => {
  store.set('feeds', feeds);
  return true;
});

// ─── Store: AI Config ────────────────────────────────────────────────────────
ipcMain.handle('get-ai-config', () => {
  return store.get('aiConfig', {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    summaryPrompt: '请用中文简洁地总结以下文章内容，200字以内：',
    translatePrompt: '请将以下内容翻译成中文：'
  });
});

ipcMain.handle('save-ai-config', (_, config) => {
  store.set('aiConfig', config);
  return true;
});

// ─── Fetch RSS ────────────────────────────────────────────────────────────────
ipcMain.handle('fetch-feed', async (_, url) => {
  try {
    const feed = await parser.parseURL(url);
    return {
      success: true,
      title: feed.title || url,
      items: (feed.items || []).map(item => ({
        title: item.title || '无标题',
        link: item.link || '',
        pubDate: item.pubDate || item.isoDate || '',
        contentSnippet: item.contentSnippet || '',
        content: item.content || item['content:encoded'] || item.contentSnippet || '',
        author: item.author || item.creator || ''
      }))
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── AI Request ───────────────────────────────────────────────────────────────
ipcMain.handle('ai-request', async (_, { text, mode }) => {
  const config = store.get('aiConfig', {});
  const baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const apiKey = config.apiKey || '';
  const model = config.model || 'gpt-4o-mini';

  let systemPrompt = '';
  if (mode === 'summary') {
    systemPrompt = config.summaryPrompt || '请用中文简洁地总结以下文章内容，200字以内：';
  } else if (mode === 'translate') {
    systemPrompt = config.translatePrompt || '请将以下内容翻译成中文：';
  }

  if (!apiKey) {
    return { success: false, error: '请先在设置中配置 API Key' };
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        max_tokens: 1024,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return { success: false, error: `API 错误 ${response.status}: ${err}` };
    }

    const data = await response.json();
    const result = data.choices?.[0]?.message?.content || '';
    return { success: true, result };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── Open external link ───────────────────────────────────────────────────────
ipcMain.handle('open-external', (_, url) => {
  shell.openExternal(url);
});

// ─── Theme ────────────────────────────────────────────────────────────────────
ipcMain.handle('get-theme', () => {
  return store.get('theme', 'dark');
});

ipcMain.handle('save-theme', (_, theme) => {
  store.set('theme', theme);
  if (theme === 'light') nativeTheme.themeSource = 'light';
  else if (theme === 'system') nativeTheme.themeSource = 'system';
  else nativeTheme.themeSource = 'dark';
  return true;
});

// ─── Export Feeds ─────────────────────────────────────────────────────────────
ipcMain.handle('export-feeds', async () => {
  const feeds = store.get('feeds', []);
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出订阅源',
      defaultPath: `rss-feeds-${new Date().toISOString().slice(0,10)}.json`,
      filters: [{ name: 'JSON 文件', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };
    fs.writeFileSync(result.filePath, JSON.stringify(feeds, null, 2), 'utf8');
    return { success: true, path: result.filePath, count: feeds.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── Import Feeds ─────────────────────────────────────────────────────────────
ipcMain.handle('import-feeds', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入订阅源',
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return { success: false, canceled: true };
    const raw = fs.readFileSync(result.filePaths[0], 'utf8');
    const imported = JSON.parse(raw);
    if (!Array.isArray(imported)) return { success: false, error: '文件格式不正确，需要 JSON 数组' };
    return { success: true, feeds: imported };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── Create Backup ────────────────────────────────────────────────────────────
ipcMain.handle('create-backup', async () => {
  try {
    const backup = {
      appVersion: '1.0.1',
      createdAt: new Date().toISOString(),
      feeds: store.get('feeds', []),
      aiConfig: store.get('aiConfig', {}),
      tgConfig: store.get('tgConfig', {}),
      theme: store.get('theme', 'dark')
    };
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存全量备份',
      defaultPath: `rss-backup-${new Date().toISOString().slice(0,10)}.json`,
      filters: [{ name: 'JSON 文件', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };
    fs.writeFileSync(result.filePath, JSON.stringify(backup, null, 2), 'utf8');
    return { success: true, path: result.filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── Restore Backup ───────────────────────────────────────────────────────────
ipcMain.handle('restore-backup', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择备份文件',
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return { success: false, canceled: true };
    const raw = fs.readFileSync(result.filePaths[0], 'utf8');
    const backup = JSON.parse(raw);
    if (backup.feeds) store.set('feeds', backup.feeds);
    if (backup.aiConfig) store.set('aiConfig', backup.aiConfig);
    if (backup.tgConfig) store.set('tgConfig', backup.tgConfig);
    if (backup.theme) store.set('theme', backup.theme);
    return { success: true, backup };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── Telegram Config ──────────────────────────────────────────────────────────
ipcMain.handle('get-tg-config', () => {
  return store.get('tgConfig', {
    botToken: '',
    chatId: '',
    digestPrompt: '请用中文简洁总结以下文章内容，3句话以内：',
    maxArticles: 5
  });
});

ipcMain.handle('save-tg-config', (_, cfg) => {
  store.set('tgConfig', cfg);
  return true;
});

// ─── Generate Digest ──────────────────────────────────────────────────────────
ipcMain.handle('generate-digest', async (_, feeds) => {
  const aiConfig = store.get('aiConfig', {});
  const tgConfig = store.get('tgConfig', {});
  const baseUrl = (aiConfig.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const apiKey = aiConfig.apiKey || '';
  const model = aiConfig.model || 'gpt-4o-mini';
  const digestPrompt = tgConfig.digestPrompt || '请用中文简洁总结以下文章内容，3句话以内：';
  const maxArticles = parseInt(tgConfig.maxArticles) || 5;

  if (!apiKey) return { success: false, error: '请先在设置中配置 AI API Key' };
  if (!feeds || feeds.length === 0) return { success: false, error: '没有可用的订阅源' };

  const date = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  let doc = `📰 RSS 日报 · ${date}\n\n`;
  const results = [];

  for (const feed of feeds) {
    try {
      const parsed = await parser.parseURL(feed.url);
      const items = (parsed.items || []).slice(0, maxArticles);
      if (items.length === 0) continue;

      doc += `【${feed.name}】\n`;

      for (const item of items) {
        const text = item.contentSnippet || item.content || item['content:encoded'] || '';
        let summary = '';

        if (text && text.trim().length > 0) {
          try {
            const resp = await fetch(`${baseUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
              },
              body: JSON.stringify({
                model,
                messages: [
                  { role: 'system', content: digestPrompt },
                  { role: 'user', content: text.slice(0, 3000) }
                ],
                max_tokens: 200,
                temperature: 0.7
              })
            });
            if (resp.ok) {
              const d = await resp.json();
              summary = d.choices?.[0]?.message?.content?.trim() || '';
            }
          } catch (aiErr) {
            summary = '';
          }
        }

        const titleLine = item.title || '无标题';
        const linkLine = item.link ? ` (${item.link})` : '';
        doc += `• ${titleLine}${linkLine}\n`;
        if (summary) doc += `  ${summary}\n`;
        doc += '\n';
      }

      doc += '\n';
      results.push({ feedName: feed.name, ok: true, count: items.length });
    } catch (e) {
      results.push({ feedName: feed.name, ok: false, error: e.message });
    }
  }

  return { success: true, digest: doc, results };
});

// ─── Send to Telegram ─────────────────────────────────────────────────────────
ipcMain.handle('send-telegram', async (_, text) => {
  const cfg = store.get('tgConfig', {});
  if (!cfg.botToken || !cfg.chatId) {
    return { success: false, error: '请先在设置 → Telegram 中配置 Bot Token 和 Chat ID' };
  }

  const chunkSize = 4000;
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }

  try {
    for (const chunk of chunks) {
      const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: cfg.chatId,
          text: chunk,
          disable_web_page_preview: true
        })
      });
      if (!res.ok) {
        const errText = await res.text();
        return { success: false, error: `Telegram API 错误: ${errText}` };
      }
    }
    return { success: true, chunks: chunks.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
});