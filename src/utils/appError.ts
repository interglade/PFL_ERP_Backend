


class BaseError extends Error {
  constructor(message: string) {
    super(message);
    Error.captureStackTrace(this, this.constructor);
  }
}

export default class AppError extends BaseError {
  readonly status: string;
  readonly isOperational: boolean;
  constructor(public statusCode: number = 500, public message: string = 'An unexpected error occurred') {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
  }
}

