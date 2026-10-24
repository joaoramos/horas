/*
 * TEMPORARY — theme switcher for trying out styles.
 * Sets <html data-theme="…"> and remembers the choice in this browser.
 * Themes are defined in themes.css; keep this list in sync with it.
 */
(function () {
  var THEMES = [
    { id: '', label: 'Tema 0 — Padrão' },
    { id: 'tema-1', label: 'Tema 1 — Editorial' },
    { id: 'tema-2', label: 'Tema 2 — Lúdico' },
    { id: 'tema-3', label: 'Tema 3 — Dinâmico' },
    { id: 'scribbly', label: 'Tema 4 — Rabiscos' },
    { id: 'forest', label: 'Tema 5 — Mata' },
    { id: 'magazine', label: 'Tema 6 — Magazine' },
  ];
  var KEY = 'jm-theme';
  var root = document.documentElement;

  function read() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function save(id) { try { localStorage.setItem(KEY, id); } catch (e) {} }
  function apply(id) {
    if (id) root.setAttribute('data-theme', id);
    else root.removeAttribute('data-theme');
  }

  // Runs in <head>, so the saved theme applies before the first paint
  var current = read();
  if (!THEMES.some(function (t) { return t.id === current; })) current = '';
  apply(current);

  document.addEventListener('DOMContentLoaded', function () {
    var wrap = document.createElement('div');
    wrap.className = 'theme-switcher';

    var label = document.createElement('label');
    label.htmlFor = 'theme-switcher';
    label.textContent = 'Tema';

    var select = document.createElement('select');
    select.id = 'theme-switcher';
    THEMES.forEach(function (t) {
      var option = new Option(t.label, t.id);
      option.selected = t.id === current;
      select.add(option);
    });
    select.addEventListener('change', function () {
      apply(select.value);
      save(select.value);
    });

    wrap.append(label, select);
    document.body.append(wrap);
  });
})();
