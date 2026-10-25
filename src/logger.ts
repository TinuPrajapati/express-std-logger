import winston from "winston";
import type { Logger } from "winston";
import util from "node:util";
import fs from "node:fs";
import path from "node:path";

const INSPECT_OPTS: util.InspectOptions = {
  depth: Infinity,
  colors: true,
  compact: false,
  breakLength: 80,
  sorted: true,
};

const RESERVED_KEYS = new Set([
  "level",
  "message",
  "timestamp",
  "service",
  "stack",
  "splat",
]);

export type LogLevel = "error" | "warn" | "info" | "http" | "debug";

export interface CreateLoggerOptions {
  service?: string;
  level?: LogLevel | (string & {});
  logsDir?: string;
}

export interface StdLogger extends Logger {
  object(message?: string, value?: unknown, level?: string): void;
  array(message?: string, value?: unknown, level?: string): void;
}

export function formatMetaForConsole(meta: unknown): string {
  if (!meta || typeof meta !== "object") {
    return meta === undefined ? "" : util.inspect(meta, INSPECT_OPTS);
  }

  const lines: string[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (key === "object" || key === "array") {
      lines.push(util.inspect(value, INSPECT_OPTS));
      continue;
    }
    const inspected = util.inspect(value, INSPECT_OPTS);
    if (inspected.includes("\n")) {
      lines.push(`${key}:`);
      lines.push(
        inspected
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n"),
      );
    } else {
      lines.push(`${key}: ${inspected}`);
    }
  }
  return lines.join("\n");
}

function devConsoleFormat() {
  return winston.format.printf((info) => {
    const { timestamp, level, message, stack, ...rest } = info;
    const head = `${timestamp} | ${String(level).padEnd(5)} | ${message}`;
    const metaBlock = formatMetaForConsole(rest);
    const parts = [head];
    if (metaBlock) parts.push(metaBlock);
    if (stack) parts.push(String(stack));
    return parts.join("\n");
  });
}

function consoleFormat(isProduction: boolean) {
  return isProduction
    ? winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      )
    : winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        winston.format.colorize({ level: true }),
        winston.format.errors({ stack: true }),
        devConsoleFormat(),
      );
}

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

function ensureLogsDir(logsDir: string) {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

function attachInspectHelpers(target: Logger): StdLogger {
  const std = target as StdLogger;

  function logInspectable(
    kind: "object" | "array",
    message: string,
    value: unknown,
    level = "debug",
  ) {
    const label = message || `(${kind})`;
    if (kind === "array" && value != null && !Array.isArray(value)) {
      std.warn("logger.array expected an array; use logger.object instead", {
        received: typeof value,
      });
    }
    if (kind === "object" && Array.isArray(value)) {
      std.warn("logger.object received an array; use logger.array instead");
    }
    std.log(level, label, { [kind]: value });
  }

  std.object = (message = "", value, level = "debug") => {
    logInspectable("object", message, value, level);
  };

  std.array = (message = "", value, level = "debug") => {
    logInspectable("array", message, value, level);
  };

  return std;
}

function resolveOptions(options: CreateLoggerOptions = {}) {
  const nodeEnv = process.env.NODE_ENV;
  const isProduction = nodeEnv === "production";
  const level =
    options.level ||
    process.env.LOG_LEVEL ||
    (nodeEnv === "development" ? "debug" : "info");
  const service = options.service || process.env.SERVICE_NAME || "app";
  const logsDir = options.logsDir || path.join(process.cwd(), "logs");
  return { isProduction, level, service, logsDir };
}

export function buildLogger(options: CreateLoggerOptions = {}): StdLogger {
  const { isProduction, level, service, logsDir } = resolveOptions(options);
  ensureLogsDir(logsDir);

  const instance = winston.createLogger({
    level,
    levels,
    defaultMeta: { service },
    transports: [
      new winston.transports.Console({ format: consoleFormat(isProduction) }),
      new winston.transports.File({
        filename: path.join(logsDir, "error.log"),
        level: "error",
        format: fileFormat,
      }),
      new winston.transports.File({
        filename: path.join(logsDir, "combined.log"),
        format: fileFormat,
      }),
    ],
  });

  return attachInspectHelpers(instance);
}

let activeLogger = buildLogger();

export function createLogger(options: CreateLoggerOptions = {}): StdLogger {
  const next = buildLogger(options);
  const previous = activeLogger;
  activeLogger = next;
  previous.close();
  return activeLogger;
}

export function getLogger(): StdLogger {
  return activeLogger;
}

export const logger: StdLogger = new Proxy({} as StdLogger, {
  get(_target, prop) {
    const value = Reflect.get(activeLogger, prop);
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(activeLogger)
      : value;
  },
  set(_target, prop, value) {
    Reflect.set(activeLogger, prop, value);
    return true;
  },
  has(_target, prop) {
    return prop in activeLogger;
  },
});

export default logger;
