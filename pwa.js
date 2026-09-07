/**
 * Keep leftover service workers from controlling Docker tabs.
 * No custom install UI — use the browser's own install control if present.
 */
(function () {
  const isHttp = location.protocol === 'http:' || location.protocol === 'https:';
  if (!isHttp || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => { reg.unregister().catch(() => {}); });
  }).catch(() => {});
})();
