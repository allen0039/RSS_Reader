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
const autoRefreshTimers = new Map();

function getFreshRssAccounts() {
  const list = store.get('freshrssAccounts', []);
  return Array.isArray(list) ? list : [];
}

function setFreshRssAccounts(accounts) {
  store.set('freshrssAccounts', accounts);
}

function restartFreshRssAutoRefresh() {
  for (const t of autoRefreshTimers.values()) clearInterval(t);
  autoRefreshTimers.clear();

  const accounts = getFreshRssAccounts();
  accounts.forEach(acc => {
    const intervalMin = parseInt(acc.refreshInterval) || 0;
    if (!intervalMin || !acc.authToken) return;
    const ms = intervalMin * 60 * 1000;
    const t = setInterval(() => {
      if (!mainWindow) return;
      mainWindow.webContents.send('auto-refresh-tick', { accountId: acc.id });
    }, ms);
    autoRefreshTimers.set(acc.id, t);
  });
}

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
  restartFreshRssAutoRefresh();
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

// ─── Reader Preferences ───────────────────────────────────────────────────────
ipcMain.handle('get-reader-preferences', () => {
  return store.get('readerPreferences', {
    showArticleImages: true,
    scrollMarkReadEnabled: true,
    listScrollMarkReadEnabled: false
  });
});

ipcMain.handle('save-reader-preferences', (_, prefs) => {
  const oldPrefs = store.get('readerPreferences', {
    showArticleImages: true,
    scrollMarkReadEnabled: true,
    listScrollMarkReadEnabled: false
  });
  store.set('readerPreferences', {
    ...oldPrefs,
    ...prefs
  });
  return true;
});

// ─── Store: FreshRSS Accounts (multi-login) ──────────────────────────────────
ipcMain.handle('get-freshrss-config', () => {
  let accounts = getFreshRssAccounts();
  if (accounts.length === 0) {
    const old = store.get('freshrssConfig', null);
    if (old && (old.baseUrl || old.username || old.authToken)) {
      accounts = [{
        id: `fr_migrated_${Date.now()}`,
        groupName: old.username || 'FreshRSS',
        baseUrl: old.baseUrl || '',
        username: old.username || '',
        apiPassword: old.apiPassword || '',
        authToken: old.authToken || '',
        userId: old.userId || '',
        loggedInAt: old.loggedInAt || '',
        refreshInterval: old.refreshInterval || 30,
        collapsed: false,
        collapsedCategories: []
      }];
      setFreshRssAccounts(accounts);
      store.set('freshrssActiveAccountId', accounts[0].id);
      restartFreshRssAutoRefresh();
    }
  }
  return {
    accounts,
    activeAccountId: store.get('freshrssActiveAccountId', '')
  };
});

