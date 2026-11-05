import * as mediasoupClient from 'mediasoup-client';
import { types as mediasoupTypes } from 'mediasoup-client';
import { TypedEmitter } from '../utils/typedEmitter';
import { getLogger } from '../utils/logger';
import { SignalClient } from '../signal/SignalClient';
import type {
  JoinResponse,
  ConnectRequest,
  TransportConnectInfo,
  DtlsFingerprint,
  IceParameters,
} from '../protocol/types';

const log = getLogger('TransportManager');

/** Grace period before a 'disconnected' ICE state is treated as a failure.
 *  Transient disconnects self-heal as ICE restarts on its own; triggering a
 *  full reconnect for them would tear down a recoverable session. */
const DISCONNECTED_GRACE_MS = 5_000;

export type ProduceCallback = (
  params: {
    kind: mediasoupTypes.MediaKind;
    rtpParameters: mediasoupTypes.RtpParameters;
    appData: Record<string, unknown>;
  },
  callback: (response: { id: string }) => void,
  errback: (error: Error) => void,
) => void;

export type ProduceDataCallback = (
  params: {
    sctpStreamParameters: mediasoupTypes.SctpStreamParameters;
    label?: string;
    protocol?: string;
    appData: Record<string, unknown>;
  },
  callback: (response: { id: string }) => void,
  errback: (error: Error) => void,
) => void;

export type TransportEvents = {
  signalReady: (sendDC: mediasoupTypes.DataProducer, recvDC: mediasoupTypes.DataConsumer) => void;
  connectionFailed: (direction: 'send' | 'recv') => void;
  closed: () => void;
};

export class TransportManager extends TypedEmitter<TransportEvents> {
  device: mediasoupClient.Device;
  sendTransport: mediasoupTypes.Transport | null = null;
  recvTransport: mediasoupTypes.Transport | null = null;
  signalDataProducer: mediasoupTypes.DataProducer | null = null;
  signalDataConsumer: mediasoupTypes.DataConsumer | null = null;

  private url = '';
  private signalClient: SignalClient;
  private hasDtlsFingerprints = false;
  private joinResponse: JoinResponse | null = null;
  private certificate: RTCCertificate | null = null;
  private pendingProduceCallbacks = new Map<string, ProduceCallback>();
  private pendingProduceDataCallbacks = new Map<string, ProduceDataCallback>();
  private disconnectedGraceTimers = new Map<'send' | 'recv', ReturnType<typeof setTimeout>>();
  /** Transport connect entries awaiting submission, keyed by transport SID. */
  private pendingConnects = new Map<string, TransportConnectInfo>();
  private connectFlushPromise?: Promise<void>;

  constructor(signalClient: SignalClient) {
    super();
    this.device = new mediasoupClient.Device();
    this.signalClient = signalClient;
  }

  registerProduceCallback(clientTrackId: string, cb: ProduceCallback): void {
    this.pendingProduceCallbacks.set(clientTrackId, cb);
  }

  registerProduceDataCallback(clientTrackId: string, cb: ProduceDataCallback): void {
    this.pendingProduceDataCallbacks.set(clientTrackId, cb);
  }

  async generateCertificate(): Promise<DtlsFingerprint[]> {
    try {
      const cert = await RTCPeerConnection.generateCertificate({
        name: 'ECDSA',
        namedCurve: 'P-256',
      } as EcKeyGenParams);
      this.certificate = cert;

      const fingerprints: DtlsFingerprint[] = cert.getFingerprints().map((fp) => ({
        algorithm: fp.algorithm ?? '',
        value: fp.value?.toUpperCase() ?? '',
      }));
      log.info(`Generated certificate with ${fingerprints.length} fingerprint(s)`);
      return fingerprints;
    } catch (err) {
      log.warn('Failed to generate certificate, falling back to auto-generated', err);
      return [];
    }
  }

  getCertificate(): RTCCertificate | null {
    return this.certificate;
  }

  /** Used when replacing TransportManager (full reconnect) so DTLS matches join fingerprints. */
  setCertificate(cert: RTCCertificate | null): void {
    this.certificate = cert;
  }

