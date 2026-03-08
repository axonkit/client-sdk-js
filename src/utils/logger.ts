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

/**
 * Callback signature for log extensions. Receives the log level, formatted
 * message, and any additional context passed to the logger call.
 */
export type LogExtension = (level: LogLevel, msg: string, context: Record<string, unknown>) => void;

let globalLevel: LogLevel = LogLevel.INFO;
let customLogger: LoggerInterface | undefined;
let logExtension: LogExtension | undefined;

export function setLogLevel(level: LogLevel): void {
  globalLevel = level;
}

export function getLogLevel(): LogLevel {
  return globalLevel;
}

export function setLogger(logger: LoggerInterface): void {
  customLogger = logger;
}

/**
 * Set an extension handler that receives all SDK log messages. This can be
 * used to forward logs to a third-party logging service (e.g. Sentry,
 * Datadog).
 *
 * @param handler - The extension handler function, or `undefined` to remove.
 *
 * @example
 * ```ts
 * setLogExtension((level, msg, context) => {
 *   myLoggingService.log({ level: LogLevel[level], message: msg, ...context });
 * });
 * ```
 */
export function setLogExtension(handler: LogExtension | undefined): void {
  logExtension = handler;
}

export function getLogger(tag: string): LoggerInterface {
  const prefix = `[AxonKit:${tag}]`;

  function wrap(level: LogLevel, consoleFn: (...args: any[]) => void) {
    return (msg: string, ...args: any[]) => {
      if (globalLevel > level) return;

      const formattedMsg = `${prefix} ${msg}`;

      if (logExtension) {
        try {
          logExtension(level, formattedMsg, args.length > 0 ? { args } : {});
        } catch {
          // never let a buggy extension break the SDK
        }
      }

      if (customLogger) {
        const method = LogLevel[level].toLowerCase() as keyof LoggerInterface;
        customLogger[method](formattedMsg, ...args);
      } else {
        consoleFn(formattedMsg, ...args);
      }
    };
  }

  return {
    trace: wrap(LogLevel.TRACE, console.debug),
    debug: wrap(LogLevel.DEBUG, console.debug),
    info: wrap(LogLevel.INFO, console.info),
    warn: wrap(LogLevel.WARN, console.warn),
    error: wrap(LogLevel.ERROR, console.error),
  };
}
