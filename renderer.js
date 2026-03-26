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
let readerPrefs = {
  showArticleImages: true,
  scrollMarkReadEnabled: true,
  listScrollMarkReadEnabled: false
};
let freshRssConfig = { accounts: [], activeAccountId: '' };
// key: accountId -> { account, feeds, articles, categories, collapsedCategories:Set }
let freshGroups = {};

// ── Unread tracking ──────────────────────────────────────────────────────────
let unreadSet = new Set();   // _uid of unread articles
let frItemIdMap = {};        // article._uid -> FreshRSS numeric item id
let frItemAccountMap = {};   // article._uid -> accountId
let markReadQueue = [];      // FreshRSS item ids pending sync
let markReadFlushTimer = null;

function queueMarkRead(article) {
  if (!unreadSet.has(article._uid)) return;
  unreadSet.delete(article._uid);
  // Update card style immediately
  const card = articleListEl.querySelector(`[data-uid="${article._uid}"]`);
  if (card) card.classList.remove('unread');
  updateUnreadBadge();
  // Queue FreshRSS sync
  const frId = frItemIdMap[article._uid];
  const accountId = frItemAccountMap[article._uid];
  if (accountId && frId) {
    markReadQueue.push({ accountId, itemId: frId });
    scheduleMarkReadFlush();
  }
}

function scheduleMarkReadFlush() {
  if (markReadFlushTimer) return;
  markReadFlushTimer = setTimeout(async () => {
    markReadFlushTimer = null;
    if (markReadQueue.length === 0) return;
    const rows = [...markReadQueue];
    markReadQueue = [];
    const byAccount = {};
    rows.forEach(r => {
      if (!byAccount[r.accountId]) byAccount[r.accountId] = [];
      byAccount[r.accountId].push(r.itemId);
    });
    const tasks = Object.entries(byAccount).map(([accountId, itemIds]) =>
      window.api.freshRssMarkRead({ accountId, itemIds })
    );
    try { await Promise.all(tasks); } catch (_) { /* best-effort */ }
  }, 2000);
}

function updateUnreadBadge() {
  // rerender feed list to update counts
  renderFeedList();
}

let listScrollTimer = null;
function handleListScrollMarkRead() {
  if (!readerPrefs.listScrollMarkReadEnabled) return;
  if (listScrollTimer) clearTimeout(listScrollTimer);
  listScrollTimer = setTimeout(() => {
    const cards = [...articleListEl.querySelectorAll('.article-card.unread')];
    const listRect = articleListEl.getBoundingClientRect();
    cards.forEach(card => {
      const rect = card.getBoundingClientRect();
      const visibleTop = Math.max(rect.top, listRect.top);
      const visibleBottom = Math.min(rect.bottom, listRect.bottom);
      const visible = Math.max(0, visibleBottom - visibleTop);
      const ratio = rect.height > 0 ? visible / rect.height : 0;
      if (ratio >= 0.7) {
        const uid = card.dataset.uid;
        const article = filteredArticles.find(a => a._uid === uid);
        if (article) queueMarkRead(article);
      }
    });
  }, 120);
}

