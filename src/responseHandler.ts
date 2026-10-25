import logger from "./logger.js";

export interface RequestLike {
  method?: string;
  originalUrl?: string;
  url?: string;
}

export interface ResponseLike {
  statusCode?: number;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  status(code: number): { json(body: unknown): unknown };
}

export type NextFunction = (err?: unknown) => void;

export interface SuccessOptions {
  message?: string;
  status?: number;
  key?: string;
}

export interface ErrorOptions {
  message?: string;
  status?: number;
}

export default class ResponseHandler {
  static apiRequestLogger(
    req: RequestLike,
    res: ResponseLike,
    next: NextFunction,
  ): void {
    const start = Date.now();
    res.on("finish", () => {
      const method = req.method;
      const urlPath = req.originalUrl || req.url;
      const status = res.statusCode;
      const durationMs = Date.now() - start;
      logger.info(`API Hit [${method}] ${urlPath}:${status} - ${durationMs}ms`);
    });
    next();
  }

  static respondWithSuccess(
    req: RequestLike,
    res: ResponseLike,
    result?: unknown,
    options: SuccessOptions = {},
  ): void {
    const { message, status = 200, key = "result" } = options;
    res.status(status).json({
      success: true,
      [key]: result,
      ...(message ? { message } : {}),
    });
  }

  static respondBadRequest(
    req: RequestLike,
    res: ResponseLike,
    result?: unknown,
    options: ErrorOptions = {},
  ): void {
    const { message = "Bad request", status = 400 } = options;
    logger.error(message);
    res.status(status).json({
      success: false,
      error: message,
      ...(result != null ? { result } : {}),
    });
  }
}
