
var FORM_STARTED_AT = Date.now();

// ── 通報人的 LINE 身分 ──
// 從 LINE 圖文選單點「案件通報」時，機器人會把身分帶在連結上傳進來，
// 讓里長知道是誰通報的；填表者看不到這兩個值。
// 用瀏覽器或書籤直接開這一頁時沒有這些參數，維持空字串，表單照常可以送出。
var LINE_USER_ID = '', LINE_DISPLAY_NAME = '';
(function () {
  try {
    var q = new URLSearchParams(location.search);
    LINE_USER_ID = q.get('lineUserId') || '';
    LINE_DISPLAY_NAME = q.get('displayName') || '';
  } catch (e) {}
})();

var _toastTimer;
function showToast(msg) {
  var el = document.getElementById('toastError');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function() { el.classList.remove('show'); }, 4000);
}

function setSubmitProgress(stepText, percent, noteText) {
  document.getElementById('submitProgressStep').textContent = stepText || '正在處理…';
  document.getElementById('submitProgressFill').style.width = Math.max(0, Math.min(100, percent || 0)) + '%';
  if (noteText) document.getElementById('submitProgressNote').textContent = noteText;
}

function openSubmitProgress(stepText, percent, noteText) {
  setSubmitProgress(stepText, percent, noteText);
  document.body.classList.add('loading-submit');
  document.getElementById('submitProgressOverlay').classList.add('open');
  document.getElementById('submitProgressOverlay').setAttribute('aria-hidden', 'false');
}

function closeSubmitProgress() {
  document.body.classList.remove('loading-submit');
  document.getElementById('submitProgressOverlay').classList.remove('open');
  document.getElementById('submitProgressOverlay').setAttribute('aria-hidden', 'true');
}

function fillCurrentLocation() {
  var btn = document.getElementById('locateBtn');
  var mapEl = document.getElementById('f_map');
  var addrEl = document.getElementById('f_addr');
  if (!navigator.geolocation) {
    showToast('此裝置不支援自動定位，請手動貼上 Google Map 連結。');
    return;
  }

  var originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 定位中';
  }

  navigator.geolocation.getCurrentPosition(function(pos) {
    var lat = Number(pos.coords.latitude).toFixed(6);
    var lng = Number(pos.coords.longitude).toFixed(6);
    var mapsUrl = 'https://maps.google.com/?q=' + lat + ',' + lng;
    if (mapEl) {
      mapEl.value = mapsUrl;
      mapEl.classList.remove('invalid');
    }
    if (addrEl && !addrEl.value.trim()) {
      addrEl.value = '目前定位：' + lat + ',' + lng;
      addrEl.classList.remove('invalid');
      var err = addrEl.parentElement.querySelector('.error-text');
      if (err) err.style.display = 'none';
    }
    showToast('已取得目前定位');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }, function(err) {
    var msg = '定位失敗，請確認已允許位置權限，或手動貼上 Google Map 連結。';
    if (err && err.code === 1) msg = '定位權限未開啟，請允許位置權限後再試。';
    if (err && err.code === 2) msg = '暫時無法取得定位，請移到戶外或訊號較好的地方再試。';
    if (err && err.code === 3) msg = '定位逾時，請再按一次或手動貼上 Google Map 連結。';
    showToast(msg);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }, {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 60000
  });
}

// ── 多選照片 widget ──
var reportPhotos = [];
var reportPhotoIdSeq = 0;
var reportPhotoSortable = null;