function countUnread(feedId) {
  if (feedId.startsWith('fresh-group:')) {
    const accountId = feedId.slice('fresh-group:'.length);
    return allArticles.filter(a => a.source === 'fresh' && a.accountId === accountId && unreadSet.has(a._uid)).length;
  }
  if (feedId.startsWith('fresh-cat:')) {
    const [accountId, cat] = feedId.slice('fresh-cat:'.length).split('|');
    return allArticles.filter(a => a.source === 'fresh' && a.accountId === accountId && (a.categories || []).includes(cat) && unreadSet.has(a._uid)).length;
  }
  if (feedId.startsWith('fresh-feed:')) {
    const [accountId, target] = feedId.slice('fresh-feed:'.length).split('|');
    return allArticles.filter(a => a.source === 'fresh' && a.accountId === accountId && a.feedUrl === target && unreadSet.has(a._uid)).length;
  }
  if (feedId === 'all') return unreadSet.size;
  return [...unreadSet].filter(uid => uid.startsWith(feedId + '-')).length;
}

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
articleListEl.addEventListener('scroll', handleListScrollMarkRead, { passive: true });

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
  const allUnread = countUnread('all');
  feedList.innerHTML = `
    <div class="feed-all-item${currentFeedId === 'all' ? ' active' : ''}" data-id="all">
      <span>🌐 全部文章</span>
      ${allUnread > 0 ? `<span class="unread-badge">${allUnread}</span>` : ''}
    </div>`;

  (freshRssConfig.accounts || []).forEach(accOrder => {
    const group = freshGroups[accOrder.id];
    if (!group) return;
    if (!group.account || !group.account.authToken) return;
    const accountId = group.account.id;
    const gid = `fresh-group:${accountId}`;
    const fgUnread = countUnread(gid);
    const collapsed = !!group.collapsed;

    const g = document.createElement('div');
    g.className = 'feed-item fresh-group-header' + (currentFeedId === gid ? ' active' : '');
    g.dataset.id = gid;
    g.innerHTML = `
      <span class="feed-icon">☁️</span>
      <span class="feed-name" title="${escHtml(group.account.groupName || group.account.username || 'FreshRSS')}">${escHtml(group.account.groupName || group.account.username || 'FreshRSS')}</span>
      ${fgUnread > 0 ? `<span class="unread-badge">${fgUnread}</span>` : ''}
      <button class="feed-collapse" data-collapse="${accountId}" title="折叠/展开">${collapsed ? '▸' : '▾'}</button>`;
    feedList.appendChild(g);

    if (collapsed) return;

    const categories = group.categories || [];
    categories.forEach(cat => {
      const catId = `fresh-cat:${accountId}|${cat}`;
      const catUnread = countUnread(catId);
      const catCollapsed = (group.collapsedCategories || new Set()).has(cat);
      const c = document.createElement('div');
      c.className = 'feed-item fresh-cat-item' + (currentFeedId === catId ? ' active' : '');
      c.dataset.id = catId;
      c.innerHTML = `
        <span class="feed-icon">📁</span>
        <span class="feed-name" title="${escHtml(cat)}">${escHtml(cat)}</span>
        ${catUnread > 0 ? `<span class="unread-badge">${catUnread}</span>` : ''}
        <button class="feed-collapse" data-cat-collapse="${accountId}|${encodeURIComponent(cat)}" title="折叠/展开">${catCollapsed ? '▸' : '▾'}</button>`;
      feedList.appendChild(c);

      if (catCollapsed) return;
      (group.feeds || []).filter(ff => (ff.categories || []).includes(cat)).forEach(ff => {
        const fid = `fresh-feed:${accountId}|${ff.url}`;
        const uc = countUnread(fid);
        const item = document.createElement('div');
        item.className = 'feed-item fresh-feed-item' + (currentFeedId === fid ? ' active' : '');
        item.dataset.id = fid;
        item.innerHTML = `
          <span class="feed-icon">🛰️</span>
          <span class="feed-name" title="${escHtml(ff.name)}">${escHtml(ff.name)}</span>
          ${uc > 0 ? `<span class="unread-badge">${uc}</span>` : ''}`;
        feedList.appendChild(item);
      });
    });
  });

  feeds.forEach(f => {
    const uc = countUnread(f.id);
    const div = document.createElement('div');
    div.className = 'feed-item' + (currentFeedId === f.id ? ' active' : '');
    div.dataset.id = f.id;
    div.innerHTML = `
      <span class="feed-icon">📡</span>
      <span class="feed-name" title="${escHtml(f.name)}">${escHtml(f.name)}</span>
      ${uc > 0 ? `<span class="unread-badge">${uc}</span>` : ''}
      <button class="feed-delete" data-id="${f.id}" title="删除">✕</button>`;
    feedList.appendChild(div);
  });

  // click feed
  feedList.querySelectorAll('[data-id]').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.classList.contains('feed-delete') || e.target.classList.contains('feed-collapse')) return;
      selectFeed(el.dataset.id);
    });
  });

  feedList.querySelectorAll('[data-collapse]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const accId = btn.dataset.collapse;
      if (!freshGroups[accId]) return;
      freshGroups[accId].collapsed = !freshGroups[accId].collapsed;
      const acc = (freshRssConfig.accounts || []).find(a => a.id === accId);
      if (acc) acc.collapsed = freshGroups[accId].collapsed;
      renderFeedList();
    });
  });

  feedList.querySelectorAll('[data-cat-collapse]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const [accId, ...rest] = btn.dataset.catCollapse.split('|');
      const cat = decodeURIComponent(rest.join('|'));
      if (!freshGroups[accId]) return;
      if (!freshGroups[accId].collapsedCategories) freshGroups[accId].collapsedCategories = new Set();
      if (freshGroups[accId].collapsedCategories.has(cat)) freshGroups[accId].collapsedCategories.delete(cat);
      else freshGroups[accId].collapsedCategories.add(cat);
      const acc = (freshRssConfig.accounts || []).find(a => a.id === accId);
      if (acc) acc.collapsedCategories = [...freshGroups[accId].collapsedCategories];
      renderFeedList();
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
  } else if (id.startsWith('fresh-group:')) {
    const accountId = id.slice('fresh-group:'.length);
    const g = freshGroups[accountId];
    listTitle.textContent = g?.account?.groupName || g?.account?.username || 'FreshRSS 远端组';
  } else if (id.startsWith('fresh-cat:')) {
    const payload = id.slice('fresh-cat:'.length);
    const i = payload.indexOf('|');
    const cat = i >= 0 ? payload.slice(i + 1) : '分类';
    listTitle.textContent = cat;
  } else if (id.startsWith('fresh-feed:')) {
    const payload = id.slice('fresh-feed:'.length);
    const i = payload.indexOf('|');
    const accountId = i >= 0 ? payload.slice(0, i) : '';
    const u = i >= 0 ? payload.slice(i + 1) : payload;
    const ff = (freshGroups[accountId]?.feeds || []).find(x => x.url === u);
    listTitle.textContent = ff ? ff.name : 'FreshRSS 订阅源';
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
  frItemIdMap = {};
  frItemAccountMap = {};
  const validUids = new Set();

  // Local feeds
  feeds.forEach(f => {
    (f.items || []).forEach((item, idx) => {
      const uid = `${f.id}-${idx}`;
      validUids.add(uid);
      allArticles.push({ ...item, feedId: f.id, feedName: f.name, _uid: uid, source: 'local' });
    });
  });

  // FreshRSS remote group (memory only)
  Object.values(freshGroups).forEach(group => {
    const accountId = group.account?.id;
    if (!accountId) return;
    (group.articles || []).forEach((item, idx) => {
      const uid = `fr:${accountId}:${idx}`;
      validUids.add(uid);
      frItemIdMap[uid] = item.frItemId || '';
      frItemAccountMap[uid] = accountId;
      allArticles.push({
        ...item,
        accountId,
        feedId: `fresh-feed:${accountId}|${item.feedUrl || ''}`,
        feedName: item.feedName || group.account.groupName || 'FreshRSS',
        _uid: uid,
        source: 'fresh'
      });
      if (item.unread) unreadSet.add(uid);
      else unreadSet.delete(uid);
    });
  });

  unreadSet = new Set([...unreadSet].filter(uid => validUids.has(uid)));

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
  let src = allArticles;
  if (currentFeedId !== 'all') {
    if (currentFeedId.startsWith('fresh-group:')) {
      const accountId = currentFeedId.slice('fresh-group:'.length);
      src = allArticles.filter(a => a.source === 'fresh' && a.accountId === accountId);
    } else if (currentFeedId.startsWith('fresh-cat:')) {
      const payload = currentFeedId.slice('fresh-cat:'.length);
      const i = payload.indexOf('|');
      const accountId = i >= 0 ? payload.slice(0, i) : '';
      const cat = i >= 0 ? payload.slice(i + 1) : '';
      src = allArticles.filter(a => a.source === 'fresh' && a.accountId === accountId && (a.categories || []).includes(cat));
      const acc = (freshRssConfig.accounts || []).find(x => x.id === accountId);
      if (acc?.onlyUnreadCategory) {
        src = src.filter(a => unreadSet.has(a._uid));
      }
    } else if (currentFeedId.startsWith('fresh-feed:')) {
      const payload = currentFeedId.slice('fresh-feed:'.length);
      const i = payload.indexOf('|');
      const accountId = i >= 0 ? payload.slice(0, i) : '';
      const target = i >= 0 ? payload.slice(i + 1) : payload;
      src = allArticles.filter(a => a.source === 'fresh' && a.accountId === accountId && a.feedUrl === target);
    } else {
      src = allArticles.filter(a => a.feedId === currentFeedId);
    }
  }

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
    const isUnread = unreadSet.has(article._uid);
    const thumb = readerPrefs.showArticleImages ? extractFirstImageUrl(article) : '';
    const card = document.createElement('div');
    card.className = 'article-card'
      + (currentArticle?._uid === article._uid ? ' active' : '')
      + (isUnread ? ' unread' : '');
    card.dataset.uid = article._uid;

    const date = article.pubDate ? formatDate(article.pubDate) : '';
    card.innerHTML = `
      ${isUnread ? '<span class="unread-dot"></span>' : ''}
      <div class="ac-layout ${thumb ? 'has-thumb' : ''}">
        <div class="ac-main">
          <div class="ac-title">${escHtml(article.title)}</div>
          <div class="ac-meta">
            <span>${escHtml(article.feedName)}</span>
            ${date ? `<span>·</span><span>${date}</span>` : ''}
            ${article.author ? `<span>·</span><span>${escHtml(article.author)}</span>` : ''}
          </div>
          ${article.contentSnippet
            ? `<div class="ac-snippet">${escHtml(article.contentSnippet.slice(0, 120))}</div>`
            : ''}
        </div>
        ${thumb ? `<div class="ac-thumb"><img src="${escHtml(thumb)}" alt="preview" loading="lazy" referrerpolicy="no-referrer" crossorigin="anonymous" onerror="this.parentElement.style.display='none'" /></div>` : ''}
      </div>`;

    card.addEventListener('click', () => openArticle(article));
    articleListEl.appendChild(card);
  });

  handleListScrollMarkRead();
}

