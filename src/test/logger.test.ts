import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LogLevel,
  setLogLevel,
  getLogLevel,
  setLogger,
  setLogExtension,
  getLogger,
} from '../utils/logger';

describe('LogLevel', () => {
  it('has expected numeric values in ascending order', () => {
    expect(LogLevel.TRACE).toBe(0);
    expect(LogLevel.DEBUG).toBe(1);
    expect(LogLevel.INFO).toBe(2);
    expect(LogLevel.WARN).toBe(3);
    expect(LogLevel.ERROR).toBe(4);
    expect(LogLevel.SILENT).toBe(5);
  });
});

describe('setLogLevel / getLogLevel', () => {
  const original = getLogLevel();

  afterEach(() => {
    setLogLevel(original);
  });

  it('changes the global log level', () => {
    setLogLevel(LogLevel.ERROR);
    expect(getLogLevel()).toBe(LogLevel.ERROR);
  });

  it('accepts SILENT to suppress all output', () => {
    setLogLevel(LogLevel.SILENT);
    expect(getLogLevel()).toBe(LogLevel.SILENT);
  });
});

describe('getLogger', () => {
  const original = getLogLevel();

  beforeEach(() => {
    setLogLevel(LogLevel.TRACE);
  });

  afterEach(() => {
    setLogLevel(original);
    setLogger(undefined as any);
    setLogExtension(undefined);
  });

  it('returns an object with all log methods', () => {
    const log = getLogger('test');
    expect(typeof log.trace).toBe('function');
    expect(typeof log.debug).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
  });

  it('does not throw when calling log methods', () => {
    const log = getLogger('safe');
    expect(() => log.trace('t')).not.toThrow();
    expect(() => log.debug('d')).not.toThrow();
    expect(() => log.info('i')).not.toThrow();
    expect(() => log.warn('w')).not.toThrow();
    expect(() => log.error('e')).not.toThrow();
  });

  it('respects log level (suppresses lower levels)', () => {
    setLogLevel(LogLevel.ERROR);
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const log = getLogger('filtered');
    log.info('should not appear');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('forwards to custom logger when set', () => {
    const custom = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    setLogger(custom);
    const log = getLogger('custom');
    log.info('hello');
    expect(custom.info).toHaveBeenCalledWith('[AxonKit:custom] hello');
  });

  it('calls log extension handler', () => {
    const handler = vi.fn();
    setLogExtension(handler);
    const log = getLogger('ext');
    log.warn('test-msg');
    expect(handler).toHaveBeenCalledWith(
      LogLevel.WARN,
      expect.stringContaining('test-msg'),
      expect.any(Object),
    );
  });

  it('does not crash if log extension throws', () => {
    setLogExtension(() => {
      throw new Error('boom');
    });
    const log = getLogger('crashproof');
    expect(() => log.info('safe call')).not.toThrow();
  });
});
