export enum LogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
  SILENT = 5,
}

export interface LoggerInterface {
  trace(msg: string, ...args: any[]): void;
  debug(msg: string, ...args: any[]): void;
  info(msg: string, ...args: any[]): void;
  warn(msg: string, ...args: any[]): void;
  error(msg: string, ...args: any[]): void;
}

let globalLevel: LogLevel = LogLevel.INFO;
let customLogger: LoggerInterface | undefined;

export function setLogLevel(level: LogLevel): void {
  globalLevel = level;
}

export function getLogLevel(): LogLevel {
  return globalLevel;
}

export function setLogger(logger: LoggerInterface): void {
  customLogger = logger;
}

export function getLogger(tag: string): LoggerInterface {
  const prefix = `[AxonKit:${tag}]`;

  const noop = () => {};

  function wrap(level: LogLevel, consoleFn: (...args: any[]) => void) {
    return (msg: string, ...args: any[]) => {
      if (globalLevel > level) return;
      if (customLogger) {
        const method = LogLevel[level].toLowerCase() as keyof LoggerInterface;
        customLogger[method](`${prefix} ${msg}`, ...args);
      } else {
        consoleFn(`${prefix} ${msg}`, ...args);
      }
    };
  }

  return {
    trace: globalLevel <= LogLevel.TRACE ? wrap(LogLevel.TRACE, console.debug) : noop,
    debug: globalLevel <= LogLevel.DEBUG ? wrap(LogLevel.DEBUG, console.debug) : noop,
    info: wrap(LogLevel.INFO, console.info),
    warn: wrap(LogLevel.WARN, console.warn),
    error: wrap(LogLevel.ERROR, console.error),
  };
}