ipcMain.handle('save-freshrss-config', (_, payload = {}) => {
  const accounts = getFreshRssAccounts();
  if (!Array.isArray(payload.accounts)) return true;

  const merged = payload.accounts.map(inAcc => {
    const old = accounts.find(a => a.id === inAcc.id) || {};
    const next = { ...old, ...inAcc };
    if (!inAcc.apiPassword && old.apiPassword) next.apiPassword = old.apiPassword;
    if (!next.id) next.id = `fr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    if (!next.groupName) next.groupName = next.username || 'FreshRSS';
    if (!Array.isArray(next.collapsedCategories)) next.collapsedCategories = [];
    return next;
  });

  setFreshRssAccounts(merged);
  if (payload.activeAccountId !== undefined) {
    store.set('freshrssActiveAccountId', payload.activeAccountId || '');
  }
  restartFreshRssAutoRefresh();
  return true;
});

function normalizeFreshRssApiBase(rawUrl) {
  if (!rawUrl) return '';
  let u = rawUrl.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  u = u.replace(/\/$/, '');
  if (u.endsWith('/api/greader.php')) return u;
  if (u.endsWith('/api/greader.php/')) return u.slice(0, -1);
  if (u.endsWith('/api')) return `${u}/greader.php`;
  return `${u}/api/greader.php`;
}

function pickImageUrlFromAny(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    for (const x of v) {
      const u = pickImageUrlFromAny(x);
      if (u) return u;
    }
    return '';
  }
  if (typeof v === 'object') {
    return v.url || v.href || v.src || v?.$?.url || v?.$?.href || '';
  }
  return '';
}

function normalizeImageUrl(url) {
  if (!url) return '';
  const u = String(url).trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('data:image/')) return u;
  return '';
}

async function freshrssRequest(account, pathSuffix, options = {}) {
  const apiBase = normalizeFreshRssApiBase(account.baseUrl || '');
  if (!apiBase) {
    throw new Error('请先在设置中填写 FreshRSS 地址');
  }
  const url = `${apiBase}${pathSuffix}`;
  const headers = { ...(options.headers || {}) };
  if (account.authToken) {
    headers.Authorization = `GoogleLogin auth=${account.authToken}`;
  }
  return fetch(url, { ...options, headers });
}

// ─── FreshRSS Login ───────────────────────────────────────────────────────────
ipcMain.handle('freshrss-login', async (_, { accountId } = {}) => {
  try {
    const accounts = getFreshRssAccounts();
    const idx = accounts.findIndex(a => a.id === accountId);
    if (idx < 0) return { success: false, error: '账号不存在' };
    const acc = accounts[idx];

    const apiBase = normalizeFreshRssApiBase(acc.baseUrl || '');
    const username = (acc.username || '').trim();
    const apiPassword = (acc.apiPassword || '').trim();

    if (!apiBase || !username || !apiPassword) {
      return { success: false, error: '请先填写 FreshRSS 地址、用户名和 API Password' };
    }

    const authUrl = `${apiBase}/accounts/ClientLogin?Email=${encodeURIComponent(username)}&Passwd=${encodeURIComponent(apiPassword)}`;
    const resp = await fetch(authUrl, { method: 'GET' });
    const text = await resp.text();
    if (!resp.ok) {
      return { success: false, error: `登录失败 (${resp.status})：${text}` };
    }

    const match = text.match(/^Auth=(.+)$/m);
    if (!match) {
      return { success: false, error: `未获取到 Auth Token：${text}` };
    }
    const authToken = match[1].trim();

    const userInfoResp = await fetch(`${apiBase}/reader/api/0/user-info`, {
      headers: { Authorization: `GoogleLogin auth=${authToken}` }
    });
    const userInfoText = await userInfoResp.text();
    if (!userInfoResp.ok) {
      return { success: false, error: `登录成功但读取用户信息失败 (${userInfoResp.status})：${userInfoText}` };
    }

    let userId = '';
    try {
      const userInfo = JSON.parse(userInfoText);
      userId = userInfo.userId || '';
    } catch (_) {
      userId = '';
    }

    accounts[idx] = {
      ...acc,
      baseUrl: acc.baseUrl,
      username,
      apiPassword,
      authToken,
      userId,
      loggedInAt: new Date().toISOString()
    };
    setFreshRssAccounts(accounts);
    restartFreshRssAutoRefresh();
    return { success: true, userId, accountId };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── FreshRSS Sync Subscriptions ──────────────────────────────────────────────
ipcMain.handle('freshrss-sync', async (_, { accountId } = {}) => {
  try {
    const accounts = getFreshRssAccounts();
    const acc = accounts.find(a => a.id === accountId);
    if (!acc || !acc.authToken) {
      return { success: false, error: '请先完成 FreshRSS 登录验证' };
    }

    // fetch subscription list
    const resp = await freshrssRequest(acc, '/reader/api/0/subscription/list?output=json', { method: 'GET' });
    const text = await resp.text();
    if (!resp.ok) {
      return { success: false, error: `同步失败 (${resp.status})：${text}` };
    }

    let data;
    try { data = JSON.parse(text); } catch (_) {
      return { success: false, error: '订阅列表响应不是有效 JSON' };
    }

    const subs = Array.isArray(data.subscriptions) ? data.subscriptions : [];
    const feeds = subs
      .map(s => ({
        url: s.id && s.id.startsWith('feed/') ? s.id.slice(5) : '',
        name: s.title || '',
        frId: s.id || ''          // keep original feed/... id for mark-read calls
      }))
      .filter(f => f.url);

    // fetch unread item ids
    let unreadIds = [];
    try {
      const unreadResp = await freshrssRequest(
        acc,
        '/reader/api/0/stream/items/ids?output=json&s=user/-/state/com.google/reading-list&xt=user/-/state/com.google/read&n=5000',
        { method: 'GET' }
      );
      if (unreadResp.ok) {
        const ud = await unreadResp.json();
        unreadIds = (ud.itemRefs || []).map(r => String(r.id));
      }
    } catch (_) { /* ignore, unread tracking optional */ }

    return { success: true, feeds, unreadIds };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── FreshRSS Remote Group Fetch (Reeder-like) ───────────────────────────────
ipcMain.handle('freshrss-fetch-group', async (_, options = {}) => {
  try {
    const accounts = getFreshRssAccounts();
    const accountId = options.accountId;
    const acc = accounts.find(a => a.id === accountId);
    if (!acc || !acc.authToken) {
      return { success: false, error: '请先完成 FreshRSS 登录验证' };
    }

    const reqLimit = parseInt(options.limit);
    const isUnlimited = !reqLimit || reqLimit <= 0;
    const targetLimit = isUnlimited ? Infinity : Math.max(100, Math.min(20000, reqLimit));
    const pageSize = Math.min(1000, isUnlimited ? 1000 : targetLimit);

    const subsResp = await freshrssRequest(acc, '/reader/api/0/subscription/list?output=json', { method: 'GET' });
    const subsText = await subsResp.text();
    if (!subsResp.ok) {
      return { success: false, error: `获取订阅源失败 (${subsResp.status})：${subsText}` };
    }

    const subsData = JSON.parse(subsText || '{}');
    const subscriptions = Array.isArray(subsData.subscriptions) ? subsData.subscriptions : [];
    const feeds = subscriptions
      .map(s => ({
        frId: s.id || '',
        url: s.id && s.id.startsWith('feed/') ? s.id.slice(5) : '',
        name: s.title || '未命名订阅源',
        categories: (s.categories || []).map(c => c.label || '').filter(Boolean)
      }))
      .filter(f => f.url);

    let pages = 0;
    let continuation = '';
    let mergedItems = [];

    while (true) {
      const path = continuation
        ? `/reader/api/0/stream/contents/user/-/state/com.google/reading-list?output=json&n=${pageSize}&c=${encodeURIComponent(continuation)}`
        : `/reader/api/0/stream/contents/user/-/state/com.google/reading-list?output=json&n=${pageSize}`;
      const streamResp = await freshrssRequest(acc, path, { method: 'GET' });
      const streamText = await streamResp.text();
      if (!streamResp.ok) {
        return { success: false, error: `获取文章失败 (${streamResp.status})：${streamText}` };
      }
      const streamData = JSON.parse(streamText || '{}');
      const items = Array.isArray(streamData.items) ? streamData.items : [];
      mergedItems = mergedItems.concat(items);
      pages += 1;

      continuation = streamData.continuation || '';
      if (!continuation) break;
      if (!isUnlimited && mergedItems.length >= targetLimit) break;
    }

    let items = mergedItems;
    if (!isUnlimited && items.length > targetLimit) items = items.slice(0, targetLimit);

    // Optional: backfill per feed for fuller coverage (Reeder-like)
    if (options.perFeedBackfill) {
      const byFeed = new Set(items.map(i => i?.origin?.streamId).filter(Boolean));
      for (const feedId of byFeed) {
        let feedContinuation = '';
        let guard = 0;
        while (guard < 10) {
          guard += 1;
          const p = feedContinuation
            ? `/reader/api/0/stream/contents/${encodeURIComponent(feedId)}?output=json&n=300&c=${encodeURIComponent(feedContinuation)}`
            : `/reader/api/0/stream/contents/${encodeURIComponent(feedId)}?output=json&n=300`;
          const r = await freshrssRequest(acc, p, { method: 'GET' });
          if (!r.ok) break;
          const d = await r.json();
          const arr = Array.isArray(d.items) ? d.items : [];
          const existed = new Set(items.map(x => String(x.id)));
          arr.forEach(x => {
            if (!existed.has(String(x.id))) items.push(x);
          });
          pages += 1;
          feedContinuation = d.continuation || '';
          if (!feedContinuation) break;
          if (!isUnlimited && items.length >= targetLimit) break;
        }
        if (!isUnlimited && items.length >= targetLimit) break;
      }
      if (!isUnlimited && items.length > targetLimit) items = items.slice(0, targetLimit);
    }
    const readTag = 'user/-/state/com.google/read';

    const articles = items.map((item, idx) => {
      const categories = Array.isArray(item.categories) ? item.categories : [];
      const link = item?.canonical?.[0]?.href || item?.alternate?.[0]?.href || '';
      const content = item?.content?.content || item?.summary?.content || '';
      const originId = item?.origin?.streamId || '';
      const feedUrl = originId.startsWith('feed/') ? originId.slice(5) : '';
      const published = item.published ? new Date(item.published * 1000).toISOString() : '';
      // Try to extract image URL from multiple common fields
      const imageUrl = normalizeImageUrl(
        pickImageUrlFromAny(item.enclosure) ||
        pickImageUrlFromAny(item['media:thumbnail']) ||
        pickImageUrlFromAny(item['media:content']) ||
        pickImageUrlFromAny(item.thumbnail) ||
        pickImageUrlFromAny(item.image)
      );
      return {
        frItemId: String(item.id || idx),
        title: item.title || '无标题',
        link,
        pubDate: published,
        contentSnippet: item.summary?.content || '',
        content,
        imageUrl,
        author: item.author || '',
        feedName: item?.origin?.title || 'FreshRSS',
        feedUrl,
        categories: categories.filter(x => x.startsWith('user/-/label/')).map(x => x.replace('user/-/label/', '')),
        unread: !categories.includes(readTag)
      };
    });

    return {
      success: true,
      accountId,
      feeds,
      articles,
      stats: {
        fetched: articles.length,
        pages,
        limited: !isUnlimited,
        limit: isUnlimited ? 0 : targetLimit,
        mode: options.perFeedBackfill ? 'per-feed-backfill' : 'global-stream'
      }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── FreshRSS Mark as Read ────────────────────────────────────────────────────
ipcMain.handle('freshrss-mark-read', async (_, { accountId, itemIds }) => {
  try {
    const accounts = getFreshRssAccounts();
    const acc = accounts.find(a => a.id === accountId);
    if (!acc || !acc.authToken) return { success: false, error: '未登录' };
    if (!itemIds || itemIds.length === 0) return { success: true };

    // GReader API: POST to edit-tag, add read state
    // itemIds are plain numbers; API expects 'i' params
    const params = new URLSearchParams();
    params.append('a', 'user/-/state/com.google/read');
    for (const id of itemIds) {
      params.append('i', String(id));
    }

    // need T (action token) first
    let actionToken = '';
    try {
      const tokenResp = await freshrssRequest(acc, '/reader/api/0/token', { method: 'GET' });
      if (tokenResp.ok) actionToken = (await tokenResp.text()).trim();
    } catch (_) { /* skip */ }

    if (actionToken) params.append('T', actionToken);

    const resp = await freshrssRequest(acc, '/reader/api/0/edit-tag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const txt = await resp.text();
    if (!resp.ok) return { success: false, error: `标记失败 (${resp.status})：${txt}` };
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
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
        author: item.author || item.creator || '',
        imageUrl: normalizeImageUrl(
          pickImageUrlFromAny(item.enclosure) ||
          pickImageUrlFromAny(item['media:thumbnail']) ||
          pickImageUrlFromAny(item['media:content']) ||
          pickImageUrlFromAny(item.thumbnail) ||
          pickImageUrlFromAny(item.image)
        )
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

    const rawText = await response.text();
    if (!response.ok) {
      // Try to parse error as JSON first, fallback to raw text
      let errMsg = `API 错误 ${response.status}`;
      try {
        const errJson = JSON.parse(rawText);
        errMsg += `: ${errJson?.error?.message || errJson?.message || rawText.slice(0, 200)}`;
      } catch (_) {
        // Response is HTML or non-JSON (e.g. wrong baseUrl, proxy error)
        if (rawText.toLowerCase().includes('<!doctype') || rawText.toLowerCase().includes('<html')) {
          errMsg += ': 接口地址返回了 HTML 页面，请检查 API Base URL 是否正确';
        } else {
          errMsg += `: ${rawText.slice(0, 200)}`;
        }
      }
      return { success: false, error: errMsg };
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (_) {
      return { success: false, error: '接口返回了非 JSON 格式的数据，请检查 API Base URL 是否正确' };
    }
    const result = data.choices?.[0]?.message?.content || '';
    return { success: true, result };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── AI Health Check ────────────────────────────────────────────────────────
ipcMain.handle('ai-health-check', async () => {
  const config = store.get('aiConfig', {});
  const baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const apiKey = config.apiKey || '';
  const model = config.model || 'gpt-4o-mini';

  if (!apiKey) return { success: false, error: '请先填写 API Key' };

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 8,
        temperature: 0
      })
    });
    const rawText = await response.text();
    if (!response.ok) {
      let errMsg = `HTTP ${response.status}`;
      try {
        const j = JSON.parse(rawText);
        errMsg += `: ${j?.error?.message || j?.message || rawText.slice(0, 120)}`;
      } catch (_) {
        if (rawText.toLowerCase().includes('<!doctype') || rawText.toLowerCase().includes('<html')) {
          errMsg += ': 接口返回了 HTML 页面，Base URL 可能有误';
        } else {
          errMsg += `: ${rawText.slice(0, 120)}`;
        }
      }
      return { success: false, error: errMsg };
    }
    let data;
    try { data = JSON.parse(rawText); } catch (_) {
      return { success: false, error: '返回非 JSON，请检查 Base URL' };
    }
    const reply = data.choices?.[0]?.message?.content || '(ok)';
    return { success: true, model, reply };
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
ipcMain.handle('create-backup', async (_, options = {}) => {
  try {
    const includeFeeds = options.includeFeeds !== false;
    const includeAiConfig = options.includeAiConfig !== false;
    const includeFreshRssConfig = options.includeFreshRssConfig !== false;
    const includeTgConfig = options.includeTgConfig !== false;
    const includeTheme = options.includeTheme !== false;

    const backup = {
      appVersion: '1.0.1',
      createdAt: new Date().toISOString(),
      backupOptions: {
        includeFeeds,
        includeAiConfig,
        includeFreshRssConfig,
        includeTgConfig,
        includeTheme
      }
    };

    if (includeFeeds) backup.feeds = store.get('feeds', []);
    if (includeAiConfig) backup.aiConfig = store.get('aiConfig', {});
    if (includeFreshRssConfig) {
      backup.freshrssAccounts = getFreshRssAccounts();
      backup.freshrssActiveAccountId = store.get('freshrssActiveAccountId', '');
    }
    if (includeTgConfig) backup.tgConfig = store.get('tgConfig', {});
    if (includeTheme) backup.theme = store.get('theme', 'dark');

    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存备份',
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
    if (Object.prototype.hasOwnProperty.call(backup, 'feeds')) store.set('feeds', backup.feeds || []);
    if (Object.prototype.hasOwnProperty.call(backup, 'aiConfig')) store.set('aiConfig', backup.aiConfig || {});
    if (Object.prototype.hasOwnProperty.call(backup, 'freshrssAccounts')) {
      setFreshRssAccounts(Array.isArray(backup.freshrssAccounts) ? backup.freshrssAccounts : []);
      store.set('freshrssActiveAccountId', backup.freshrssActiveAccountId || '');
      restartFreshRssAutoRefresh();
    }
    // backward compatibility
    if (Object.prototype.hasOwnProperty.call(backup, 'freshrssConfig')) {
      const old = backup.freshrssConfig || {};
      if (old.baseUrl || old.username) {
        const migrated = [{
          id: `fr_migrated_${Date.now()}`,
          groupName: old.username || 'FreshRSS',
          baseUrl: old.baseUrl || '',
          username: old.username || '',
          apiPassword: old.apiPassword || '',
          authToken: old.authToken || '',
          userId: old.userId || '',
          loggedInAt: old.loggedInAt || '',
          refreshInterval: old.refreshInterval || 30,
          collapsedCategories: []
        }];
        setFreshRssAccounts(migrated);
        store.set('freshrssActiveAccountId', migrated[0].id);
        restartFreshRssAutoRefresh();
      }
    }
    if (Object.prototype.hasOwnProperty.call(backup, 'tgConfig')) store.set('tgConfig', backup.tgConfig || {});
    if (Object.prototype.hasOwnProperty.call(backup, 'theme') && backup.theme) store.set('theme', backup.theme);
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
ipcMain.handle('generate-digest', async (_, payload) => {
  const aiConfig = store.get('aiConfig', {});
  const tgConfig = store.get('tgConfig', {});
  const baseUrl = (aiConfig.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const apiKey = aiConfig.apiKey || '';
  const model = aiConfig.model || 'gpt-4o-mini';
  const digestPrompt = tgConfig.digestPrompt || '请用中文简洁总结以下文章内容，3句话以内：';
  const maxArticles = parseInt(tgConfig.maxArticles) || 5;

  if (!apiKey) return { success: false, error: '请先在设置中配置 AI API Key' };

  // Support both old format (array of feeds) and new format ({ localFeeds, freshArticles })
  const isNewFormat = payload && !Array.isArray(payload) && ('localFeeds' in payload || 'freshArticles' in payload);
  const localFeeds = isNewFormat ? (payload.localFeeds || []) : (Array.isArray(payload) ? payload : []);
  const freshArticles = isNewFormat ? (payload.freshArticles || []) : [];

  if (localFeeds.length === 0 && freshArticles.length === 0) {
    return { success: false, error: '没有可用的订阅源' };
  }

  // AI summary helper
  async function summarize(text) {
    if (!text || !text.trim()) return '';
    try {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
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
      if (!resp.ok) return '';
      const rawText = await resp.text();
      let d;
      try { d = JSON.parse(rawText); } catch (_) { return ''; }
      return d.choices?.[0]?.message?.content?.trim() || '';
    } catch (_) { return ''; }
  }

  const date = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  let doc = `📰 RSS 日报 · ${date}\n\n`;
  const results = [];

  // ── Local feeds (fetch from URL) ────────────────────────────────────────────
  for (const feed of localFeeds) {
    try {
      const parsed = await parser.parseURL(feed.url);
      const items = (parsed.items || []).slice(0, maxArticles);
      if (items.length === 0) continue;
      doc += `【${feed.name}】\n`;
      for (const item of items) {
        const text = item.contentSnippet || item.content || item['content:encoded'] || '';
        const summary = await summarize(text);
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

  // ── FreshRSS in-memory articles ─────────────────────────────────────────────
  if (freshArticles.length > 0) {
    // Group by feedName
    const byFeed = {};
    freshArticles.forEach(a => {
      const key = a.feedName || 'FreshRSS';
      if (!byFeed[key]) byFeed[key] = [];
      byFeed[key].push(a);
    });
    for (const [feedName, items] of Object.entries(byFeed)) {
      try {
        const slice = items.slice(0, maxArticles);
        doc += `【${feedName}】\n`;
        for (const item of slice) {
          const text = item.content || '';
          const summary = await summarize(text);
          const titleLine = item.title || '无标题';
          const linkLine = item.link ? ` (${item.link})` : '';
          doc += `• ${titleLine}${linkLine}\n`;
          if (summary) doc += `  ${summary}\n`;
          doc += '\n';
        }
        doc += '\n';
        results.push({ feedName, ok: true, count: slice.length });
      } catch (e) {
        results.push({ feedName, ok: false, error: e.message });
      }
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
