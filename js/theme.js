(() => {
  const STORAGE_KEY = 'dbf_theme';

  const SUN_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;
  const MOON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

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
    if (btn) {
      btn.innerHTML = theme === 'dark' ? SUN_SVG : MOON_SVG;
      btn.setAttribute('aria-label', theme === 'dark' ? 'Skift til lyst tema' : 'Skift til mørkt tema');
      btn.title = theme === 'dark' ? 'Lyst tema' : 'Mørkt tema';
    }
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

    const slot = document.getElementById('theme-toggle-slot');
    if (slot) {
      slot.appendChild(btn);
    } else {
      btn.classList.add('theme-toggle-fixed');
      document.body.appendChild(btn);
    }

    applyTheme(getTheme());
    btn.addEventListener('click', toggle);
  });
})();
