/**
 * Tiny structured logger.
 *
 * Intentionally avoids external dependencies so it runs in edge / node /
 * test environments without pulling in heavy transports. In production
 * the output is JSON-per-line, which Docker's json-file driver and any
 * log forwarder (Loki, CloudWatch, Datadog) can consume directly.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'token',
  'authorization',
  'cookie',
  'nextauth_secret',
  'api_football_key',
  'awastats_api_key',
  'secret',
]);

function redact<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  const clone: any = Array.isArray(value) ? [] : {};
  for (const [k, v] of Object.entries(value as any)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      clone[k] = '[redacted]';
    } else if (v && typeof v === 'object') {
      clone[k] = redact(v);
    } else {
      clone[k] = v;
    }
  }
  return clone as T;
}

function emit(level: Level, msg: string, context?: Record<string, unknown>) {
  const payload = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...(context ? redact(context) : {}),
  };
  const serialized = JSON.stringify(payload);
  if (level === 'error') {
    console.error(serialized);
  } else if (level === 'warn') {
    console.warn(serialized);
  } else {
    // eslint-disable-next-line no-console
    console.log(serialized);
  }
}

export const logger = {
  debug(msg: string, ctx?: Record<string, unknown>) {
    if (process.env.NODE_ENV === 'production') return; // silence debug in prod
    emit('debug', msg, ctx);
  },
  info(msg: string, ctx?: Record<string, unknown>) {
    emit('info', msg, ctx);
  },
  warn(msg: string, ctx?: Record<string, unknown>) {
    emit('warn', msg, ctx);
  },
  error(msg: string, ctx?: Record<string, unknown>) {
    emit('error', msg, ctx);
  },
  /**
   * Structured security-event logger. Use for rate-limit hits, auth
   * failures, suspicious CSRF rejections, etc. The `event` field makes
   * it easy to build alerts.
   */
  security(event: string, ctx: Record<string, unknown> = {}) {
    emit('warn', `security.${event}`, { event, ...ctx });
  },
};
