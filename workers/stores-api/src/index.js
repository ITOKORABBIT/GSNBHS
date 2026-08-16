import {
  claimPublicDedupe,
  enforcePublicRateLimit,
  httpError as publicHttpError,
  validatePublicFormEnvelope,
} from "./public-guard.js";

const STORE_ACTIONS = new Set([
  "health",
  "login",
  "getPublicStores",
  "getPublicStore",
  "getPublicStoreTags",
  "getPublicStoreTaxonomy",
  "getViewStats",
  "recordCardView",
  "bulkAddCardViews",
  "resetViewStats",
  "getStores",
  "getStore",
  "getStoreTaxonomy",
  "submitStore",
  "updateStore",
  "updateStoreTaxonomy",
  "reorderStores",
  "deleteStore",
  "importStores",
  "uploadStorePhoto",
  "uploadAdminPhoto",
]);

export const DEFAULT_STORE_CATEGORIES = [
  "美食地圖",
  "飲料冰品",
  "健康醫療",
  "生活便利",
  "住宅相關",
  "寵物專區",
  "其他",
];
export const BRAND_TAG_COLORS = ["gold", "mint", "blue", "rose", "violet", "stone"];

let driveTokenCache = null;
let driveTokenExpiry = 0;
const sessionCache = new Map();
const SESSION_CACHE_TTL = 5 * 60 * 1000;

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return corsResponse(env, null, 204);
    if (request.method !== "POST") {
      return corsJson(env, { success: false, error: "POST only" }, 405);
    }

    let data;
    try {
      const text = await request.text();
      data = JSON.parse(text || "{}");
    } catch {
      return corsJson(env, { success: false, error: "Invalid JSON" }, 400);
    }

    const action = String(data.action || "");
    if (!STORE_ACTIONS.has(action)) {
      return corsJson(env, { success: false, error: "Unsupported action" }, 400);
    }

    try {
      switch (action) {
        case "health":
          return corsJson(env, { success: true, service: "stores-api" });
        case "login":
          return corsJson(env, await loginAdmin(env, data));
        case "getPublicStores":
          return corsJson(env, await getPublicStores(env));
        case "getPublicStore":
          return corsJson(env, await getPublicStore(env, data));
        case "getPublicStoreTags":
          return corsJson(env, await getPublicStoreTags(env));
        case "getPublicStoreTaxonomy":
          return corsJson(env, await getPublicStoreTaxonomy(env));
        case "getStores":
          await requireAdmin(request, env, data);
          return corsJson(env, await getStores(env));
        case "getStore":
          await requireAdmin(request, env, data);
          return corsJson(env, await getStore(env, data));
        case "getStoreTaxonomy":
          await requireAdmin(request, env, data);
          return corsJson(env, await getStoreTaxonomy(env));
        case "submitStore":
          return corsJson(env, await submitStore(env, data, request), 201);
        case "updateStore":
          await requireAdmin(request, env, data);
          return corsJson(env, await updateStore(env, data));
        case "updateStoreTaxonomy":
          await requireAdmin(request, env, data);
          return corsJson(env, await updateStoreTaxonomy(env, data));
        case "reorderStores":
          await requireAdmin(request, env, data);
          return corsJson(env, await reorderStores(env, data));
        case "deleteStore":
          await requireAdmin(request, env, data);
          return corsJson(env, await deleteStore(env, data));
        case "getViewStats":
          return corsJson(env, await getViewStats(env));
        case "recordCardView":
          return corsJson(env, await recordCardView(env, data));
        case "bulkAddCardViews":
          await requireAdmin(request, env, data);
          return corsJson(env, await bulkAddCardViews(env, data));
        case "resetViewStats":
          await requireAdmin(request, env, data);
          return corsJson(env, await resetViewStats(env, data));
        case "importStores":
          await requireImporter(env, data);
          return corsJson(env, await importStores(env, data));
        case "uploadStorePhoto":
          return corsJson(env, await uploadPublicStorePhoto(env, data, request));
        case "uploadAdminPhoto":
          await requireAdmin(request, env, data);
          return corsJson(env, await uploadStorePhoto(env, data));
        default:
          return corsJson(env, { success: false, error: "Unsupported action" }, 400);
      }
    } catch (error) {
      const status = Number(error.status || 500);
      console.error(JSON.stringify({ action, status, error: error.message }));
      return corsJson(env, { success: false, error: status < 500 ? error.message : "伺服器錯誤", code: status }, status);
    }
  },
};

