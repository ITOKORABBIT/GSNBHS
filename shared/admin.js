
const TAB_STYLES = {
  cases:    { accent: '#4d7a56', soft: '#ebf3ec' },
  stores:   { accent: '#be9445', soft: '#fbf4e4' },
  bulletins:{ accent: '#b95353', soft: '#fff1ef' },
  events:   { accent: '#1a73e8', soft: '#e8f0fe' },
  views:    { accent: '#5f5aa2', soft: '#f0efff' },
  admins:   { accent: '#2f63ce', soft: '#eef4ff' },
  emergency:{ accent: '#c0392b', soft: '#fdeceb' },
  chat:     { accent: '#0f9d8d', soft: '#e6f7f5' }
};
const VIEW_PAGE_CONFIG = {
  cases: {
    label: '公開案件',
    url: () => CONFIG.CASE_API_URL,
    sourceAction: 'getCases',
    idKey: 'caseId',
    title: item => item.publicTitle || item.title || '（無標題）',
    publicOnly: item => isTruthy(item.publicFlag)
  },
  stores: {
    label: '美食地圖',
    url: () => CONFIG.STORE_API_URL,
    sourceAction: 'getStores',
    idKey: 'storeId',
    title: item => item.pubName || item.storeName || '（無名稱）',
    publicOnly: item => item.status === '已公開'
  },
  bulletins: {
    label: '活動公告',
    url: () => CONFIG.BULLETIN_API_URL,
    sourceAction: 'getBulletins',
    idKey: 'bulletinId',
    title: item => item.title || '（無標題）',
    publicOnly: item => bulletinStatusLabel(item.status) === '已發布'
  }
};

let currentTab = 'cases';
let adminName = '';
let adminRole = '';
let adminEmail = '';
let allCases = [];
let allStores = [];
let allBulletins = [];
let allAdmins = [];
let allEvents = [];
let loadedTabs = {};
let caseFilter = 'all';
let storeFilter = 'all';
let bulletinFilter = 'all';
let eventFilter = 'all';
let editingAdminEmail = null;
let adminsAccessible = false;
let viewStatsData = {};
let viewItems = [];
let allEmergencyContacts = [];
let editingEmergencyId = null;
let allChatThreads = [];

const WORKER_ACTION_URLS = {
  getCases:     () => CONFIG.CASE_API_URL,
  getStores:    () => CONFIG.STORE_API_URL,
  getBulletins: () => CONFIG.BULLETIN_API_URL,
  getEvents:    () => CONFIG.EVENT_API_URL,
  getRegistrations: () => CONFIG.EVENT_API_URL,
  getEmergencyContacts:    () => CONFIG.EVENT_API_URL,
  addEmergencyContact:     () => CONFIG.EVENT_API_URL,
  updateEmergencyContact:  () => CONFIG.EVENT_API_URL,
  deleteEmergencyContact:  () => CONFIG.EVENT_API_URL,
  getChatThreads:  () => CONFIG.EVENT_API_URL,
  getChatMessages: () => CONFIG.EVENT_API_URL,
};
function apiCall(action, extra) {
  const sess = getSession();
  const payload = Object.assign({ action: action }, extra || {});
  const workerUrl = WORKER_ACTION_URLS[action] ? WORKER_ACTION_URLS[action]() : null;
  const isWorker = !!workerUrl;
  const url = workerUrl || CONFIG.SCRIPT_URL;
  if (sess) {
    payload.sessionToken = sess.sessionToken;
    if (isWorker && sess.id_token) payload.id_token = sess.id_token;
  }
  return fetch(url, {
    method: 'POST',
    redirect: isWorker ? undefined : 'follow',
    headers: { 'Content-Type': isWorker ? 'application/json' : 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  })
  .then(r => r.json());
}

function apiCallTo(url, action, extra) {
  const sess = getSession();
  const payload = Object.assign({ action: action }, extra || {});
  if (sess) {
    payload.sessionToken = sess.sessionToken;
    if (sess.id_token) payload.id_token = sess.id_token;
  }
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(r => r.json());
}

function handleExpiredSession() {
  clearSession();
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'grid';
  document.getElementById('loginError').style.display = 'block';
  document.getElementById('loginError').textContent = '登入已失效，請重新登入。';
  if (typeof google !== 'undefined') google.accounts.id.disableAutoSelect();
}

function isLineWebView() {
  return /Line\//i.test(navigator.userAgent);
}

function isOtherWebView() {
  const ua = navigator.userAgent;
  return /FBAN|FBAV|Instagram|MicroMessenger/i.test(ua) ||
    (ua.includes('Android') && /wv\b/.test(ua));
}

function copyLoginUrl() {
  const url = location.href;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.querySelector('.webview-copy-btn');
    btn.textContent = '✓ 已複製！貼到 Chrome 開啟';
    btn.style.background = '#16a34a';
  }).catch(() => {
    prompt('請手動複製此網址：', url);
  });
}

function initGoogle() {
  if (isLineWebView()) {
    const url = new URL(location.href);
    if (!url.searchParams.has('openExternalBrowser')) {
      url.searchParams.set('openExternalBrowser', '1');
      location.replace(url.toString());
      return;
    }
  }
  if (isOtherWebView()) {
    document.getElementById('webviewWarn').style.display = 'block';
    return;
  }
  const sess = getSession();
  if (sess) {
    adminName = sess.name || '';
    adminRole = sess.role || '';
    adminEmail = sess.email || '';
    enterApp();
    return;
  }
  if (!CONFIG.GOOGLE_CLIENT_ID) return;
  if (typeof google === 'undefined') {
    setTimeout(initGoogle, 300);
    return;
  }
  google.accounts.id.initialize({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    callback: onGoogleSignIn,
    auto_select: true
  });
  google.accounts.id.renderButton(document.getElementById('loginBtnWrap'), {
    type: 'standard',
    theme: 'filled_blue',
    size: 'large',
    text: 'signin_with',
    locale: 'zh-TW',
    width: 280
  });
  google.accounts.id.prompt();
}

