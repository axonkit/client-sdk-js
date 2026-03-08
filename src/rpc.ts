/**
 * Specialized error for RPC methods.
 *
 * When thrown in an RPC handler, the `message` and `code` are sent back to
 * the caller. Built-in error codes 1001–1999 are reserved.
 */
export class RpcError extends Error {
  static MAX_MESSAGE_BYTES = 256;
  static MAX_DATA_BYTES = 15360;

  code: number;
  data?: string;

  constructor(code: number, message: string, data?: string) {
    super(message);
    this.code = code;
    this.data = data;
  }

  static ErrorCode = {
    APPLICATION_ERROR: 1500,
    CONNECTION_TIMEOUT: 1501,
    RESPONSE_TIMEOUT: 1502,
    RECIPIENT_DISCONNECTED: 1503,
    RESPONSE_PAYLOAD_TOO_LARGE: 1504,
    SEND_FAILED: 1505,
    UNSUPPORTED_METHOD: 1400,
    RECIPIENT_NOT_FOUND: 1401,
    REQUEST_PAYLOAD_TOO_LARGE: 1402,
  } as const;

  static ErrorMessage: Record<keyof typeof RpcError.ErrorCode, string> = {
    APPLICATION_ERROR: 'Application error in method handler',
    CONNECTION_TIMEOUT: 'Connection timeout',
    RESPONSE_TIMEOUT: 'Response timeout',
    RECIPIENT_DISCONNECTED: 'Recipient disconnected',
    RESPONSE_PAYLOAD_TOO_LARGE: 'Response payload too large',
    SEND_FAILED: 'Failed to send',
    UNSUPPORTED_METHOD: 'Method not supported at destination',
    RECIPIENT_NOT_FOUND: 'Recipient not found',
    REQUEST_PAYLOAD_TOO_LARGE: 'Request payload too large',
  } as const;

  /** Create a built-in error by key name. */
  static builtIn(key: keyof typeof RpcError.ErrorCode, data?: string): RpcError {
    return new RpcError(RpcError.ErrorCode[key], RpcError.ErrorMessage[key], data);
  }
}

export const MAX_RPC_PAYLOAD_BYTES = 15360;

/** @internal */
export function byteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}