async function getPublicStores(env) {
  const rows = await env.DB.prepare(
    `SELECT public_payload_json
       FROM stores
      WHERE status = '已公開'
      ORDER BY
        CASE pub_cate
          WHEN '美食地圖' THEN 1
          WHEN '飲料冰品' THEN 2
          WHEN '健康醫療' THEN 3
          WHEN '生活便利' THEN 4
          WHEN '住宅相關' THEN 5
          WHEN '寵物專區' THEN 6
          ELSE 7
        END,
        CASE WHEN sort_order > 0 THEN 1 ELSE 0 END,
        CASE WHEN sort_order > 0 THEN sort_order ELSE 0 END ASC,
        store_id DESC`,
  ).all();
  return {
    success: true,
    stores: rows.results.map((row) => parseJson(row.public_payload_json)),
  };
}

async function getPublicStore(env, data) {
  const storeId = requireStoreId(data);
  const row = await env.DB.prepare(
    "SELECT public_payload_json FROM stores WHERE store_id = ? AND status = '已公開'",
  )
    .bind(storeId)
    .first();
  if (!row) return { success: false, error: "找不到商店" };
  return { success: true, storeData: parseJson(row.public_payload_json) };
}

async function getPublicStoreTags(env) {
  const taxonomy = await getEffectiveStoreTaxonomy(env);
  return {
    success: true,
    tags: taxonomy.brandTags,
  };
}

async function getPublicStoreTaxonomy(env) {
  return { success: true, taxonomy: await getEffectiveStoreTaxonomy(env) };
}

async function getStores(env) {
  const rows = await env.DB.prepare(
    `SELECT payload_json FROM stores
      ORDER BY updated_at DESC, store_id DESC`,
  ).all();
  return {
    success: true,
    stores: rows.results.map((row) => parseJson(row.payload_json)),
  };
}

async function getStore(env, data) {
  const storeId = requireStoreId(data);
  const row = await env.DB.prepare(
    "SELECT payload_json FROM stores WHERE store_id = ?",
  )
    .bind(storeId)
    .first();
  if (!row) return { success: false, error: "找不到商店: " + storeId };
  return { success: true, storeData: parseJson(row.payload_json) };
}

async function getStoreTaxonomy(env) {
  const managed = await loadManagedStoreTaxonomy(env);
  return {
    success: true,
    taxonomy: managed,
    effectiveTaxonomy: await getEffectiveStoreTaxonomy(env, managed),
  };
}

async function updateStoreTaxonomy(env, data) {
  const taxonomy = normalizeStoreTaxonomy(data.taxonomy || data);
  const renames = normalizeBrandTagRenames(data.brandTagRenames);
  if (renames.length) await rewriteStoreBrandTags(env, renames);
  await env.DB.prepare(
    `INSERT INTO store_settings(setting_key, value_json, updated_at)
     VALUES('taxonomy', ?, ?)
     ON CONFLICT(setting_key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = excluded.updated_at`,
  ).bind(JSON.stringify(taxonomy), taipeiNowText()).run();
  return {
    success: true,
    taxonomy,
    effectiveTaxonomy: await getEffectiveStoreTaxonomy(env, taxonomy),
  };
}