function onGoogleSignIn(resp) {
  document.getElementById('loginError').style.display = 'none';
  fetch(CONFIG.SCRIPT_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'login', id_token: resp.credential })
  })
  .then(r => r.text())
  .then(t => JSON.parse(t))
  .then(json => {
    if (!json.success) {
      document.getElementById('loginError').style.display = 'block';
      return;
    }
    adminName = json.name || '';
    adminRole = json.role || '';
    adminEmail = json.email || '';
    setSession(json.sessionToken, json.email, json.name, json.role || '', resp.credential);
    enterApp();
  })
  .catch(() => {
    document.getElementById('loginError').style.display = 'block';
  });
}

function enterApp() {
  const redirect = new URLSearchParams(location.search).get('redirect') || '';
  if (redirect) {
    try {
      const target = new URL(redirect, location.origin);
      if (target.origin === location.origin) {
        location.replace(redirect);
        return;
      }
    } catch (error) {}
  }
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'block';
  document.getElementById('userAvatar').textContent = (adminName || '管').charAt(0);
  document.getElementById('userName').textContent = adminName || '管理者';
  document.getElementById('userRole').textContent = adminRole || '管理員';
  applyInitialTab();
}

function doLogout() {
  clearSession();
  if (typeof google !== 'undefined') google.accounts.id.disableAutoSelect();
  location.href = 'admin.html';
}

function applyInitialTab() {
  const tab = new URLSearchParams(location.search).get('tab');
  if (tab && TAB_STYLES[tab]) currentTab = tab;
  switchTab(currentTab);
}

function switchTab(tab) {
  currentTab = tab;
  const style = TAB_STYLES[tab];
  document.documentElement.style.setProperty('--tab-accent', style.accent);
  document.documentElement.style.setProperty('--tab-soft', style.soft);
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === 'panel-' + tab);
  });
  loadTab(tab);
}

function badgeClassByText(text) {
  const value = String(text || '');
  if (value.includes('新') || value.includes('待')) return 'badge-blue';
  if (value.includes('處理中') || value.includes('審核中') || value.includes('草稿') || value.includes('未發布')) return 'badge-gold';
  if (value.includes('已公開') || value.includes('已發布') || value.includes('已處理') || value.includes('已結案')) return 'badge-green';
  return 'badge-gray';
}

function isTruthy(value) {
  return value === true || value === 1 || value === '1' || value === 'TRUE' || value === '是';
}

function setSummary(id, value, note) {
  document.getElementById(id).textContent = value;
  document.getElementById(id + 'Note').textContent = note;
}

function bulletinStatusLabel(status) {
  return String(status || '').trim() === '已發布' ? '已發布' : '未發布';
}

function buildPills(containerId, items, selected, callbackName) {
  const container = document.getElementById(containerId);
  container.innerHTML = items.map(item => (
    '<button class="pill' + (item.value === selected ? ' active' : '') + '" onclick="' + callbackName + '(\'' + escapeHtml(item.value) + '\')">' +
    escapeHtml(item.label) + '</button>'
  )).join('');
}

function setCaseFilter(value) { caseFilter = value; renderCases(); }
function setStoreFilter(value) { storeFilter = value; renderStores(); }
function setBulletinFilter(value) { bulletinFilter = value; renderBulletins(); }
function setEventFilter(value) { eventFilter = value; renderEvents(); }

function loadTab(tab, force) {
  if (!force && loadedTabs[tab]) return;
  loadedTabs[tab] = true;

  if (tab === 'cases') loadCases();
  if (tab === 'stores') loadStores();
  if (tab === 'bulletins') loadBulletins();
  if (tab === 'events') loadEvents();
  if (tab === 'views') loadViewStats();
  if (tab === 'admins') loadAdmins();
  if (tab === 'emergency') loadEmergencyContacts();
  if (tab === 'chat') loadChatThreads();
}

function loadCases() {
  apiCall('getCases').then(json => {
    if (json.code === 401) return handleExpiredSession();
    if (!json.success) throw new Error(json.error || '載入案件失敗');
    allCases = json.cases || [];
    const pending = allCases.filter(item => String(item.status || '').includes('新') || String(item.status || '').includes('待')).length;
    setSummary('sumCases', String(allCases.length), '待關注 ' + pending + ' 件');
    renderCases();
  }).catch(error => {
    document.getElementById('caseWrap').innerHTML = '<div class="empty-state"><h3>無法載入案件</h3><p>' + escapeHtml(error.message || '請稍後再試') + '</p></div>';
  });
}

