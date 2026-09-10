/* 舊社里公開活動頁：沿用里刊新聞版面（assets/bulletin-news.css）。
   資料來自 events-api 的公開端點 getPublicEvents，只拿得到白名單欄位。
   報名一律導到官方 LINE，網頁不收報名資料。 */

var ICON = {
  clock: '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  pin: '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  form: '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>',
  line: '<svg width="17" height="17" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 5.82 2 10.5c0 2.7 1.5 5.1 3.86 6.66-.1.36-.6 2.1-.68 2.43 0 0-.02.11.06.16.07.04.16.01.16.01.22-.03 2.5-1.64 3.49-2.3.99.15 2.02.24 3.11.24 5.52 0 10-3.82 10-8.5S17.52 2 12 2z"/></svg>'
};

var allEvents = [];
var currentTab = 'all';

/* ── 小工具 ── */
function lineUrl(message) {
  var botId = (typeof CONFIG !== 'undefined' && CONFIG.LINE_BOT_ID) || '';
  return 'https://line.me/R/oaMessage/' + encodeURIComponent(botId) +
    (message ? '/?' + encodeURIComponent(message) : '');
}

function toDriveImgUrl(url) {
  if (!url) return '';
  var m = String(url).match(/[-\w]{25,}/);
  if (m && String(url).indexOf('drive.google.com') !== -1) {
    return 'https://drive.google.com/thumbnail?id=' + m[0] + '&sz=w1000';
  }
  return url;
}

function stripHtml(html) {
  var div = document.createElement('div');
  div.innerHTML = html || '';
  return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
}

/* 日期：2026-09-20T09:00 → 2026.09.20 09:00 */
function fmtDT(value, withTime) {
  if (!value) return '';
  var m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return String(value);
  var date = m[1] + '.' + m[2] + '.' + m[3];
  return withTime && m[4] ? date + ' ' + m[4] + ':' + m[5] : date;
}
function fmtRange(start, end, withTime) {
  var a = fmtDT(start, withTime), b = fmtDT(end, withTime);
  if (a && b) return a === b ? a : a + ' – ' + b;
  return a || b || '';
}
function eventTimeText(e) {
  return fmtRange(e.eventStart, e.eventEnd, true) || String(e.eventDate || '');
}
function regTimeText(e) {
  return fmtRange(e.registrationStart, e.registrationEnd, false);
}

/* ── 狀態 ── */
// 各里後台用過的狀態不只一種寫法（已截止／已結束），所以走白名單：
// 只有「報名中」才開放報名，其餘一律當成結束，未來新增狀態也不會誤開。
function stateOf(e) {
  if (String(e.status || '') !== '報名中') return 'closed';
  var now = Date.now();
  var start = registrationTime(e.registrationStart, -Infinity);
  var end = registrationTime(e.registrationEnd, Infinity);
  if (Number.isNaN(start) || Number.isNaN(end) || now > end) return 'closed';
  if (now < start) return 'upcoming';
  if (e.isFull) return 'full';
  return 'open';
}
// 與後端相同：沒有時區的日期時間以台灣時間解讀，不使用瀏覽器所在地。
function registrationTime(value, fallback) {
  if (!value) return fallback;
  var m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5]) : Date.parse(value);
}
var STATE_TAG = { open: 'tag-open', full: 'tag-full', upcoming: 'tag-closed', closed: 'tag-closed' };

function stateLabel(e) {
  var st = stateOf(e);
  if (st === 'open') return '報名中';
  if (st === 'full') return '已額滿';
  if (st === 'upcoming') return '尚未開放';
  if (e.status === '報名中') return '報名已截止';
  return String(e.status || '') || '已結束';   // 結束的直接顯示後台設定的字
}

function stateTag(e) {
  return '<span class="tag ' + STATE_TAG[stateOf(e)] + '">' + esc(stateLabel(e)) + '</span>';
}

