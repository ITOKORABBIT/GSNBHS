// ============================================================
// NeighborhoodSystem 美食地圖系統設定
// 複製給新客戶時只需修改這個檔案
// 注意：此 repo 雖已設為 Private，但前端檔案仍會公開部署到 Cloudflare Pages
// ============================================================

const CONFIG = {
  // 里別資訊
  VILLAGE_NAME: '舊社里',
  SYSTEM_NAME: '里民小幫手',

  // Make Webhook URL 已改由 Apps Script 後端的 Script Properties 管理
  STORE_WEBHOOK_URL: '',

  // Google Apps Script（照片上傳，公開，無需登入）
  UPLOAD_URL: '',

  // Google Apps Script（統一 API 端點，所有資料讀寫都經過此處驗證）
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbz-tyVnT1v5h3TeMzmaAoSPa7GtBO_jay1PrkmRL-LL0N3bTeOojg4EMep9hnDG0DVO/exec',

  // Cloudflare Worker 商店 API
  STORE_API_URL: 'https://gsnbhs-stores-api.ulch0709.workers.dev',

  // Cloudflare Pages 基底網址
  BASE_URL: 'https://gsnbhs.pages.dev',

  // Google OAuth Client ID（用於管理員 Google 登入）
  // 注意：填入與 HPNBHS 相同的 Client ID 或另建新的
  GOOGLE_CLIENT_ID: '998009736888-v0hng93jchshicessbc6pjf4e6eiolju.apps.googleusercontent.com',

  // 公開前端不保存後端 API Key；上傳由 Apps Script 做來源網域與流量限制
  API_KEY: '',
};
