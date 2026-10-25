import winston from "winston";
import util from "util";
import fs from "fs";
import path from "path";

const INSPECT_OPTS = {
  depth: null,
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

export function formatMetaForConsole(meta) {
  if (!meta || typeof meta !== "object") {
    return meta === undefined ? "" : util.inspect(meta, INSPECT_OPTS);
  }

  const lines = [];
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
    const head = `${timestamp} | ${level.padEnd(5)} | ${message}`;
    const metaBlock = formatMetaForConsole(rest);
    const parts = [head];
    if (metaBlock) parts.push(metaBlock);
    if (stack) parts.push(String(stack));
    return parts.join("\n");
  });
}

function consoleFormat(isProduction) {
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

function ensureLogsDir(logsDir) {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

function attachInspectHelpers(target) {
  function logInspectable(kind, message, value, level = "debug") {
    const label = message || `(${kind})`;
    if (kind === "array" && value != null && !Array.isArray(value)) {
      target.warn("logger.array expected an array; use logger.object instead", {
        received: typeof value,
      });
    }
    if (kind === "object" && Array.isArray(value)) {
      target.warn("logger.object received an array; use logger.array instead");
    }
    target.log(level, label, { [kind]: value });
  }

  target.object = (message = "", value, level = "debug") => {
    logInspectable("object", message, value, level);
  };

  target.array = (message = "", value, level = "debug") => {
    logInspectable("array", message, value, level);
  };

  return target;
}

function resolveOptions(options = {}) {
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

export function buildLogger(options = {}) {
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

export function createLogger(options = {}) {
  const next = buildLogger(options);
  const previous = activeLogger;
  activeLogger = next;
  previous?.close?.();
  return activeLogger;
}

export function getLogger() {
  return activeLogger;
}

export const logger = new Proxy(
  {},
  {
    get(_target, prop) {
      const value = activeLogger[prop];
      return typeof value === "function" ? value.bind(activeLogger) : value;
    },
    set(_target, prop, value) {
      activeLogger[prop] = value;
      return true;
    },
    has(_target, prop) {
      return prop in activeLogger;
    },
  },
);

export default logger;