// ── Article reader ────────────────────────────────────────────────────────────
// scroll threshold: mark read after scrolling 30% of article body
let scrollMarkTimer = null;
function setupScrollMarkRead(article) {
  const panel = $('reader-content');
  if (!panel) return;

  const onScroll = () => {
    if (!currentArticle || currentArticle._uid !== article._uid) return;
    const { scrollTop, scrollHeight, clientHeight } = panel;
    const ratio = (scrollTop + clientHeight) / scrollHeight;
    if (ratio > 0.3) {
      clearTimeout(scrollMarkTimer);
      scrollMarkTimer = setTimeout(() => queueMarkRead(article), 400);
      panel.removeEventListener('scroll', onScroll);
    }
  };
  panel.addEventListener('scroll', onScroll, { passive: true });
}

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
  articleBody.innerHTML = sanitizeHtml(raw, { showImages: readerPrefs.showArticleImages });

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

  // Reeder-style: mark read on open (immediate) for short articles,
  // scroll-based for longer ones
  const readerContent = $('reader-content');
  readerContent.scrollTop = 0;
  // If content is short (no scroll needed), mark immediately after brief delay
  setTimeout(() => {
    if (!currentArticle || currentArticle._uid !== article._uid) return;
    if (!readerPrefs.scrollMarkReadEnabled) return;
    const needsScroll = readerContent.scrollHeight > readerContent.clientHeight * 1.3;
    if (!needsScroll) {
      queueMarkRead(article);
    } else {
      setupScrollMarkRead(article);
    }
  }, 300);
}