  getDtlsFingerprints(): DtlsFingerprint[] {
    if (!this.certificate) return [];
    return this.certificate.getFingerprints().map((fp) => ({
      algorithm: fp.algorithm ?? '',
      value: fp.value?.toUpperCase() ?? '',
    }));
  }

  async setup(
    url: string,
    joinResponse: JoinResponse,
    hasDtlsFingerprints: boolean,
    rtcConfig?: RTCConfiguration,
  ): Promise<void> {
    this.url = url;
    this.joinResponse = joinResponse;
    this.hasDtlsFingerprints = hasDtlsFingerprints;

    // 1. Load router RTP capabilities
    if (!this.device.loaded) {
      await this.device.load({
        routerRtpCapabilities: joinResponse.rtpCapabilities,
      });
      log.info('Device loaded with RTP capabilities');
    }

    // Build additionalSettings by layering: certificate -> server iceTransportPolicy -> user rtcConfig
    const additionalSettings: Partial<RTCConfiguration> = {};
    if (this.certificate) {
      additionalSettings.certificates = [this.certificate];
    }
    if (joinResponse.iceTransportPolicy) {
      additionalSettings.iceTransportPolicy = joinResponse.iceTransportPolicy;
    }
    if (rtcConfig) {
      Object.assign(additionalSettings, rtcConfig);
    }

    // 2. Create send transport
    this.sendTransport = this.device.createSendTransport({
      id: joinResponse.sendTransport.sid,
      iceParameters: joinResponse.sendTransport.iceParameters as mediasoupTypes.IceParameters,
      iceCandidates: joinResponse.sendTransport
        .iceCandidates as unknown as mediasoupTypes.IceCandidate[],
      dtlsParameters: joinResponse.sendTransport
        .dtlsParameters as unknown as mediasoupTypes.DtlsParameters,
      sctpParameters: joinResponse.sendTransport
        .sctpParameters as unknown as mediasoupTypes.SctpParameters,
      iceServers: joinResponse.iceServers,
      additionalSettings,
    });
    log.info(`Send transport created: ${this.sendTransport.id}`);

    // 3. Create recv transport
    this.recvTransport = this.device.createRecvTransport({
      id: joinResponse.receiveTransport.sid,
      iceParameters: joinResponse.receiveTransport.iceParameters as mediasoupTypes.IceParameters,
      iceCandidates: joinResponse.receiveTransport
        .iceCandidates as unknown as mediasoupTypes.IceCandidate[],
      dtlsParameters: joinResponse.receiveTransport
        .dtlsParameters as unknown as mediasoupTypes.DtlsParameters,
      sctpParameters: joinResponse.receiveTransport
        .sctpParameters as unknown as mediasoupTypes.SctpParameters,
      iceServers: joinResponse.iceServers,
      additionalSettings,
    });
    log.info(`Recv transport created: ${this.recvTransport.id}`);

    this.setupTransportEvents();
    await this.setupSignalChannels(joinResponse);
  }

  async restartIce(iceParamsMap: Record<string, IceParameters>): Promise<void> {
    if (this.sendTransport) {
      const params = iceParamsMap[this.sendTransport.id];
      if (params) {
        await this.sendTransport.restartIce({
          iceParameters: params as mediasoupTypes.IceParameters,
        });
        log.info(`ICE restarted on send transport ${this.sendTransport.id}`);
      }
    }
    if (this.recvTransport) {
      const params = iceParamsMap[this.recvTransport.id];
      if (params) {
        await this.recvTransport.restartIce({
          iceParameters: params as mediasoupTypes.IceParameters,
        });
        log.info(`ICE restarted on recv transport ${this.recvTransport.id}`);
      }
    }
  }

  /**
   * Returns WebRTC stats for the send and/or receive transports.
   */
  async getStats(): Promise<{
    send?: RTCStatsReport;
    recv?: RTCStatsReport;
  }> {
    const [send, recv] = await Promise.all([
      this.sendTransport?.getStats(),
      this.recvTransport?.getStats(),
    ]);
    return { send: send ?? undefined, recv: recv ?? undefined };
  }

