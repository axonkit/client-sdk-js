import { describe, it, expect } from 'vitest';
import { RpcError, MAX_RPC_PAYLOAD_BYTES, byteLength } from '../rpc';

// ---------------------------------------------------------------------------
// RpcError
// ---------------------------------------------------------------------------

describe('RpcError', () => {
  it('constructs with code and message', () => {
    const err = new RpcError(1500, 'Application error');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(1500);
    expect(err.message).toBe('Application error');
    expect(err.data).toBeUndefined();
  });

  it('constructs with optional data', () => {
    const err = new RpcError(1500, 'fail', '{"detail":"oops"}');
    expect(err.data).toBe('{"detail":"oops"}');
  });

  it('has static ErrorCode constants', () => {
    expect(RpcError.ErrorCode.APPLICATION_ERROR).toBe(1500);
    expect(RpcError.ErrorCode.CONNECTION_TIMEOUT).toBe(1501);
    expect(RpcError.ErrorCode.RESPONSE_TIMEOUT).toBe(1502);
    expect(RpcError.ErrorCode.RECIPIENT_DISCONNECTED).toBe(1503);
    expect(RpcError.ErrorCode.RESPONSE_PAYLOAD_TOO_LARGE).toBe(1504);
    expect(RpcError.ErrorCode.SEND_FAILED).toBe(1505);
    expect(RpcError.ErrorCode.UNSUPPORTED_METHOD).toBe(1400);
    expect(RpcError.ErrorCode.RECIPIENT_NOT_FOUND).toBe(1401);
    expect(RpcError.ErrorCode.REQUEST_PAYLOAD_TOO_LARGE).toBe(1402);
  });

  it('has matching ErrorMessage entries', () => {
    const keys = Object.keys(RpcError.ErrorCode) as (keyof typeof RpcError.ErrorCode)[];
    for (const key of keys) {
      expect(RpcError.ErrorMessage[key]).toBeDefined();
      expect(typeof RpcError.ErrorMessage[key]).toBe('string');
    }
  });

  describe('builtIn', () => {
    it('creates an error with correct code and message', () => {
      const err = RpcError.builtIn('APPLICATION_ERROR');
      expect(err.code).toBe(1500);
      expect(err.message).toBe('Application error in method handler');
      expect(err.data).toBeUndefined();
    });

    it('passes data to the created error', () => {
      const err = RpcError.builtIn('CONNECTION_TIMEOUT', 'extra-info');
      expect(err.code).toBe(1501);
      expect(err.data).toBe('extra-info');
    });

    it('creates each built-in error type correctly', () => {
      const keys = Object.keys(RpcError.ErrorCode) as (keyof typeof RpcError.ErrorCode)[];
      for (const key of keys) {
        const err = RpcError.builtIn(key);
        expect(err.code).toBe(RpcError.ErrorCode[key]);
        expect(err.message).toBe(RpcError.ErrorMessage[key]);
      }
    });
  });

  it('has correct static limits', () => {
    expect(RpcError.MAX_MESSAGE_BYTES).toBe(256);
    expect(RpcError.MAX_DATA_BYTES).toBe(15360);
  });
});

// ---------------------------------------------------------------------------
// MAX_RPC_PAYLOAD_BYTES
// ---------------------------------------------------------------------------

describe('MAX_RPC_PAYLOAD_BYTES', () => {
  it('equals 15360', () => {
    expect(MAX_RPC_PAYLOAD_BYTES).toBe(15360);
  });
});

// ---------------------------------------------------------------------------
// byteLength
// ---------------------------------------------------------------------------

describe('byteLength', () => {
  it('returns 0 for empty string', () => {
    expect(byteLength('')).toBe(0);
  });

  it('returns correct length for ASCII strings', () => {
    expect(byteLength('hello')).toBe(5);
    expect(byteLength('a')).toBe(1);
  });

  it('handles multi-byte UTF-8 characters', () => {
    expect(byteLength('你好')).toBe(6); // 3 bytes each
    expect(byteLength('é')).toBe(2);
    expect(byteLength('€')).toBe(3);
  });

  it('handles emoji (4-byte UTF-8)', () => {
    expect(byteLength('😀')).toBe(4);
    expect(byteLength('hello 😀')).toBe(10); // 5 + 1 space + 4
  });

  it('handles mixed content', () => {
    const str = 'Hello 你好 😀';
    expect(byteLength(str)).toBe(5 + 1 + 6 + 1 + 4); // 17
  });
});
