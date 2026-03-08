import { types as mediasoupTypes } from 'mediasoup-client';
import { Participant, TrackPublication } from './Participant';
import { LocalTrackPublication } from './LocalTrackPublication';
import { LocalTrack } from '../track/LocalTrack';
import { LocalAudioTrack } from '../track/LocalAudioTrack';
import { LocalVideoTrack } from '../track/LocalVideoTrack';
import { createLocalAudioTrack, createLocalVideoTrack, createLocalScreenTracks } from '../track/create';
import { RPCClient } from '../signal/RPCClient';
import { TransportManager } from '../transport/TransportManager';
import { TrackKind, TrackSource } from '../protocol/types';
import type {
  TrackPublishRequest,
  TrackPublishResponse,
  DataTrackPublishRequest,
  DataTrackPublishResponse,
} from '../protocol/types';
import type { TrackPublishOptions, DataPublishOptions, AudioCaptureOptions, VideoCaptureOptions, ScreenShareCaptureOptions, PublishCodecOptions } from '../track/options';
import { ParticipantEvent } from '../events';
import { getLogger } from '../utils/logger';
import { generateLogId } from '../utils/id';
import type { ChatMessage, SendTextOptions, StreamTextOptions, StreamBytesOptions, SendFileOptions, PerformRpcParams, RpcInvocationData } from '../types';
import { DataStreamSender, TextStreamWriter, ByteStreamWriter } from '../data-stream/DataStreamManager';
import { RpcError, byteLength, MAX_RPC_PAYLOAD_BYTES } from '../rpc';

const log = getLogger('LocalParticipant');

export class LocalParticipant extends Participant {
  private rpc!: RPCClient;
  private transportManager!: TransportManager;
  private producers = new Map<string, mediasoupTypes.Producer>();
  private dataProducers = new Map<string, mediasoupTypes.DataProducer>();
  private trackSidMap = new Map<string, string>();
  private dataStreamSender?: DataStreamSender;

  private _lastCameraError?: Error;
  private _lastMicrophoneError?: Error;

