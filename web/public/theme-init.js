// Runs before first paint. Keep it tiny and dependency free.
// Must stay in sync with src/theme/theme.ts (storage key and values).
(function () {
  var theme = null;
  try {
    var stored = localStorage.getItem('polymnia.theme');
    if (stored === 'light' || stored === 'dark') theme = stored;
  } catch {
    // Storage unavailable: follow the OS preference.
  }
  if (!theme) {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
})();
