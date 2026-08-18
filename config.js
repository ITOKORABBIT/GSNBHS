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
  LINE_BOT_ID: '@900rucza',

  // 案件通報表單的 LIFF ID（LINE Developers → 與 @900rucza 同一個 Provider 底下的
  // LINE Login 頻道 → LIFF）。留空時通報表單照常運作，只是不會記錄通報人的 LINE 名稱。
  LIFF_ID_REPORT: '',
};