  /** @internal RPC handlers registered by the user for P2P RPC. */
  rpcHandlers = new Map<string, (data: RpcInvocationData) => Promise<string>>();
  /** @internal Pending RPC responses waiting for a reply. */
  pendingRpcResponses = new Map<string, {
    resolve: (payload: string) => void;
    reject: (error: RpcError) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  /** @internal */
  init(rpc: RPCClient, transportManager: TransportManager): void {
    this.rpc = rpc;
    this.transportManager = transportManager;
    this.dataStreamSender = new DataStreamSender(rpc, transportManager);
  }

  /** @internal */
  getProducers(): ReadonlyMap<string, mediasoupTypes.Producer> {
    return this.producers;
  }

  /** @internal */
  getDataProducers(): ReadonlyMap<string, mediasoupTypes.DataProducer> {
    return this.dataProducers;
  }

  /** Last error encountered while creating a camera track. */
  get lastCameraError(): Error | undefined {
    return this._lastCameraError;
  }

  /** Last error encountered while creating a microphone track. */
  get lastMicrophoneError(): Error | undefined {
    return this._lastMicrophoneError;
  }

  async setCameraEnabled(
    enabled: boolean,
    captureOptions?: VideoCaptureOptions,
    publishOptions?: TrackPublishOptions,
  ): Promise<TrackPublication | undefined> {
    if (enabled) {
      try {
        const track = await createLocalVideoTrack(captureOptions);
        return await this.publishTrack(track, { ...publishOptions, source: TrackSource.Camera });
      } catch (e) {
        this._lastCameraError = e instanceof Error ? e : new Error(String(e));
        throw e;
      }
    } else {
      const pub = this.getTrackPublication(TrackSource.Camera);
      if (pub?.track) {
        await this.unpublishTrack(pub.track as LocalTrack);
      }
      return pub;
    }
  }

  async setMicrophoneEnabled(
    enabled: boolean,
    captureOptions?: AudioCaptureOptions,
    publishOptions?: TrackPublishOptions,
  ): Promise<TrackPublication | undefined> {
    if (enabled) {
      try {
        const track = await createLocalAudioTrack(captureOptions);
        return await this.publishTrack(track, { ...publishOptions, source: TrackSource.Microphone });
      } catch (e) {
        this._lastMicrophoneError = e instanceof Error ? e : new Error(String(e));
        throw e;
      }
    } else {
      const pub = this.getTrackPublication(TrackSource.Microphone);
      if (pub?.track) {
        await this.unpublishTrack(pub.track as LocalTrack);
      }
      return pub;
    }
  }

  async setScreenShareEnabled(
    enabled: boolean,
    captureOptions?: ScreenShareCaptureOptions,
    publishOptions?: TrackPublishOptions,
  ): Promise<TrackPublication | undefined> {
    if (enabled) {
      const tracks = await createLocalScreenTracks(captureOptions);
      let pub: TrackPublication | undefined;
      for (const t of tracks) {
        pub = await this.publishTrack(t, { ...publishOptions, source: t.source });
      }
      return pub;
    } else {
      const pub = this.getTrackPublication(TrackSource.ScreenShare);
      if (pub?.track) {
        await this.unpublishTrack(pub.track as LocalTrack);
      }
      const audioPub = this.getTrackPublication(TrackSource.ScreenShareAudio);
      if (audioPub?.track) {
        await this.unpublishTrack(audioPub.track as LocalTrack);
      }
      return pub;
    }
  }

  /**
   * Enable both camera and microphone simultaneously.
   * More efficient than calling `setCameraEnabled` and `setMicrophoneEnabled`
   * separately because it batches the device request.
   */
  async enableCameraAndMicrophone(
    captureOptions?: { audio?: AudioCaptureOptions; video?: VideoCaptureOptions },
    publishOptions?: TrackPublishOptions,
  ): Promise<void> {
    const [audioTrack, videoTrack] = await Promise.all([
      createLocalAudioTrack(captureOptions?.audio).catch((e) => {
        this._lastMicrophoneError = e instanceof Error ? e : new Error(String(e));
        log.warn('Failed to create audio track', e);
        return undefined;
      }),
      createLocalVideoTrack(captureOptions?.video).catch((e) => {
        this._lastCameraError = e instanceof Error ? e : new Error(String(e));
        log.warn('Failed to create video track', e);
        return undefined;
      }),
    ]);

    const results = await Promise.allSettled([
      audioTrack
        ? this.publishTrack(audioTrack, { ...publishOptions, source: TrackSource.Microphone })
        : Promise.resolve(),
      videoTrack
        ? this.publishTrack(videoTrack, { ...publishOptions, source: TrackSource.Camera })
        : Promise.resolve(),
    ]);

    for (const r of results) {
      if (r.status === 'rejected') {
        log.warn('Failed to publish track', r.reason);
      }
    }
  }

  async publishTrack(
    track: LocalTrack | MediaStreamTrack,
    options?: TrackPublishOptions,
  ): Promise<TrackPublication> {
    let localTrack: LocalTrack;

    if (track instanceof MediaStreamTrack) {
      const kind = track.kind === 'audio' ? TrackKind.Audio : TrackKind.Video;
      if (kind === TrackKind.Audio) {
        localTrack = new LocalAudioTrack(track);
      } else {
        localTrack = new LocalVideoTrack(track);
      }
    } else {
      localTrack = track;
    }

    if (options?.source) {
      localTrack.source = options.source;
    }

    const sendTransport = this.transportManager.sendTransport;
    if (!sendTransport) throw new Error('Send transport not available');

    const isVideo = localTrack.kind === TrackKind.Video;

    let encodings: mediasoupTypes.RtpEncodingParameters[] | undefined;
    if (isVideo && localTrack instanceof LocalVideoTrack) {
      if (options?.scalabilityMode) {
        const enc = options.videoEncoding;
        encodings = [{
          scalabilityMode: options.scalabilityMode,
          maxBitrate: enc?.maxBitrate,
          maxFramerate: enc?.maxFramerate,
        }];
      } else {
        if (options?.simulcast !== false) {
          localTrack.setSimulcast(true);
        }
        if (options?.videoEncoding) {
          localTrack.setEncoding(options.videoEncoding);
        }
        encodings = localTrack.getSimulcastEncodings();
      }
    }

    const codecOptions = this.buildCodecOptions(options);

    let codec: mediasoupTypes.RtpCodecCapability | undefined;
    if (isVideo && options?.videoCodec) {
      const mimeType = `video/${options.videoCodec}`;
      codec = this.transportManager.device.rtpCapabilities.codecs?.find(
        (c) => c.mimeType.toLowerCase() === mimeType,
      );
    }

    const clientTrackId = generateLogId();

    const producePromise = new Promise<string>((resolve, reject) => {
      this.transportManager.registerProduceCallback(clientTrackId, async (params, callback, errback) => {
        try {
          const req: TrackPublishRequest = {
            clientTrackId,
            name: options?.name ?? localTrack.name,
            kind: localTrack.kind,
            rtpParameters: params.rtpParameters,
            source: localTrack.source,
            muted: localTrack.isMuted,
          };

          if (isVideo && localTrack instanceof LocalVideoTrack) {
            const dim = localTrack.dimensions;
            if (dim) {
              req.width = dim.width;
              req.height = dim.height;
            }
          }

          const resp = await this.rpc.request<TrackPublishResponse>('track.publish', req);
          callback({ id: resp.trackSid });
          resolve(resp.trackSid);
        } catch (err) {
          errback(err instanceof Error ? err : new Error(String(err)));
          reject(err);
        }
      });
    });

    const producer = await sendTransport.produce({
      track: localTrack.mediaStreamTrack!,
      encodings,
      codecOptions,
      codec,
      stopTracks: options?.stopTracks,
      disableTrackOnPause: options?.disableTrackOnPause,
      zeroRtpOnPause: options?.zeroRtpOnPause,
      appData: { clientTrackId, source: localTrack.source },
    });

    const trackSid = await producePromise;
    localTrack.sid = trackSid;
    localTrack.producer = producer;

    this.producers.set(trackSid, producer);

    const publication = new LocalTrackPublication({
      trackSid,
      trackName: options?.name ?? localTrack.name,
      kind: localTrack.kind,
      source: localTrack.source,
      track: localTrack,
      muted: localTrack.isMuted,
      producer,
      rpc: this.rpc,
    });

    this.trackPublications.set(trackSid, publication);

    producer.observer.on('pause', () => {
      publication.muted = true;
      this.emit(ParticipantEvent.TrackMuted, publication);
    });

    producer.observer.on('resume', () => {
      publication.muted = false;
      this.emit(ParticipantEvent.TrackUnmuted, publication);
    });

    producer.observer.on('trackended', () => {
      log.info(`Track ${trackSid} ended, unpublishing`);
      this.unpublishTrack(localTrack).catch((err) => {
        log.warn(`Failed to auto-unpublish track ${trackSid}`, err);
      });
    });

    producer.on('transportclose', () => {
      log.info(`Transport closed for track ${trackSid}`);
      this.producers.delete(trackSid);
      this.trackPublications.delete(trackSid);
    });

    this.emit(ParticipantEvent.TrackPublished, publication);
    this.emit(ParticipantEvent.LocalTrackPublished, publication);
    log.info(`Published track ${trackSid} (${localTrack.kind}/${localTrack.source})`);

    return publication;
  }

  async unpublishTrack(track: LocalTrack | MediaStreamTrack): Promise<void> {
    let trackSid: string | undefined;

    if (track instanceof LocalTrack) {
      trackSid = track.sid;
    } else {
      for (const [sid, pub] of this.trackPublications) {
        if ((pub.track as LocalTrack)?.mediaStreamTrack === track) {
          trackSid = sid;
          break;
        }
      }
    }

    if (!trackSid) return;

    const producer = this.producers.get(trackSid);
    const publication = this.trackPublications.get(trackSid);

    try {
      await this.rpc.request('track.unpublish', { trackSid });
    } catch (err) {
      log.warn(`Failed to unpublish track ${trackSid}`, err);
    }

    producer?.close();
    this.producers.delete(trackSid);

    if (publication) {
      this.trackPublications.delete(trackSid);
      if (publication.track instanceof LocalTrack) {
        publication.track.stop();
      }
      this.emit(ParticipantEvent.TrackUnpublished, publication);
      this.emit(ParticipantEvent.LocalTrackUnpublished, publication);
    }

    log.info(`Unpublished track ${trackSid}`);
  }

  async publishData(data: Uint8Array, options?: DataPublishOptions): Promise<void> {
    const sendTransport = this.transportManager.sendTransport;
    if (!sendTransport) throw new Error('Send transport not available');

    const clientTrackId = generateLogId();

    const dataProducer = await sendTransport.produceData({
      ordered: options?.ordered ?? true,
      maxRetransmits: options?.maxRetransmits,
      maxPacketLifeTime: options?.maxPacketLifeTime,
      label: options?.label ?? 'data',
      protocol: '',
    });

    const req: DataTrackPublishRequest = {
      clientTrackId,
      transportSid: sendTransport.id,
      sctpStreamParameters: dataProducer.sctpStreamParameters as any,
      name: options?.name ?? 'data',
      label: options?.label ?? 'data',
      protocol: '',
    };

    const resp = await this.rpc.request<DataTrackPublishResponse>('dataTrack.publish', req);
    this.dataProducers.set(resp.dataTrackSid, dataProducer);

    dataProducer.send(data);
    log.info(`Published data track ${resp.dataTrackSid}`);
  }

  async updateMetadata(metadata: string): Promise<void> {
    await this.rpc.request('participant.update', { metadata });
    this.metadata = metadata;
  }

  async updateName(name: string): Promise<void> {
    await this.rpc.request('participant.update', { name });
    this.name = name;
  }

  async updateAttributes(attributes: Record<string, string>): Promise<void> {
    await this.rpc.request('participant.update', { attributes });
    this.attributes = { ...this.attributes, ...attributes };
  }

  // --- Chat Messages ---

  /**
   * Send a chat message to all participants in the room.
   */
  async sendChatMessage(text: string): Promise<ChatMessage> {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      message: text,
      timestamp: Date.now(),
    };
    this.rpc.notify('chat.message', msg);
    this.emit(ParticipantEvent.ChatMessage, msg);
    return msg;
  }

