// Shared by content.js and popup.js.
const MODES = {
  auto: 'Auto (match frame rate)',
  fast: 'Fast',
  balanced: 'Balanced',
  upscale: 'Upscale only',
  ModeA: 'A (HQ)',
  ModeAA: 'A+A',
  ModeB: 'B',
  ModeBB: 'B+B',
  ModeC: 'C',
  ModeCA: 'C+A',
  fsr: 'FSR (live action)',
};
const DEFAULTS = { mode: 'auto', strength: 1 };
