/* ═══════════════════════════════════════════════════════════════════════════
   renderer.js  –  RSS 阅读器渲染进程
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let feeds = [];          // [{ id, url, name, items: [] }]
let allArticles = [];    // 所有文章的扁平数组，带 feedId / feedName
let filteredArticles = [];
let currentFeedId = 'all';
let currentArticle = null;

// ── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const feedList        = $('feed-list');
const articleListEl   = $('article-list');
const listTitle       = $('list-title');
const listEmpty       = $('list-empty');
const searchInput     = $('search-input');
const btnRefresh      = $('btn-refresh');
const btnAddFeed      = $('btn-add-feed');
const btnSettings     = $('btn-settings');
const readerContent   = $('reader-content');
const readerPlaceholder = $('reader-placeholder');
const articleView     = $('article-view');
const articleTitle    = $('article-title');
const articleMeta     = $('article-meta');
const articleBody     = $('article-body');
const btnSummary      = $('btn-summary');
const btnTranslate    = $('btn-translate');
const btnOpenLink     = $('btn-open-link');
const btnDigest       = $('btn-digest');
const aiResultBox     = $('ai-result-box');
const aiResultText    = $('ai-result-text');
const aiResultModeLabel = $('ai-result-mode-label');
const btnCloseAi      = $('btn-close-ai');
const toast           = $('toast');

// digest state
let currentDigestText = '';

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = 'info') {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className = `show ${type}`;
  toastTimer = setTimeout(() => { toast.className = ''; }, 3000);
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

document.querySelectorAll('.modal-close, [data-modal]').forEach(el => {
  el.addEventListener('click', () => {
    const id = el.dataset.modal || el.closest('.modal-overlay').id;
    closeModal(id);
  });
});

// close on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

// ── Feed rendering ────────────────────────────────────────────────────────────
function renderFeedList() {
  // keep the "all" item
  feedList.innerHTML = `
    <div class="feed-all-item${currentFeedId === 'all' ? ' active' : ''}" data-id="all">
      <span>🌐 全部文章</span>
    </div>`;

  feeds.forEach(f => {
    const div = document.createElement('div');
    div.className = 'feed-item' + (currentFeedId === f.id ? ' active' : '');
    div.dataset.id = f.id;
    div.innerHTML = `
      <span class="feed-icon">📡</span>
      <span class="feed-name" title="${escHtml(f.name)}">${escHtml(f.name)}</span>
      <button class="feed-delete" data-id="${f.id}" title="删除">✕</button>`;
    feedList.appendChild(div);
  });

  // click feed
  feedList.querySelectorAll('[data-id]').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.classList.contains('feed-delete')) return;
      selectFeed(el.dataset.id);
    });
  });

  // delete feed
  feedList.querySelectorAll('.feed-delete').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      deleteFeed(btn.dataset.id);
    });
  });
}

function selectFeed(id) {
  currentFeedId = id;
  renderFeedList();
  applyFilter();
  if (id === 'all') {
    listTitle.textContent = '全部文章';
  } else {
    const f = feeds.find(x => x.id === id);
    listTitle.textContent = f ? f.name : '文章列表';
  }
}

async function deleteFeed(id) {
  feeds = feeds.filter(f => f.id !== id);
  await window.api.saveFeeds(feeds.map(({ id, url, name }) => ({ id, url, name })));
  buildAllArticles();
  if (currentFeedId === id) selectFeed('all');
  else renderFeedList();
  renderFeedsManageList();
  showToast('已删除订阅源', 'success');
}

// ── Article rendering ─────────────────────────────────────────────────────────
function buildAllArticles() {
  allArticles = [];
  feeds.forEach(f => {
    (f.items || []).forEach((item, idx) => {
      allArticles.push({ ...item, feedId: f.id, feedName: f.name, _uid: `${f.id}-${idx}` });
    });
  });
  // sort by date desc
  allArticles.sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate) : 0;
    const db = b.pubDate ? new Date(b.pubDate) : 0;
    return db - da;
  });
  applyFilter();
}

function applyFilter() {
  const q = searchInput.value.trim().toLowerCase();
  let src = currentFeedId === 'all'
    ? allArticles
    : allArticles.filter(a => a.feedId === currentFeedId);

  if (q) {
    src = src.filter(a =>
      a.title.toLowerCase().includes(q) ||
      (a.contentSnippet || '').toLowerCase().includes(q)
    );
  }
  filteredArticles = src;
  renderArticleList();
}

function renderArticleList() {
  articleListEl.innerHTML = '';
  if (filteredArticles.length === 0) {
    listEmpty.style.display = 'flex';
    return;
  }
  listEmpty.style.display = 'none';

  filteredArticles.forEach(article => {
    const card = document.createElement('div');
    card.className = 'article-card' + (currentArticle?._uid === article._uid ? ' active' : '');
    card.dataset.uid = article._uid;

    const date = article.pubDate ? formatDate(article.pubDate) : '';
    card.innerHTML = `
      <div class="ac-title">${escHtml(article.title)}</div>
      <div class="ac-meta">
        <span>${escHtml(article.feedName)}</span>
        ${date ? `<span>·</span><span>${date}</span>` : ''}
        ${article.author ? `<span>·</span><span>${escHtml(article.author)}</span>` : ''}
      </div>
      ${article.contentSnippet
        ? `<div class="ac-snippet">${escHtml(article.contentSnippet.slice(0, 120))}</div>`
        : ''}`;

    card.addEventListener('click', () => openArticle(article));
    articleListEl.appendChild(card);
  });
}

// ── Article reader ────────────────────────────────────────────────────────────
function openArticle(article) {
  currentArticle = article;
  renderArticleList(); // update active state

  readerPlaceholder.style.display = 'none';
  articleView.style.display = 'block';

  articleTitle.textContent = article.title;
  const date = article.pubDate ? formatDate(article.pubDate) : '';
  articleMeta.innerHTML = [
    article.feedName ? `<span>${escHtml(article.feedName)}</span>` : '',
    article.author   ? `<span>作者：${escHtml(article.author)}</span>` : '',
    date             ? `<span>${date}</span>` : ''
  ].filter(Boolean).join('<span>·</span>');

  // render body – prefer HTML content, fallback to snippet
  const raw = article.content || article.contentSnippet || '';
  articleBody.innerHTML = sanitizeHtml(raw);

  // intercept link clicks
  articleBody.querySelectorAll('a[href]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      if (a.href) window.api.openExternal(a.href);
    });
  });

  // enable toolbar
  btnSummary.disabled = false;
  btnTranslate.disabled = false;
  if (article.link) {
    btnOpenLink.style.display = 'flex';
    btnOpenLink.onclick = () => window.api.openExternal(article.link);
  } else {
    btnOpenLink.style.display = 'none';
  }

  // hide AI result
  aiResultBox.classList.remove('visible');
  aiResultText.textContent = '';
}

// ── AI ────────────────────────────────────────────────────────────────────────
async function runAI(mode) {
  if (!currentArticle) return;

  const text = currentArticle.content || currentArticle.contentSnippet || currentArticle.title;
  if (!text) { showToast('文章内容为空', 'error'); return; }

  // show loading
  aiResultBox.classList.add('visible');
  aiResultModeLabel.textContent = mode === 'summary' ? 'AI 摘要' : 'AI 翻译';
  aiResultText.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';

  btnSummary.disabled = true;
  btnTranslate.disabled = true;

  const res = await window.api.aiRequest({ text, mode });

  btnSummary.disabled = false;
  btnTranslate.disabled = false;

  if (res.success) {
    aiResultText.textContent = res.result;
    showToast(mode === 'summary' ? '摘要已生成' : '翻译完成', 'success');
  } else {
    aiResultText.textContent = `错误：${res.error}`;
    showToast(res.error, 'error');
  }
}

btnSummary.addEventListener('click', () => runAI('summary'));
btnTranslate.addEventListener('click', () => runAI('translate'));
btnCloseAi.addEventListener('click', () => {
  aiResultBox.classList.remove('visible');
  aiResultText.textContent = '';
});

// ── Add Feed ──────────────────────────────────────────────────────────────────
btnAddFeed.addEventListener('click', () => {
  $('input-feed-url').value = '';
  $('input-feed-name').value = '';
  openModal('modal-add-feed');
  setTimeout(() => $('input-feed-url').focus(), 150);
});

$('btn-confirm-add-feed').addEventListener('click', async () => {
  const url = $('input-feed-url').value.trim();
  if (!url) { showToast('请输入 URL', 'error'); return; }

  const btn = $('btn-confirm-add-feed');
  btn.disabled = true;
  btn.textContent = '获取中…';

  const res = await window.api.fetchFeed(url);

  btn.disabled = false;
  btn.textContent = '添加并获取';

  if (!res.success) {
    showToast(`获取失败：${res.error}`, 'error');
    return;
  }

  const customName = $('input-feed-name').value.trim();
  const id = 'feed_' + Date.now();
  const newFeed = {
    id,
    url,
    name: customName || res.title || url,
    items: res.items
  };

  feeds.push(newFeed);
  await window.api.saveFeeds(feeds.map(({ id, url, name }) => ({ id, url, name })));
  buildAllArticles();
  selectFeed(id);
  renderFeedsManageList();
  closeModal('modal-add-feed');
  showToast(`已添加 "${newFeed.name}"，共 ${res.items.length} 篇文章`, 'success');
});

// ── Refresh ───────────────────────────────────────────────────────────────────
btnRefresh.addEventListener('click', async () => {
  const toRefresh = currentFeedId === 'all'
    ? feeds
    : feeds.filter(f => f.id === currentFeedId);

  if (toRefresh.length === 0) { showToast('没有可刷新的订阅源', 'error'); return; }

  btnRefresh.classList.add('spinning');
  btnRefresh.disabled = true;

  let updated = 0;
  await Promise.all(toRefresh.map(async f => {
    const res = await window.api.fetchFeed(f.url);
    if (res.success) {
      f.items = res.items;
      updated++;
    }
  }));

  btnRefresh.classList.remove('spinning');
  btnRefresh.disabled = false;
  buildAllArticles();
  showToast(`已刷新 ${updated} 个订阅源`, 'success');
});

// ── Search ────────────────────────────────────────────────────────────────────
searchInput.addEventListener('input', applyFilter);

// ── Settings ──────────────────────────────────────────────────────────────────
btnSettings.addEventListener('click', async () => {
  const cfg = await window.api.getAiConfig();
  $('cfg-base-url').value         = cfg.baseUrl || '';
  $('cfg-api-key').value          = cfg.apiKey || '';
  $('cfg-model').value            = cfg.model || '';
  $('cfg-summary-prompt').value   = cfg.summaryPrompt || '';
  $('cfg-translate-prompt').value = cfg.translatePrompt || '';

  const tgCfg = await window.api.getTgConfig();
  $('cfg-tg-token').value  = tgCfg.botToken || '';
  $('cfg-tg-chatid').value = tgCfg.chatId || '';
  $('cfg-tg-prompt').value = tgCfg.digestPrompt || '';
  $('cfg-tg-max').value    = tgCfg.maxArticles || 5;

  renderFeedsManageList();
  openModal('modal-settings');
});

$('btn-save-settings').addEventListener('click', async () => {
  const config = {
    baseUrl:         $('cfg-base-url').value.trim(),
    apiKey:          $('cfg-api-key').value.trim(),
    model:           $('cfg-model').value.trim(),
    summaryPrompt:   $('cfg-summary-prompt').value.trim(),
    translatePrompt: $('cfg-translate-prompt').value.trim()
  };
  await window.api.saveAiConfig(config);

  const tgCfg = {
    botToken:     $('cfg-tg-token').value.trim(),
    chatId:       $('cfg-tg-chatid').value.trim(),
    digestPrompt: $('cfg-tg-prompt').value.trim(),
    maxArticles:  parseInt($('cfg-tg-max').value) || 5
  };
  await window.api.saveTgConfig(tgCfg);

  closeModal('modal-settings');
  showToast('设置已保存', 'success');
});

// settings tabs
document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
    tab.classList.add('active');
    $(tab.dataset.tab).classList.add('active');
  });
});

function renderFeedsManageList() {
  const el = $('feeds-manage-list');
  if (feeds.length === 0) {
    el.innerHTML = '<p style="color:var(--overlay);font-size:13px">暂无订阅源</p>';
    return;
  }
  el.innerHTML = feeds.map(f => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
      <span style="flex:1;font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(f.url)}">${escHtml(f.name)}</span>
      <span style="font-size:11px;color:var(--overlay)">${(f.items||[]).length} 篇</span>
      <button class="btn btn-danger" style="padding:3px 10px;font-size:12px" data-del="${f.id}">删除</button>
    </div>`).join('');

  el.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => deleteFeed(btn.dataset.del));
  });
}

// ── Digest ────────────────────────────────────────────────────────────────────
btnDigest.addEventListener('click', async () => {
  if (feeds.length === 0) {
    showToast('请先添加订阅源', 'error');
    return;
  }

  // Show modal in loading state
  currentDigestText = '';
  $('digest-content').value = '';
  $('digest-status').textContent = '正在生成日报，请稍候…（需要逐篇调用 AI，可能需要数分钟）';
  $('btn-digest-send').disabled = true;
  $('btn-digest-copy').disabled = true;
  openModal('modal-digest');

  btnDigest.disabled = true;
  btnDigest.textContent = '⏳ 生成中…';

  const feedsData = feeds.map(f => ({ id: f.id, url: f.url, name: f.name }));
  const res = await window.api.generateDigest(feedsData);

  btnDigest.disabled = false;
  btnDigest.textContent = '📋 生成日报';

  if (!res.success) {
    $('digest-status').textContent = `❌ 生成失败：${res.error}`;
    showToast(res.error, 'error');
    return;
  }

  currentDigestText = res.digest;
  $('digest-content').value = res.digest;

  const ok = res.results.filter(r => r.ok).length;
  const fail = res.results.filter(r => !r.ok).length;
  let statusMsg = `✅ 已处理 ${ok} 个订阅源`;
  if (fail > 0) statusMsg += `，${fail} 个失败`;
  statusMsg += `，共 ${res.digest.length} 字符`;
  $('digest-status').textContent = statusMsg;

  $('btn-digest-send').disabled = false;
  $('btn-digest-copy').disabled = false;
  showToast('日报生成完成', 'success');
});

$('btn-digest-copy').addEventListener('click', () => {
  if (!currentDigestText) return;
  navigator.clipboard.writeText(currentDigestText).then(() => {
    showToast('已复制到剪贴板', 'success');
  }).catch(() => {
    showToast('复制失败', 'error');
  });
});

$('btn-digest-send').addEventListener('click', async () => {
  if (!currentDigestText) return;

  const btn = $('btn-digest-send');
  btn.disabled = true;
  btn.textContent = '发送中…';
  $('digest-status').textContent = '正在推送到 Telegram…';

  const res = await window.api.sendTelegram(currentDigestText);

  btn.disabled = false;
  btn.textContent = '✈️ 推送到 Telegram';

  if (res.success) {
    const chunkInfo = res.chunks > 1 ? `（共 ${res.chunks} 条消息）` : '';
    $('digest-status').textContent = `✅ 已成功推送到 Telegram ${chunkInfo}`;
    showToast(`推送成功 ${chunkInfo}`, 'success');
  } else {
    $('digest-status').textContent = `❌ 推送失败：${res.error}`;
    showToast(res.error, 'error');
  }
});

// ── Utilities ─────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Very lightweight "sanitizer": we allow basic HTML tags but
 * strip scripts and on* attributes to avoid XSS in article content.
 */
function sanitizeHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('script, style, iframe, object, embed, form').forEach(el => el.remove());
  tmp.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      if (attr.name.startsWith('on') || attr.name === 'href' && attr.value.startsWith('javascript:')) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return tmp.innerHTML;
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)} 天前`;
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

// ── Theme ─────────────────────────────────────────────────────────────────────
let currentTheme = 'dark';

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  // update active state on theme buttons
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const theme = btn.dataset.theme;
    applyTheme(theme);
    await window.api.saveTheme(theme);
    showToast(
      theme === 'light' ? '已切换为白色主题' :
      theme === 'dark'  ? '已切换为黑色主题' :
                          '已切换为跟随系统',
      'success'
    );
  });
});

// ── Export / Import Feeds ─────────────────────────────────────────────────────
$('btn-export-feeds').addEventListener('click', async () => {
  const res = await window.api.exportFeeds();
  if (res.canceled) return;
  if (res.success) showToast(`已导出 ${res.count} 个订阅源`, 'success');
  else showToast(`导出失败：${res.error}`, 'error');
});

$('btn-import-feeds').addEventListener('click', async () => {
  const res = await window.api.importFeeds();
  if (res.canceled) return;
  if (!res.success) { showToast(`导入失败：${res.error}`, 'error'); return; }

  // Merge: skip duplicates by URL
  let added = 0;
  for (const f of res.feeds) {
    if (!f.url) continue;
    if (feeds.find(x => x.url === f.url)) continue;
    const id = f.id || ('feed_' + Date.now() + '_' + Math.random().toString(36).slice(2));
    feeds.push({ id, url: f.url, name: f.name || f.url, items: [] });
    added++;
  }
  if (added === 0) { showToast('没有新的订阅源（已全部存在）', 'info'); return; }

  await window.api.saveFeeds(feeds.map(({ id, url, name }) => ({ id, url, name })));
  renderFeedList();
  renderFeedsManageList();
  showToast(`已导入 ${added} 个新订阅源，正在获取文章…`, 'success');

  // fetch new feeds in background
  await Promise.all(feeds.filter(f => f.items.length === 0).map(async f => {
    const r = await window.api.fetchFeed(f.url);
    if (r.success) f.items = r.items;
  }));
  buildAllArticles();
});

// ── Backup / Restore ──────────────────────────────────────────────────────────
$('btn-create-backup').addEventListener('click', async () => {
  const res = await window.api.createBackup();
  if (res.canceled) return;
  if (res.success) showToast('全量备份已保存', 'success');
  else showToast(`备份失败：${res.error}`, 'error');
});

$('btn-restore-backup').addEventListener('click', async () => {
  const res = await window.api.restoreBackup();
  if (res.canceled) return;
  if (!res.success) { showToast(`恢复失败：${res.error}`, 'error'); return; }

  showToast('备份已恢复，正在重新加载…', 'success');
  // Reload all data from store
  setTimeout(async () => {
    closeModal('modal-settings');
    const savedFeeds = await window.api.getFeeds();
    feeds = savedFeeds.map(f => ({ ...f, items: [] }));
    renderFeedList();
    renderFeedsManageList();
    // apply restored theme
    if (res.backup.theme) {
      applyTheme(res.backup.theme);
      await window.api.saveTheme(res.backup.theme);
    }
    // re-fetch feeds
    await Promise.all(feeds.map(async f => {
      const r = await window.api.fetchFeed(f.url);
      if (r.success) f.items = r.items;
    }));
    buildAllArticles();
    showToast('恢复完成', 'success');
  }, 500);
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  // Load and apply theme first
  const theme = await window.api.getTheme();
  applyTheme(theme);

  const savedFeeds = await window.api.getFeeds();
  // restore feed metadata, then fetch items in background
  feeds = savedFeeds.map(f => ({ ...f, items: [] }));
  renderFeedList();

  if (feeds.length > 0) {
    btnRefresh.classList.add('spinning');
    await Promise.all(feeds.map(async f => {
      const res = await window.api.fetchFeed(f.url);
      if (res.success) f.items = res.items;
    }));
    btnRefresh.classList.remove('spinning');
    buildAllArticles();
    showToast(`已加载 ${feeds.length} 个订阅源`, 'success');
  }
}

init();