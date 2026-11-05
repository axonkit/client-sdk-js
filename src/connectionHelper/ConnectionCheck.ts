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
      await this.acquireAndReleaseTracks({ audio: true }, 'audio');
    });
  }

  async checkPublishVideo(): Promise<CheckInfo> {
    return this.runCheck('publish-video', 'Check video publishing capability', async () => {
      await this.acquireAndReleaseTracks({ video: true }, 'video');
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

  /**
   * Acquires devices with a timeout. A permission prompt that is never
   * answered would otherwise hang the check forever; if the acquisition
   * resolves after the timeout, the tracks are still released.
   */
  private async acquireAndReleaseTracks(
    constraints: MediaStreamConstraints,
    label: string,
  ): Promise<void> {
    const streamPromise = navigator.mediaDevices.getUserMedia(constraints);
    let timedOut = false;
    // Release the mic/camera even when we stop waiting for the promise.
    streamPromise
      .then((s) => {
        if (timedOut) s.getTracks().forEach((t) => t.stop());
      })
      .catch(() => {});
    try {
      const stream = await this.withTimeout(streamPromise, 15_000, `getUserMedia(${label})`);
      stream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      timedOut = true;
      throw err;
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]).finally(() => clearTimeout(timer!));
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
