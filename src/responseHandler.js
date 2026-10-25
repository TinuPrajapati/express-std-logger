import logger from "./logger.js";

class ResponseHandler {
  static apiRequestLogger(req, res, next) {
    const start = Date.now();
    res.on("finish", () => {
      const method = req.method;
      const path = req.originalUrl || req.url;
      const status = res.statusCode;
      const durationMs = Date.now() - start;
      logger.info(`API Hit [${method}] ${path}:${status} - ${durationMs}ms`);
    });
    next();
  }

  static respondWithSuccess(req, res, result, options = {}) {
    const { message, status = 200, key = "result" } = options;
    res.status(status).json({
      success: true,
      [key]: result,
      ...(message ? { message } : {}),
    });
  }

  static respondBadRequest(req, res, result, options = {}) {
    const { message = "Bad request", status = 400 } = options;
    logger.error(message);
    res.status(status).json({
      success: false,
      error: message,
      ...(result != null ? { result } : {}),
    });
  }
}

export default ResponseHandler;
