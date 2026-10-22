// Apply before loading CSS so a remembered dark theme does not flash white.
(() => {
  const key = 'brisa-theme';
  const valid = value => ['light', 'dark', 'system'].includes(value);
  const media = matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  let persistent = true;
  try { const value = localStorage.getItem(key); if (valid(value)) preference = value; }
  catch { persistent = false; }
  function apply() {
    const theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = theme;
    const color = document.querySelector('meta[name="theme-color"]');
    if (color) color.content = theme === 'dark' ? '#111b18' : '#21695b';
    dispatchEvent(new CustomEvent('brisa-theme-change'));
  }
  window.BrisaTheme = Object.freeze({
    get preference() { return preference; },
    get persistent() { return persistent; },
    set(value) {
      if (!valid(value)) return;
      preference = value;
      try { localStorage.setItem(key, value); persistent = true; }
      catch { persistent = false; }
      apply();
    }
  });
  media.addEventListener('change', () => { if (preference === 'system') apply(); });
  addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = valid(event.newValue) ? event.newValue : 'system';
    apply();
  });
  apply();
})();