function renderReportPhotoGrid() {
  var grid   = document.getElementById('reportPhotoGrid');
  var addBtn = document.getElementById('reportPhotoAddBtn');
  if (!grid) return;

  grid.innerHTML = '';
  reportPhotos.forEach(function(p) {
    var div = document.createElement('div');
    div.className = 'photo-preview-item';
    div.setAttribute('data-sort-id', String(p.id));
    var img = document.createElement('img');
    img.src = p.src;
    img.alt = '照片';
    var rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.className = 'item-remove';
    rmBtn.textContent = '✕';
    rmBtn.setAttribute('data-pid', String(p.id));
    rmBtn.addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
      var pid = parseInt(this.getAttribute('data-pid'));
      syncReportPhotosFromDOM();
      reportPhotos = reportPhotos.filter(function(x) { return x.id !== pid; });
      renderReportPhotoGrid();
    });
    var hint = document.createElement('span');
    hint.className = 'drag-hint';
    hint.textContent = '拖曳排序';
    div.appendChild(img);
    div.appendChild(rmBtn);
    if (reportPhotos.length > 1) div.appendChild(hint);
    grid.appendChild(div);
  });

  if (addBtn) addBtn.classList.toggle('hidden', reportPhotos.length >= 5);

  if (reportPhotoSortable) { reportPhotoSortable.destroy(); reportPhotoSortable = null; }
  if (reportPhotos.length > 1) {
    reportPhotoSortable = new SortableOrder(grid, {
      selector: '.photo-preview-item',
      onReorder: function(ids) {
        var idMap = {};
        reportPhotos.forEach(function(p) { idMap[p.id] = p; });
        reportPhotos = ids.map(function(id) { return idMap[parseInt(id)]; }).filter(Boolean);
      }
    });
  }
}

function syncReportPhotosFromDOM() {
  var grid = document.getElementById('reportPhotoGrid');
  if (!grid) return;
  var items = grid.querySelectorAll('[data-sort-id]');
  var idMap = {};
  reportPhotos.forEach(function(p) { idMap[p.id] = p; });
  var ordered = Array.prototype.map.call(items, function(el) {
    return idMap[parseInt(el.getAttribute('data-sort-id'))];
  }).filter(Boolean);
  if (ordered.length === reportPhotos.length) reportPhotos = ordered;
}

function handleReportPhotoAdd(input) {
  if (!input.files || !input.files.length) return;
  var slots = 5 - reportPhotos.length;
  if (slots <= 0) return;
  var files = Array.prototype.slice.call(input.files, 0, slots);
  var pending = files.length;
  files.forEach(function(file) {
    var id = reportPhotoIdSeq++;
    var reader = new FileReader();
    reader.onload = function(e) {
      reportPhotos.push({ id: id, src: e.target.result, file: file });
      pending--;
      if (pending === 0) renderReportPhotoGrid();
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

// 讀取照片；公開上傳走 Cloudflare Worker，需壓到 2MB 內。
function prepareImageForUpload(file) {
  var LIMIT = 1.75 * 1024 * 1024;
  var MAX_EDGE = 1600;
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) {
      if (file.size <= LIMIT && /^image\/(jpe?g|png|webp)$/i.test(file.type || '')) {
        resolve({ dataUrl: e.target.result, mimeType: file.type || 'image/jpeg' });
        return;
      }
      var img = new Image();
      img.onload = function() {
        var edgeScale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        var sizeScale = Math.min(1, Math.sqrt(LIMIT / Math.max(file.size, 1)));
        var scale = Math.min(edgeScale, sizeScale);
        var w = Math.max(1, Math.floor(img.width * scale));
        var h = Math.max(1, Math.floor(img.height * scale));
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');
        var qualities = [0.82, 0.76, 0.7, 0.64];
        var dataUrl = '';
        for (var round = 0; round < 4; round++) {
          canvas.width = w; canvas.height = h;
          ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          for (var qi = 0; qi < qualities.length; qi++) {
            dataUrl = canvas.toDataURL('image/jpeg', qualities[qi]);
            if (dataUrl.length * 0.75 <= LIMIT) {
              resolve({ dataUrl: dataUrl, mimeType: 'image/jpeg' });
              return;
            }
          }
          w = Math.max(1, Math.floor(w * 0.85));
          h = Math.max(1, Math.floor(h * 0.85));
        }
        resolve({ dataUrl: dataUrl, mimeType: 'image/jpeg' });
      };
      img.onerror = function() { reject(new Error('照片格式無法讀取，請改用 JPG 或 PNG 再試。')); };
      img.src = e.target.result;
    };
    reader.onerror = function() { reject(new Error('照片讀取失敗，請重新選取照片。')); };
    reader.readAsDataURL(file);
  });
}

async function uploadOneReportPhoto(file) {
  try {
    var prepared = await prepareImageForUpload(file);
    var b64 = prepared.dataUrl.indexOf(',') !== -1 ? prepared.dataUrl.split(',')[1] : prepared.dataUrl;
    var res = await fetch(CONFIG.CASE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'uploadPublicPhoto',
        imageBase64: b64,
        mimeType: prepared.mimeType || 'image/jpeg'
      })
    });
    var json;
    try { json = await res.json(); } catch(pe) { throw new Error('照片上傳回應格式錯誤 (HTTP ' + res.status + ')'); }
    if (!res.ok || !json.success || !json.url) throw new Error((json && json.error) || ('照片上傳失敗 (HTTP ' + res.status + ')'));
    return json.url;
  } catch(e) {
    console.warn('[uploadReportPhoto]', e);
    return { error: e.message || '照片上傳失敗' };
  }
}