function renderCases() {
  const q = (document.getElementById('caseSearch').value || '').trim().toLowerCase();
  const statusCounts = {};
  allCases.forEach(item => {
    const key = item.status || '未設定';
    statusCounts[key] = (statusCounts[key] || 0) + 1;
  });

  const pills = [{ value: 'all', label: '全部 ' + allCases.length }];
  Object.keys(statusCounts).sort().forEach(key => pills.push({ value: key, label: key + ' ' + statusCounts[key] }));
  buildPills('casePills', pills, caseFilter, 'setCaseFilter');

  const list = allCases.filter(item => {
    if (caseFilter !== 'all' && (item.status || '未設定') !== caseFilter) return false;
    if (!q) return true;
    const hay = [item.caseId, item.title, item.addr, item.category, item.publicTitle].join(' ').toLowerCase();
    return hay.includes(q);
  });

  if (!list.length) {
    document.getElementById('caseWrap').innerHTML = '<div class="empty-state"><h3>沒有符合的案件</h3><p>請調整搜尋條件或切換狀態。</p></div>';
    return;
  }

  const rows = list.map(item => (
    '<tr>' +
    '<td>' + escapeHtml(item.caseId) + '</td>' +
    '<td>' + escapeHtml(item.title || '（無標題）') + '</td>' +
    '<td><span class="badge ' + badgeClassByText(item.status) + '">' + escapeHtml(item.status || '未設定') + '</span></td>' +
    '<td>' + escapeHtml(item.category || '—') + '</td>' +
    '<td>' + escapeHtml(fmtDate(item.reportTime)) + '</td>' +
    '<td><div class="inline-actions">' +
    '<a class="inline-link" href="detail.html?id=' + encodeURIComponent(item.caseId) + '">編輯</a>' +
    '</div></td>' +
    '</tr>'
  )).join('');

  document.getElementById('caseWrap').innerHTML =
    '<table><thead><tr><th>案件編號</th><th>主旨</th><th>狀態</th><th>分類</th><th>通報時間</th><th>操作</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function loadStores() {
  apiCall('getStores').then(json => {
    if (json.code === 401) return handleExpiredSession();
    if (!json.success) throw new Error(json.error || '載入商店失敗');
    allStores = json.stores || [];
    const publicCount = allStores.filter(item => item.status === '已公開').length;
    setSummary('sumStores', String(allStores.length), '已公開 ' + publicCount + ' 間');
    renderStores();
  }).catch(error => {
    document.getElementById('storeWrap').innerHTML = '<div class="empty-state"><h3>無法載入商店</h3><p>' + escapeHtml(error.message || '請稍後再試') + '</p></div>';
  });
}

function renderStores() {
  const q = (document.getElementById('storeSearch').value || '').trim().toLowerCase();
  const statusCounts = {};
  allStores.forEach(item => {
    const key = item.status || '未設定';
    statusCounts[key] = (statusCounts[key] || 0) + 1;
  });

  const pills = [{ value: 'all', label: '全部 ' + allStores.length }];
  Object.keys(statusCounts).sort().forEach(key => pills.push({ value: key, label: key + ' ' + statusCounts[key] }));
  buildPills('storePills', pills, storeFilter, 'setStoreFilter');

  const list = allStores.filter(item => {
    if (storeFilter !== 'all' && (item.status || '未設定') !== storeFilter) return false;
    if (!q) return true;
    const hay = [item.storeId, item.storeName, item.addr, item.category, item.name].join(' ').toLowerCase();
    return hay.includes(q);
  });

  if (!list.length) {
    document.getElementById('storeWrap').innerHTML = '<div class="empty-state"><h3>沒有符合的商店</h3><p>請調整搜尋條件或切換狀態。</p></div>';
    return;
  }

  const rows = list.map(item => (
    '<tr>' +
    '<td>' + escapeHtml(item.storeId) + '</td>' +
    '<td>' + escapeHtml(item.storeName || '（無名稱）') + '</td>' +
    '<td><span class="badge ' + badgeClassByText(item.status) + '">' + escapeHtml(item.status || '未設定') + '</span></td>' +
    '<td>' + escapeHtml(item.category || '—') + '</td>' +
    '<td>' + escapeHtml(fmtDate(item.applyTime)) + '</td>' +
    '<td><div class="inline-actions">' +
    '<a class="inline-link" href="storedetail.html?id=' + encodeURIComponent(item.storeId) + '">審核</a>' +
    '<a class="inline-link" href="storeopendetail.html?id=' + encodeURIComponent(item.storeId) + '&back=' + encodeURIComponent('storeopenlist.html') + '" target="_blank" rel="noopener">公開頁</a>' +
    '</div></td>' +
    '</tr>'
  )).join('');

  document.getElementById('storeWrap').innerHTML =
    '<table><thead><tr><th>商店編號</th><th>店名</th><th>狀態</th><th>分類</th><th>申請時間</th><th>操作</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function loadBulletins() {
  apiCall('getBulletins').then(json => {
    if (json.code === 401) return handleExpiredSession();
    if (!json.success) throw new Error(json.error || '載入公告失敗');
    allBulletins = json.bulletins || [];
    const publishedCount = allBulletins.filter(item => bulletinStatusLabel(item.status) === '已發布').length;
    setSummary('sumBulletins', String(allBulletins.length), '已發布 ' + publishedCount + ' 則');
    renderBulletins();
  }).catch(error => {
    document.getElementById('bulletinWrap').innerHTML = '<div class="empty-state"><h3>無法載入公告</h3><p>' + escapeHtml(error.message || '請稍後再試') + '</p></div>';
  });
}

