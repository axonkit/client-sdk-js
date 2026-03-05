/**
 * Axon Protocol message encoder/decoder.
 *
 * Wire format (text-based, binary-safe body):
 *   Request:      REQ <method> <logId>\r\n[headers]\r\n<body>
 *   Response:     RES <logId> <status>\r\n[headers]\r\n<body>
 *   Notification: MSG <method> [<logId>]\r\n[headers]\r\n<body>
 *
 * Optional headers block:
 *   AXON/1.0\r\n
 *   Key: Value\r\n
 *   \r\n
 */

const CRLF = '\r\n';
const CRLF_BYTES = new Uint8Array([0x0d, 0x0a]);
const HEADER_PREFIX = 'AXON/1.0';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export enum MessageType {
  REQ = 'REQ',
  RES = 'RES',
  MSG = 'MSG',
}

export interface AxonMessage {
  type: MessageType;
  method?: string;
  logId?: string;
  status?: number;
  headers?: Record<string, string>;
  body?: Uint8Array;
}

function concatBuffers(...buffers: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const b of buffers) total += b.byteLength;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const b of buffers) {
    result.set(b, offset);
    offset += b.byteLength;
  }
  return result;
}

function findCRLF(data: Uint8Array, start: number): number {
  for (let i = start; i < data.byteLength - 1; i++) {
    if (data[i] === 0x0d && data[i + 1] === 0x0a) return i;
  }
  return -1;
}

function encodeHeaders(headers: Record<string, string>): Uint8Array {
  let text = `${HEADER_PREFIX}${CRLF}`;
  for (const [key, value] of Object.entries(headers)) {
    text += `${key}: ${value}${CRLF}`;
  }
  text += CRLF;
  return textEncoder.encode(text);
}

export function encode(msg: AxonMessage): Uint8Array {
  let firstLine: string;

  switch (msg.type) {
    case MessageType.REQ:
      firstLine = `REQ ${msg.method} ${msg.logId}`;
      break;
    case MessageType.RES:
      firstLine = `RES ${msg.logId} ${msg.status}`;
      break;
    case MessageType.MSG:
      firstLine = msg.logId ? `MSG ${msg.method} ${msg.logId}` : `MSG ${msg.method}`;
      break;
  }

  const parts: Uint8Array[] = [textEncoder.encode(firstLine), CRLF_BYTES];

  if (msg.headers && Object.keys(msg.headers).length > 0) {
    parts.push(encodeHeaders(msg.headers));
  }

  if (msg.body && msg.body.byteLength > 0) {
    parts.push(msg.body);
  }

  return concatBuffers(...parts);
}

export function decode(data: Uint8Array | ArrayBuffer): AxonMessage {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  const firstLineEnd = findCRLF(bytes, 0);
  if (firstLineEnd < 0) {
    throw new Error('Invalid Axon message: no CRLF found');
  }

  const firstLine = textDecoder.decode(bytes.subarray(0, firstLineEnd));
  const parts = firstLine.split(' ');

  if (parts.length < 2) {
    throw new Error(`Invalid Axon message first line: ${firstLine}`);
  }

  const msg: AxonMessage = { type: parts[0] as MessageType };

  switch (msg.type) {
    case MessageType.REQ:
      msg.method = parts[1];
      msg.logId = parts[2];
      break;
    case MessageType.RES:
      msg.logId = parts[1];
      msg.status = parseInt(parts[2], 10);
      break;
    case MessageType.MSG:
      msg.method = parts[1];
      msg.logId = parts.length > 2 ? parts[2] : undefined;
      break;
    default:
      throw new Error(`Unknown message type: ${parts[0]}`);
  }

  let offset = firstLineEnd + 2; // skip first CRLF

  // Check for headers block (starts with AXON/1.0)
  const remaining = textDecoder.decode(bytes.subarray(offset, Math.min(offset + HEADER_PREFIX.length, bytes.byteLength)));
  if (remaining.startsWith(HEADER_PREFIX)) {
    msg.headers = {};
    // Skip "AXON/1.0\r\n"
    offset += HEADER_PREFIX.length + 2;

    while (offset < bytes.byteLength) {
      const lineEnd = findCRLF(bytes, offset);
      if (lineEnd < 0) break;

      // Empty line signals end of headers
      if (lineEnd === offset) {
        offset += 2;
        break;
      }

      const line = textDecoder.decode(bytes.subarray(offset, lineEnd));
      const colonIdx = line.indexOf(': ');
      if (colonIdx > 0) {
        msg.headers[line.substring(0, colonIdx)] = line.substring(colonIdx + 2);
      }
      offset = lineEnd + 2;
    }
  }

  // Remaining bytes are the body
  if (offset < bytes.byteLength) {
    msg.body = bytes.subarray(offset);
  }

  return msg;
}

export function bodyToJSON<T = any>(msg: AxonMessage): T | undefined {
  if (!msg.body || msg.body.byteLength === 0) return undefined;
  const text = textDecoder.decode(msg.body);
  return JSON.parse(text) as T;
}

export function jsonToBody(obj: any): Uint8Array {
  return textEncoder.encode(JSON.stringify(obj));
}
