import * as mediasoupClient from 'mediasoup-client';
import { types as mediasoupTypes } from 'mediasoup-client';
import { TypedEventEmitter } from '../utils/events';
import { getLogger } from '../utils/logger';
import { SignalClient } from '../signal/SignalClient';
import type {
  JoinResponse,
  ConnectRequest,
  TransportConnectInfo,
} from '../protocol/types';

const log = getLogger('TransportManager');

export interface TransportEvents {
  signalReady: (
    sendDC: mediasoupTypes.DataProducer,
    recvDC: mediasoupTypes.DataConsumer,
  ) => void;
  produce: (
    params: {
      kind: mediasoupTypes.MediaKind;
      rtpParameters: mediasoupTypes.RtpParameters;
      appData: Record<string, unknown>;
    },
    callback: (response: { id: string }) => void,
    errback: (error: Error) => void,
  ) => void;
  closed: () => void;
}

export class TransportManager extends TypedEventEmitter<TransportEvents> {
  device: mediasoupClient.Device;
  sendTransport: mediasoupTypes.Transport | null = null;
  recvTransport: mediasoupTypes.Transport | null = null;
  signalDataProducer: mediasoupTypes.DataProducer | null = null;
  signalDataConsumer: mediasoupTypes.DataConsumer | null = null;

  private url = '';
  private signalClient: SignalClient;
  private hasDtlsFingerprints = false;
  private joinResponse: JoinResponse | null = null;

  constructor(signalClient: SignalClient) {
    super();
    this.device = new mediasoupClient.Device();
    this.signalClient = signalClient;
  }

  async setup(
    url: string,
    joinResponse: JoinResponse,
    hasDtlsFingerprints: boolean,
  ): Promise<void> {
    this.url = url;
    this.joinResponse = joinResponse;
    this.hasDtlsFingerprints = hasDtlsFingerprints;

    // 1. Load router RTP capabilities
    await this.device.load({
      routerRtpCapabilities: joinResponse.rtpCapabilities,
    });
    log.info('Device loaded with RTP capabilities');

    // 2. Create send transport
    this.sendTransport = this.device.createSendTransport({
      id: joinResponse.sendTransport.sid,
      iceParameters: joinResponse.sendTransport.iceParameters as mediasoupTypes.IceParameters,
      iceCandidates: joinResponse.sendTransport.iceCandidates as unknown as mediasoupTypes.IceCandidate[],
      dtlsParameters: joinResponse.sendTransport.dtlsParameters as unknown as mediasoupTypes.DtlsParameters,
      sctpParameters: joinResponse.sendTransport.sctpParameters as unknown as mediasoupTypes.SctpParameters,
      iceServers: [],
    });
    log.info(`Send transport created: ${this.sendTransport.id}`);

    // 3. Create recv transport
    this.recvTransport = this.device.createRecvTransport({
      id: joinResponse.receiveTransport.sid,
      iceParameters: joinResponse.receiveTransport.iceParameters as mediasoupTypes.IceParameters,
      iceCandidates: joinResponse.receiveTransport.iceCandidates as unknown as mediasoupTypes.IceCandidate[],
      dtlsParameters: joinResponse.receiveTransport.dtlsParameters as unknown as mediasoupTypes.DtlsParameters,
      sctpParameters: joinResponse.receiveTransport.sctpParameters as unknown as mediasoupTypes.SctpParameters,
      iceServers: [],
    });
    log.info(`Recv transport created: ${this.recvTransport.id}`);

    this.setupTransportEvents();

    // 5. Establish signal DataChannels
    await this.setupSignalChannels(joinResponse);
  }

  async close(): Promise<void> {
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
    const pendingConnects: TransportConnectInfo[] = [];

    // --- Send transport events ---
    this.sendTransport!.on('connect', ({ dtlsParameters }, callback, errback) => {
      if (this.hasDtlsFingerprints) {
        // Server already knows our DTLS params from JoinRequest
        callback();
        return;
      }
      pendingConnects.push({
        transportSid: this.sendTransport!.id,
        dtlsParameters: dtlsParameters as any,
      });
      this.connectTransports(pendingConnects)
        .then(() => callback())
        .catch(errback);
    });

    this.sendTransport!.on('produce', (params, callback, errback) => {
      this.emit('produce', params as any, callback, errback);
    });

    this.sendTransport!.on(
      'producedata',
      (params, callback, _errback) => {
        // For signal DataChannel, use the info from JoinResponse directly
        if (params.label === this.joinResponse?.signal.send.label) {
          callback({ id: this.joinResponse!.signal.send.channelSid });
          return;
        }
        // For user data channels, emit event for Room to handle
        callback({ id: params.label ?? '' });
      },
    );

    // --- Recv transport events ---
    this.recvTransport!.on('connect', ({ dtlsParameters }, callback, errback) => {
      if (this.hasDtlsFingerprints) {
        callback();
        return;
      }
      pendingConnects.push({
        transportSid: this.recvTransport!.id,
        dtlsParameters: dtlsParameters as any,
      });
      this.connectTransports(pendingConnects)
        .then(() => callback())
        .catch(errback);
    });
  }

  private async connectTransports(transports: TransportConnectInfo[]): Promise<void> {
    if (!this.joinResponse) return;

    const request: ConnectRequest = {
      nodeId: this.signalClient.currentNodeId,
      participantSid: this.joinResponse.participant.sid,
      transports,
    };

    await this.signalClient.connect(this.url, request);
    transports.length = 0;
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

    this.emit('signalReady', this.signalDataProducer, this.signalDataConsumer);
  }
}