  /**
   * Edit a previously sent chat message.
   */
  async editChatMessage(editText: string, originalMessage: ChatMessage): Promise<ChatMessage> {
    const msg: ChatMessage = {
      ...originalMessage,
      message: editText,
      editTimestamp: Date.now(),
    };
    this.rpc.notify('chat.message', msg);
    this.emit(ParticipantEvent.ChatMessage, msg);
    return msg;
  }

  // --- Data Streams ---

  /**
   * Send a complete text message to participants via data stream.
   */
  async sendText(text: string, options?: SendTextOptions): Promise<{ id: string }> {
    if (!this.dataStreamSender) throw new Error('Not connected');
    return this.dataStreamSender.sendText(text, options);
  }

  /**
   * Open an incremental text stream to participants.
   * Returns a writer that can be used to send text chunks.
   */
  async streamText(options?: StreamTextOptions): Promise<TextStreamWriter> {
    if (!this.dataStreamSender) throw new Error('Not connected');
    return this.dataStreamSender.streamText(options);
  }

  /**
   * Send a file to participants via data stream.
   */
  async sendFile(file: File, options?: SendFileOptions): Promise<{ id: string }> {
    if (!this.dataStreamSender) throw new Error('Not connected');
    return this.dataStreamSender.sendFile(file, options);
  }