async function submitStore(env, data, request) {
  const envelopeError = validatePublicFormEnvelope(data);
  if (envelopeError) throw publicHttpError(400, "表單已失效，請重新整理後再試");
  await enforcePublicRateLimit(env, request, "store-submit", 5, 60 * 60);

  const name = text(data.name).slice(0, 50);
  const phone = text(data.phone).slice(0, 30);
  const storeName = text(data.title).slice(0, 100);
  const normalizedPhone = phone.replace(/[^\d]/g, "");
  if (!name) throw httpError(400, "請輸入申請人姓名");
  if (normalizedPhone.length < 8) throw httpError(400, "請輸入正確的申請人聯絡電話");
  if (!storeName) throw httpError(400, "請輸入店家名稱");
  const claimed = await claimPublicDedupe(env, "store", [normalizedPhone, storeName], 10 * 60);
  if (!claimed) throw httpError(429, "這份申請剛剛已送出，請勿重複送出");

  const now = taipeiNowText();
  const storeId = await nextStoreId(env);
  const store = {
    storeId,
    applyTime: now,
    status: "申請審核中",
    category: normalizeStoreCategory(data.cate),
    name,
    phone,
    lineId: text(data.lineId),
    lineDisplayName: text(data.lineDisplayName),
    storeName,
    storePhone: text(data.storephone),
    storeNum: text(data.taxid),
    desc: text(data.desc),
    offer: text(data.offer),
    hours: text(data.opentime),
    addr: text(data.addr),
    mapUrl: text(data.map),
    note: "",
    lastUpdate: now,
    reviewer: "",
    pubName: "",
    pubCate: "",
    pubPhone: "",
    pubAddr: "",
    pubMapUrl: "",
    pubDesc: "",
    pubOffer: "",
    pubHours: "",
    pubStoreNum: "",
    planType: ["免費", "精選", "優選"].includes(text(data.planType))
      ? text(data.planType)
      : "免費",
    pinOrder: 0,
    sortOrder: 0,
    brandTags: normalizeBrandTags(data.brandTags || data.brandTag),
    brandTag: "",
    brandUrl: normalizePublicUrl(data.brandUrl),
  };
  for (let i = 1; i <= 10; i++) store["photo" + i] = normalizePublicUrl(data["photo" + i]);
  store.brandTag = store.brandTags[0] || "";
  await upsertStore(env, store);
  return { success: true, storeId };
}

async function updateStore(env, data) {
  const storeId = requireStoreId(data);
  const row = await env.DB.prepare("SELECT payload_json FROM stores WHERE store_id = ?")
    .bind(storeId)
    .first();
  if (!row) return { success: false, error: "找不到商店: " + storeId };

  const store = parseJson(row.payload_json);
  const directFields = [
    "status",
    "note",
    "reviewer",
    "pubName",
    "pubCate",
    "pubPhone",
    "pubAddr",
    "pubMapUrl",
    "pubDesc",
    "pubOffer",
    "pubHours",
    "pubStoreNum",
    "planType",
    "pinOrder",
    "sortOrder",
    "brandTag",
    "brandTags",
    "brandUrl",
  ];
  for (const field of directFields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) store[field] = data[field];
  }
  store.brandTags = normalizeBrandTags(store.brandTags || store.brandTag);
  store.brandTag = store.brandTags[0] || "";
  for (let i = 1; i <= 10; i++) {
    const key = "photo" + i;
    if (Object.prototype.hasOwnProperty.call(data, key)) store[key] = text(data[key]);
  }
  store.pubCate = normalizeStoreCategory(store.pubCate);
  store.brandUrl = normalizePublicUrl(store.brandUrl);
  store.pinOrder = Number(store.pinOrder || 0);
  store.sortOrder = Number(store.sortOrder || 0);
  store.lastUpdate = taipeiNowText();

  await upsertStore(env, store);
  return { success: true };
}

async function reorderStores(env, data) {
  const orders = Array.isArray(data.orders) ? data.orders : [];
  const statements = [];
  for (const item of orders) {
    const storeId = text(item.storeId);
    if (!storeId) continue;
    const row = await env.DB.prepare("SELECT payload_json FROM stores WHERE store_id = ?")
      .bind(storeId)
      .first();
    if (!row) continue;
    const store = parseJson(row.payload_json);
    store.sortOrder = Number(item.sortOrder || 0);
    statements.push(upsertStoreStatement(env, store));
  }
  if (statements.length) await env.DB.batch(statements);
  return { success: true };
}

async function deleteStore(env, data) {
  const storeId = requireStoreId(data);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM stores WHERE store_id = ?").bind(storeId),
    env.DB.prepare("DELETE FROM store_views WHERE store_id = ?").bind(storeId),
  ]);
  return { success: true };
}

async function importStores(env, data) {
  const stores = Array.isArray(data.stores) ? data.stores : [];
  const statements = stores
    .filter((store) => store && store.storeId)
    .map((store) => upsertStoreStatement(env, normalizeImportedStore(store)));
  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
  }
  return { success: true, imported: statements.length };
}

