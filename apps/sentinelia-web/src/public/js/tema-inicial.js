(function () {
  var clave = 'sentinelia.tema';
  var modos = ['auto', 'light', 'dark'];
  var modo = 'auto';

  try {
    var guardado = window.localStorage.getItem(clave);
    modo = modos.includes(guardado) ? guardado : 'auto';
  } catch (_error) {
    modo = 'auto';
  }

  var oscuroSistema = window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  var tema = modo === 'auto' ? (oscuroSistema ? 'dark' : 'light') : modo;

  document.documentElement.dataset.themeMode = modo;
  document.documentElement.dataset.theme = tema;
  document.documentElement.dataset.bsTheme = tema;
  document.documentElement.style.colorScheme = tema;

  var favicon = document.createElement('link');
  favicon.rel = 'icon';
  favicon.type = 'image/svg+xml';
  favicon.dataset.themeFavicon = '';
  favicon.href = tema === 'dark'
    ? '/IMG/Sentinelia-DarkBackground.svg'
    : '/IMG/Sentinelia.svg';
  document.head.appendChild(favicon);
})();