  /**
   * Open an incremental byte stream to participants.
   * Returns a writer that can be used to send byte chunks.
   */
  async streamBytes(options?: StreamBytesOptions): Promise<ByteStreamWriter> {
    if (!this.dataStreamSender) throw new Error('Not connected');
    return this.dataStreamSender.streamBytes(options);
  }

  // --- P2P RPC ---

  /**
   * Perform an RPC call to a specific remote participant.
   * The remote participant must have registered a handler for the method
   * via `room.registerRpcMethod`.
   *
   * @returns The response payload string.
   */
  async performRpc(params: PerformRpcParams): Promise<string> {
    const { destinationIdentity, method, payload, responseTimeout = 15000 } = params;

    if (byteLength(payload) > MAX_RPC_PAYLOAD_BYTES) {
      throw RpcError.builtIn('REQUEST_PAYLOAD_TOO_LARGE');
    }

    const requestId = crypto.randomUUID();

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRpcResponses.delete(requestId);
        reject(RpcError.builtIn('RESPONSE_TIMEOUT'));
      }, responseTimeout);

      this.pendingRpcResponses.set(requestId, { resolve, reject, timer });

      this.rpc.notify('rpc.request', {
        requestId,
        destinationIdentity,
        method,
        payload,
        responseTimeout,
        callerIdentity: this.identity,
      });
    });
  }

  /** @internal Handle an incoming RPC response relayed by the server. */
  handleRpcResponse(body: any): void {
    const pending = this.pendingRpcResponses.get(body.requestId);
    if (!pending) return;

    this.pendingRpcResponses.delete(body.requestId);
    clearTimeout(pending.timer);

    if (body.error) {
      pending.reject(new RpcError(body.error.code ?? 1500, body.error.message ?? 'Application error', body.error.data));
    } else {
      pending.resolve(body.payload ?? '');
    }
  }

  /** @internal Handle an incoming RPC invocation from a remote participant. */
  async handleRpcInvocation(body: any): Promise<void> {
    const handler = this.rpcHandlers.get(body.method);
    if (!handler) {
      this.rpc.notify('rpc.response', {
        requestId: body.requestId,
        callerIdentity: body.callerIdentity,
        error: { code: RpcError.ErrorCode.UNSUPPORTED_METHOD, message: 'Method not supported' },
      });
      return;
    }

    try {
      const result = await handler({
        requestId: body.requestId,
        callerIdentity: body.callerIdentity,
        payload: body.payload ?? '',
        responseTimeout: body.responseTimeout ?? 15000,
      });
      this.rpc.notify('rpc.response', {
        requestId: body.requestId,
        callerIdentity: body.callerIdentity,
        payload: result,
      });
    } catch (err) {
      const rpcErr = err instanceof RpcError
        ? err
        : new RpcError(RpcError.ErrorCode.APPLICATION_ERROR, err instanceof Error ? err.message : String(err));
      this.rpc.notify('rpc.response', {
        requestId: body.requestId,
        callerIdentity: body.callerIdentity,
        error: { code: rpcErr.code, message: rpcErr.message, data: rpcErr.data },
      });
    }
  }

  private buildCodecOptions(options?: TrackPublishOptions): PublishCodecOptions | undefined {
    const explicit = options?.codecOptions;
    const dtx = options?.dtx;
    const bitrate = options?.audioBitrate;
    if (!explicit && dtx === undefined && bitrate === undefined) return undefined;
    return {
      ...explicit,
      ...(dtx !== undefined && { opusDtx: dtx }),
      ...(bitrate !== undefined && { opusMaxAverageBitrate: bitrate }),
    };
  }

  /** @internal */
  closeAll(keepTracks = false): void {
    for (const [, producer] of this.producers) {
      producer.close();
    }
    for (const [, dp] of this.dataProducers) {
      dp.close();
    }
    this.dataStreamSender?.close();
    if (!keepTracks) {
      for (const [, pub] of this.trackPublications) {
        if (pub.track instanceof LocalTrack) {
          pub.track.stop();
        }
      }
    }
    this.producers.clear();
    this.dataProducers.clear();
    this.trackPublications.clear();
  }

  /** @internal */
  clearPublications(): void {
    this.producers.clear();
    this.dataProducers.clear();
    this.trackSidMap.clear();
    this.trackPublications.clear();
  }
}