async function upsertStore(env, store) {
  await upsertStoreStatement(env, normalizeImportedStore(store)).run();
}

function upsertStoreStatement(env, store) {
  const publicStore = toPublicStore(store);
  return env.DB.prepare(
    `INSERT INTO stores (
      store_id, status, category, store_name, pub_name, pub_cate, plan_type,
      pin_order, sort_order, brand_tag, updated_at, payload_json, public_payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(store_id) DO UPDATE SET
      status = excluded.status,
      category = excluded.category,
      store_name = excluded.store_name,
      pub_name = excluded.pub_name,
      pub_cate = excluded.pub_cate,
      plan_type = excluded.plan_type,
      pin_order = excluded.pin_order,
      sort_order = excluded.sort_order,
      brand_tag = excluded.brand_tag,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json,
      public_payload_json = excluded.public_payload_json`,
  ).bind(
    store.storeId,
    text(store.status),
    normalizeStoreCategory(store.category),
    text(store.storeName),
    text(store.pubName),
    normalizeStoreCategory(store.pubCate),
    text(store.planType || "免費"),
    Number(store.pinOrder || 0),
    Number(store.sortOrder || 0),
    text(store.brandTag),
    text(store.lastUpdate || store.updatedAt || ""),
    JSON.stringify(store),
    JSON.stringify(publicStore),
  );
}

function normalizeImportedStore(store) {
  const copy = { ...store };
  copy.storeId = text(copy.storeId);
  copy.status = text(copy.status) || "申請審核中";
  copy.category = normalizeStoreCategory(copy.category);
  copy.storeName = text(copy.storeName);
  copy.pubName = text(copy.pubName);
  copy.pubCate = normalizeStoreCategory(copy.pubCate);
  copy.planType = text(copy.planType || "免費");
  copy.pinOrder = Number(copy.pinOrder || 0);
  copy.sortOrder = Number(copy.sortOrder || 0);
  copy.brandTags = brandTagsForStore(copy);
  copy.brandTag = copy.brandTags[0] || "";
  copy.brandUrl = normalizePublicUrl(copy.brandUrl);
  for (let i = 1; i <= 10; i++) copy["photo" + i] = text(copy["photo" + i]);
  // When importing from the public API (pub* fields present, private fields empty),
  // back-fill private fields so the admin view shows useful data.
  if (!copy.storeName) copy.storeName = copy.pubName;
  if (!copy.category)  copy.category  = copy.pubCate;
  if (!copy.storePhone) copy.storePhone = text(copy.pubPhone);
  if (!copy.addr)       copy.addr       = text(copy.pubAddr);
  if (!copy.mapUrl)     copy.mapUrl     = text(copy.pubMapUrl);
  if (!copy.desc)       copy.desc       = text(copy.pubDesc);
  if (!copy.offer)      copy.offer      = text(copy.pubOffer);
  if (!copy.hours)      copy.hours      = text(copy.pubHours);
  if (!copy.storeNum)   copy.storeNum   = text(copy.pubStoreNum);
  return copy;
}

function toPublicStore(store) {
  const publicStore = {
    storeId: text(store.storeId),
    pubName: text(store.pubName || store.storeName),
    pubCate: normalizeStoreCategory(store.pubCate || store.category),
    pubPhone: text(store.pubPhone || store.storePhone),
    pubAddr: text(store.pubAddr || store.addr),
    pubMapUrl: text(store.pubMapUrl || store.mapUrl),
    pubDesc: text(store.pubDesc || store.desc),
    pubOffer: text(store.pubOffer || store.offer),
    pubHours: text(store.pubHours || store.hours),
    pubStoreNum: text(store.pubStoreNum || store.storeNum),
    planType: text(store.planType || "免費"),
    pinOrder: Number(store.pinOrder || 0),
    sortOrder: Number(store.sortOrder || 0),
    brandTags: brandTagsForStore(store),
    brandTag: brandTagsForStore(store)[0] || "",
    brandUrl: normalizePublicUrl(store.brandUrl),
  };
  for (let i = 1; i <= 10; i++) publicStore["photo" + i] = text(store["photo" + i]);
  return publicStore;
}

