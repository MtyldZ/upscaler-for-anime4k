// Loaded in <head> so the saved theme applies before first paint (no flash).
try { document.documentElement.dataset.theme = localStorage.theme || 'system'; } catch {}
