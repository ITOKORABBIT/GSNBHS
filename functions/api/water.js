/**
 * GET /api/water — 臺中市停水資訊（台灣自來水公司官方開放資料）
 *
 * 為什麼要有這支 Function：
 * 1. 台水的 JSON 沒有回 Access-Control-Allow-Origin，瀏覽器直接 fetch 會被 CORS 擋掉。
 * 2. 原始資料是全台 69 筆混在一起，且含重複案件、已恢復供水的舊案、
 *    整段公文式的停水原因。直接照貼就是參考站「資料雜訊」的老路。
 *
 * 這裡只做四件事：過濾臺中市、去重、判斷有效期、把原因清成一句話。
 * 不做任何推測或補值；來源給不出來的欄位就留空，前端顯示「—」。
 */

const SOURCE_URL = 'https://web.water.gov.tw/wateroffapi/openData/export/json';
const SOURCE_NAME = '台灣自來水公司 停水資訊開放資料';
const SOURCE_PAGE = 'https://web.water.gov.tw/wateroff';
const CITY = '臺中市';

/** 已恢復供水後仍顯示的時間（毫秒）。超過就不再列出，避免版面塞舊案。 */
const KEEP_AFTER_RESTORE_MS = 6 * 60 * 60 * 1000;
/** 開始前多久算「即將停水」。 */
const UPCOMING_WINDOW_MS = 72 * 60 * 60 * 1000;

/** 台水的時間字串沒有時區，實際是台灣時間，補成 +08:00 再解析。 */
function parseTaiwanTime(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const text = raw.trim().replace(' ', 'T');
  const date = new Date(text + '+08:00');
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 停水原因清洗：台水塞的是整段公文，含 [] 包裹、全形空白、換行與重複的
 * 「停水期間請關閉抽水馬達」制式句。留第一句可讀的說明就好。
 */
function cleanReason(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let text = raw
    .replace(/^\[|\]$/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/　/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!text || text === 'null') return '';
  // 取到第一個句號／全形句號為止，其餘多是制式提醒與範圍重述
  const cut = text.search(/[。；]/);
  if (cut > 8) text = text.slice(0, cut);
  text = text.trim().replace(/[，、,\s]+$/, '');
  return text.length > 60 ? text.slice(0, 60) + '…' : text;
}

/** 停水地區：來源用「縣市/行政區/路名。」格式，去掉縣市前綴避免每行都重複。 */
function cleanArea(raw) {
  if (!raw || typeof raw !== 'string' || raw === 'null') return '';
  return raw
    .split(/[\r\n]+/)
    .map((line) => line.replace(/^[臺台]中市\//, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function toInt(raw) {
  const n = Number.parseInt(String(raw ?? '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function classify(startAt, endAt, now) {
  if (startAt && now < startAt) return 'upcoming';
  if (endAt && now > endAt) return 'restored';
  if (startAt && now >= startAt) return 'ongoing';
  return 'unknown';
}

function normalise(row, now) {
  const startAt = parseTaiwanTime(row['案件日期時間']);
  const endAt = parseTaiwanTime(row['恢復日期時間']);
  return {
    id: String(row['案件編號'] || '').trim(),
    kind: String(row['案件類型'] || '').trim(), // 計畫性 / 非計畫性
    district: String(row['影響行政區'] || '').trim(),
    area: cleanArea(row['停水地區']),
    reason: cleanReason(row['停水原因']),
    households: toInt(row['影響戶數']),
    office: String(row['場所'] || '').trim(),
    phone: String(row['連絡電話'] || '').trim(),
    startAt: startAt ? startAt.toISOString() : null,
    endAt: endAt ? endAt.toISOString() : null,
    state: classify(startAt, endAt, now),
  };
}

function isRelevant(item, now) {
  const start = item.startAt ? new Date(item.startAt).getTime() : null;
  const end = item.endAt ? new Date(item.endAt).getTime() : null;
  if (item.state === 'restored') return end !== null && now.getTime() - end <= KEEP_AFTER_RESTORE_MS;
  if (item.state === 'upcoming') return start !== null && start - now.getTime() <= UPCOMING_WINDOW_MS;
  return true;
}

const ORDER = { ongoing: 0, upcoming: 1, restored: 2, unknown: 3 };

function json(body, status, cacheSeconds) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${cacheSeconds}`,
      'access-control-allow-origin': '*',
    },
  });
}

export async function onRequestGet() {
  const now = new Date();
  const meta = {
    source: SOURCE_NAME,
    sourceUrl: SOURCE_PAGE,
    city: CITY,
    fetchedAt: now.toISOString(),
  };

  let raw;
  try {
    const upstream = await fetch(SOURCE_URL, {
      headers: { accept: 'application/json' },
      cf: { cacheTtl: 600, cacheEverything: true },
      signal: AbortSignal.timeout(12000),
    });
    if (!upstream.ok) {
      return json({ ok: false, error: `來源回應 ${upstream.status}`, meta, items: [] }, 502, 60);
    }
    raw = await upstream.json();
  } catch (err) {
    return json({ ok: false, error: '無法連線到台水開放資料', meta, items: [] }, 502, 60);
  }

  if (!Array.isArray(raw)) {
    return json({ ok: false, error: '來源格式與預期不符', meta, items: [] }, 502, 60);
  }

  const seen = new Set();
  const items = raw
    .filter((row) => String(row?.['影響縣市'] || '').replace(/台/g,'臺').includes(CITY) && (String(row?.['影響行政區'] || '') + String(row?.['停水地區'] || '')).includes('北屯'))
    .map((row) => normalise(row, now))
    .filter((item) => {
      if (!item.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .filter((item) => isRelevant(item, now))
    .sort((a, b) => {
      const byState = ORDER[a.state] - ORDER[b.state];
      if (byState !== 0) return byState;
      return String(a.startAt || '').localeCompare(String(b.startAt || ''));
    });

  return json(
    {
      ok: true,
      meta: { ...meta, totalUpstream: raw.length, matched: items.length },
      items,
    },
    200,
    600
  );
}