  close(): void {
    if (!this.sendTransport && !this.recvTransport) return;

    for (const [, timer] of this.disconnectedGraceTimers) {
      clearTimeout(timer);
    }
    this.disconnectedGraceTimers.clear();
    // Pending produce callbacks hold closures over tracks/options; drop them
    // so they cannot leak (and never fire) after teardown.
    this.pendingProduceCallbacks.clear();
    this.pendingProduceDataCallbacks.clear();

    this.signalDataProducer?.close();
    this.signalDataConsumer?.close();
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.signalDataProducer = null;
    this.signalDataConsumer = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.emit('closed');
    log.info('Transport manager closed');
  }

  private setupTransportEvents(): void {
    // --- Send transport events ---
    this.sendTransport!.on('connect', ({ dtlsParameters }, callback, errback) => {
      if (this.hasDtlsFingerprints) {
        // Server already knows our DTLS params from JoinRequest
        callback();
        return;
      }
      this.enqueueConnect({
        transportSid: this.sendTransport!.id,
        dtlsParameters: dtlsParameters as any,
      })
        .then(() => callback())
        .catch(errback);
    });

    this.sendTransport!.on('produce', (params, callback, errback) => {
      const clientTrackId = params.appData?.clientTrackId as string | undefined;
      if (clientTrackId) {
        const cb = this.pendingProduceCallbacks.get(clientTrackId);
        if (cb) {
          this.pendingProduceCallbacks.delete(clientTrackId);
          cb(params as any, callback, errback);
          return;
        }
      }
      log.warn('Unhandled produce event, no matching clientTrackId callback');
      errback(new Error('No produce callback registered for this track'));
    });

    this.sendTransport!.on('producedata', (params, callback, errback) => {
      if (params.label === this.joinResponse?.signal.send.label) {
        callback({ id: this.joinResponse!.signal.send.channelSid });
        return;
      }
      const clientTrackId = (params.appData as Record<string, unknown>)?.clientTrackId as
        | string
        | undefined;
      if (clientTrackId) {
        const cb = this.pendingProduceDataCallbacks.get(clientTrackId);
        if (cb) {
          this.pendingProduceDataCallbacks.delete(clientTrackId);
          cb(params as any, callback, errback);
          return;
        }
      }
      log.warn('Unhandled producedata event, no matching callback');
      errback(new Error('No producedata callback registered'));
    });

    this.sendTransport!.on('connectionstatechange', (state: string) => {
      this.handleTransportStateChange('send', state);
    });

    // --- Recv transport events ---
    this.recvTransport!.on('connect', ({ dtlsParameters }, callback, errback) => {
      if (this.hasDtlsFingerprints) {
        callback();
        return;
      }
      this.enqueueConnect({
        transportSid: this.recvTransport!.id,
        dtlsParameters: dtlsParameters as any,
      })
        .then(() => callback())
        .catch(errback);
    });

    this.recvTransport!.on('connectionstatechange', (state: string) => {
      this.handleTransportStateChange('recv', state);
    });
  }

  private handleTransportStateChange(direction: 'send' | 'recv', state: string): void {
    log.info(`${direction} transport connection state: ${state}`);

    if (state === 'failed') {
      this.clearDisconnectGrace(direction);
      this.emit('connectionFailed', direction);
      return;
    }

    if (state === 'disconnected') {
      // Only escalate after a grace period: transient disconnects are common
      // (network switches, NAT rebinding) and ICE usually recovers by itself.
      if (this.disconnectedGraceTimers.has(direction)) return;
      const timer = setTimeout(() => {
        this.disconnectedGraceTimers.delete(direction);
        const transport = direction === 'send' ? this.sendTransport : this.recvTransport;
        const current = transport?.connectionState;
        if (current === 'disconnected' || current === 'failed') {
          this.emit('connectionFailed', direction);
        }
      }, DISCONNECTED_GRACE_MS);
      this.disconnectedGraceTimers.set(direction, timer);
      return;
    }

    // connected / completed / checking / new — cancel any pending escalation.
    this.clearDisconnectGrace(direction);
  }

