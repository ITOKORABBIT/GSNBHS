import assert from "node:assert/strict";
import test from "node:test";

import {
  applyBrandTagRenames,
  DEFAULT_STORE_CATEGORIES,
  effectiveStoreTaxonomy,
  normalizeBrandTagDefinitions,
  normalizeStoreTaxonomy,
} from "./index.js";

test("store taxonomy falls back to the current category set", () => {
  assert.deepEqual(normalizeStoreTaxonomy({}).categories, DEFAULT_STORE_CATEGORIES);
});

test("store taxonomy trims and deduplicates managed categories and approved tags", () => {
  assert.deepEqual(
    normalizeStoreTaxonomy({
      categories: [" 家庭好友聚餐 ", "", "生活百貨", "生活百貨"],
      brandTags: [" 寵物友善 ", "寵物友善", "123", "超過六個字標籤", "素食友善"],
    }),
    {
      categories: ["家庭好友聚餐", "生活百貨"],
      brandTags: ["寵物友善", "素食友善"],
      brandTagDefs: [
        { name: "寵物友善", color: "gold" },
        { name: "素食友善", color: "gold" },
      ],
    },
  );
});

test("store taxonomy keeps more than three approved library tags", () => {
  assert.deepEqual(
    normalizeStoreTaxonomy({
      brandTags: ["寵物友善", "夜間營業", "親子餐廳", "素食友善"],
    }).brandTags,
    ["寵物友善", "夜間營業", "親子餐廳", "素食友善"],
  );
});

test("effective store taxonomy merges approved tags with published tags", () => {
  assert.deepEqual(
    effectiveStoreTaxonomy(
      { categories: ["家庭好友聚餐"], brandTags: ["素食友善", "寵物友善"] },
      [
        { status: "已公開", brandTags: ["寵物友善", "夜間營業"] },
        { status: "申請審核中", brandTags: ["尚未核可"] },
      ],
    ),
    {
      categories: ["家庭好友聚餐"],
      brandTags: ["夜間營業", "素食友善", "寵物友善"],
      brandTagDefs: [
        { name: "夜間營業", color: "gold" },
        { name: "素食友善", color: "gold" },
        { name: "寵物友善", color: "gold" },
      ],
    },
  );
});

test("brand tag definitions keep fixed swatch color keys", () => {
  assert.deepEqual(
    normalizeBrandTagDefinitions([
      { name: " 火鍋 ", color: "mint" },
      { name: "火鍋", color: "rose" },
      { name: "早餐", color: "unknown" },
    ]),
    [
      { name: "火鍋", color: "mint" },
      { name: "早餐", color: "gold" },
    ],
  );
});

test("brand tag renames rewrite stores that used the old name", () => {
  assert.deepEqual(
    applyBrandTagRenames(
      { brandTags: ["火鍋", "素食"], brandTag: "火鍋" },
      [{ from: "火鍋", to: "火鍋一條街" }],
    ),
    { brandTags: ["火鍋一條街", "素食"], brandTag: "火鍋一條街" },
  );
});