// ── AI ────────────────────────────────────────────────────────────────────────
async function runAI(mode) {
  if (!currentArticle) return;

  const text = toPlainTextForAI(currentArticle);
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

function toPlainTextForAI(article) {
  const html = article?.content || article?.contentSnippet || '';
  if (!html) return article?.title || '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('script, style, iframe, object, embed').forEach(el => el.remove());
  const raw = (tmp.textContent || '').replace(/\s+/g, ' ').trim();
  const title = article?.title ? `${article.title}\n\n` : '';
  const merged = `${title}${raw}`;
  // keep payload stable to avoid model/token errors
  return merged.slice(0, 12000);
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
  if (currentFeedId.startsWith('fresh-group:') || currentFeedId.startsWith('fresh-feed:') || currentFeedId.startsWith('fresh-cat:')) {
    const accountId = currentFeedId.split(':')[1]?.split('|')[0];
    await doFreshRssSync(accountId);
    return;
  }

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
function makeNewAccount() {
  return {
    id: `fr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    groupName: 'FreshRSS 远端组',
    baseUrl: '',
    username: '',
    apiPassword: '',
    authToken: '',
    userId: '',
    loggedInAt: '',
    refreshInterval: 30,
    fetchLimit: 1000,
    perFeedBackfill: false,
    onlyUnreadCategory: false,
    categoryCollapseInitialized: false,
    collapsedCategories: []
  };
}

function getActiveAccount() {
  return (freshRssConfig.accounts || []).find(a => a.id === freshRssConfig.activeAccountId) || null;
}

function renderAccountSelector() {
  const sel = $('cfg-fr-account');
  if (!sel) return;
  const accounts = freshRssConfig.accounts || [];
  if (accounts.length === 0) {
    const a = makeNewAccount();
    freshRssConfig.accounts = [a];
    freshRssConfig.activeAccountId = a.id;
  }
  sel.innerHTML = (freshRssConfig.accounts || []).map(a =>
    `<option value="${a.id}">${escHtml(a.groupName || a.username || 'FreshRSS')}</option>`
  ).join('');
  sel.value = freshRssConfig.activeAccountId || freshRssConfig.accounts[0].id;
}

function fillActiveAccountForm() {
  const acc = getActiveAccount();
  if (!acc) return;
  $('cfg-fr-group-name').value = acc.groupName || '';
  $('cfg-fr-base-url').value = acc.baseUrl || '';
  $('cfg-fr-username').value = acc.username || '';
  $('cfg-fr-api-password').value = acc.apiPassword || '';
  $('cfg-fr-refresh-interval').value = acc.refreshInterval ?? 30;
  $('cfg-fr-fetch-limit').value = String(acc.fetchLimit ?? 1000);
  $('cfg-fr-per-feed-backfill').checked = !!acc.perFeedBackfill;
  $('cfg-fr-only-unread').checked = !!acc.onlyUnreadCategory;
  if (refreshSlider) refreshSlider.dispatchEvent(new Event('input'));
  $('fr-status').textContent = acc.authToken
    ? `已登录（${acc.groupName || acc.username || 'FreshRSS'}）`
    : '当前账号尚未登录 FreshRSS';
}

function persistActiveAccountForm() {
  const acc = getActiveAccount();
  if (!acc) return;
  acc.groupName = $('cfg-fr-group-name').value.trim() || acc.username || 'FreshRSS 远端组';
  acc.baseUrl = $('cfg-fr-base-url').value.trim();
  acc.username = $('cfg-fr-username').value.trim();
  const p = $('cfg-fr-api-password').value.trim();
  if (p) acc.apiPassword = p;
  acc.refreshInterval = parseInt($('cfg-fr-refresh-interval').value) || 30;
  acc.fetchLimit = parseInt($('cfg-fr-fetch-limit').value) || 0;
  acc.perFeedBackfill = !!$('cfg-fr-per-feed-backfill').checked;
  acc.onlyUnreadCategory = !!$('cfg-fr-only-unread').checked;
}

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

  readerPrefs = await window.api.getReaderPreferences();
  $('cfg-show-images').checked = readerPrefs.showArticleImages !== false;
  $('cfg-scroll-mark-read').checked = readerPrefs.scrollMarkReadEnabled !== false;
  $('cfg-list-scroll-mark-read').checked = !!readerPrefs.listScrollMarkReadEnabled;

  freshRssConfig = await window.api.getFreshRssConfig();
  if (!Array.isArray(freshRssConfig.accounts)) freshRssConfig.accounts = [];
  renderAccountSelector();
  fillActiveAccountForm();

  renderFeedsManageList();
  openModal('modal-settings');
});

$('btn-ai-health').addEventListener('click', async () => {
  const btn = $('btn-ai-health');
  const result = $('ai-health-result');
  btn.disabled = true;
  btn.textContent = '检测中…';
  result.textContent = '';
  result.style.color = 'var(--overlay)';

  // Save current form values first so health check uses latest input
  await window.api.saveAiConfig({
    baseUrl:         $('cfg-base-url').value.trim(),
    apiKey:          $('cfg-api-key').value.trim(),
    model:           $('cfg-model').value.trim(),
    summaryPrompt:   $('cfg-summary-prompt').value.trim(),
    translatePrompt: $('cfg-translate-prompt').value.trim()
  });

  const res = await window.api.aiHealthCheck();
  btn.disabled = false;
  btn.textContent = '🔍 健康检测（测试连通性）';
  if (res.success) {
    result.style.color = 'var(--green)';
    result.textContent = `✓ 连通正常，模型：${res.model}，回复：${res.reply}`;
  } else {
    result.style.color = 'var(--red)';
    result.textContent = `✗ ${res.error}`;
  }
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

  readerPrefs = {
    showArticleImages: $('cfg-show-images').checked,
    scrollMarkReadEnabled: $('cfg-scroll-mark-read').checked,
    listScrollMarkReadEnabled: $('cfg-list-scroll-mark-read').checked
  };
  await window.api.saveReaderPreferences(readerPrefs);

  persistActiveAccountForm();
  const frCfg = {
    accounts: freshRssConfig.accounts,
    activeAccountId: freshRssConfig.activeAccountId
  };
  await window.api.saveFreshRssConfig(frCfg);

  closeModal('modal-settings');
  showToast('设置已保存', 'success');
});

// ── Refresh interval slider label ────────────────────────────────────────────
const refreshSlider = $('cfg-fr-refresh-interval');
if (refreshSlider) {
  const updateLabel = () => {
    const v = parseInt(refreshSlider.value);
    const label = $('cfg-fr-refresh-interval-label');
    if (label) label.textContent = v === 0 ? '关闭' : `${v} 分钟`;
  };
  refreshSlider.addEventListener('input', updateLabel);
  updateLabel();
}

$('cfg-fr-account').addEventListener('change', () => {
  persistActiveAccountForm();
  freshRssConfig.activeAccountId = $('cfg-fr-account').value;
  fillActiveAccountForm();
});

$('cfg-fr-group-name').addEventListener('input', () => {
  persistActiveAccountForm();
  renderAccountSelector();
});

$('btn-fr-add-account').addEventListener('click', () => {
  persistActiveAccountForm();
  const a = makeNewAccount();
  freshRssConfig.accounts.push(a);
  freshRssConfig.activeAccountId = a.id;
  renderAccountSelector();
  fillActiveAccountForm();
});

$('btn-fr-del-account').addEventListener('click', () => {
  if ((freshRssConfig.accounts || []).length <= 1) {
    showToast('至少保留一个账号配置槽位', 'info');
    return;
  }
  const id = freshRssConfig.activeAccountId;
  freshRssConfig.accounts = freshRssConfig.accounts.filter(a => a.id !== id);
  delete freshGroups[id];
  freshRssConfig.activeAccountId = freshRssConfig.accounts[0].id;
  renderAccountSelector();
  fillActiveAccountForm();
  buildAllArticles();
  renderFeedList();
});

$('btn-fr-up').addEventListener('click', () => {
  persistActiveAccountForm();
  const arr = freshRssConfig.accounts || [];
  const idx = arr.findIndex(a => a.id === freshRssConfig.activeAccountId);
  if (idx <= 0) return;
  [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
  renderAccountSelector();
  renderFeedList();
});

$('btn-fr-down').addEventListener('click', () => {
  persistActiveAccountForm();
  const arr = freshRssConfig.accounts || [];
  const idx = arr.findIndex(a => a.id === freshRssConfig.activeAccountId);
  if (idx < 0 || idx >= arr.length - 1) return;
  [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
  renderAccountSelector();
  renderFeedList();
});

$('btn-fr-logout').addEventListener('click', async () => {
  const acc = getActiveAccount();
  if (!acc) return;
  acc.authToken = '';
  acc.userId = '';
  acc.loggedInAt = '';
  delete freshGroups[acc.id];
  await window.api.saveFreshRssConfig({
    accounts: freshRssConfig.accounts,
    activeAccountId: freshRssConfig.activeAccountId
  });
  if (currentFeedId.startsWith(`fresh-group:${acc.id}`) || currentFeedId.startsWith(`fresh-cat:${acc.id}|`) || currentFeedId.startsWith(`fresh-feed:${acc.id}|`)) {
    currentFeedId = 'all';
  }
  buildAllArticles();
  renderFeedList();
  $('fr-status').textContent = `已登出账号：${acc.groupName || acc.username || 'FreshRSS'}`;
  showToast('已登出当前 FreshRSS 账号', 'success');
});

$('cfg-fr-only-unread').addEventListener('change', () => {
  persistActiveAccountForm();
  applyFilter();
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

$('btn-fr-login').addEventListener('click', async () => {
  const btn = $('btn-fr-login');
  btn.disabled = true;
  btn.textContent = '登录中…';

  persistActiveAccountForm();
  await window.api.saveFreshRssConfig({
    accounts: freshRssConfig.accounts,
    activeAccountId: freshRssConfig.activeAccountId
  });

  const res = await window.api.freshRssLogin({ accountId: freshRssConfig.activeAccountId });

  btn.disabled = false;
  btn.textContent = '登录验证';

  if (!res.success) {
    $('fr-status').textContent = `登录失败：${res.error}`;
    showToast(res.error, 'error');
    return;
  }

  const active = getActiveAccount();
  $('fr-status').textContent = `登录成功，账号：${active?.groupName || active?.username || 'FreshRSS'}，正在刷新…`;
  showToast('FreshRSS 登录成功，开始同步', 'success');

  // Auto-sync after login
  await doFreshRssSync(freshRssConfig.activeAccountId);
});

async function doFreshRssSync(accountId) {
  const targetId = accountId || freshRssConfig.activeAccountId;
  if (!targetId) return;
  const syncAccount = (freshRssConfig.accounts || []).find(a => a.id === targetId);
  if (!syncAccount) return;
  const syncBtn = $('btn-fr-sync');
  if (syncBtn) { syncBtn.disabled = true; syncBtn.textContent = '同步中…'; }

  const syncRes = await window.api.freshRssFetchGroup({
    accountId: targetId,
    limit: syncAccount.fetchLimit || 0,
    perFeedBackfill: !!syncAccount.perFeedBackfill
  });

  if (syncBtn) { syncBtn.disabled = false; syncBtn.textContent = '立即同步'; }

  if (!syncRes.success) {
    const st = $('fr-status');
    if (st) st.textContent = `同步失败：${syncRes.error}`;
    showToast(syncRes.error, 'error');
    return;
  }

  const acc = (freshRssConfig.accounts || []).find(a => a.id === targetId);
  if (!acc) return;
  if (!freshGroups[targetId]) {
    freshGroups[targetId] = {
      account: acc,
      feeds: [],
      articles: [],
      categories: [],
      collapsed: !!acc.collapsed,
      collapsedCategories: new Set(acc.collapsedCategories || [])
    };
  }
  freshGroups[targetId].account = acc;
  freshGroups[targetId].feeds = (syncRes.feeds || []).map(f => ({
    ...f,
    categories: (f.categories && f.categories.length > 0) ? f.categories : ['未分类']
  }));
  freshGroups[targetId].articles = syncRes.articles || [];
  const catSet = new Set();
  (syncRes.feeds || []).forEach(f => (f.categories || []).forEach(c => catSet.add(c)));
  if (catSet.size === 0) catSet.add('未分类');
  freshGroups[targetId].categories = [...catSet];

  // Clean layout by default: first sync collapses all categories
  if (acc.categoryCollapseInitialized !== true) {
    acc.collapsedCategories = [...catSet];
    acc.categoryCollapseInitialized = true;
    freshGroups[targetId].collapsedCategories = new Set(acc.collapsedCategories);
    await window.api.saveFreshRssConfig({
      accounts: freshRssConfig.accounts,
      activeAccountId: freshRssConfig.activeAccountId
    });
  }

  // If user currently views FreshRSS group, keep focus there after refresh
  if (currentFeedId === 'all') {
    currentFeedId = `fresh-group:${targetId}`;
  }

  buildAllArticles();
  renderFeedList();
  renderFeedsManageList();

  const st = $('fr-status');
  const remoteUnread = countUnread(`fresh-group:${targetId}`);
  const fetched = syncRes.stats?.fetched ?? freshGroups[targetId].articles.length;
  const pages = syncRes.stats?.pages ?? 1;
  const mode = syncRes.stats?.mode === 'per-feed-backfill' ? '按订阅源补拉' : '全局流';
  const limitText = syncRes.stats?.limited ? `上限 ${syncRes.stats.limit}` : '无限';
  if (st) st.textContent = `远端已刷新：已拉取 ${fetched} 条，分页 ${pages} 次，模式 ${mode}，限制 ${limitText}，未读 ${remoteUnread}`;
  showToast(`FreshRSS 远端已刷新，未读 ${remoteUnread} 篇`, 'success');
}

$('btn-fr-sync').addEventListener('click', async () => {
  persistActiveAccountForm();
  await window.api.saveFreshRssConfig({
    accounts: freshRssConfig.accounts,
    activeAccountId: freshRssConfig.activeAccountId
  });
  await doFreshRssSync(freshRssConfig.activeAccountId);
});

// ── Digest ────────────────────────────────────────────────────────────────────
// ── Digest source picker ─────────────────────────────────────────────────────
function buildDigestSourceList() {
  const container = $('digest-source-list');
  container.innerHTML = '';

  function makeGroup(title) {
    const g = document.createElement('div');
    g.style.cssText = 'font-size:11px;font-weight:600;color:var(--overlay);text-transform:uppercase;letter-spacing:.05em;margin-top:6px;padding-bottom:2px;border-bottom:1px solid var(--border)';
    g.textContent = title;
    container.appendChild(g);
  }

  function makeRow(id, label, checked = true) {
    const row = document.createElement('label');
    row.className = 'checkbox-row';
    row.style.cssText = 'padding:3px 0;cursor:pointer';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.digestSource = id;
    cb.checked = checked;
    row.appendChild(cb);
    row.appendChild(document.createTextNode(' ' + label));
    container.appendChild(row);
  }

  // Local feeds
  if (feeds.length > 0) {
    makeGroup('本地订阅源');
    feeds.forEach(f => makeRow(`local:${f.id}`, f.name));
  }

  // FreshRSS groups — three-level: account → category → feeds
  Object.values(freshGroups).forEach(group => {
    const acc = group.account;
    if (!acc) return;
    const accId = acc.id;
    const groupLabel = acc.groupName || acc.username || 'FreshRSS';
    const groupFeeds = group.feeds || [];
    const cats = group.categories || [];

    makeGroup(groupLabel);

    cats.forEach(cat => {
      const catFeeds = groupFeeds.filter(f => (f.categories || []).includes(cat));

      // Category row
      const catRow = document.createElement('div');
      catRow.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;padding:2px 0;user-select:none';

      const catCb = document.createElement('input');
      catCb.type = 'checkbox';
      catCb.checked = true;
      catCb.dataset.digestCatCb = `${accId}|${cat}`;

      const toggle = document.createElement('span');
      toggle.textContent = '▾';
      toggle.style.cssText = 'font-size:10px;color:var(--overlay);cursor:pointer;width:12px;display:inline-block';

      const catLabel = document.createElement('span');
      catLabel.style.cssText = 'font-size:13px;font-weight:500;color:var(--text)';
      catLabel.textContent = cat;

      catRow.appendChild(catCb);
      catRow.appendChild(toggle);
      catRow.appendChild(catLabel);
      container.appendChild(catRow);

      // Feed sub-list
      const subList = document.createElement('div');
      subList.style.cssText = 'padding-left:22px;display:flex;flex-direction:column;gap:2px;margin-bottom:4px';

      catFeeds.forEach(f => {
        const feedRow = document.createElement('label');
        feedRow.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;padding:1px 0;font-size:12px;color:var(--subtext)';
        const fcb = document.createElement('input');
        fcb.type = 'checkbox';
        fcb.checked = true;
        fcb.dataset.digestSource = `fresh-feed:${accId}|${encodeURIComponent(f.url)}`;
        fcb.dataset.digestFeedUrl = f.url;
        fcb.dataset.digestFeedName = f.name || f.url;
        feedRow.appendChild(fcb);
        feedRow.appendChild(document.createTextNode(' ' + (f.name || f.url)));
        subList.appendChild(feedRow);
      });

      container.appendChild(subList);

      // Toggle collapse
      toggle.addEventListener('click', e => {
        e.preventDefault();
        const collapsed = subList.style.display === 'none';
        subList.style.display = collapsed ? 'flex' : 'none';
        toggle.textContent = collapsed ? '▾' : '▸';
      });

      // Category checkbox → check/uncheck all feeds in category
      catCb.addEventListener('change', () => {
        subList.querySelectorAll('input[data-digest-source]').forEach(cb => cb.checked = catCb.checked);
      });

      // Feed checkbox → update category checkbox indeterminate state
      subList.addEventListener('change', () => {
        const all = [...subList.querySelectorAll('input[data-digest-source]')];
        const anyChecked = all.some(cb => cb.checked);
        const allChecked = all.every(cb => cb.checked);
        catCb.checked = allChecked;
        catCb.indeterminate = anyChecked && !allChecked;
      });
    });
  });

  if (container.children.length === 0) {
    container.innerHTML = '<div style="color:var(--overlay);font-size:13px">暂无可用订阅源</div>';
  }
}

btnDigest.addEventListener('click', () => {
  const hasLocal = feeds.length > 0;
  const hasFresh = Object.keys(freshGroups).length > 0;
  if (!hasLocal && !hasFresh) {
    showToast('请先添加订阅源', 'error');
    return;
  }
  buildDigestSourceList();
  openModal('modal-digest-source');
});

$('btn-digest-source-all').addEventListener('click', () => {
  $('digest-source-list').querySelectorAll('input[data-digest-source]').forEach(cb => cb.checked = true);
});

$('btn-digest-source-none').addEventListener('click', () => {
  $('digest-source-list').querySelectorAll('input[data-digest-source]').forEach(cb => cb.checked = false);
});

$('btn-digest-source-confirm').addEventListener('click', async () => {
  const checkedFeeds = [...$('digest-source-list').querySelectorAll('input[data-digest-source]:checked')];

  if (checkedFeeds.length === 0) {
    showToast('请至少选择一个订阅源', 'error');
    return;
  }

  closeModal('modal-digest-source');

  // Build feeds/articles payload from checked feed-level checkboxes
  const localFeedIds = new Set();
  const freshFeedKeys = new Set(); // `${accId}|${feedUrl}`

  [...$('digest-source-list').querySelectorAll('input[data-digest-source]:checked')].forEach(cb => {
    const src = cb.dataset.digestSource;
    if (src.startsWith('local:')) {
      localFeedIds.add(src.slice(6));
    } else if (src.startsWith('fresh-feed:')) {
      const part = src.slice(11); // `${accId}|${encodedUrl}`
      const pipeIdx = part.indexOf('|');
      const accId = part.slice(0, pipeIdx);
      const url = decodeURIComponent(part.slice(pipeIdx + 1));
      freshFeedKeys.add(`${accId}|${url}`);
    }
  });

  // Local feeds list for main process to fetch
  const localFeeds = feeds
    .filter(f => localFeedIds.has(f.id))
    .map(f => ({ id: f.id, url: f.url, name: f.name }));

  // FreshRSS in-memory articles filtered by selected feed URLs
  const freshArticles = [];
  Object.values(freshGroups).forEach(group => {
    const accId = group.account?.id;
    if (!accId) return;
    const groupLabel = group.account.groupName || group.account.username || 'FreshRSS';
    (group.articles || []).forEach(a => {
      const key = `${accId}|${a.feedUrl || ''}`;
      if (freshFeedKeys.has(key)) {
        freshArticles.push({
          title: a.title || '无标题',
          link: a.link || '',
          content: a.content || a.contentSnippet || '',
          feedName: a.feedName || groupLabel
        });
      }
    });
  });

  // Show digest modal in loading state
  currentDigestText = '';
  $('digest-content').value = '';
  $('digest-status').textContent = '正在生成日报，请稍候…（需要逐篇调用 AI，可能需要数分钟）';
  $('btn-digest-send').disabled = true;
  $('btn-digest-copy').disabled = true;
  openModal('modal-digest');

  btnDigest.disabled = true;
  btnDigest.textContent = '⏳ 生成中…';

  const res = await window.api.generateDigest({ localFeeds, freshArticles });

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
  let statusMsg = `✅ 已处理 ${ok} 个来源`;
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
function extractFirstImageUrl(article) {
  function normalize(u) {
    if (!u) return '';
    const s = String(u).trim();
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith('//')) return `https:${s}`;
    if (s.startsWith('data:image/')) return s;
    if (s.startsWith('/') && article?.link) {
      try { return new URL(s, article.link).toString(); } catch (_) { return ''; }
    }
    return '';
  }

  // 1. Use pre-extracted imageUrl field (enclosure / media:thumbnail)
  if (article?.imageUrl) {
    const n = normalize(article.imageUrl);
    if (n) return n;
  }

  // 2. Scan HTML content for first img
  const html = article?.content || '';
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const img = tmp.querySelector('img[src]');
  const src = img?.getAttribute('src') || '';
  if (!src) return '';
  return normalize(src);
}

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
function sanitizeHtml(html, opts = {}) {
  const showImages = opts.showImages !== false;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('script, style, iframe, object, embed, form').forEach(el => el.remove());
  if (!showImages) tmp.querySelectorAll('img').forEach(el => el.remove());
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
  const options = {
    includeFeeds: $('backup-feeds').checked,
    includeAiConfig: $('backup-ai').checked,
    includeFreshRssConfig: $('backup-fr').checked,
    includeTgConfig: $('backup-tg').checked,
    includeTheme: $('backup-theme').checked
  };
  if (!Object.values(options).some(Boolean)) {
    showToast('请至少选择一个备份项', 'error');
    return;
  }
  const res = await window.api.createBackup(options);
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

// ── Auto-refresh listener ─────────────────────────────────────────────────────
if (window.api.onAutoRefreshTick) {
  window.api.onAutoRefreshTick(async (_event, payload = {}) => {
    btnRefresh.classList.add('spinning');

    // Refresh local feeds
    const toRefresh = feeds;
    await Promise.all(toRefresh.map(async f => {
      const res = await window.api.fetchFeed(f.url);
      if (res.success) {
        const oldLinks = new Set((f.items || []).map(i => i.link));
        f.items = res.items;
        res.items.forEach((item, idx) => {
          if (!oldLinks.has(item.link)) {
            unreadSet.add(`${f.id}-${idx}`);
          }
        });
      }
    }));

    // Refresh FreshRSS remote group in real time for target account
    if (payload.accountId) {
      await doFreshRssSync(payload.accountId);
    } else {
      buildAllArticles();
      renderFeedList();
    }

    btnRefresh.classList.remove('spinning');
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  // Load and apply theme first
  const theme = await window.api.getTheme();
  applyTheme(theme);

  // Load FreshRSS config for mark-read functionality
  freshRssConfig = await window.api.getFreshRssConfig();
  if (!Array.isArray(freshRssConfig.accounts)) freshRssConfig.accounts = [];
  readerPrefs = await window.api.getReaderPreferences();

  const savedFeeds = await window.api.getFeeds();
  feeds = savedFeeds.map(f => ({ ...f, items: [] }));
  renderFeedList();

  if (feeds.length > 0) {
    btnRefresh.classList.add('spinning');
    await Promise.all(feeds.map(async f => {
      const res = await window.api.fetchFeed(f.url);
      if (res.success) f.items = res.items;
    }));
    btnRefresh.classList.remove('spinning');
    // Mark all loaded articles as unread initially
    feeds.forEach(f => {
      (f.items || []).forEach((_, idx) => {
        unreadSet.add(`${f.id}-${idx}`);
      });
    });
    buildAllArticles();
    showToast(`已加载 ${feeds.length} 个订阅源`, 'success');
  }

  for (const acc of freshRssConfig.accounts) {
    if (acc.authToken) await doFreshRssSync(acc.id);
  }
}

init();
