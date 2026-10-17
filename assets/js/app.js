/* Boot the upgraded shell. Scene, catalog, and pages stay in sibling scripts. */
(function () {
  'use strict';
  const loading = document.getElementById('loading');
  if (!window.SITE_DATA || !window.CATALOG || !window.XiaobaiShell) {
    if (loading) loading.innerHTML = '<p>作品资料未载入，请重新打开页面。</p>';
    return;
  }
  new window.XiaobaiShell().start();
}());
