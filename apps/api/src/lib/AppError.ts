/**
 * Typed HTTP error thrown anywhere in the service or repo layers.
 * Fastify's global error handler reads `statusCode`, `message`, and optional `data`.
 * `data` is forwarded as-is in the JSON response body so callers can include
 * structured payloads (e.g. a `conflicts` array from stock reservation checks).
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    // Maintain proper prototype chain in transpiled ES5
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static badRequest(message: string, data?: Record<string, unknown>)    { return new AppError(message, 400, data); }
  static unauthorized(message: string)                                   { return new AppError(message, 401); }
  static forbidden(message: string)                                      { return new AppError(message, 403); }
  static notFound(message: string)                                       { return new AppError(message, 404); }
  static conflict(message: string, data?: Record<string, unknown>)       { return new AppError(message, 409, data); }
  static unprocessable(message: string, data?: Record<string, unknown>)  { return new AppError(message, 422, data); }
  static internal(message: string)                                       { return new AppError(message, 500); }
}
