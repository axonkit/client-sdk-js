import { describe, it, expect } from 'vitest';
import { ErrorCode, AxonError, ConnectionError, TimeoutError } from '../protocol/errors';

describe('ErrorCode', () => {
  it('has expected numeric values', () => {
    expect(ErrorCode.OK).toBe(200);
    expect(ErrorCode.BadRequest).toBe(400);
    expect(ErrorCode.Unauthorized).toBe(401);
    expect(ErrorCode.Forbidden).toBe(403);
    expect(ErrorCode.NotFound).toBe(404);
    expect(ErrorCode.Conflict).toBe(409);
    expect(ErrorCode.InternalError).toBe(500);
  });
});

describe('AxonError', () => {
  it('constructs with code and message', () => {
    const err = new AxonError(ErrorCode.NotFound, 'room not found');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AxonError');
    expect(err.code).toBe(ErrorCode.NotFound);
    expect(err.message).toBe('room not found');
    expect(err.logId).toBeUndefined();
  });

  it('constructs with optional logId', () => {
    const err = new AxonError(ErrorCode.InternalError, 'oops', 'log-abc');
    expect(err.logId).toBe('log-abc');
  });

  describe('fromStatus', () => {
    it('maps known status codes', () => {
      const err = AxonError.fromStatus(401, 'unauthorized');
      expect(err.code).toBe(ErrorCode.Unauthorized);
      expect(err.message).toBe('unauthorized');
    });

    it('falls back to InternalError for unknown status', () => {
      const err = AxonError.fromStatus(999, 'unknown error');
      expect(err.code).toBe(ErrorCode.InternalError);
    });

    it('passes logId through', () => {
      const err = AxonError.fromStatus(404, 'gone', 'req-123');
      expect(err.logId).toBe('req-123');
    });

    it('handles each known error code', () => {
      const known = [200, 400, 401, 403, 404, 409, 500];
      for (const status of known) {
        const err = AxonError.fromStatus(status, 'test');
        expect(err.code).toBe(status);
      }
    });
  });
});

describe('ConnectionError', () => {
  it('constructs with message only', () => {
    const err = new ConnectionError('connection lost');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ConnectionError');
    expect(err.message).toBe('connection lost');
    expect(err.status).toBeUndefined();
  });

  it('constructs with message and status', () => {
    const err = new ConnectionError('forbidden', 403);
    expect(err.status).toBe(403);
  });
});

describe('TimeoutError', () => {
  it('uses default message', () => {
    const err = new TimeoutError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('TimeoutError');
    expect(err.message).toBe('Request timed out');
  });

  it('accepts custom message', () => {
    const err = new TimeoutError('signal timed out');
    expect(err.message).toBe('signal timed out');
  });
});
