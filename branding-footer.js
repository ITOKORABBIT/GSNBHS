(function () {
  var companyName = 'ITOKO RABBIT';
  var year = new Date().getFullYear();
  var footerText = '\u00A9 ' + year + ' ' + companyName + '. All rights reserved.';

  var existing = document.querySelector('.site-branding-footer, body > .footer, body > footer');
  if (!existing) {
    existing = document.createElement('footer');
    document.body.appendChild(existing);
  }

  existing.className = 'site-branding-footer';
  existing.textContent = footerText;

  if (!document.getElementById('site-branding-footer-style')) {
    var style = document.createElement('style');
    style.id = 'site-branding-footer-style';
    style.textContent = '.site-branding-footer{margin-top:28px;padding:18px 16px 24px;text-align:center;font-family:"Noto Sans TC",-apple-system,BlinkMacSystemFont,sans-serif;font-size:12px;line-height:1.8;color:#6b8577;background:transparent}';
    document.head.appendChild(style);
  }
})();
