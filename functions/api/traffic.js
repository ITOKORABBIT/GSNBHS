import { get, json, taiwanTime } from './_local.js';

export function nearbyTraffic(rows, now = Date.now()) {
  const seen = new Set();
  return rows.flatMap(row => {
    const lat = Number(row.y1), lon = Number(row.x1);
    // 舊社公園周邊 3 公里，明示周邊範圍，並非行政里界。
    const km = Math.hypot((lat - 24.181308) * 111.2, (lon - 120.699549) * 101.5);
    const updatedAt = taiwanTime(row.modDttm);
    if (!Number.isFinite(km) || km > 3 || !updatedAt || now - Date.parse(updatedAt) > 24 * 3600000 || seen.has(row.UID)) return [];
    seen.add(row.UID);
    return [{ id: row.UID, area: [row.areaNm, row.road].filter(Boolean).join(' '), detail: row.comment,
      kind: row.roadtype, updatedAt, state: /排除|恢復正常|恢復通車/.test(row.comment) ? '已排除' : '路況通報' }];
  }).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function onRequestGet() {
  const meta = { source: '警察廣播電臺', sourceUrl: 'https://data.gov.tw/dataset/15221', scope: '舊社公園周邊 3 公里', fetchedAt: new Date().toISOString() };
  try {
    const data = await (await get('https://rtr.pbs.gov.tw/NMP103_PbsWS/resources/roadData/opendata')).json();
    if (!Array.isArray(data.result) || !data.result.length) throw new Error('invalid traffic');
    const latest = Math.max(...data.result.map(row => Date.parse(taiwanTime(row.modDttm)) || 0));
    if (Date.now() - latest > 2 * 3600000) throw new Error('stale traffic');
    return json({ ok: true, meta, items: nearbyTraffic(data.result) });
  } catch {
    return json({ ok: false, meta, items: [], error: '交通資訊暫時無法取得' }, 502, 60);
  }
}
