// ============================================================
// NeighborhoodSystem 美食地圖系統設定
// 複製給新客戶時只需修改這個檔案
// 注意：此 repo 雖已設為 Private，但前端檔案仍會公開部署到 Cloudflare Pages
// ============================================================

const CONFIG = {
  // 里別資訊
  VILLAGE_NAME: '舊社里',
  SYSTEM_NAME: '里民小幫手',

  // Google Apps Script（統一 API 端點，所有資料讀寫都經過此處驗證）
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbzzp0iFCBkJmlxHuR2j8Ae8xpVPc9gzmvbqBBGNUt0Whm9QpJIrUC0dIs7ZnUjacuuS/exec',

  // Cloudflare Worker 商店 API
  STORE_API_URL: 'https://gsnbhs-stores-api.ulch0709.workers.dev',

  // Cloudflare Pages 基底網址
  BASE_URL: 'https://gsnbhs.pages.dev',

  // Google OAuth Client ID（用於管理員 Google 登入）
  // 注意：填入與 HPNBHS 相同的 Client ID 或另建新的
  GOOGLE_CLIENT_ID: '998009736888-v0hng93jchshicessbc6pjf4e6eiolju.apps.googleusercontent.com',
};
