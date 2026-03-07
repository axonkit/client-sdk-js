import { types as mediasoupTypes } from 'mediasoup-client';
import { TypedEventEmitter } from '../utils/events';
import { getLogger } from '../utils/logger';
import { generateLogId } from '../utils/id';
import { AxonError, TimeoutError } from '../protocol/errors';
import {
  MessageType,
  encode,
  decode,
  bodyToJSON,
  jsonToBody,
  type AxonMessage,
} from '../protocol/message';

const log = getLogger('RPCClient');

const DEFAULT_TIMEOUT = 10_000;

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

type RequestHandler = (body: any) => Promise<any>;
type NotificationHandler = (body: any) => void;

export interface RPCEvents {
  closed: () => void;
  error: (err: Error) => void;
}

export class RPCClient extends TypedEventEmitter<RPCEvents> {
  private sendDC: mediasoupTypes.DataProducer | null = null;
  private recvDC: mediasoupTypes.DataConsumer | null = null;
  private pending = new Map<string, PendingRequest>();
  private requestHandlers = new Map<string, RequestHandler>();
  private notificationHandlers = new Map<string, NotificationHandler>();
  private closed = false;
  lastSentAt = 0;

  bind(
    sendDC: mediasoupTypes.DataProducer,
    recvDC: mediasoupTypes.DataConsumer,
  ): void {
    this.sendDC = sendDC;
    this.recvDC = recvDC;

    recvDC.on('message', (data: ArrayBuffer | string) => {
      this.handleMessage(data);
    });

    recvDC.on('close', () => {
      log.warn('Receive DataChannel closed');
    });
  }

  async request<T = any>(
    method: string,
    body?: object,
    timeout: number = DEFAULT_TIMEOUT,
  ): Promise<T> {
    if (this.closed || !this.sendDC) {
      throw new Error('RPCClient is closed or not bound');
    }

    const logId = generateLogId();
    const msg: AxonMessage = {
      type: MessageType.REQ,
      method,
      logId,
      body: body ? jsonToBody(body) : undefined,
    };

    log.debug(`REQ ${method} logId=${logId}`);

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(logId);
        reject(new TimeoutError(`RPC ${method} timed out after ${timeout}ms`));
      }, timeout);

      this.pending.set(logId, { resolve, reject, timer, method });

      const encoded = encode(msg);
      this.sendDC!.send(encoded);
      this.lastSentAt = Date.now();
    });
  }

  respond(logId: string, status: number, body?: object, headers?: Record<string, string>): void {
    if (this.closed || !this.sendDC) return;

    const msg: AxonMessage = {
      type: MessageType.RES,
      logId,
      status,
      headers,
      body: body ? jsonToBody(body) : undefined,
    };

    log.debug(`RES logId=${logId} status=${status}`);
    this.sendDC.send(encode(msg));
    this.lastSentAt = Date.now();
  }

  notify(method: string, body?: object): void {
    if (this.closed || !this.sendDC) return;

    const msg: AxonMessage = {
      type: MessageType.MSG,
      method,
      body: body ? jsonToBody(body) : undefined,
    };

    this.sendDC.send(encode(msg));
    this.lastSentAt = Date.now();
  }

  onRequest(method: string, handler: RequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  onNotification(method: string, handler: NotificationHandler): void {
    this.notificationHandlers.set(method, handler);
  }

  close(): void {
    this.closed = true;
    for (const [logId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('RPCClient closed'));
      this.pending.delete(logId);
    }
    this.requestHandlers.clear();
    this.notificationHandlers.clear();
    this.sendDC = null;
    this.recvDC = null;
  }

  private handleMessage(data: ArrayBuffer | string): void {
    try {
      const bytes = typeof data === 'string'
        ? new TextEncoder().encode(data)
        : new Uint8Array(data);

      const msg = decode(bytes);

      switch (msg.type) {
        case MessageType.RES:
          this.handleResponse(msg);
          break;
        case MessageType.REQ:
          this.handleIncomingRequest(msg);
          break;
        case MessageType.MSG:
          this.handleNotification(msg);
          break;
      }
    } catch (err) {
      log.error('Failed to handle message', err);
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  private handleResponse(msg: AxonMessage): void {
    const logId = msg.logId;
    if (!logId) return;

    const pending = this.pending.get(logId);
    if (!pending) {
      log.warn(`Received response for unknown logId=${logId}`);
      return;
    }

    this.pending.delete(logId);
    clearTimeout(pending.timer);

    if (msg.status && msg.status >= 400) {
      const errorMsg = msg.headers?.['Error'] ?? `RPC error status=${msg.status}`;
      pending.reject(AxonError.fromStatus(msg.status, errorMsg, logId));
      return;
    }

    const body = bodyToJSON(msg);
    log.debug(`RES ${pending.method} logId=${logId} status=${msg.status}`);
    pending.resolve(body);
  }

  private async handleIncomingRequest(msg: AxonMessage): Promise<void> {
    const method = msg.method;
    if (!method) return;

    const handler = this.requestHandlers.get(method);
    if (!handler) {
      log.warn(`No handler for server request: ${method}`);
      if (msg.logId) {
        this.respond(msg.logId, 404, undefined, { Error: 'No handler' });
      }
      return;
    }

    try {
      const reqBody = bodyToJSON(msg);
      log.debug(`Incoming REQ ${method} logId=${msg.logId}`);
      const result = await handler(reqBody);
      if (msg.logId) {
        this.respond(msg.logId, 200, result);
      }
    } catch (err) {
      log.error(`Handler error for ${method}`, err);
      if (msg.logId) {
        this.respond(msg.logId, 500, undefined, {
          Error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private handleNotification(msg: AxonMessage): void {
    const method = msg.method;
    if (!method) return;

    const handler = this.notificationHandlers.get(method);
    if (!handler) {
      log.debug(`No handler for notification: ${method}`);
      return;
    }

    try {
      const body = bodyToJSON(msg);
      log.debug(`MSG ${method} logId=${msg.logId ?? '(none)'}`);
      handler(body);
    } catch (err) {
      log.error(`Notification handler error for ${method}`, err);
    }
  }
}
