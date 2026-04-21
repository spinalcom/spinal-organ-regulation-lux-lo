"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const LOG_DIR = process.env.LOG_DIR || path.resolve(process.cwd(), 'logs');
const LOG_MAX_AGE_DAYS = Number(process.env.LOG_MAX_AGE_DAYS) || 30;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
class Logger {
    constructor() {
        this.streams = new Map();
        fs.mkdirSync(LOG_DIR, { recursive: true });
        this.cleanupOldLogs();
        setInterval(() => this.cleanupOldLogs(), CLEANUP_INTERVAL_MS).unref();
    }
    warning(msg) {
        this.write('warnings', msg, console.warn);
    }
    map(msg) {
        this.write('map', msg, console.log);
    }
    regulation(msg) {
        this.write('regulation', msg, console.log);
    }
    write(channel, msg, consoleFn) {
        const ts = new Date().toISOString();
        this.getStream(channel).write(`[${ts}] ${msg}\n`);
        consoleFn(msg);
    }
    getStream(channel) {
        const today = todayStr();
        const existing = this.streams.get(channel);
        if (existing && existing.date === today)
            return existing.stream;
        if (existing)
            existing.stream.end();
        const file = path.join(LOG_DIR, `${channel}-${today}.log`);
        const stream = fs.createWriteStream(file, { flags: 'a' });
        this.streams.set(channel, { date: today, stream });
        return stream;
    }
    cleanupOldLogs() {
        try {
            const now = Date.now();
            const maxAgeMs = LOG_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
            for (const file of fs.readdirSync(LOG_DIR)) {
                if (!file.endsWith('.log'))
                    continue;
                const fullPath = path.join(LOG_DIR, file);
                const stat = fs.statSync(fullPath);
                if (now - stat.mtimeMs > maxAgeMs) {
                    fs.unlinkSync(fullPath);
                    console.log(`[logger] Deleted old log file: ${file}`);
                }
            }
        }
        catch (err) {
            console.error('[logger] Failed to clean up old logs:', err);
        }
    }
}
function todayStr() {
    return new Date().toISOString().slice(0, 10);
}
exports.logger = new Logger();
//# sourceMappingURL=logger.js.map