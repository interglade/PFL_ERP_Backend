


class BaseError extends Error {
  constructor(message: string) {
    super(message);
    Error.captureStackTrace(this, this.constructor);
  }
}

export default class AppError extends BaseError {
  readonly status: string;
  readonly isOperational: boolean;
  /**
   * `details` is sent to the client as `data` next to the message, for errors
   * the screen has to act on (e.g. which masters to import first).
   */
  constructor(
    public statusCode: number = 500,
    public message: string = 'An unexpected error occurred',
    public details?: unknown,
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
  }
}

