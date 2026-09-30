const $ = (id) => document.getElementById(id);

const GROUPS = {
  Adaptive: ['auto'],
  Anime: ['fast', 'balanced', 'upscale'],
  'Anime4K presets': ['ModeA', 'ModeAA', 'ModeB', 'ModeBB', 'ModeC', 'ModeCA'],
  'General video': ['fsr'],
};
const HINTS = {
  auto: 'Picks the highest quality your GPU can keep in sync with the video.',
  fast: 'Small networks, one 2× pass. Lowest GPU load.',
  balanced: 'Large networks, one 2× pass. Good quality at moderate load.',
  upscale: 'Anime4K 2× upscale without the restore pass. Changes the image less.',
  fsr: 'Edge-aware upscale + sharpen (FSR 1). Best for YouTube and live action. Very light.',
  ModeA: 'Restore + upscale. Best for most anime with blur or compression.',
  ModeAA: 'Mode A applied twice. Sharpest result, heaviest load.',
  ModeB: 'Softer restore. For sources with ringing or aliasing.',
  ModeBB: 'Mode B applied twice.',
  ModeC: 'Denoising upscale. For clean, low-resolution sources.',
  ModeCA: 'Mode C followed by Mode A.',
};

// Theme (system / light / dark), stored per extension in localStorage; theme.js applies it on load.
const setTheme = (t) => {
  document.documentElement.dataset.theme = t;
  try { localStorage.theme = t; } catch {}
  for (const b of document.querySelectorAll('.seg button')) b.setAttribute('aria-pressed', b.dataset.theme === t);
};
for (const b of document.querySelectorAll('.seg button')) b.onclick = () => setTheme(b.dataset.theme);
setTheme(document.documentElement.dataset.theme);

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const ask = (cmd) => chrome.tabs.sendMessage(tab.id, cmd).catch(() => null);
  const settings = await chrome.storage.local.get(DEFAULTS);

  for (const [group, keys] of Object.entries(GROUPS)) {
    const og = document.createElement('optgroup');
    og.label = group;
    for (const k of keys) og.append(new Option(MODES[k], k));
    $('mode').append(og);
  }
  const showMode = () => { $('hint').textContent = HINTS[$('mode').value]; };
  const showStrength = () => { $('sv').textContent = $('strength').value + '%'; };
  $('mode').value = settings.mode;
  $('strength').value = settings.strength * 100;
  showMode();
  showStrength();

  $('mode').onchange = () => { showMode(); chrome.storage.local.set({ mode: $('mode').value }); };
  $('strength').oninput = () => { showStrength(); chrome.storage.local.set({ strength: $('strength').value / 100 }); };

  let message = '';
  const refresh = async () => {
    const st = await ask('status');
    $('toggle').setAttribute('aria-checked', !!st);
    $('status').textContent = st ? st.label : message || 'Off';
    $('stats').textContent = st ? `GPU ${st.gpu} ms / frame ${st.frame} ms` : 'GPU – / frame –';
    const load = st ? Math.min(1, st.gpu / st.frame) : 0;
    $('load').style.width = load * 100 + '%';
    $('load').style.background = `var(${load > 0.5 ? '--bad' : load > 0.2 ? '--warn' : '--ok'})`;
  };
  $('toggle').onclick = async () => {
    const r = await ask('toggle');
    message = r === null ? 'No playable video in this tab' : typeof r === 'string' ? r : '';
    refresh();
  };
  refresh();
  setInterval(refresh, 1000);
})();
