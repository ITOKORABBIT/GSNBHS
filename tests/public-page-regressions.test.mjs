import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function pageContext(file, response = { ok: true, json: async () => ({ success: true, events: [] }) }) {
  const elements = new Map();
  const handlers = {};
  const element = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', classList: { add() {}, remove() {} }, addEventListener() {} });
    return elements.get(id);
  };
  const context = vm.createContext({
    CONFIG: { VILLAGE_NAME: '測試里', SYSTEM_NAME: '小幫手', LINE_BOT_ID: '@test' },
    document: { getElementById: element, addEventListener: (name, fn) => { handlers[name] = fn; }, querySelectorAll: () => [] },
    esc: value => String(value ?? ''), fetch: async () => response, URLSearchParams,
    location: { search: '' }, setInterval() {}, console,
  });
  let source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  if (file.includes('storefront')) source = source.slice(0, source.indexOf("document.getElementById('heroKicker').textContent"));
  else source = source.replace(/load\(\);\s*$/, '');
  vm.runInContext(source, context);
  return { context, element, handlers };
}

test('registration follows Taiwan time, inclusive boundaries and closed statuses', () => {
  const { context: c } = pageContext('assets/eventopenlist.js');
  vm.runInContext('Date.now = () => Date.UTC(2026, 8, 10, 2, 0)', c);
  const event = { status: '報名中', registrationStart: '2026-09-10T10:00', registrationEnd: '2026-09-10T10:00' };
  assert.equal(c.stateOf(event), 'open');
  assert.equal(c.stateOf({ ...event, registrationStart: '2026-09-10T10:01', registrationEnd: '2026-09-11T10:00' }), 'upcoming');
  assert.equal(c.stateLabel({ ...event, registrationEnd: '2026-09-10T09:59' }), '報名已截止');
  assert.equal(c.stateOf({ ...event, registrationEnd: 'bad date' }), 'closed');
  assert.equal(c.stateOf({ status: '報名中', isFull: true }), 'full');
  for (const status of ['草稿', '已截止', '已結束', '已取消', 'unknown']) assert.equal(c.stateOf({ status }), 'closed');
});

test('every rendered event card has one class attribute and supports the keyboard selector', () => {
  const { context: c, element } = pageContext('assets/eventopenlist.js');
  c.renderFeed(Array.from({ length: 6 }, (_, i) => ({ eventId: 'e' + i, eventName: '活動', status: '報名中' })));
  const cards = element('feed').innerHTML.match(/<article\b[^>]*>/g);
  assert.equal(cards.length, 6);
  for (const card of cards) {
    assert.equal((card.match(/\bclass=/g) || []).length, 1);
    assert.match(card, /class="clickable(?: [^"]*)?"/);
  }
});

test('HTTP and application failures are distinct from an empty successful response', async () => {
  for (const [response, expected] of [
    [{ ok: false, json: async () => ({ success: false }) }, '載入失敗'],
    [{ ok: true, json: async () => ({ success: false }) }, '載入失敗'],
    [{ ok: true, json: async () => ({ success: true, events: null }) }, '載入失敗'],
    [{ ok: true, json: async () => ({ success: true, events: [] }) }, '目前沒有公開的活動'],
  ]) {
    const { context: c, element } = pageContext('assets/eventopenlist.js', response);
    c.load();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(element('feed').innerHTML.includes(expected));
  }
});

test('store keyboard handler preserves child controls but activates the card', () => {
  const { context: c, handlers } = pageContext('assets/storefront-map.js');
  let opened = 0, prevented = 0;
  c.openStore = () => opened++;
  const card = { dataset: { id: 'test' } };
  for (const key of ['Enter', ' ']) {
    handlers.keydown({ key, target: { closest: () => card }, preventDefault: () => prevented++ });
  }
  assert.equal(opened, 0);
  assert.equal(prevented, 0);
  handlers.keydown({ key: 'Enter', target: { closest: selector => selector === '.shop[data-id]' ? card : null }, preventDefault: () => prevented++ });
  assert.equal(opened, 1);
  assert.equal(prevented, 1);
});
