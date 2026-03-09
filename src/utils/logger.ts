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

  const noop = () => {};

  function makeMethod(level: LogLevel, consoleFn: (...args: any[]) => void) {
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

  // Use a Proxy so that each call resolves the method at invocation time.
  // When no custom logger or extension is set, the proxy returns a bound
  // console function whose call-site is visible in browser devtools.
  return new Proxy({} as LoggerInterface, {
    get(_target, prop: string) {
      const levelMap: Record<string, [LogLevel, (...args: any[]) => void]> = {
        trace: [LogLevel.TRACE, console.debug],
        debug: [LogLevel.DEBUG, console.debug],
        info: [LogLevel.INFO, console.info],
        warn: [LogLevel.WARN, console.warn],
        error: [LogLevel.ERROR, console.error],
      };
      const entry = levelMap[prop];
      if (!entry) return undefined;

      const [level, consoleFn] = entry;
      if (globalLevel > level) return noop;

      if (customLogger || logExtension) {
        return makeMethod(level, consoleFn);
      }

      // Return a bound console call — browser devtools will attribute the
      // log line to the *caller* of this function, not to logger.ts.
      return consoleFn.bind(console, prefix);
    },
  });
}
