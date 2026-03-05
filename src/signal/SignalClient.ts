import { getLogger } from '../utils/logger';
import { ConnectionError } from '../protocol/errors';
import type { JoinRequest, JoinResponse, ConnectRequest } from '../protocol/types';

const log = getLogger('SignalClient');

export interface JoinResult {
  response: JoinResponse;
  nodeId: string;
  logId: string;
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

  async join(url: string, token: string, request: JoinRequest): Promise<JoinResult> {
    const endpoint = `${url}/rtc/join`;
    log.info(`Joining room at ${endpoint}`);

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(request),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new ConnectionError(
        `Join failed: ${resp.status} ${resp.statusText} ${text}`,
        resp.status,
      );
    }

    this.nodeId = resp.headers.get('X-Node-Id') ?? '';
    this.logId = resp.headers.get('X-Log-Id') ?? '';

    const response = (await resp.json()) as JoinResponse;

    log.info(`Joined room ${response.room.name}, nodeId=${this.nodeId}`);
    return { response, nodeId: this.nodeId, logId: this.logId };
  }

  async connect(url: string, request: ConnectRequest): Promise<void> {
    const endpoint = `${url}/rtc/connect`;
    log.info(`Connecting transports at ${endpoint}`);

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
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