async function uploadAllReportPhotos(btn) {
  syncReportPhotosFromDOM();
  var urls = [];
  var errors = [];
  var total = reportPhotos.length;
  for (var i = 0; i < total; i++) {
    var stepLabel = '正在上傳照片 ' + (i + 1) + ' / ' + total + '…';
    btn.innerHTML = '<span class="spinner"></span> ' + stepLabel;
    setSubmitProgress(stepLabel, Math.round((i / total) * 75), '大圖需要多幾秒是正常的');
    var uploaded = await uploadOneReportPhoto(reportPhotos[i].file);
    if (uploaded && uploaded.error) {
      urls.push('');
      errors.push(uploaded.error);
    } else {
      urls.push(uploaded || '');
    }
  }
  var failCount = urls.filter(function(u) { return !u; }).length;
  if (failCount > 0 && failCount < total) {
    var ok = window.confirm(
      '有 ' + failCount + ' 張照片未能上傳。\n' +
      (errors[0] ? '原因：' + errors[0] + '\n' : '') +
      '按「確定」繼續送出（不含未上傳的照片），或按「取消」返回重試。'
    );
    if (!ok) throw new Error('user_cancelled');
  } else if (failCount === total && total > 0) {
    throw new Error(errors[0] || '所有照片上傳失敗，請確認網路後再試。');
  }
  while (urls.length < 5) urls.push('');
  return urls;
}

function validateForm() {
  var valid = true;
  var requiredFields = [
    { id: 'f_name', label: '姓名' },
    { id: 'f_phone', label: '電話' },
    { id: 'f_cate', label: '類別' },
    { id: 'f_title', label: '主旨' },
    { id: 'f_desc', label: '描述' },
    { id: 'f_addr', label: '地點' }
  ];

  requiredFields.forEach(function(f) {
    var el = document.getElementById(f.id);
    var err = el.parentElement.querySelector('.error-text');
    if (!el.value.trim()) {
      el.classList.add('invalid');
      if (err) err.style.display = 'block';
      valid = false;
    } else {
      el.classList.remove('invalid');
      if (err) err.style.display = 'none';
    }
  });

  // 電話格式：去掉非數字後至少 8 碼（與 GAS 驗證一致）
  var phoneEl = document.getElementById('f_phone');
  var phoneErr = phoneEl.parentElement.querySelector('.error-text');
  if (phoneEl.value.replace(/[^\d]/g, '').length < 8) {
    phoneEl.classList.add('invalid');
    if (phoneErr) { phoneErr.textContent = '請輸入有效電話號碼'; phoneErr.style.display = 'block'; }
    valid = false;
  }

  return valid;
}