function renderBulletins() {
  const q = (document.getElementById('bulletinSearch').value || '').trim().toLowerCase();
  const statusCounts = {};
  allBulletins.forEach(item => {
    const key = bulletinStatusLabel(item.status);
    statusCounts[key] = (statusCounts[key] || 0) + 1;
  });

  const pills = [{ value: 'all', label: '全部 ' + allBulletins.length }];
  ['已發布', '未發布'].forEach(key => pills.push({ value: key, label: key + ' ' + (statusCounts[key] || 0) }));
  buildPills('bulletinPills', pills, bulletinFilter, 'setBulletinFilter');

  const list = allBulletins.filter(item => {
    if (bulletinFilter !== 'all' && bulletinStatusLabel(item.status) !== bulletinFilter) return false;
    if (!q) return true;
    const hay = [item.bulletinId, item.title, item.content, item.author].join(' ').toLowerCase();
    return hay.includes(q);
  });

  if (!list.length) {
    document.getElementById('bulletinWrap').innerHTML = '<div class="empty-state"><h3>沒有符合的公告</h3><p>請調整搜尋條件或切換狀態。</p></div>';
    return;
  }

  const rows = list.map(item => (
    '<tr>' +
    '<td>' + escapeHtml(item.bulletinId) + '</td>' +
    '<td>' + escapeHtml(item.title || '（無標題）') + (item.pinned ? ' <span class="muted">置頂</span>' : '') + '</td>' +
    '<td><span class="badge ' + badgeClassByText(bulletinStatusLabel(item.status)) + '">' + escapeHtml(bulletinStatusLabel(item.status)) + '</span></td>' +
    '<td>' + escapeHtml(fmtDate(item.createdAt)) + '</td>' +
    '<td>' + escapeHtml(item.author || '—') + '</td>' +
    '<td><div class="inline-actions">' +
    '<a class="inline-link" href="bulletinlist.html">管理</a>' +
    '<a class="inline-link" href="bulletin.html" target="_blank" rel="noopener">前台</a>' +
    '</div></td>' +
    '</tr>'
  )).join('');

  document.getElementById('bulletinWrap').innerHTML =
    '<table><thead><tr><th>公告編號</th><th>標題</th><th>狀態</th><th>建立時間</th><th>建立者</th><th>操作</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function loadEvents() {
  apiCall('getEvents').then(json => {
    if (json.code === 401) return handleExpiredSession();
    if (!json.success) throw new Error(json.error || '載入活動失敗');
    allEvents = json.events || [];
    const activeCount = allEvents.filter(e => e.status === '報名中').length;
    const totalReg = allEvents.reduce((s, e) => s + (parseInt(e.registeredCount) || 0), 0);
    setSummary('sumEvents', String(allEvents.length), '報名中 ' + activeCount + ' 個・共 ' + totalReg + ' 人報名');
    renderEvents();
  }).catch(error => {
    document.getElementById('eventWrap').innerHTML = '<div class="empty-state"><h3>無法載入活動</h3><p>' + escapeHtml(error.message || '請稍後再試') + '</p></div>';
  });
}

function renderEvents() {
  const q = (document.getElementById('eventSearch').value || '').trim().toLowerCase();
  const statusCounts = {};
  allEvents.forEach(e => {
    const key = e.status || '草稿';
    statusCounts[key] = (statusCounts[key] || 0) + 1;
  });

  const pills = [{ value: 'all', label: '全部 ' + allEvents.length }];
  ['報名中', '草稿', '已截止'].forEach(key => {
    if (statusCounts[key]) pills.push({ value: key, label: key + ' ' + statusCounts[key] });
  });
  buildPills('eventPills', pills, eventFilter, 'setEventFilter');

  const list = allEvents.filter(e => {
    if (eventFilter !== 'all' && (e.status || '草稿') !== eventFilter) return false;
    if (!q) return true;
    return [e.eventName, e.eventLocation, e.eventDate].join(' ').toLowerCase().includes(q);
  });

  if (!list.length) {
    document.getElementById('eventWrap').innerHTML = '<div class="empty-state"><h3>沒有符合的活動</h3><p>請調整搜尋條件，或到「進入管理頁」新增活動。</p></div>';
    return;
  }

  const statusBadge = {
    '報名中': 'badge-green',
    '草稿':   'badge-gold',
    '已截止': 'badge-gray'
  };

  const rows = list.map(e => {
    const quota = e.quota > 0
      ? e.registeredCount + ' / ' + e.quota + ' 人'
      : e.registeredCount + ' 人（不限）';
    const isFull = e.quota > 0 && e.registeredCount >= e.quota;
    const quotaHtml = isFull
      ? '<span class="badge badge-gray">' + quota + ' 額滿</span>'
      : quota;
    const s = e.status || '草稿';
    return '<tr>' +
      '<td>' + escapeHtml(e.eventName || '（未命名）') + '</td>' +
      '<td><span class="badge ' + (statusBadge[s] || 'badge-gray') + '">' + escapeHtml(s) + '</span></td>' +
      '<td>' + escapeHtml(e.eventDate || '—') + '</td>' +
      '<td>' + escapeHtml(e.eventLocation || '—') + '</td>' +
      '<td>' + quotaHtml + '</td>' +
      '<td><div class="inline-actions">' +
      '<a class="inline-link" href="eventdetail.html?id=' + encodeURIComponent(e.eventId) + '">編輯</a>' +
      '<button class="inline-link" type="button" onclick="openEventRegistrations(\'' + escapeHtml(e.eventId) + '\')">名單</button>' +
      '</div></td>' +
      '</tr>';
  }).join('');

  document.getElementById('eventWrap').innerHTML =
    '<table><thead><tr><th>活動名稱</th><th>狀態</th><th>日期</th><th>地點</th><th>報名人數</th><th>操作</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function openEventRegistrations(eventId) {
  const event = allEvents.find(item => String(item.eventId || '') === String(eventId || '')) || {};
  const eventName = event.eventName || '（未命名）';
  document.getElementById('registrationModalTitle').textContent = eventName + ' 報名名單';
  document.getElementById('registrationModalBody').innerHTML =
    '<div class="empty-state"><h3>載入中</h3><p>正在讀取報名名單…</p></div>';
  document.getElementById('registrationModal').classList.add('open');
  apiCall('getRegistrations', { eventId: eventId }).then(json => {
    if (json.code === 401) return handleExpiredSession();
    if (!json.success) throw new Error(json.error || '載入報名名單失敗');
    renderEventRegistrations(json);
  }).catch(error => {
    document.getElementById('registrationModalBody').innerHTML =
      '<div class="empty-state"><h3>無法載入名單</h3><p>' + escapeHtml(error.message || '請稍後再試') + '</p></div>';
  });
}

