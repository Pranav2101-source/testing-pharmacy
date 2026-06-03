/**
 * Typed HTTP error thrown anywhere in the service or repo layers.
 * Fastify's global error handler reads `statusCode` and `message`.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = "AppError";
    // Maintain proper prototype chain in transpiled ES5
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static badRequest(message: string)   { return new AppError(message, 400); }
  static unauthorized(message: string) { return new AppError(message, 401); }
  static forbidden(message: string)    { return new AppError(message, 403); }
  static notFound(message: string)     { return new AppError(message, 404); }
  static conflict(message: string)     { return new AppError(message, 409); }
  static unprocessable(message: string){ return new AppError(message, 422); }
  static internal(message: string)     { return new AppError(message, 500); }
}