// 清除驗證狀態
document.querySelectorAll('input, textarea, select').forEach(function(el) {
  el.addEventListener('input', function() {
    this.classList.remove('invalid');
    var err = this.parentElement.querySelector('.error-text');
    if (err) err.style.display = 'none';
  });
});

// 送出表單
document.getElementById('reportForm').addEventListener('submit', async function(e) {
  e.preventDefault();

  if (!validateForm()) {
    document.querySelector('.invalid').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  var btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 送出中...';
  openSubmitProgress('正在整理案件資料…', 10, '若有照片，系統會先逐張上傳再送出');

  try {
    // 1. 逐張上傳照片，取回 Drive URL
    var photoUrls = await uploadAllReportPhotos(btn);

    btn.innerHTML = '<span class="spinner"></span> 送出案件中...';
    setSubmitProgress('正在送出案件資料…', 88, '送出完成後會自動進入成功畫面');

    // 2. 組合資料
    var payload = {
      action: 'submitReport',
      formTs: FORM_STARTED_AT,
      website: '',
      name: document.getElementById('f_name').value.trim(),
      phone: document.getElementById('f_phone').value.trim(),
      lineId: document.getElementById('f_line').value.trim(),
      lineUserId: LINE_USER_ID,
      lineDisplayName: LINE_DISPLAY_NAME,
      cate: document.getElementById('f_cate').value,
      title: document.getElementById('f_title').value.trim(),
      desc: document.getElementById('f_desc').value.trim(),
      addr: document.getElementById('f_addr').value.trim(),
      map: document.getElementById('f_map').value.trim(),
      case1999: document.getElementById('f_1999').value.trim(),
      photo1: photoUrls[0], photo2: photoUrls[1], photo3: photoUrls[2],
      photo4: photoUrls[3], photo5: photoUrls[4]
    };

    // 3. 送出
    var res = await fetch(CONFIG.CASE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var json;
    try { json = await res.json(); } catch(pe) { throw new Error('伺服器回應格式錯誤 (HTTP ' + res.status + ')'); }
    if (!res.ok || !json.success) throw new Error((json && json.error) || ('HTTP ' + res.status));

    // 4. 顯示成功
    setSubmitProgress('案件已送出，正在完成畫面…', 100, '完成後會顯示案件編號');
    closeSubmitProgress();
    document.getElementById('reportForm').style.display = 'none';
    document.getElementById('successMsg').style.display = 'block';
    if (json.caseId) {
      var successText = document.querySelector('#successMsg p');
      if (successText) {
        successText.textContent = json.notificationSent === false
          ? '案件已成立，案件編號：' + json.caseId + '。群組通知暫時延遲，但里辦後台仍可查看，請勿重複送出。'
          : '案件已成功送出，案件編號：' + json.caseId + '。已通知里辦公處。';
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (err) {
    closeSubmitProgress();
    console.error('[submit] error:', err);
    if (err.message === 'user_cancelled') {
      btn.disabled = false;
      btn.innerHTML = '<svg class="icon"><use href="#i-send"/></svg> 送出通報';
      return;
    }
    var GAS_ERRORS = {
      'too_many_requests':       '相同的通報在 5 分鐘內已送出，請稍後再試',
      'form_expired':            '表單已逾時，請重新整理頁面後再試',
      'bot_rejected':            '驗證失敗，請重新整理頁面後再試',
      'missing_required_fields': '請確認所有必填欄位已填寫',
      'invalid_phone':           '電話號碼格式不正確',
    };
    showToast('送出失敗：' + (GAS_ERRORS[err.message] || err.message || '未知錯誤'));
    btn.disabled = false;
    btn.innerHTML = '<svg class="icon"><use href="#i-send"/></svg> 送出通報';
  }
});
