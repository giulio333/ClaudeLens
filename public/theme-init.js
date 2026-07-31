// Apply saved theme before paint to avoid a flash. Default: light.
// Kept as an external file (not inline) so a strict `script-src 'self'` CSP allows it.
try {
  var t = localStorage.getItem('cl-theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
} catch {
  document.documentElement.setAttribute('data-theme', 'light');
}