  private clearDisconnectGrace(direction: 'send' | 'recv'): void {
    const timer = this.disconnectedGraceTimers.get(direction);
    if (timer) {
      clearTimeout(timer);
      this.disconnectedGraceTimers.delete(direction);
    }
  }

  /**
   * Queues a transport-connect entry keyed by transport SID and flushes the
   * queue. Deduplicating by SID plus draining in a loop guarantees each
   * transport is submitted to the server exactly once even when send and recv
   * 'connect' events fire concurrently.
   */
  private enqueueConnect(info: TransportConnectInfo): Promise<void> {
    this.pendingConnects.set(info.transportSid, info);
    if (this.connectFlushPromise) return this.connectFlushPromise;

    const run = async (): Promise<void> => {
      while (this.pendingConnects.size > 0) {
        const transports = [...this.pendingConnects.values()];
        this.pendingConnects.clear();
        await this.connectTransports(transports);
      }
    };
    this.connectFlushPromise = run().finally(() => {
      this.connectFlushPromise = undefined;
    });
    return this.connectFlushPromise;
  }

  private async connectTransports(transports: TransportConnectInfo[]): Promise<void> {
    if (!this.joinResponse) return;

    const request: ConnectRequest = {
      nodeId: this.signalClient.currentNodeId,
      participantSid: this.joinResponse.participant.sid,
      transports,
    };

    await this.signalClient.connect(this.url, request, this.joinResponse.room?.name);
  }

  private async setupSignalChannels(jr: JoinResponse): Promise<void> {
    // Receive direction: consume data on recv transport
    this.signalDataConsumer = await this.recvTransport!.consumeData({
      id: jr.signal.receive.channelSid,
      dataProducerId: jr.signal.receive.dataSourceSid,
      sctpStreamParameters: jr.signal.receive.sctpStreamParameters as any,
      label: jr.signal.receive.label,
      protocol: jr.signal.receive.protocol,
    });
    log.info('Signal receive DataChannel established');

    // Send direction: produce data on send transport
    const produceDataOptions: any = {
      sctpStreamParameters: jr.signal.send.sctpStreamParameters,
      label: jr.signal.send.label,
      protocol: jr.signal.send.protocol,
    };
    this.signalDataProducer = await this.sendTransport!.produceData(produceDataOptions);
    log.info('Signal send DataChannel established');

    await Promise.all([
      this.waitForDataChannelOpen(this.signalDataProducer, 'signalDataProducer'),
      this.waitForDataChannelOpen(this.signalDataConsumer, 'signalDataConsumer'),
    ]);

    this.emit('signalReady', this.signalDataProducer, this.signalDataConsumer);
  }

  private static readonly DC_OPEN_TIMEOUT = 10_000;

  private waitForDataChannelOpen(
    dc: mediasoupTypes.DataProducer | mediasoupTypes.DataConsumer,
    label: string,
  ): Promise<void> {
    const state = dc.readyState;
    if (state === 'open') {
      return Promise.resolve();
    }
    if (state === 'closed' || state === 'closing') {
      return Promise.reject(new Error(`${label} is already ${state}`));
    }

    // Cast to access the common on/off('open'|'close'|'error') shared by both types
    const emitter = dc as mediasoupTypes.EnhancedEventEmitter;

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`${label} open timed out after ${TransportManager.DC_OPEN_TIMEOUT}ms`));
      }, TransportManager.DC_OPEN_TIMEOUT);

      const cleanup = () => {
        clearTimeout(timer);
        emitter.off('open', onOpen);
        emitter.off('close', onClose);
        emitter.off('error', onError);
      };

      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onClose = () => {
        cleanup();
        reject(new Error(`${label} closed before opening`));
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      emitter.on('open', onOpen);
      emitter.on('close', onClose);
      emitter.on('error', onError);
    });
  }
}
