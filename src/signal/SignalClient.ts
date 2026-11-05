import { getLogger } from '../utils/logger';
import { ConnectionError } from '../protocol/errors';
import type {
  JoinRequest,
  JoinResponse,
  ReconnectResponse,
  ConnectRequest,
} from '../protocol/types';

const log = getLogger('SignalClient');

/** Hard cap on signalling HTTP requests so a stalled server cannot hang joins. */
const SIGNAL_TIMEOUT_MS = 10_000;

/**
 * Append a fixed API path to the user-supplied server URL. Uses URL parsing
 * instead of string concatenation so an existing path prefix, query string or
 * hash on the base URL is preserved.
 */
function endpointFor(baseUrl: string, path: string): string {
  const u = new URL(baseUrl);
  u.pathname = `${u.pathname.replace(/\/+$/, '')}${path}`;
  return u.toString();
}

export interface JoinResult {
  response: JoinResponse | ReconnectResponse;
  logId: string;
}

export function isReconnectResponse(resp: any): resp is ReconnectResponse {
  return resp && 'iceParameters' in resp && !('participant' in resp) && !resp.fullReconnect;
}

export class SignalClient {
  private nodeId = '';
  private logId = '';

  get currentNodeId(): string {
    return this.nodeId;
  }

  get currentLogId(): string {
    return this.logId;
  }

  async join(url: string, request: JoinRequest): Promise<JoinResult> {
    const endpoint = endpointFor(url, '/rtc/join');
    log.info(`Joining room at ${endpoint}`);

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ payload: JSON.stringify(request) }),
      signal: AbortSignal.timeout(SIGNAL_TIMEOUT_MS),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new ConnectionError(
        `Join failed: ${resp.status} ${resp.statusText} ${text}`,
        resp.status,
      );
    }

    const response = (await resp.json()) as JoinResponse | ReconnectResponse;

    this.logId = resp.headers.get('X-Log-Id') ?? '';

    if (isReconnectResponse(response)) {
      log.info('Received ICE restart response');
    } else {
      this.nodeId = response.serverInfo.nodeId;
      log.info(`Joined room ${response.room.name}, nodeId=${this.nodeId}`);
    }

    return { response, logId: this.logId };
  }

  async connect(url: string, request: ConnectRequest): Promise<void> {
    const endpoint = endpointFor(url, '/rtc/connect');
    log.info(`Connecting transports at ${endpoint}`);

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ payload: JSON.stringify(request) }),
      signal: AbortSignal.timeout(SIGNAL_TIMEOUT_MS),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new ConnectionError(
        `Connect failed: ${resp.status} ${resp.statusText} ${text}`,
        resp.status,
      );
    }

    log.info('Transport connect succeeded');
  }
}
