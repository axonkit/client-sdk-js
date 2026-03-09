import { getLogger } from '../utils/logger';
import { ConnectionError } from '../protocol/errors';
import type { JoinRequest, JoinResponse, ReconnectResponse, ConnectRequest } from '../protocol/types';

const log = getLogger('SignalClient');

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
    const u = new URL(`${url}/rtc/join`);
    if (request.room.name) {
      u.searchParams.set('room', request.room.name);
    }
    const endpoint = u.toString();
    log.info(`Joining room at ${endpoint}`);

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ payload: JSON.stringify(request) }),
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

  async connect(url: string, request: ConnectRequest, roomName?: string): Promise<void> {
    const u = new URL(`${url}/rtc/connect`);
    if (roomName) {
      u.searchParams.set('room', roomName);
    }
    const endpoint = u.toString();
    log.info(`Connecting transports at ${endpoint}`);

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ payload: JSON.stringify(request) }),
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
