var SESSION_KEY = 'hpnbhs_admin';
var SESSION_TTL = 2 * 3600 * 1000;

function esc(s) {
  if (!s && s !== 0) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

var escapeHtml = esc;

function getSession() {
  try {
    var d = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (!d || !d.sessionToken || Date.now() - d.ts > SESSION_TTL) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return d;
  } catch (e) {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function setSession(token, email, name, role, idToken) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    sessionToken: token,
    email: email,
    name: name,
    role: role || '',
    id_token: idToken || '',
    ts: Date.now()
  }));
}

function touchSession() {
  var d = getSession();
  if (!d) return;
  d.ts = Date.now();
  localStorage.setItem(SESSION_KEY, JSON.stringify(d));
}

function fmtDate(value) {
  if (!value) return '';
  var d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16);
  return d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
}

function fmtDateTime(s) {
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      var tw = new Date(d.getTime() + 8 * 60 * 60 * 1000);
      var pad = function(n) { return String(n).padStart(2, '0'); };
      return tw.getUTCFullYear() + '/' + pad(tw.getUTCMonth() + 1) + '/' + pad(tw.getUTCDate()) +
             ' ' + pad(tw.getUTCHours()) + ':' + pad(tw.getUTCMinutes()) + ':' + pad(tw.getUTCSeconds());
    }
  }
  return s;
}

function driveImgUrl(url) {
  if (!url) return url;
  var m = url.match(/[?&]id=([a-zA-Z0-9_\-]+)/);
  if (m && url.indexOf('drive.google.com/uc') !== -1) {
    return 'https://lh3.googleusercontent.com/d/' + m[1];
  }
  return url;
}

function retryLh3Img(img) {
  var retries = parseInt(img.dataset.r || '0');
  if (retries >= 4) return;
  img.dataset.r = String(retries + 1);
  var orig = img.dataset.orig || img.src;
  img.dataset.orig = orig;
  setTimeout(function() { img.src = ''; setTimeout(function() { img.src = orig; }, 50); }, (retries + 1) * 2500);
}