export function normalizeBrandTags(value) {
  const input = Array.isArray(value) ? value : [value];
  const tags = [];
  for (const item of input) {
    const tag = text(item).trim();
    if (!tag || tag.length > 6 || /^\d+$/.test(tag) || tags.includes(tag)) continue;
    tags.push(tag);
    if (tags.length === 3) break;
  }
  return tags;
}

export function brandTagsForStore(store) {
  if (!store) return [];
  return normalizeBrandTags(
    Array.isArray(store.brandTags) && store.brandTags.length
      ? store.brandTags
      : store.brandTag,
  );
}

export function collectPublishedBrandTags(stores) {
  const tags = [];
  for (const store of Array.isArray(stores) ? stores : []) {
    if (text(store.status) !== "已公開") continue;
    for (const tag of brandTagsForStore(store)) {
      if (!tags.includes(tag)) tags.push(tag);
    }
  }
  return tags.sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

export function normalizeStoreTaxonomy(input) {
  const source = input && typeof input === "object" ? input : {};
  const categories = normalizeTaxonomyValues(source.categories, {
    fallback: DEFAULT_STORE_CATEGORIES,
    maxLength: 18,
  });
  const brandTagDefs = normalizeBrandTagDefinitions(
    Array.isArray(source.brandTagDefs) ? source.brandTagDefs : source.brandTags,
  );
  return {
    categories,
    brandTags: brandTagDefs.map((item) => item.name),
    brandTagDefs,
  };
}

export function effectiveStoreTaxonomy(input, stores) {
  const taxonomy = normalizeStoreTaxonomy(input);
  const brandTags = mergeTaxonomyValues(
    taxonomy.brandTags,
    collectPublishedBrandTags(stores),
    "zh-Hant",
  );
  return {
    categories: taxonomy.categories,
    brandTags,
    brandTagDefs: brandTags.map((name) => (
      taxonomy.brandTagDefs.find((item) => item.name === name) || { name, color: "gold" }
    )),
  };
}

function normalizeTaxonomyValues(values, { fallback, maxLength }) {
  const normalized = [];
  for (const item of Array.isArray(values) ? values : []) {
    const value = text(item).trim();
    if (!value || value.length > maxLength || normalized.includes(value)) continue;
    normalized.push(value);
  }
  return normalized.length ? normalized : fallback.slice();
}

function mergeTaxonomyValues(left, right, locale) {
  const values = [];
  for (const item of [...left, ...right]) {
    if (!values.includes(item)) values.push(item);
  }
  return values.sort((a, b) => a.localeCompare(b, locale));
}

export function normalizeBrandTagDefinitions(values) {
  const defs = [];
  for (const item of Array.isArray(values) ? values : []) {
    const name = text(item && typeof item === "object" ? item.name : item).trim();
    if (!name || name.length > 6 || /^\d+$/.test(name) || defs.some((def) => def.name === name)) continue;
    const color = text(item && typeof item === "object" ? item.color : "");
    defs.push({ name, color: BRAND_TAG_COLORS.includes(color) ? color : "gold" });
  }
  return defs;
}

export function applyBrandTagRenames(store, renames) {
  const next = { ...(store || {}) };
  const renameMap = new Map(normalizeBrandTagRenames(renames).map((item) => [item.from, item.to]));
  next.brandTags = brandTagsForStore(next).map((tag) => renameMap.get(tag) || tag);
  next.brandTags = normalizeBrandTags(next.brandTags);
  next.brandTag = next.brandTags[0] || "";
  return next;
}

function normalizeBrandTagRenames(value) {
  return (Array.isArray(value) ? value : []).map((item) => ({
    from: text(item && item.from).trim(),
    to: text(item && item.to).trim(),
  })).filter((item) =>
    item.from && item.to && item.from !== item.to && normalizeBrandTags(item.to).length === 1
  );
}

async function rewriteStoreBrandTags(env, renames) {
  const rows = await env.DB.prepare("SELECT payload_json FROM stores").all();
  const statements = [];
  for (const row of rows.results) {
    const current = parseJson(row.payload_json);
    const next = applyBrandTagRenames(current, renames);
    if (JSON.stringify(brandTagsForStore(current)) === JSON.stringify(next.brandTags)) continue;
    next.lastUpdate = taipeiNowText();
    statements.push(upsertStoreStatement(env, normalizeImportedStore(next)));
  }
  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
  }
}

