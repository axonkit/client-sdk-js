export enum ErrorCode {
  OK = 200,
  BadRequest = 400,
  Unauthorized = 401,
  Forbidden = 403,
  NotFound = 404,
  Conflict = 409,
  InternalError = 500,
}

export class AxonError extends Error {
  code: ErrorCode;
  logId?: string;

  constructor(code: ErrorCode, message: string, logId?: string) {
    super(message);
    this.name = 'AxonError';
    this.code = code;
    this.logId = logId;
  }

  static fromStatus(status: number, message: string, logId?: string): AxonError {
    const code = Object.values(ErrorCode).includes(status)
      ? (status as ErrorCode)
      : ErrorCode.InternalError;
    return new AxonError(code, message, logId);
  }
}

export class ConnectionError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ConnectionError';
    this.status = status;
  }
}

export class TimeoutError extends Error {
  constructor(message = 'Request timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}
