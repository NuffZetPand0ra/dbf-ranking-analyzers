(() => {
  const STORAGE_KEY = 'dbf_theme';

  function getTheme() {
    return localStorage.getItem(STORAGE_KEY) || 'dark';
  }

  function applyTheme(theme) {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀ Lyst tema' : '☾ Mørkt tema';
  }

  function toggle() {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }

  // Apply immediately (no flash) — called from inline script in <head>
  window.__applyTheme = applyTheme;
  window.__getTheme = getTheme;

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.createElement('button');
    btn.id = 'themeToggle';
    btn.className = 'theme-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Skift tema');
    document.body.appendChild(btn);

    applyTheme(getTheme());
    btn.addEventListener('click', toggle);
  });
})();
