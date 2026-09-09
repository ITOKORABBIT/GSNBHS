/**
 * GET /api/power — 臺中市計畫性停電資訊（台灣電力公司官方開放資料）
 *
 * 為什麼要有這支 Function：
 * 1. 台電只提供 ZIP 壓縮檔（政府資料開放平臺資料集 26144），瀏覽器無法直接讀，
 *    而且沒有 CORS 標頭。
 * 2. 原始資料是全台 23 個區處分檔，台中區處那一份還混了新竹縣與桃園市。
 * 3. 最麻煩的是「同一件工程被拆成多筆」——一條路一列。實測臺中市 54 列
 *    其實只有 24 件工程，直接照貼會讓畫面看起來像有 54 件停電。
 *
 * 這裡做五件事：解壓、只留臺中市、依請求號數合併、清理範圍字串、判斷有效期。
 * 不做任何推測或補值；來源給不出來的欄位就留空，前端顯示「—」。
 */

const SOURCE_URL = 'https://service.taipower.com.tw/data/opendata/apply/file/d077004/001.zip';
const SOURCE_NAME = '台灣電力公司 計畫性工作停電資料';
const SOURCE_PAGE = 'https://data.gov.tw/dataset/26144';

/** 台中區營業處的檔名（由 ZIP 內 manifest.csv 確認：105 = 台中區處）。 */
const ENTRY_NAME = '105.csv';
const CITY = '臺中市';

/** 已結束多久之內仍顯示（毫秒）。 */
const KEEP_AFTER_END_MS = 2 * 60 * 60 * 1000;

/* ────────────────────────── ZIP 解壓 ────────────────────────── */

/**
 * 從 ZIP 取出指定檔案。Workers 沒有 zip 函式庫，但 ZIP 的壓縮內容就是
 * raw deflate，可以交給內建的 DecompressionStream 處理，所以只需要自己
 * 走一次中央目錄找到檔案位置。
 */
async function extractFromZip(buffer, wantName) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // 由檔尾往前找 End of Central Directory（0x06054b50）。
  // ZIP 允許結尾有註解，所以不能假設它一定在最後 22 bytes。
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 65557; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP 結構異常：找不到 central directory');

  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);

  for (let i = 0; i < count; i++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) throw new Error('ZIP central directory 損毀');
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));

    if (name === wantName) {
      // local header 的 name/extra 長度可能與 central directory 不同，要重新讀
      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('ZIP local header 損毀');
      const lNameLen = view.getUint16(localOffset + 26, true);
      const lExtraLen = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = bytes.subarray(start, start + compSize);

      if (method === 0) return new TextDecoder().decode(data); // 未壓縮
      if (method !== 8) throw new Error(`不支援的壓縮方式 ${method}`);

      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new TextDecoder().decode(await new Response(stream).arrayBuffer());
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`ZIP 內找不到 ${wantName}`);
}

/* ────────────────────────── CSV ────────────────────────── */

/** 容忍引號與換行的最小 CSV 解析。 */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (c === '\r') continue;
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/* ────────────────────────── 清洗 ────────────────────────── */

/** 台電的時間欄位格式為 `2026/08/18 09:00~11:50`，沒有時區，實際是台灣時間。 */
function parseWindow(raw) {
  if (!raw || raw === '無') return null;
  const m = String(raw).trim().match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})~(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h1, mi1, h2, mi2] = m;
  const start = new Date(`${y}-${mo}-${d}T${h1}:${mi1}:00+08:00`);
  let end = new Date(`${y}-${mo}-${d}T${h2}:${mi2}:00+08:00`);
  // 跨午夜（例如 23:00~01:00）
  if (end < start) end = new Date(end.getTime() + 86400000);
  return Number.isNaN(start.getTime()) ? null : { start, end };
}

/** 停電範圍：去掉重複的「臺中市」前綴，讓每行只留下實際路段。 */
function cleanArea(raw) {
  return String(raw || '').trim().replace(/^[臺台]中市/, '').trim();
}