/* 報名中的排前面；同組內活動日期近的排前面，沒日期的往後 */
function eventRank(a, b) {
  var ra = stateOf(a) === 'closed' ? 1 : 0;
  var rb = stateOf(b) === 'closed' ? 1 : 0;
  if (ra !== rb) return ra - rb;
  var ka = String(a.eventStart || a.registrationEnd || '');
  var kb = String(b.eventStart || b.registrationEnd || '');
  if (!ka) return 1;
  if (!kb) return -1;
  return ra === 1 ? kb.localeCompare(ka) : ka.localeCompare(kb);
}

/* ── 卡片零件 ── */
function metaHtml(e) {
  var html = stateTag(e);
  var when = eventTimeText(e);
  if (when) html += '<span class="dateline">' + esc(when) + '</span>';
  return html;
}

function linesHtml(e, compact) {
  var rows = [];
  var when = eventTimeText(e);
  if (when) rows.push([ICON.clock, '活動時間', when]);
  if (!compact && e.eventLocation) rows.push([ICON.pin, '地點', e.eventLocation]);
  var reg = regTimeText(e);
  if (reg) rows.push([ICON.form, '報名期間', reg]);
  if (!rows.length) return '';
  return '<div class="evt-lines">' + rows.map(function (r) {
    return '<div class="evt-line">' + r[0] + '<span><b>' + r[1] + '</b>　' + esc(r[2]) + '</span></div>';
  }).join('') + '</div>';
}

function quotaHtml(e) {
  var joined = Number(e.registeredCount || 0);
  var quota = Number(e.quota || 0);
  if (!quota) {
    return '<div class="evt-quota"><span class="num">' + joined + '</span> 人已報名・不限名額</div>';
  }
  var pct = Math.min(100, Math.round(joined / quota * 100));
  return '<div class="evt-quota' + (e.isFull ? ' full' : '') + '">' +
    '<span><span class="num">' + joined + '</span> / ' + quota + ' 人</span>' +
    '<span class="quota-bar"><span class="quota-fill" style="width:' + pct + '%"></span></span>' +
    '</div>';
}

function figureHtml(e, cls) {
  if (!e.imageUrl) return '';
  return '<div class="' + cls + '"><img src="' + esc(toDriveImgUrl(e.imageUrl)) + '" alt="" loading="lazy"></div>';
}
function figureClass(e) {
  return e.imageUrl ? '' : ' no-figure';
}
function openAttrs(id, classes) {
  return 'class="clickable' + (classes ? ' ' + classes : '') + '" role="button" tabindex="0" data-id="' + esc(id) + '"';
}

/* ── 版面 ── */
function renderFeed(list) {
  var feed = document.getElementById('feed');
  if (!list.length) {
    var nothingAtAll = !allEvents.length;
    feed.innerHTML = '<div class="state">' +
      '<svg width="46" height="46" fill="none" stroke-width="1.5" viewBox="0 0 24 24">' +
      '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>' +
      (nothingAtAll
        ? '<h3>目前沒有公開的活動</h3><p>里辦推出新活動時會出現在這裡。</p>'
        : '<h3>這個分類沒有活動</h3><p>換個分類看看，或稍後再回來。</p>') +
      '</div>';
    return;
  }

  var lead = list[0];
  var subs = list.slice(1, 4);
  var rest = list.slice(4);
  var html = '';

  html += '<div class="kicker-line">最新活動</div>';
  html += '<article ' + openAttrs(lead.eventId) + '><div class="lead' + figureClass(lead) + '">' +
    figureHtml(lead, 'lead-figure') +
    '<div><div class="lead-meta">' + metaHtml(lead) + '</div>' +
    '<h2>' + esc(lead.eventName) + '</h2>' +
    (lead.description ? '<p class="lead-excerpt">' + esc(stripHtml(lead.description)) + '</p>' : '') +
    linesHtml(lead) + quotaHtml(lead) +
    '<div class="lead-more"><span>看活動詳情</span> →</div>' +
    '</div></div></article>';

  if (subs.length) {
    html += '<div class="subleads">';
    subs.forEach(function (e) {
      html += '<article ' + openAttrs(e.eventId, 'sublead' + figureClass(e)) + '>' +
        figureHtml(e, 'sublead-figure') +
        '<div><div class="story-meta">' + metaHtml(e) + '</div>' +
        '<h3>' + esc(e.eventName) + '</h3>' +
        linesHtml(e, true) + quotaHtml(e) + '</div></article>';
    });
    html += '</div>';
  }

  if (rest.length) {
    html += '<div class="stories"><div class="kicker-line">更多活動</div>';
    rest.forEach(function (e) {
      html += '<article ' + openAttrs(e.eventId, 'story' + figureClass(e)) + '>' +
        figureHtml(e, 'story-figure') +
        '<div><div class="story-meta">' + metaHtml(e) + '</div>' +
        '<h3>' + esc(e.eventName) + '</h3>' +
        linesHtml(e, true) + quotaHtml(e) + '</div></article>';
    });
    html += '</div>';
  }

  feed.innerHTML = html;
}

