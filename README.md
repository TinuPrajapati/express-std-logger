# express-std-logger

A small logger and Express response helper you can drop into any Node backend.

The console output, log files, and JSON response shapes match the logger and `ResponseHandler` used across existing services: a colorized single-line message in development, JSON in production, and `logs/error.log` plus `logs/combined.log` on disk.

This package is ESM only (`"type": "module"`). Use it from a project that has `"type": "module"`, or load it with `await import()` from CommonJS.

## Install

```bash
npm install express-std-logger
```

Requires Node.js 18 or newer.

## Quick start

```js
import express from "express";
import morgan from "morgan";
import { createLogger } from "express-std-logger";
import ResponseHandler from "express-std-logger/responsehandler";

const logger = createLogger({ service: "obligation-api" });

const app = express();

app.use(
  morgan("tiny", {
    stream: { write: (message) => logger.info(message.trim()) },
  }),
);
app.use(ResponseHandler.apiRequestLogger);
app.use(express.json());

app.get("/health", (req, res) => {
  return ResponseHandler.respondWithSuccess(
    req,
    res,
    { uptime: process.uptime() },
    { message: "Service is running" },
  );
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  logger.error("Unhandled request error", {
    message: err?.message,
    stack: err?.stack,
    path: req.originalUrl,
  });
  return ResponseHandler.respondBadRequest(req, res, null, {
    message: err?.message || "Internal server error",
    status: err?.status || 500,
  });
});
```

Call `createLogger` once at startup, before the server handles traffic. `ResponseHandler` always writes through the active logger, including one you create with `createLogger`.

If you do not need a custom service name, import the default logger and skip `createLogger`:

```js
import logger from "express-std-logger";

logger.info("Server started");
```

## Imports

```js
import logger, { createLogger } from "express-std-logger";
import ResponseHandler from "express-std-logger/responsehandler";
```

| Import | What it is |
| --- | --- |
| `logger` | Default Winston logger. Safe to use immediately. |
| `createLogger(options)` | Builds a new logger and makes it the active one. |
| `express-std-logger/responsehandler` | `ResponseHandler` class (static methods). |

`createLogger` options:

| Option | Default | Purpose |
| --- | --- | --- |
| `service` | `process.env.SERVICE_NAME` or `"app"` | Value stored as `service` on every log record. It is written to log files and omitted from the dev console line. |
| `level` | `process.env.LOG_LEVEL`, or `debug` when `NODE_ENV=development`, otherwise `info` | Minimum level that is printed. |
| `logsDir` | `<process.cwd()>/logs` | Folder for `error.log` and `combined.log`. Created if it does not exist. |

```js
const logger = createLogger({
  service: "billing-api",
  level: "debug",
  logsDir: "/var/log/billing-api",
});
```

## Logger

Levels, from most to least severe: `error`, `warn`, `info`, `http`, `debug`.

```js
logger.error("Readiness check failed");
logger.warn("Redis reconnecting");
logger.info("Listening on port 3000");
logger.http("inbound request");
logger.debug("cache miss");
```

Pass a metadata object as the second argument. Nested values are printed with `util.inspect` (full depth, sorted keys):

```js
logger.error("Readiness check failed", {
  message: error.message,
  stack: error.stack,
  requestId: req.requestId,
});
```

### `logger.object` and `logger.array`

Use these when you want a value pretty-printed on its own, without a `key:` label. The default level is `debug`.

```js
logger.object("user record", { id: 1, name: "Ada" });
logger.array("ids", [1, 2, 3], "info");
```

If you call `logger.array` with a non-array, or `logger.object` with an array, the logger prints a warning and still logs the value.

### Development console format

When `NODE_ENV` is not `production`, each line looks like this (the level is colorized in a terminal):

```text
2026-10-25 02:21:00 | info | Listening on port 3000
2026-10-25 02:21:01 | info | API Hit [GET] /health:200 - 4ms
2026-10-25 02:21:02 | error | Readiness check failed connect ECONNREFUSED
requestId: '8f1c...'
```

Shape: `YYYY-MM-DD HH:mm:ss | <level> | <message>`. The level is colorized in a terminal. Metadata is printed under the line. A metadata field named `message` is appended to the log line, and a metadata field named `stack` is printed after the other fields. That is Winston's behavior, same as the in-repo logger.

### Production console format

When `NODE_ENV=production`, the console is one JSON object per line:

```json
{"level":"info","message":"Listening on port 3000","service":"billing-api","timestamp":"2026-10-25T02:21:00.000Z"}
```

### Log files

Both environments also append JSON lines to:

- `logs/error.log` — `error` only
- `logs/combined.log` — every level that passes the current level filter

The folder is created on import. It defaults to `./logs` relative to the process working directory (the app you run), not the folder where this package is installed.

## Environment variables

| Variable | Effect |
| --- | --- |
| `NODE_ENV=development` | Default level becomes `debug` if `LOG_LEVEL` is unset. |
| `NODE_ENV=production` | Console switches from the colorized text format to JSON. |
| `LOG_LEVEL` | One of `error`, `warn`, `info`, `http`, `debug`. Overrides the `NODE_ENV` default. `createLogger({ level })` overrides this. |
| `SERVICE_NAME` | Default `service` metadata when `createLogger({ service })` is not passed. |

## ResponseHandler

All methods are static. `req` is accepted so call sites stay the same; the success and error helpers do not read it.

### `ResponseHandler.apiRequestLogger`

Express middleware. On `res` `"finish"` it logs:

```text
API Hit [GET] /health:200 - 4ms
```

```js
app.use(ResponseHandler.apiRequestLogger);
```

### `ResponseHandler.respondWithSuccess(req, res, result, options)`

| Option | Default | Meaning |
| --- | --- | --- |
| `status` | `200` | HTTP status |
| `message` | omitted | Included only when you pass it |
| `key` | `"result"` | JSON key that holds `result` |

```js
ResponseHandler.respondWithSuccess(req, res, { id: 1 }, { message: "Created", status: 201 });
```

```json
{
  "success": true,
  "result": { "id": 1 },
  "message": "Created"
}
```

### `ResponseHandler.respondBadRequest(req, res, result, options)`

Logs `options.message` with `logger.error`, then sends JSON.

| Option | Default | Meaning |
| --- | --- | --- |
| `message` | `"Bad request"` | Logged and returned as `error` |
| `status` | `400` | HTTP status. Pass `500` (or `err.status`) for unexpected failures. |

`result` is included only when it is not `null` or `undefined`.

```js
ResponseHandler.respondBadRequest(req, res, null, {
  message: "Name is required",
});
```

```json
{
  "success": false,
  "error": "Name is required"
}
```

### Error middleware

```js
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  logger.error("Unhandled request error", {
    message: err?.message,
    stack: err?.stack,
    path: req.originalUrl,
  });
  return ResponseHandler.respondBadRequest(req, res, null, {
    message: err?.message || "Internal server error",
    status: err?.status || 500,
  });
});
```

## CommonJS

This package cannot be loaded with `require()`. From a CommonJS file:

```js
const { createLogger } = await import("express-std-logger");
const { default: ResponseHandler } = await import("express-std-logger/responsehandler");
```

The file that contains that `await` must be an ES module or a CommonJS file run by a tool that supports top-level await. Otherwise wrap it in an async function.

## License

MIT
