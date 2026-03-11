import { TypedEmitter } from '../utils/typedEmitter';

export enum CheckStatus {
  Idle = 'idle',
  Running = 'running',
  Success = 'success',
  Failed = 'failed',
  Skipped = 'skipped',
}

export interface CheckInfo {
  name: string;
  status: CheckStatus;
  description: string;
  duration?: number;
  error?: string;
}

type ConnectionCheckEvents = {
  statusChanged: (info: CheckInfo) => void;
};

/**
 * Runs a series of connectivity checks against a given server URL.
 * Useful for diagnosing connection problems before entering a room.
 */
export class ConnectionCheck extends TypedEmitter<ConnectionCheckEvents> {
  private url: string;

  constructor(url: string) {
    super();
    this.url = url;
  }

  async checkSignalConnectivity(): Promise<CheckInfo> {
    return this.runCheck(
      'signal-connectivity',
      'Check signalling server reachability',
      async () => {
        const resp = await fetch(this.url, {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok && resp.status !== 405) {
          throw new Error(`Signal server returned ${resp.status}`);
        }
      },
    );
  }

  async checkWebRTC(): Promise<CheckInfo> {
    return this.runCheck('webrtc', 'Check WebRTC peer connection', async () => {
      const pc = new RTCPeerConnection();
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
      } finally {
        pc.close();
      }
    });
  }

  async checkPublishAudio(): Promise<CheckInfo> {
    return this.runCheck('publish-audio', 'Check audio publishing capability', async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const t of stream.getTracks()) t.stop();
    });
  }

  async checkPublishVideo(): Promise<CheckInfo> {
    return this.runCheck('publish-video', 'Check video publishing capability', async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      for (const t of stream.getTracks()) t.stop();
    });
  }

  async checkAll(): Promise<CheckInfo[]> {
    const results: CheckInfo[] = [];
    results.push(await this.checkSignalConnectivity());
    results.push(await this.checkWebRTC());
    results.push(await this.checkPublishAudio());
    results.push(await this.checkPublishVideo());
    return results;
  }

  private async runCheck(
    name: string,
    description: string,
    fn: () => Promise<void>,
  ): Promise<CheckInfo> {
    const info: CheckInfo = { name, status: CheckStatus.Running, description };
    this.emit('statusChanged', info);
    const start = Date.now();
    try {
      await fn();
      info.status = CheckStatus.Success;
      info.duration = Date.now() - start;
    } catch (e) {
      info.status = CheckStatus.Failed;
      info.error = e instanceof Error ? e.message : String(e);
      info.duration = Date.now() - start;
    }
    this.emit('statusChanged', info);
    return info;
  }
}
