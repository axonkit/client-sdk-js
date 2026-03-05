import { getLogger } from '../utils/logger';
import { ConnectionError } from '../protocol/errors';
import type { JoinRequest, JoinResponse, ConnectRequest } from '../protocol/types';

const log = getLogger('SignalClient');

export interface JoinResult {
  response: JoinResponse;
  logId: string;
}

export class SignalClient {
  private nodeId = '';
  private logId = '';
  private token = '';

  get currentNodeId(): string {
    return this.nodeId;
  }

  get currentLogId(): string {
    return this.logId;
  }

  async join(url: string, token: string, request: JoinRequest): Promise<JoinResult> {
    const endpoint = `${url}/rtc/join`;
    log.info(`Joining room at ${endpoint}`);

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
    if (this.nodeId) {
      headers['X-Node-Id'] = this.nodeId;
    }

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new ConnectionError(
        `Join failed: ${resp.status} ${resp.statusText} ${text}`,
        resp.status,
      );
    }

    const response = (await resp.json()) as JoinResponse;

    this.nodeId = response.serverInfo.nodeId;
    this.logId = resp.headers.get('X-Log-Id') ?? '';
    this.token = token;

    log.info(`Joined room ${response.room.name}, nodeId=${this.nodeId}`);
    return { response, logId: this.logId };
  }

  async connect(url: string, request: ConnectRequest): Promise<void> {
    const endpoint = `${url}/rtc/connect`;
    log.info(`Connecting transports at ${endpoint}`);

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
        'X-Node-Id': this.nodeId,
      },
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