function buildTabs() {
  var counts = { open: 0, full: 0, upcoming: 0, closed: 0 };
  allEvents.forEach(function (e) { counts[stateOf(e)]++; });
  var tabs = [{ key: 'all', label: '全部', n: allEvents.length }];
  if (counts.open) tabs.push({ key: 'open', label: '報名中', n: counts.open });
  if (counts.full) tabs.push({ key: 'full', label: '已額滿', n: counts.full });
  if (counts.upcoming) tabs.push({ key: 'upcoming', label: '尚未開放', n: counts.upcoming });
  if (counts.closed) tabs.push({ key: 'closed', label: '已結束', n: counts.closed });

  document.getElementById('cateTabs').innerHTML = tabs.map(function (t) {
    return '<button class="cate-tab" role="tab" data-tab="' + esc(t.key) + '"' +
      ' aria-selected="' + (t.key === currentTab ? 'true' : 'false') + '">' +
      esc(t.label) + '<span class="n">' + t.n + '</span></button>';
  }).join('');
}

function applyTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.cate-tab').forEach(function (el) {
    el.setAttribute('aria-selected', el.dataset.tab === tab ? 'true' : 'false');
  });
  var list = tab === 'all' ? allEvents : allEvents.filter(function (e) { return stateOf(e) === tab; });
  renderFeed(list);
}