function closeRegistrationModal() {
  document.getElementById('registrationModal').classList.remove('open');
}

function renderEventRegistrations(data) {
  const regs = data.registrations || [];
  const totalHeadcount = parseInt(data.totalHeadcount, 10) || regs.length;
  if (!regs.length) {
    document.getElementById('registrationModalBody').innerHTML =
      '<div class="empty-state"><h3>尚無報名資料</h3><p>目前沒有里民報名此活動。</p></div>';
    return;
  }
  const rows = regs.map(reg => (
    '<tr>' +
    '<td>' + escapeHtml(reg.displayName || '（未取得姓名）') + '</td>' +
    '<td>' + escapeHtml(reg.headcount || '1') + '</td>' +
    '<td>' + (String(reg.checkedIn || '').toUpperCase() === 'TRUE' ? '<span class="badge badge-green">已簽到</span>' : '<span class="badge badge-gray">未簽到</span>') + '</td>' +
    '<td>' + (String(reg.lineReminderOptIn || '').toUpperCase() === 'TRUE' ? '🔔 接收' : '—') + '</td>' +
    '<td>' + escapeHtml(formatDateTime(reg.submittedAt)) + '</td>' +
    '<td>' + escapeHtml(reg.residentNote || '') + '</td>' +
    '</tr>'
  )).join('');
  document.getElementById('registrationModalBody').innerHTML =
    '<div class="registration-summary">共 ' + regs.length + ' 筆報名・' + totalHeadcount + ' 人</div>' +
    '<div class="registration-table-wrap"><table><thead><tr><th>LINE 姓名</th><th>人數</th><th>簽到</th><th>LINE 提醒</th><th>報名時間</th><th>備註</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function formatDateTime(value) {
  if (!value) return '—';
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      return new Intl.DateTimeFormat('zh-TW', {
        timeZone: 'Asia/Taipei',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(d).replace(/\//g, '-').replace(',', '');
    }
  }
  return raw.substring(0, 16).replace('T', ' ');
}

function selectedViewConfig() {
  const key = document.getElementById('viewPageSelect') ? document.getElementById('viewPageSelect').value : 'cases';
  return { key, config: VIEW_PAGE_CONFIG[key] || VIEW_PAGE_CONFIG.cases };
}

function showViewMessage(message, isError) {
  const el = document.getElementById('viewMessage');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('error', !!isError);
  el.style.display = message ? 'block' : 'none';
}

function loadViewStats(force) {
  const sel = selectedViewConfig();
  const config = sel.config;
  showViewMessage('', false);
  document.getElementById('viewWrap').innerHTML = '<div class="empty-state"><h3>載入中</h3><p>正在讀取瀏覽人次…</p></div>';

  return Promise.all([
    apiCall(config.sourceAction),
    apiCallTo(config.url(), 'getViewStats', { page: sel.key })
  ]).then(([sourceJson, statsJson]) => {
    if (sourceJson.code === 401 || statsJson.code === 401) return handleExpiredSession();
    if (!sourceJson.success) throw new Error(sourceJson.error || '無法讀取資料');
    if (!statsJson.success) throw new Error(statsJson.error || '無法讀取瀏覽人次');

    const source = sourceJson.cases || sourceJson.stores || sourceJson.bulletins || [];
    const idKey = config.idKey;
    viewStatsData = statsJson.cardCounts || {};
    viewItems = source
      .filter(config.publicOnly)
      .map(item => ({
        id: String(item[idKey] || ''),
        title: config.title(item),
        count: Number(viewStatsData[item[idKey]] || 0)
      }))
      .filter(item => item.id);
    document.getElementById('viewTotal').textContent = String(statsJson.pageCount || 0);
    renderViewRows();
  }).catch(error => {
    showViewMessage(error.message || '讀取失敗', true);
    document.getElementById('viewWrap').innerHTML = '<div class="empty-state"><h3>無法讀取瀏覽人次</h3><p>' + escapeHtml(error.message || '請稍後再試') + '</p></div>';
  });
}

function renderViewRows() {
  if (!viewItems.length) {
    document.getElementById('viewWrap').innerHTML = '<div class="empty-state"><h3>沒有公開項目</h3><p>這個頁面目前沒有可調整的公開卡片。</p></div>';
    return;
  }
  const rows = sortedViewItems()
    .map(item => (
      '<tr>' +
      '<td>' + escapeHtml(item.id) + '</td>' +
      '<td>' + escapeHtml(item.title) + '</td>' +
      '<td>' + escapeHtml(String(item.count)) + '</td>' +
      '<td><input class="input view-count-input" data-id="' + escapeHtml(item.id) + '" type="number" min="0" value="' + escapeHtml(String(item.count)) + '"></td>' +
      '<td><button class="inline-link" type="button" onclick="setSingleViewCount(\'' + escapeHtml(item.id) + '\')">套用</button></td>' +
      '</tr>'
    )).join('');
  document.getElementById('viewWrap').innerHTML =
    '<table><thead><tr><th>編號</th><th>標題</th><th>目前</th><th>指定數字</th><th>操作</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function sortedViewItems() {
  return viewItems.slice().sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

function bulkBoostViews() {
  const sel = selectedViewConfig();
  const count = Math.max(1, Math.floor(Number(document.getElementById('viewTopN').value || 0)));
  const min = Math.max(0, Math.floor(Number(document.getElementById('viewAddMin').value || 0)));
  const maxRaw = Math.max(0, Math.floor(Number(document.getElementById('viewAddMax').value || 0)));
  const max = Math.max(min, maxRaw);
  const items = sortedViewItems().slice(0, count).map(item => ({
    itemId: item.id,
    count: min === max ? min : Math.floor(Math.random() * (max - min + 1)) + min
  })).filter(item => item.count > 0);
  if (!items.length) {
    showViewMessage('沒有可增加的項目，或增加數為 0。', true);
    return;
  }
  apiCallTo(sel.config.url(), 'bulkAddCardViews', { page: sel.key, items })
    .then(json => {
      if (json.code === 401) return handleExpiredSession();
      if (!json.success) throw new Error(json.error || '批次增加失敗');
      return loadViewStats(true).then(() => {
        showViewMessage('已增加 ' + (json.updated || items.length) + ' 筆瀏覽數。', false);
      });
    })
    .catch(error => showViewMessage(error.message || '批次增加失敗', true));
}

function setSingleViewCount(itemId) {
  const sel = selectedViewConfig();
  const input = document.querySelector('.view-count-input[data-id="' + CSS.escape(itemId) + '"]');
  const count = Math.max(0, Math.floor(Number(input ? input.value : 0)));
  apiCallTo(sel.config.url(), 'resetViewStats', { page: sel.key, cards: [{ itemId, count }] })
    .then(json => {
      if (json.code === 401) return handleExpiredSession();
      if (!json.success) throw new Error(json.error || '設定失敗');
      return loadViewStats(true).then(() => {
        showViewMessage('已設定 ' + itemId + ' 為 ' + count + '。', false);
      });
    })
    .catch(error => showViewMessage(error.message || '設定失敗', true));
}

function loadAdmins() {
  apiCall('getAdmins').then(json => {
    if (json.code === 401 || json.success === false) {
      adminsAccessible = false;
      allAdmins = [];
      setSummary('sumAdmins', '—', '目前帳號無管理者權限');
      renderAdmins(json.error || '僅超級管理員可查看與管理帳號。');
      return;
    }
    adminsAccessible = true;
    allAdmins = json.admins || [];
    setSummary('sumAdmins', String(allAdmins.length), '目前可管理帳號 ' + allAdmins.length + ' 位');
    renderAdmins();
  }).catch(() => {
    adminsAccessible = false;
    renderAdmins('無法載入管理者名單。');
  });
}

function renderAdmins(message) {
  if (!adminsAccessible) {
    document.getElementById('adminWrap').innerHTML = '<div class="empty-state"><h3>管理者頁面受限</h3><p>' + escapeHtml(message || '僅超級管理員可操作。') + '</p></div>';
    return;
  }
  if (!allAdmins.length) {
    document.getElementById('adminWrap').innerHTML = '<div class="empty-state"><h3>目前沒有管理者資料</h3><p>請先新增一位帳號。</p></div>';
    return;
  }

  const cards = allAdmins.map(item => {
    const activeLabel = item.active ? '啟用中' : '停用中';
    const badgeClass = item.active ? 'badge-green' : 'badge-gray';
    return '<div class="account-card">' +
      '<div class="account-main">' +
      '<div class="account-avatar">' + escapeHtml((item.display_name || '管').charAt(0)) + '</div>' +
      '<div>' +
      '<div class="account-name">' + escapeHtml(item.display_name || '未命名') + '</div>' +
      '<div class="account-email">' + escapeHtml(item.email || '') + '</div>' +
      '</div></div>' +
      '<div class="account-actions">' +
      '<span class="badge ' + badgeClass + '">' + activeLabel + '</span>' +
      '<span class="badge badge-blue">' + escapeHtml(item.role || '管理員') + '</span>' +
      '<button class="action-btn" onclick="openAdminModalByEmail(\'' + escapeHtml(item.email) + '\')">編輯</button>' +
      '<button class="action-btn" onclick="toggleAdminActive(\'' + escapeHtml(item.email) + '\',' + (item.active ? 'true' : 'false') + ')">' + (item.active ? '停用' : '啟用') + '</button>' +
      '<button class="action-btn" onclick="deleteAdmin(\'' + escapeHtml(item.email) + '\')">刪除</button>' +
      '</div></div>';
  }).join('');

  document.getElementById('adminWrap').innerHTML = '<div class="account-grid">' + cards + '</div>';
}

function openAdminModal(admin) {
  if (!adminsAccessible) return;
  editingAdminEmail = admin ? admin.email : null;
  document.getElementById('adminModalTitle').textContent = admin ? '編輯管理者' : '新增管理者';
  document.getElementById('adminNameInput').value = admin ? (admin.display_name || '') : '';
  document.getElementById('adminEmailInput').value = admin ? (admin.email || '') : '';
  document.getElementById('adminEmailInput').readOnly = !!admin;
  document.getElementById('adminRoleInput').value = admin ? (admin.role || '管理員') : '管理員';
  document.getElementById('adminModalError').style.display = 'none';
  document.getElementById('adminSaveBtn').textContent = '儲存';
  document.getElementById('adminModal').classList.add('open');
}

function openAdminModalByEmail(email) {
  const admin = allAdmins.find(item => item.email === email);
  if (!admin) return;
  openAdminModal(admin);
}

function closeAdminModal() {
  document.getElementById('adminModal').classList.remove('open');
}

function showAdminError(message) {
  const el = document.getElementById('adminModalError');
  el.textContent = message;
  el.style.display = 'block';
}

function saveAdmin() {
  const name = document.getElementById('adminNameInput').value.trim();
  const email = document.getElementById('adminEmailInput').value.trim().toLowerCase();
  const role = document.getElementById('adminRoleInput').value;
  const btn = document.getElementById('adminSaveBtn');

  if (!name) return showAdminError('請輸入名稱。');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showAdminError('請輸入正確的 Email。');

  btn.textContent = '儲存中…';
  const action = editingAdminEmail ? 'updateAdmin' : 'addAdmin';
  const payload = { display_name: name, email: email, role: role };
  if (editingAdminEmail) payload.target_email = editingAdminEmail;

  apiCall(action, payload).then(json => {
    if (json.code === 401) return handleExpiredSession();
    if (!json.success) {
      btn.textContent = '儲存';
      return showAdminError(json.error || '儲存失敗');
    }
    closeAdminModal();
    loadAdmins();
  }).catch(() => {
    btn.textContent = '儲存';
    showAdminError('儲存失敗，請稍後再試。');
  });
}

function toggleAdminActive(email, currentActive) {
  if (!confirm((currentActive ? '停用' : '啟用') + '這個管理者帳號？')) return;
  apiCall('updateAdmin', {
    target_email: email,
    active: !currentActive
  }).then(json => {
    if (json.code === 401) return handleExpiredSession();
    if (!json.success) {
      alert(json.error || '更新失敗');
      return;
    }
    loadAdmins();
  }).catch(() => {
    alert('更新失敗，請稍後再試。');
  });
}

function deleteAdmin(email) {
  if (!confirm('確定要刪除這位管理者？')) return;
  apiCall('deleteAdmin', { target_email: email }).then(json => {
    if (json.code === 401) return handleExpiredSession();
    if (!json.success) {
      alert(json.error || '刪除失敗');
      return;
    }
    loadAdmins();
  }).catch(() => {
    alert('刪除失敗，請稍後再試。');
  });
}

function loadEmergencyContacts() {
  apiCall('getEmergencyContacts').then(json => {
    if (json.code === 401) return handleExpiredSession();
    if (!json.success) throw new Error(json.error || '載入失敗');
    allEmergencyContacts = json.contacts || [];
    renderEmergencyContacts();
  }).catch(error => {
    document.getElementById('emergencyWrap').innerHTML = '<div class="empty-state"><h3>無法載入緊急電話</h3><p>' + escapeHtml(error.message || '請稍後再試') + '</p></div>';
  });
}

function renderEmergencyContacts() {
  if (!allEmergencyContacts.length) {
    document.getElementById('emergencyWrap').innerHTML = '<div class="empty-state"><h3>目前沒有緊急電話</h3><p>請先新增一筆。</p></div>';
    return;
  }
  const cards = allEmergencyContacts.map(item => {
    return '<div class="account-card">' +
      '<div class="account-main">' +
      '<div class="account-avatar">' + escapeHtml((item.name || '電').charAt(0)) + '</div>' +
      '<div>' +
      '<div class="account-name">' + escapeHtml(item.name || '未命名') + (item.org ? '（' + escapeHtml(item.org) + '）' : '') + '</div>' +
      '<div class="account-email">' + (item.kind === 'hint' ? '免費通話提示' : item.kind === 'url' ? ('通話連結：' + escapeHtml(item.phone || '')) : escapeHtml(item.phone || '')) + '</div>' +
      '</div></div>' +
      '<div class="account-actions">' +
      '<button class="action-btn" onclick="openEmergencyModalById(\'' + escapeHtml(item.id) + '\')">編輯</button>' +
      '<button class="action-btn" onclick="deleteEmergencyContactUi(\'' + escapeHtml(item.id) + '\')">刪除</button>' +
      '</div></div>';
  }).join('');
  document.getElementById('emergencyWrap').innerHTML = '<div class="account-grid">' + cards + '</div>';
}

function openEmergencyModal(contact) {
  editingEmergencyId = contact ? contact.id : null;
  document.getElementById('emergencyModalTitle').textContent = contact ? '編輯電話' : '新增電話';
  document.getElementById('emergencyKindInput').value = contact ? (contact.kind || 'tel') : 'tel';
  document.getElementById('emergencyNameInput').value = contact ? (contact.name || '') : '';
  document.getElementById('emergencyOrgInput').value = contact ? (contact.org || '') : '';
  document.getElementById('emergencyPhoneInput').value = contact ? (contact.phone || '') : '';
  document.getElementById('emergencySortInput').value = contact ? (contact.sort_order || 0) : 0;
  document.getElementById('emergencyModalError').style.display = 'none';
  document.getElementById('emergencySaveBtn').textContent = '儲存';
  toggleEmergencyPhoneField();
  document.getElementById('emergencyModal').classList.add('open');
}

function toggleEmergencyPhoneField() {
  const kind = document.getElementById('emergencyKindInput').value;
  document.getElementById('emergencyPhoneField').style.display = kind === 'hint' ? 'none' : '';
  document.getElementById('emergencyPhoneLabel').textContent =
    kind === 'url' ? '通話連結（例如 https://lin.ee/xxxxx）' : '電話（純數字，例如：0919662257）';
}

function openEmergencyModalById(id) {
  const contact = allEmergencyContacts.find(item => item.id === id);
  if (!contact) return;
  openEmergencyModal(contact);
}

function closeEmergencyModal() {
  document.getElementById('emergencyModal').classList.remove('open');
}

function showEmergencyError(message) {
  const el = document.getElementById('emergencyModalError');
  el.textContent = message;
  el.style.display = 'block';
}

function saveEmergencyContact() {
  const kind = document.getElementById('emergencyKindInput').value;
  const name = document.getElementById('emergencyNameInput').value.trim();
  const org = document.getElementById('emergencyOrgInput').value.trim();
  const phone = document.getElementById('emergencyPhoneInput').value.trim();
  const sortOrder = Number(document.getElementById('emergencySortInput').value) || 0;
  const btn = document.getElementById('emergencySaveBtn');

  if (!name) return showEmergencyError('請輸入名稱。');
  if (kind !== 'hint' && !phone) return showEmergencyError(kind === 'url' ? '請輸入通話連結。' : '請輸入電話。');

  btn.textContent = '儲存中…';
  const action = editingEmergencyId ? 'updateEmergencyContact' : 'addEmergencyContact';
  const payload = { kind: kind, name: name, org: org, phone: phone, sortOrder: sortOrder };
  if (editingEmergencyId) payload.id = editingEmergencyId;

  apiCall(action, payload).then(json => {
    if (json.code === 401) return handleExpiredSession();
    if (!json.success) {
      btn.textContent = '儲存';
      return showEmergencyError(json.error || '儲存失敗');
    }
    closeEmergencyModal();
    loadEmergencyContacts();
  }).catch(() => {
    btn.textContent = '儲存';
    showEmergencyError('儲存失敗，請稍後再試。');
  });
}

function deleteEmergencyContactUi(id) {
  if (!confirm('確定要刪除這筆電話？')) return;
  apiCall('deleteEmergencyContact', { id: id }).then(json => {
    if (json.code === 401) return handleExpiredSession();
    if (!json.success) {
      alert(json.error || '刪除失敗');
      return;
    }
    loadEmergencyContacts();
  }).catch(() => {
    alert('刪除失敗，請稍後再試。');
  });
}

function loadChatThreads() {
  apiCall('getChatThreads').then(json => {
    if (json.code === 401) return handleExpiredSession();
    if (!json.success) throw new Error(json.error || '載入失敗');
    allChatThreads = json.threads || [];
    renderChatThreads();
  }).catch(error => {
    document.getElementById('chatWrap').innerHTML = '<div class="empty-state"><h3>無法載入留言記錄</h3><p>' + escapeHtml(error.message || '請稍後再試') + '</p></div>';
  });
}

function renderChatThreads() {
  if (!allChatThreads.length) {
    document.getElementById('chatWrap').innerHTML = '<div class="empty-state"><h3>目前還沒有留言</h3><p>里民使用「只想聊聊」後會出現在這裡。</p></div>';
    return;
  }
  const cards = allChatThreads.map(item => {
    const name = item.display_name || '（未知里民）';
    const lastAt = (item.last_at || '').replace('T', ' ').substring(0, 16);
    return '<div class="account-card">' +
      '<div class="account-main">' +
      '<div class="account-avatar">' + escapeHtml(name.charAt(0)) + '</div>' +
      '<div>' +
      '<div class="account-name">' + escapeHtml(name) + '</div>' +
      '<div class="account-email">共 ' + (item.message_count || 0) + ' 則・最後留言 ' + escapeHtml(lastAt) + '</div>' +
      '</div></div>' +
      '<div class="account-actions">' +
      '<button class="action-btn primary" onclick="openChatThread(\'' + escapeHtml(item.line_user_id) + '\', \'' + escapeHtml(name) + '\')">查看</button>' +
      '</div></div>';
  }).join('');
  document.getElementById('chatWrap').innerHTML = '<div class="account-grid">' + cards + '</div>';
}

function openChatThread(lineUserId, displayName) {
  document.getElementById('chatModalTitle').textContent = displayName + ' 的留言';
  document.getElementById('chatMessagesWrap').innerHTML = '<p>載入中…</p>';
  document.getElementById('chatModal').classList.add('open');
  apiCall('getChatMessages', { lineUserId: lineUserId }).then(json => {
    if (json.code === 401) return handleExpiredSession();
    if (!json.success) throw new Error(json.error || '載入失敗');
    renderChatMessages(json.messages || []);
  }).catch(error => {
    document.getElementById('chatMessagesWrap').innerHTML = '<p>' + escapeHtml(error.message || '載入失敗') + '</p>';
  });
}

function renderChatMessages(messages) {
  if (!messages.length) {
    document.getElementById('chatMessagesWrap').innerHTML = '<p>沒有留言內容。</p>';
    return;
  }
  const rows = messages.map(m => {
    const who = m.role === 'user' ? '里民' : 'AI 小幫手';
    const at = (m.created_at || '').replace('T', ' ').substring(0, 16);
    const align = m.role === 'user' ? 'left' : 'right';
    const bg = m.role === 'user' ? '#eef4ff' : '#f0f0f0';
    return '<div style="text-align:' + align + ';margin:8px 0;">' +
      '<div style="display:inline-block;max-width:80%;background:' + bg + ';border-radius:10px;padding:8px 12px;">' +
      '<div style="font-size:12px;color:#888;margin-bottom:2px;">' + escapeHtml(who) + ' · ' + escapeHtml(at) + '</div>' +
      '<div>' + escapeHtml(m.content || '') + '</div>' +
      '</div></div>';
  }).join('');
  document.getElementById('chatMessagesWrap').innerHTML = rows;
}

function closeChatModal() {
  document.getElementById('chatModal').classList.remove('open');
}

window.addEventListener('click', event => {
  if (event.target === document.getElementById('adminModal')) closeAdminModal();
  if (event.target === document.getElementById('emergencyModal')) closeEmergencyModal();
  if (event.target === document.getElementById('registrationModal')) closeRegistrationModal();
});


['click', 'keydown', 'mousedown', 'touchstart', 'scroll'].forEach(function(eventName) {
  window.addEventListener(eventName, function() {
    touchSession();
  }, { passive: true });
});

document.addEventListener('DOMContentLoaded', function() {
  let tries = 0;
  const timer = setInterval(function() {
    if (typeof google !== 'undefined' || ++tries > 30) {
      clearInterval(timer);
      initGoogle();
    }
  }, 200);
});
