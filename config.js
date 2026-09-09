const CONFIG = {
  VILLAGE_NAME: '舊社里',
  SYSTEM_NAME: '里民小幫手',

  // Public pages should not ship writable webhook secrets.
  REPLY_WEBHOOK_URL: '',

  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbzzp0iFCBkJmlxHuR2j8Ae8xpVPc9gzmvbqBBGNUt0Whm9QpJIrUC0dIs7ZnUjacuuS/exec',
  EVENT_API_URL:    'https://gsnbhs-events-api.ulch0709.workers.dev',
  CASE_API_URL:     'https://gsnbhs-cases-api.ulch0709.workers.dev',
  STORE_API_URL:    'https://gsnbhs-stores-api.ulch0709.workers.dev',
  BULLETIN_API_URL: 'https://gsnbhs-bulletins-api.ulch0709.workers.dev',
  BASE_URL: 'https://gsnbhs.pages.dev',
  GOOGLE_CLIENT_ID: '998009736888-v0hng93jchshicessbc6pjf4e6eiolju.apps.googleusercontent.com',
  // 本里的商家分類（各里不同）。正式清單以本里 stores-api 的 taxonomy 為準，
  // 這份是頁面載入、API 還沒回來前先顯示的預設值。
  STORE_CATEGORIES: ['美食地圖', '飲料冰品', '健康醫療', '生活便利', '學術教育', '運動休閒', '其他各行各業'],
  LINE_BOT_ID: '@900rucza',
};
