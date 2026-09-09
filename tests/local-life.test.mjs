import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFire } from '../functions/api/fire.js';
import { nearbyTraffic } from '../functions/api/traffic.js';
import { taiwanTime } from '../functions/api/_local.js';
import { onRequestGet as water } from '../functions/api/water.js';

test('fire parser reads source columns and pagination, rejects an error page', () => {
  const result = parseFire(`<ul><li><span class="w15 list_word" data-th="受理時間：">2026/09/09 21:26:32</span>
    <span data-th="案類：">緊急救護</span><span data-th="案別">車禍</span>
    <span data-th="發生地點：">北屯區文心路 <button>google 地圖</button></span>
    <span data-th="執行狀況：">已到達</span></li></ul>第1頁／共3頁`);
  assert.equal(result.pageCount, 3);
  assert.equal(result.items[0].area, '北屯區文心路');
  assert.equal(result.items[0].detail, '車禍');
  assert.equal(result.items[0].startAt, '2026-09-09T13:26:32.000Z');
  assert.throws(() => parseFire('<html>維護中</html>'));
});

test('traffic excludes distant, expired, invalid coordinates and duplicate reports', () => {
  const base = { UID: 'a', x1: '120.699549', y1: '24.181308', modDttm: '2026-09-09 21:00:00', comment: '事故已排除', roadtype: '事故' };
  const rows = [base, base, {...base, UID:'b', x1:'121.5'}, {...base,UID:'c',modDttm:'2026-09-07 00:00:00'}, {...base,UID:'d',x1:'unknown'}];
  const items = nearbyTraffic(rows, Date.parse('2026-09-09T22:00:00+08:00'));
  assert.equal(items.length, 1);
  assert.equal(items[0].state, '已排除');
});

test('source time is Taiwan time and invalid input is not fabricated', () => {
  assert.equal(taiwanTime('2026/09/09 22:00:00'), '2026-09-09T14:00:00.000Z');
  assert.equal(taiwanTime('not a date'), null);
});

test('water keeps only Beitun, accepts 台/臺 city variants and deduplicates', async () => {
  const original = globalThis.fetch;
  const now = new Date();
  const future = new Date(now.getTime() + 3600000).toLocaleString('sv-SE', {timeZone:'Asia/Taipei'});
  const row = { '案件編號':'a','影響縣市':'台中市','影響行政區':'北屯區','停水地區':'台中市/北屯區/松竹路','案件日期時間':future };
  globalThis.fetch = async () => Response.json([row,row,{...row,'案件編號':'b','影響縣市':'新竹市'},{...row,'案件編號':'c','影響行政區':'西屯區','停水地區':'臺中市/西屯區'}]);
  try { const data = await (await water()).json(); assert.equal(data.ok,true); assert.equal(data.items.length,1); assert.equal(data.items[0].id,'a'); }
  finally { globalThis.fetch=original; }
});

test('water upstream failure returns unavailable instead of no incidents', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {throw new Error('offline')};
  try {const response=await water();assert.equal(response.status,502);assert.equal((await response.json()).ok,false);}
  finally {globalThis.fetch=original;}
});