async function loadManagedStoreTaxonomy(env) {
  const row = await env.DB.prepare(
    "SELECT value_json FROM store_settings WHERE setting_key = 'taxonomy'",
  ).first();
  return normalizeStoreTaxonomy(row ? parseJson(row.value_json) : {});
}

async function getEffectiveStoreTaxonomy(env, managed) {
  const rows = await env.DB.prepare(
    "SELECT status, payload_json FROM stores WHERE status = '已公開'",
  ).all();
  const stores = rows.results.map((row) => ({
    status: row.status,
    ...parseJson(row.payload_json),
  }));
  return effectiveStoreTaxonomy(managed || await loadManagedStoreTaxonomy(env), stores);
}

async function getViewStats(env) {
  const rows = await env.DB.prepare(
    `SELECT store_id, view_count FROM store_views`,
  ).all();
  const cardCounts = {};
  let pageCount = 0;
  for (const r of rows.results) {
    cardCounts[r.store_id] = r.view_count;
    pageCount += r.view_count;
  }
  return { success: true, pageCount, cardCounts };
}

async function recordCardView(env, data) {
  const storeId = text(data.itemId);
  if (!storeId) return { success: false, error: "Missing itemId" };
  await env.DB.prepare(
    `INSERT INTO store_views(store_id, view_count) VALUES(?, 1)
     ON CONFLICT(store_id) DO UPDATE SET view_count = view_count + 1`,
  ).bind(storeId).run();
  return { success: true };
}

async function bulkAddCardViews(env, data) {
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) return { success: false, error: "Missing items" };
  const statements = [];
  for (const item of items) {
    const storeId = text(item.itemId);
    const count = Math.max(0, Math.floor(Number(item.count || 0)));
    if (!storeId || count <= 0) continue;
    statements.push(
      env.DB.prepare(
        `INSERT INTO store_views(store_id, view_count) VALUES(?, ?)
         ON CONFLICT(store_id) DO UPDATE SET view_count = view_count + ?`,
      ).bind(storeId, count, count),
    );
  }
  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
  }
  return { success: true, updated: statements.length };
}

async function resetViewStats(env, data) {
  const cards = Array.isArray(data.cards) ? data.cards : [];
  const statements = cards.map((card) => {
    const storeId = text(card.itemId);
    if (!storeId) throw httpError(400, "Missing itemId");
    const count = Math.max(0, Math.floor(Number(card.count || 0)));
    return env.DB.prepare(
      `INSERT INTO store_views(store_id, view_count) VALUES(?, ?)
       ON CONFLICT(store_id) DO UPDATE SET view_count = excluded.view_count`,
    ).bind(storeId, count);
  });
  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
  }
  return { success: true, updated: statements.length };
}

async function nextStoreId(env) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const yy = parts.find((p) => p.type === "year").value;
  const mm = parts.find((p) => p.type === "month").value;
  const dd = parts.find((p) => p.type === "day").value;
  const datePart = yy + mm + dd;
  const monthPart = yy + mm;
  const row = await env.DB.prepare(
    `INSERT INTO public_sequences(scope, value)
     VALUES (?, COALESCE((
       SELECT MAX(CAST(substr(store_id, -3) AS INTEGER))
         FROM stores
        WHERE store_id LIKE ?
     ), 0) + 1)
     ON CONFLICT(scope) DO UPDATE SET value = public_sequences.value + 1
     RETURNING value`,
  ).bind("store:" + monthPart, "STOR" + monthPart + "%").first();
  return "STOR" + datePart + String(Number(row.value)).padStart(3, "0");
}

async function loginAdmin(env, data) {
  const idToken = text(data.id_token);
  if (!idToken) throw httpError(401, "未授權的帳號");
  if (!env.GAS_SCRIPT_URL) throw httpError(503, "登入服務未設定");

  const response = await fetch(env.GAS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "login", id_token: idToken }),
  });
  const json = await response.json();
  if (!json.success || !json.sessionToken) throw httpError(401, "未授權的帳號");
  return {
    success: true,
    sessionToken: text(json.sessionToken),
    email: text(json.email),
    name: text(json.name),
    role: text(json.role) || "管理員",
  };
}