/* ── 活動詳情 ── */
function openById(id) {
  var e = null;
  for (var i = 0; i < allEvents.length; i++) {
    if (allEvents[i].eventId === id) { e = allEvents[i]; break; }
  }
  if (!e) return;

  document.getElementById('modalTitle').textContent = e.eventName || '';
  document.getElementById('modalMeta').innerHTML = stateTag(e);

  var facts = [];
  var when = eventTimeText(e);
  if (when) facts.push(['活動時間', esc(when)]);
  if (e.eventLocation) {
    facts.push(['地點', e.mapUrl
      ? '<a href="' + esc(e.mapUrl) + '" target="_blank" rel="noopener">' + esc(e.eventLocation) + ' ↗</a>'
      : esc(e.eventLocation)]);
  }
  if (e.registrationStart) facts.push(['報名開始', esc(fmtDT(e.registrationStart, true))]);
  if (e.registrationEnd) facts.push(['報名截止', esc(fmtDT(e.registrationEnd, true))]);
  var joined = Number(e.registeredCount || 0);
  var quota = Number(e.quota || 0);
  facts.push(['已報名', quota
    ? '<span class="num">' + joined + '</span> / ' + quota + ' 人' + (e.isFull ? '（已額滿）' : '')
    : '<span class="num">' + joined + '</span> 人（不限名額）']);
  document.getElementById('modalFacts').innerHTML = facts.map(function (f) {
    return '<dt>' + f[0] + '</dt><dd>' + f[1] + '</dd>';
  }).join('');

  var desc = String(e.description || '').trim();
  document.getElementById('modalContent').innerHTML = desc
    ? desc.split(/\r?\n\s*\r?\n/).map(function (para) {
        return '<p>' + esc(para).replace(/\r?\n/g, '<br>') + '</p>';
      }).join('')
    : '<p style="color:var(--gs-muted)">這場活動還沒有補充說明，詳情請洽官方 LINE。</p>';

  var st = stateOf(e);
  var cta = document.getElementById('modalCta');
  if (st === 'open') {
    cta.innerHTML = '<a class="evt-cta" href="' + esc(lineUrl('我要報名')) + '" target="_blank" rel="noopener">' +
      ICON.line + ' 我要報名</a>' +
      '<p class="evt-note">會開啟' + esc(CONFIG.VILLAGE_NAME) + '官方 LINE，跟著訊息選擇活動並填寫資料即可完成報名。</p>';
  } else if (st === 'full') {
    cta.innerHTML = '<span class="evt-cta disabled">名額已滿</span>' +
      '<p class="evt-note">仍想參加可洽官方 LINE 詢問候補。</p>';
  } else if (st === 'upcoming') {
    cta.innerHTML = '<span class="evt-cta disabled">尚未開放報名</span>';
  } else {
    cta.innerHTML = '<span class="evt-cta disabled">報名已結束</span>';
  }

  var gallery = document.getElementById('modalGallery');
  if (e.imageUrl) {
    gallery.innerHTML = '<img src="' + esc(toDriveImgUrl(e.imageUrl)) + '" alt="" loading="lazy">';
    gallery.hidden = false;
  } else {
    gallery.innerHTML = '';
    gallery.hidden = true;
  }

  document.querySelector('.modal-scroll').scrollTop = 0;
  document.getElementById('modalBackdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
  document.querySelector('.modal-close').focus();
}

function closeModal(ev) {
  if (ev.target === document.getElementById('modalBackdrop')) closeModalDirect();
}
function closeModalDirect() {
  document.getElementById('modalBackdrop').classList.remove('open');
  document.body.style.overflow = '';
  if (location.search.indexOf('id=') !== -1) {
    history.replaceState(null, '', location.pathname);
  }
}

/* ── 事件 ── */
document.addEventListener('click', function (ev) {
  var tab = ev.target.closest('.cate-tab');
  if (tab) { applyTab(tab.dataset.tab); return; }
  var item = ev.target.closest('[data-id]');
  if (item && !ev.target.closest('.modal')) openById(item.dataset.id);
});

document.addEventListener('keydown', function (ev) {
  if (ev.key === 'Escape') { closeModalDirect(); return; }
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  var item = ev.target.closest && ev.target.closest('.clickable[data-id]');
  if (item) { ev.preventDefault(); openById(item.dataset.id); }
});

/* ── 載入 ── */
function load() {
  document.getElementById('mastheadKicker').textContent = CONFIG.VILLAGE_NAME + ' ' + CONFIG.SYSTEM_NAME;
  var now = new Date();
  document.getElementById('todayLine').textContent =
    now.getFullYear() + '.' + String(now.getMonth() + 1).padStart(2, '0') + '.' + String(now.getDate()).padStart(2, '0') + ' 更新';
  document.getElementById('railCta').href = lineUrl('我要報名');

  fetch(CONFIG.EVENT_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'getPublicEvents' })
  })
    .then(function (r) {
      if (!r.ok) throw new Error('活動服務暫時無法使用');
      return r.json();
    })
    .then(function (d) {
      if (!d.success || !Array.isArray(d.events)) throw new Error('活動資料無法讀取');
      if (!d.events.length) {
        document.getElementById('cateTabs').innerHTML = '';
        renderFeed([]);
        return;
      }
      allEvents = d.events.slice().sort(eventRank);

      var badge = document.getElementById('eventCount');
      badge.hidden = false;
      badge.textContent = '共 ' + allEvents.length + ' 場活動';

      buildTabs();
      applyTab('all');

      var wantId = new URLSearchParams(location.search).get('id');
      if (wantId) openById(wantId);
    })
    .catch(function () {
      document.getElementById('feed').innerHTML =
        '<div class="state"><svg width="46" height="46" fill="none" stroke-width="1.5" viewBox="0 0 24 24">' +
        '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
        '<h3>載入失敗</h3><p>請重新整理頁面再試一次。</p></div>';
    });
}

load();
