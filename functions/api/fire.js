import { get, json, taiwanTime } from './_local.js';

const SOURCE = 'https://www.fire.taichung.gov.tw/caselist/index.asp?Parser=99,8,226';
const clean = value => String(value || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();

export function parseFire(html) {
  if (!html.includes('受理時間') || !html.includes('執行狀況')) throw new Error('invalid fire page');
  const items = [];
  for (const match of html.matchAll(/<li>\s*<span[^>]*data-th="受理時間："[^>]*>([\s\S]*?)<\/li>/g)) {
    const row = '<span data-th="受理時間：">' + match[1];
    const field = label => clean(row.match(new RegExp('data-th="' + label + '：?"[^>]*>([^<]*)'))?.[1]);
    const time = field('受理時間');
    const area = field('發生地點');
    const startAt = taiwanTime(time);
    if (!startAt) throw new Error('invalid fire time');
    items.push({ id: time + area, startAt, area, kind: field('案類'), detail: field('案別'), state: field('執行狀況') });
  }
  const pageCount = Number(html.match(/共(\d+)頁/)?.[1] || 1);
  if (!items.length && !/無.*(?:案件|資料)|目前.*0件/.test(html)) throw new Error('unrecognised empty page');
  return { items, pageCount };
}

export async function onRequestGet() {
  const meta = { source: '臺中市政府消防局', sourceUrl: SOURCE, scope: '北屯區', fetchedAt: new Date().toISOString() };
  try {
    const first = parseFire(await (await get(SOURCE)).text());
    if (first.pageCount > 15) throw new Error('unexpected pagination');
    const pages = await Promise.all(Array.from({ length: first.pageCount - 1 }, async (_, i) =>
      parseFire(await (await get(SOURCE + ',,,,,,,,' + (i + 2))).text())));
    const all = [first, ...pages].flatMap(page => page.items);
    // 過期清單不可呈現成即時；不公開一般急病、創傷等救護資訊。
    const latest = Math.max(...all.map(item => Date.parse(item.startAt)));
    if (all.length && Date.now() - latest > 2 * 3600000) throw new Error('stale fire feed');
    const unique = new Map(all.filter(item => item.area.startsWith('北屯區') &&
      (item.kind !== '緊急救護' || /車禍|交通/.test(item.detail))).map(item => [item.id, item]));
    return json({ ok: true, meta, items: [...unique.values()].sort((a,b) => b.startAt.localeCompare(a.startAt)) });
  } catch {
    return json({ ok: false, meta, items: [], error: '消防資訊暫時無法取得' }, 502, 60);
  }
}