async function requireAdmin(request, env, data) {
  if (!env.GAS_SCRIPT_URL) throw httpError(401, "Unauthorized");
  const token = text(data.sessionToken);
  if (!token) throw httpError(401, "Unauthorized");

  const cached = sessionCache.get(token);
  if (cached && Date.now() < cached.expiresAt) return;

  const res = await fetch(env.GAS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "refreshSession", sessionToken: token }),
  });
  const json = await res.json();
  if (!json.success) throw httpError(401, "Unauthorized");

  sessionCache.set(token, { expiresAt: Date.now() + SESSION_CACHE_TTL });
  if (sessionCache.size > 50) {
    const now = Date.now();
    for (const [key, value] of sessionCache) {
      if (now >= value.expiresAt) sessionCache.delete(key);
    }
  }
}

async function requireImporter(env, data) {
  if (env.IMPORT_TOKEN && text(data.importToken) === env.IMPORT_TOKEN) return;
  throw httpError(401, "Unauthorized");
}

function corsJson(env, body, status = 200) {
  return corsResponse(env, JSON.stringify(body), status, {
    "content-type": "application/json;charset=utf-8",
  });
}

function corsResponse(env, body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "access-control-allow-origin": env.ALLOWED_ORIGIN || "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
      ...headers,
    },
  });
}

function normalizeStoreCategory(value) {
  return text(value);
}

function normalizePublicUrl(value) {
  const url = text(value);
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : "";
}

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function parseJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function taipeiNowText() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function requireStoreId(data) {
  const storeId = text(data.storeId);
  if (!storeId) throw httpError(400, "Missing storeId");
  return storeId;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// ─── Google Drive upload helpers ──────────────────────────────────────────────

async function getGoogleAccessToken(env) {
  if (driveTokenCache && Date.now() < driveTokenExpiry) return driveTokenCache;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }).toString(),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error("無法取得 Drive access token");
  driveTokenCache = json.access_token;
  driveTokenExpiry = Date.now() + (json.expires_in - 60) * 1000;
  return driveTokenCache;
}

async function uploadToDrive(env, b64, mimeType, fileName) {
  const accessToken = await getGoogleAccessToken(env);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const boundary = `----Boundary${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({ name: fileName, parents: [env.GOOGLE_DRIVE_FOLDER_ID] });
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  const uploadRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  const file = await uploadRes.json();
  if (!file.id) throw new Error("Drive 上傳失敗: " + JSON.stringify(file));
  await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  return `https://lh3.googleusercontent.com/d/${file.id}`;
}

async function uploadStorePhoto(env, data) {
  let b64 = text(data.imageBase64 || data.base64);
  if (!b64) return { success: false, error: "Missing imageBase64" };
  const comma = b64.indexOf(",");
  if (comma !== -1) b64 = b64.slice(comma + 1);
  if (b64.length * 0.75 > 2 * 1024 * 1024) return { success: false, error: "圖片過大，請壓縮至 2MB 以下" };
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_DRIVE_FOLDER_ID) return { success: false, error: "Drive 未設定" };
  const mimeType = text(data.mimeType).toLowerCase() || "image/jpeg";
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    throw httpError(400, "僅支援 JPEG、PNG 或 WebP 圖片");
  }
  if (!matchesImageSignature(b64, mimeType)) throw httpError(400, "圖片格式不正確");
  const ext = mimeType.split("/")[1] || "jpg";
  const url = await uploadToDrive(env, b64, mimeType, `store_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`);
  return { success: true, url };
}

async function uploadPublicStorePhoto(env, data, request) {
  const envelopeError = validatePublicFormEnvelope(data);
  if (envelopeError) throw publicHttpError(400, "表單已失效，請重新整理後再試");
  await enforcePublicRateLimit(env, request, "store-upload", 20, 60 * 60);
  return uploadStorePhoto(env, data);
}

function matchesImageSignature(base64, mimeType) {
  try {
    const bytes = Uint8Array.from(atob(base64.slice(0, 32)), (char) => char.charCodeAt(0));
    if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (mimeType === "image/png") return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  } catch {
    return false;
  }
}