function classify(win, now) {
  if (!win) return 'unknown';
  if (now < win.start) return 'upcoming';
  if (now > win.end) return 'ended';
  return 'ongoing';
}

const ORDER = { ongoing: 0, upcoming: 1, unknown: 2, ended: 3 };

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

  let csv;
  try {
    const upstream = await fetch(SOURCE_URL, {
      cf: { cacheTtl: 600, cacheEverything: true },
      signal: AbortSignal.timeout(12000),
    });
    if (!upstream.ok) {
      return json({ ok: false, error: `來源回應 ${upstream.status}`, meta, items: [] }, 502, 60);
    }
    csv = await extractFromZip(await upstream.arrayBuffer(), ENTRY_NAME);
  } catch (err) {
    return json(
      { ok: false, error: err.message || '無法取得台電開放資料', meta, items: [] },
      502,
      60
    );
  }

  const rows = parseCsv(csv.replace(/^﻿/, ''));
  if (rows.length < 2) {
    return json({ ok: false, error: '來源格式與預期不符', meta, items: [] }, 502, 60);
  }

  const head = rows[0].map((h) => h.trim());
  const col = (name) => head.indexOf(name);
  const iId = col('請求號數');
  const iDesc = col('工作概述');
  const iT1 = col('第一次停電時間');
  const iT2 = col('第二次停電時間');
  const iArea = col('停電範圍');
  if (iId < 0 || iArea < 0 || iT1 < 0) {
    return json({ ok: false, error: '來源欄位與預期不符', meta, items: [] }, 502, 60);
  }

  const totalRows = rows.length - 1;
  const groups = new Map();

  for (const r of rows.slice(1)) {
    const area = r[iArea] || '';
    if (!area.replace(/台/g, '臺').includes(CITY) || !area.includes('北屯區')) continue;

    const id = (r[iId] || '').trim();
    const key = id || `${r[iT1]}|${r[iDesc]}`;
    if (!groups.has(key)) {
      groups.set(key, {
        id,
        desc: (r[iDesc] || '').trim(),
        rawT1: (r[iT1] || '').trim(),
        rawT2: (r[iT2] || '').trim(),
        areas: [],
      });
    }
    const cleaned = cleanArea(area);
    // 只寫「臺中市」沒有路名的列是空殼，有具體路段時就不需要它
    if (cleaned) groups.get(key).areas.push(cleaned);
  }

  const matchedRows = Array.from(groups.values()).reduce((a, g) => a + g.areas.length, 0);

  const items = Array.from(groups.values())
    .map((g) => {
      const win = parseWindow(g.rawT1);
      const win2 = parseWindow(g.rawT2);
      const windows = [win, win2].filter(Boolean);
      const state = windows.some(w => classify(w, now) === 'ongoing') ? 'ongoing' :
        windows.some(w => classify(w, now) === 'upcoming') ? 'upcoming' :
        windows.length ? 'ended' : 'unknown';
      return {
        id: g.id,
        desc: g.desc,
        areas: Array.from(new Set(g.areas)).sort(),
        startAt: win ? win.start.toISOString() : null,
        endAt: win ? win.end.toISOString() : null,
        secondStartAt: win2 ? win2.start.toISOString() : null,
        secondEndAt: win2 ? win2.end.toISOString() : null,
        state,
      };
    })
    .filter((it) => {
      if (it.state !== 'ended') return true;
      const lastEnd = it.secondEndAt || it.endAt;
      return lastEnd && now.getTime() - new Date(lastEnd).getTime() <= KEEP_AFTER_END_MS;
    })
    .sort((a, b) => {
      const byState = ORDER[a.state] - ORDER[b.state];
      if (byState !== 0) return byState;
      return String(a.startAt || '').localeCompare(String(b.startAt || ''));
    });

  return json(
    {
      ok: true,
      meta: {
        ...meta,
        totalUpstream: totalRows,
        matchedRows,
        merged: items.length,
      },
      items,
    },
    200,
    3600
  );
}
