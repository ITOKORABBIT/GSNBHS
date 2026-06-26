const CONFIG = {
  VILLAGE_NAME: '舊社里',
  SYSTEM_NAME: '里民小幫手',

  // Public pages should not ship writable webhook secrets.
  REPORT_WEBHOOK_URL: '',
  REPLY_WEBHOOK_URL: '',
  STORE_WEBHOOK_URL: '',

  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxIRdGFYKIz0NWpG1PC1OnB53vRz4yREH9eNvE_c7TXuFEiAfL2fCgt984T4IX9KqELCA/exec',
  EVENT_API_URL:    'https://gsnbhs-events-api.ulch0709.workers.dev',
  CASE_API_URL:     'https://gsnbhs-cases-api.ulch0709.workers.dev',
  STORE_API_URL:    'https://gsnbhs-stores-api.ulch0709.workers.dev',
  BULLETIN_API_URL: 'https://gsnbhs-bulletins-api.ulch0709.workers.dev',
  BASE_URL: 'https://gsnbhs.pages.dev',
  GOOGLE_CLIENT_ID: '998009736888-v0hng93jchshicessbc6pjf4e6eiolju.apps.googleusercontent.com',
  LINE_BOT_ID: '@649jhuge',

  // Deprecated on the resident-side public app. Kept only for backward compatibility.
  API_KEY: ''
};
