/**
 * ============================================================
 * DALE DEAL — Request Logger (equivalente a Morgan, sin deps)
 * ============================================================
 */

const isProd = process.env.NODE_ENV === 'production';

function pad(n) { return String(n).padStart(2, '0'); }

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Colores ANSI para terminal
const colors = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  blue:   '\x1b[34m',
  gray:   '\x1b[90m',
  cyan:   '\x1b[36m',
};

function colorStatus(status) {
  if (status >= 500) return colors.red + status + colors.reset;
  if (status >= 400) return colors.yellow + status + colors.reset;
  if (status >= 300) return colors.cyan + status + colors.reset;
  return colors.green + status + colors.reset;
}

module.exports = function logger(req, res, next) {
  const start = Date.now();
  const { method, originalUrl, ip } = req;

  res.on('finish', () => {
    const ms      = Date.now() - start;
    const status  = res.statusCode;
    const ts      = timestamp();

    if (isProd) {
      // Formato JSON para producción (fácil de parsear por log collectors)
      console.log(JSON.stringify({ ts, method, url: originalUrl, status, ms, ip }));
    } else {
      // Formato legible para desarrollo
      const methodColor = colors.blue + method.padEnd(6) + colors.reset;
      const urlStr      = colors.gray + originalUrl + colors.reset;
      const timeStr     = colors.gray + `${ms}ms` + colors.reset;
      const ipStr       = colors.gray + ip + colors.reset;
      console.log(`${colors.gray}[${ts}]${colors.reset} ${methodColor} ${urlStr} ${colorStatus(status)} ${timeStr} ${ipStr}`);
    }
  });

  next();
};
