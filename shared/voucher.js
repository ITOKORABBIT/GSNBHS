
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function tickTime() {
  var t = new Date();
  var s = t.getFullYear() + '/' + pad2(t.getMonth() + 1) + '/' + pad2(t.getDate())
        + ' ' + pad2(t.getHours()) + ':' + pad2(t.getMinutes()) + ':' + pad2(t.getSeconds());
  var el = document.getElementById('timeText');
  if (el) el.textContent = s;
}
tickTime();
setInterval(tickTime, 1000);

function goStores() {
  window.location.href = 'storeopenlist.html';
}
