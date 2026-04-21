import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = process.env.LOG_DIR || path.resolve(process.cwd(), 'logs');
const LOG_MAX_AGE_DAYS = Number(process.env.LOG_MAX_AGE_DAYS) || 30;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type LogChannel = 'warnings' | 'map' | 'regulation';

class Logger {
  private streams = new Map<LogChannel, { date: string; stream: fs.WriteStream }>();

  constructor() {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    this.cleanupOldLogs();
    setInterval(() => this.cleanupOldLogs(), CLEANUP_INTERVAL_MS).unref();
  }

  warning(msg: string) {
    this.write('warnings', msg, console.warn);
  }

  map(msg: string) {
    this.write('map', msg, console.log);
  }

  regulation(msg: string) {
    this.write('regulation', msg, console.log);
  }

  private write(channel: LogChannel, msg: string, consoleFn: (m: string) => void) {
    const ts = new Date().toISOString();
    this.getStream(channel).write(`[${ts}] ${msg}\n`);
    consoleFn(msg);
  }

  private getStream(channel: LogChannel): fs.WriteStream {
    const today = todayStr();
    const existing = this.streams.get(channel);
    if (existing && existing.date === today) return existing.stream;
    if (existing) existing.stream.end();
    const file = path.join(LOG_DIR, `${channel}-${today}.log`);
    const stream = fs.createWriteStream(file, { flags: 'a' });
    this.streams.set(channel, { date: today, stream });
    return stream;
  }

  private cleanupOldLogs() {
    try {
      const now = Date.now();
      const maxAgeMs = LOG_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
      for (const file of fs.readdirSync(LOG_DIR)) {
        if (!file.endsWith('.log')) continue;
        const fullPath = path.join(LOG_DIR, file);
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(fullPath);
          console.log(`[logger] Deleted old log file: ${file}`);
        }
      }
    } catch (err) {
      console.error('[logger] Failed to clean up old logs:', err);
    }
  }
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export const logger = new Logger();
