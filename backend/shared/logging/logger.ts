import { env } from '../../config/env';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/**
 * Filter list of properties that must never be written to stdout logs.
 */
const SENSITIVE_KEYS = [
  'card', 'cvv', 'pin', 'pan', 'password', 'secret', 'token', 
  'key', 'authorization', 'cookie', 'auth', 'private'
];

/**
 * Recursively redacts sensitive keys from log metadata to prevent data leaks.
 */
function sanitize(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);

  const clean: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    const isSensitive = SENSITIVE_KEYS.some(k => key.toLowerCase().includes(k));
    if (isSensitive) {
      clean[key] = '[REDACTED]';
    } else if (typeof val === 'object') {
      clean[key] = sanitize(val);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

class StructuredLogger {
  private isDebugEnabled: boolean;

  constructor() {
    this.isDebugEnabled = env.APP_MODE === 'demo' || process.env.NODE_ENV === 'development';
  }

  private writeLog(level: LogLevel, message: string, meta?: Record<string, any>): void {
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: meta ? sanitize(meta) : undefined
    };

    const output = JSON.stringify(payload);
    if (level === 'ERROR') {
      console.error(output);
    } else if (level === 'WARN') {
      console.warn(output);
    } else {
      console.log(output);
    }
  }

  public debug(message: string, meta?: Record<string, any>): void {
    if (this.isDebugEnabled) {
      this.writeLog('DEBUG', message, meta);
    }
  }

  public info(message: string, meta?: Record<string, any>): void {
    this.writeLog('INFO', message, meta);
  }

  public warn(message: string, meta?: Record<string, any>): void {
    this.writeLog('WARN', message, meta);
  }

  public error(message: string, meta?: Record<string, any>): void {
    this.writeLog('ERROR', message, meta);
  }
}

export const logger = new StructuredLogger();
