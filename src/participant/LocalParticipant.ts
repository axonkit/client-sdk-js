import { types as mediasoupTypes } from 'mediasoup-client';
import { Participant, TrackPublication } from './Participant';
import { LocalTrackPublication } from './LocalTrackPublication';
import { LocalTrack } from '../track/LocalTrack';
import { LocalAudioTrack } from '../track/LocalAudioTrack';
import { LocalVideoTrack } from '../track/LocalVideoTrack';
import {
  createLocalTracks,
  createLocalAudioTrack,
  createLocalVideoTrack,
  createLocalScreenTracks,
} from '../track/create';
import { computeVideoEncodings, isSVCCodec, getDefaultDegradationPreference } from '../track/publishUtils';
import { supportsAV1, supportsVP9, isFireFox } from '../utils/browser';
import { RPCClient } from '../signal/RPCClient';
import { TransportManager } from '../transport/TransportManager';
import { TrackKind, TrackSource } from '../protocol/types';
import type {
  TrackPublishRequest,
  TrackPublishResponse,
  PublishBackupTrackRequest,
  PublishBackupTrackResponse,
  DataTrackPublishRequest,
  DataTrackPublishResponse,
  ParticipantTrackPermission,
  JoinGroupResponse,
  ParticipantInfo,
  SubscribedCodecInfo,
} from '../protocol/types';
import type {
  TrackPublishOptions,
  DataPublishOptions,
  AudioCaptureOptions,
  VideoCaptureOptions,
  ScreenShareCaptureOptions,
  PublishCodecOptions,
  RoomOptions,
  BackupVideoCodec,
} from '../track/options';
import { BackupCodecPolicy, isBackupVideoCodec } from '../track/options';
import { ParticipantEvent, TrackEvent } from '../events';
import { getLogger } from '../utils/logger';
import { generateLogId } from '../utils/id';
import type {
  Message,
  SendTextOptions,
  StreamTextOptions,
  StreamBytesOptions,
  SendFileOptions,
  PerformRpcParams,
  RpcInvocationData,
} from '../types';
import {
  DataStreamSender,
  TextStreamWriter,
  ByteStreamWriter,
} from '../data-stream/DataStreamManager';
import { RpcError, byteLength, MAX_RPC_PAYLOAD_BYTES } from '../rpc';

const log = getLogger('LocalParticipant');

export class LocalParticipant extends Participant {
  private rpc!: RPCClient;
  private transportManager!: TransportManager;
  private producers = new Map<string, mediasoupTypes.Producer>();
  private dataProducers = new Map<string, mediasoupTypes.DataProducer>();
  private dataStreamSender?: DataStreamSender;

  private _lastCameraError?: Error;
  private _lastMicrophoneError?: Error;
  private participantTrackPermissions: ParticipantTrackPermission[] = [];
  private allParticipantsAllowedToSubscribe = true;

  /** Room-level options passed in from the Room instance. */
  roomOptions?: RoomOptions;

  get isLocal(): boolean {
    return true;
  }

  /** @internal RPC handlers registered by the user for P2P RPC. */
  rpcHandlers = new Map<string, (data: RpcInvocationData) => Promise<string>>();
  /** @internal Pending RPC responses waiting for a reply. */
  pendingRpcResponses = new Map<
    string,
    {
      resolve: (payload: string) => void;
      reject: (error: RpcError) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

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
        const mergedCapture = {
          ...this.roomOptions?.videoCaptureDefaults,
          ...captureOptions,
        };
        const track = await createLocalVideoTrack(mergedCapture);
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
        const mergedCapture = {
          ...this.roomOptions?.audioCaptureDefaults,
          ...captureOptions,
        };
        const track = await createLocalAudioTrack(mergedCapture);
        return await this.publishTrack(track, {
          ...publishOptions,
          source: TrackSource.Microphone,
        });
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
   * Uses a single `getUserMedia` call so the user only grants permission once.
   */
  async enableCameraAndMicrophone(
    captureOptions?: { audio?: AudioCaptureOptions; video?: VideoCaptureOptions },
    publishOptions?: TrackPublishOptions,
  ): Promise<void> {
    let tracks: LocalTrack[];
    try {
      const mergedAudio = {
        ...this.roomOptions?.audioCaptureDefaults,
        ...captureOptions?.audio,
      };
      const mergedVideo = {
        ...this.roomOptions?.videoCaptureDefaults,
        ...captureOptions?.video,
      };
      tracks = await createLocalTracks({
        audio: mergedAudio,
        video: mergedVideo,
      });
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this._lastMicrophoneError = err;
      this._lastCameraError = err;
      log.warn('Failed to create local tracks', e);
      return;
    }

    const results = await Promise.allSettled(
      tracks.map((track) => {
        const source = track.kind === TrackKind.Audio ? TrackSource.Microphone : TrackSource.Camera;
        return this.publishTrack(track, { ...publishOptions, source });
      }),
    );

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

    // Merge room-level publishDefaults with per-track overrides
    const opts: TrackPublishOptions = {
      ...this.roomOptions?.publishDefaults,
      ...options,
    };

    if (opts.source) {
      localTrack.source = opts.source;
    }

    // --- Duplicate publish detection ---
    for (const [, pub] of this.trackPublications) {
      if (pub.track === localTrack) {
        log.warn('track has already been published, skipping');
        return pub;
      }
    }

    // --- Stereo / DTX / RED auto-configuration for audio ---
    const isAudio = localTrack.kind === TrackKind.Audio;
    let isStereo = false;
    if (isAudio) {
      const settings = localTrack.mediaStreamTrack.getSettings();
      const constraints = localTrack.mediaStreamTrack.getConstraints();
      const isStereoInput =
        ('channelCount' in settings && (settings as any).channelCount === 2) ||
        constraints.channelCount === 2;
      isStereo = opts.forceStereo ?? isStereoInput;

      if (isStereo) {
        if (opts.dtx === undefined) {
          log.info('Opus DTX will be disabled for stereo tracks by default. Enable explicitly to override.');
        }
        if (opts.red === undefined) {
          log.info('Opus RED will be disabled for stereo tracks by default. Enable explicitly to override.');
        }
        opts.dtx ??= false;
        opts.red ??= false;
      }

      // stopMicTrackOnMute
      if (opts.stopMicTrackOnMute && localTrack instanceof LocalAudioTrack) {
        localTrack.stopOnMute = true;
      }
    }

    const sendTransport = this.transportManager.sendTransport;
    if (!sendTransport) throw new Error('Send transport not available');

    const isVideo = localTrack.kind === TrackKind.Video;
    const isScreenShare =
      localTrack.source === TrackSource.ScreenShare ||
      localTrack.source === TrackSource.ScreenShareAudio;

    // --- Video codec support checks with fallback ---
    if (isVideo) {
      if (opts.videoCodec === 'av1' && !supportsAV1()) {
        log.warn('AV1 not supported by browser, falling back to default codec');
        opts.videoCodec = undefined;
      }
      if (opts.videoCodec === 'vp9' && !supportsVP9()) {
        log.warn('VP9 not supported by browser, falling back to default codec');
        opts.videoCodec = undefined;
      }
      opts.videoCodec ??= 'vp8';
    }

    // Firefox screenshare simulcast produces broken layer 0
    if (isScreenShare && isFireFox()) {
      opts.simulcast = false;
    }

    // --- Video: SVC scalabilityMode defaults ---
    if (isVideo && opts.videoCodec && isSVCCodec(opts.videoCodec)) {
      if (isScreenShare) {
        opts.scalabilityMode ??= 'L1T3';
      }
      opts.scalabilityMode ??= 'L3T3_KEY';
    }

    // --- Compute encodings ---
    let encodings: mediasoupTypes.RtpEncodingParameters[] | undefined;
    if (isVideo && localTrack instanceof LocalVideoTrack) {
      let dims: { width: number; height: number } = { width: 0, height: 0 };
      try {
        dims = await localTrack.waitForDimensions();
      } catch {
        const defaultRes = this.roomOptions?.videoCaptureDefaults?.resolution ?? {
          width: 1280,
          height: 720,
        };
        dims = { width: defaultRes.width, height: defaultRes.height };
        log.warn('could not determine track dimensions, using defaults', dims);
      }
      encodings = computeVideoEncodings(
        isScreenShare,
        dims.width,
        dims.height,
        opts,
      );
    } else if (isAudio) {
      // Audio encoding from audioPreset or audioBitrate
      const audioBitrate = opts.audioPreset?.maxBitrate ?? opts.audioBitrate;
      const audioPriority = opts.audioPreset?.priority ?? 'high';
      if (audioBitrate !== undefined) {
        encodings = [{
          maxBitrate: audioBitrate,
          priority: audioPriority,
          networkPriority: audioPriority,
        }];
      }
    }

    const codecOptions = this.buildCodecOptions(opts);

    let codec: mediasoupTypes.RtpCodecCapability | undefined;
    if (isVideo && opts.videoCodec) {
      const mimeType = `video/${opts.videoCodec}`;
      codec = this.transportManager.device.recvRtpCapabilities.codecs?.find(
        (c) => c.mimeType.toLowerCase() === mimeType,
      );
    }

    // Chrome bug: screenshare + SVC limits to 5fps with default contentHint.
    // Force 'motion' to work around it.
    if (
      isScreenShare &&
      isVideo &&
      opts.videoCodec &&
      isSVCCodec(opts.videoCodec) &&
      'contentHint' in localTrack.mediaStreamTrack
    ) {
      localTrack.mediaStreamTrack.contentHint = 'motion';
      log.debug('set contentHint to motion for SVC screenshare');
    }

    const clientTrackId = generateLogId();

    const producePromise = new Promise<string>((resolve, reject) => {
      this.transportManager.registerProduceCallback(
        clientTrackId,
        async (params, callback, errback) => {
          try {
            const req: TrackPublishRequest = {
              clientTrackId,
              name: opts.name ?? localTrack.mediaStreamTrack.label,
              kind: localTrack.kind,
              rtpParameters: params.rtpParameters,
              source: localTrack.source,
              muted: localTrack.isMuted,
            };

            if (isVideo && localTrack instanceof LocalVideoTrack) {
              try {
                const dim = await localTrack.waitForDimensions();
                req.width = dim.width;
                req.height = dim.height;
              } catch {
                // dimensions unavailable, send without them
              }

              // Include codec info for backup codec support
              if (opts.videoCodec) {
                req.videoCodec = opts.videoCodec;
              }
              const resolvedBackup = resolveBackupCodec(opts);
              if (resolvedBackup) {
                req.backupCodec = resolvedBackup;
                req.backupCodecPolicy = opts.backupCodecPolicy ?? BackupCodecPolicy.PREFER_REGRESSION;
              }
            }

            const resp = await this.rpc.request<TrackPublishResponse>('track.publish', req);
            callback({ id: resp.trackSid });
            resolve(resp.trackSid);
          } catch (err) {
            errback(err instanceof Error ? err : new Error(String(err)));
            reject(err);
          }
        },
      );
    });

    const producer = await sendTransport.produce({
      track: localTrack.mediaStreamTrack!,
      encodings,
      codecOptions,
      codec,
      stopTracks: opts.stopTrackOnUnpublish ?? false,
      disableTrackOnPause: true,
      appData: { clientTrackId, source: localTrack.source },
    });

    const trackSid = await producePromise;
    localTrack.sid = trackSid;
    localTrack.producer = producer;

    // Store the published codec on video tracks for backup codec handling
    if (isVideo && localTrack instanceof LocalVideoTrack && opts.videoCodec) {
      localTrack.publishedCodec = opts.videoCodec;
    }

    // Apply degradation preference for video tracks
    if (isVideo && localTrack instanceof LocalVideoTrack) {
      const dp = opts.degradationPreference ??
        getDefaultDegradationPreference(localTrack.source, localTrack.constraints ?? undefined);
      localTrack.setDegradationPreference(dp).catch((err) => {
        log.warn('Failed to set degradation preference', err);
      });
    }

    this.producers.set(trackSid, producer);

    const publication = new LocalTrackPublication({
      trackSid,
      trackName: opts.name ?? localTrack.mediaStreamTrack.label,
      kind: localTrack.kind,
      source: localTrack.source,
      track: localTrack,
      muted: localTrack.isMuted,
      producer,
      options: opts,
    });

    this.addTrackPublicationToMaps(publication);

    localTrack.startMonitor();
    localTrack.addVisibilityListener();

    localTrack.on(TrackEvent.Muted, () => {
      publication.muted = true;
      this.emit(ParticipantEvent.TrackMuted, publication);
      this.rpc.request('track.mute', { trackSid, muted: true }).catch(() => {});
    });

    localTrack.on(TrackEvent.Unmuted, () => {
      publication.muted = false;
      this.emit(ParticipantEvent.TrackUnmuted, publication);
      this.rpc.request('track.mute', { trackSid, muted: false }).catch(() => {});
    });

    producer.observer.on('trackended', () => {
      const isManaged =
        !localTrack.isUserProvided &&
        (localTrack.source === TrackSource.Camera ||
          localTrack.source === TrackSource.Microphone);

      if (isManaged) {
        log.info(`Track ${trackSid} ended, attempting restart`);
        localTrack
          .restart()
          .then(() => {
            log.info(`Track ${trackSid} successfully restarted after ended`);
          })
          .catch((restartErr) => {
            log.warn(`Failed to restart track ${trackSid}, unpublishing`, restartErr);
            this.unpublishTrack(localTrack).catch((err) => {
              log.warn(`Failed to auto-unpublish track ${trackSid}`, err);
            });
          });
      } else {
        log.info(`Track ${trackSid} ended, unpublishing`);
        this.unpublishTrack(localTrack).catch((err) => {
          log.warn(`Failed to auto-unpublish track ${trackSid}`, err);
        });
      }
    });

    producer.on('transportclose', () => {
      log.info(`Transport closed for track ${trackSid}`);
      this.producers.delete(trackSid);
    });

    this.emit(ParticipantEvent.TrackPublished, publication);
    this.emit(ParticipantEvent.LocalTrackPublished, publication);
    log.info(`Published track ${trackSid} (${localTrack.kind}/${localTrack.source})`);

    return publication;
  }

  /**
   * Unpublish a track from the room.
   * @param track - The track or MediaStreamTrack to unpublish.
   * @param stopOnUnpublish - Whether to stop the track after unpublishing.
   *   Defaults to `false`.
   */
  async unpublishTrack(
    track: LocalTrack | MediaStreamTrack,
  ): Promise<LocalTrackPublication | undefined> {
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

    if (!trackSid) return undefined;

    const producer = this.producers.get(trackSid);
    const publication = this.trackPublications.get(trackSid) as LocalTrackPublication | undefined;

    try {
      await this.rpc.request('track.unpublish', { trackSid });
    } catch (err) {
      log.warn(`Failed to unpublish track ${trackSid}`, err);
    }

    const localTrack = publication?.track instanceof LocalTrack ? publication.track : undefined;
    localTrack?.stopMonitor();

    producer?.close();
    this.producers.delete(trackSid);

    if (localTrack) {
      localTrack.producer = undefined;
    }

    if (publication) {
      this.removeTrackPublicationFromMaps(trackSid);
      this.emit(ParticipantEvent.TrackUnpublished, publication);
      this.emit(ParticipantEvent.LocalTrackUnpublished, publication);
    }

    log.info(`Unpublished track ${trackSid}`);
    return publication;
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

  /**
   * Sets and updates the metadata of the local participant.
   * Note: this requires `canUpdateMetadata` permission.
   */
  async setMetadata(metadata: string): Promise<void> {
    await this.rpc.request('participant.update', { metadata });
    this.metadata = metadata;
  }

  /**
   * Sets and updates the name of the local participant.
   * Note: this requires `canUpdateMetadata` permission.
   */
  async setName(name: string): Promise<void> {
    await this.rpc.request('participant.update', { name });
    this.name = name;
  }

  /**
   * Set or update participant attributes. It will make updates only to keys that
   * are present in `attributes`, and will not override others.
   * Note: this requires `canUpdateMetadata` permission.
   */
  async setAttributes(attributes: Record<string, string>): Promise<void> {
    await this.rpc.request('participant.update', { attributes });
    this.attributes = { ...this.attributes, ...attributes };
  }

  // --- Group (Breakout Room) ---

  /**
   * Join a group (breakout room). The server will rewire subscriptions
   * so that only participants in the same group exchange media.
   * Permissions may change to the group-level permissions.
   * @returns The list of other participants already in the group.
   */
  async joinGroup(groupId: string): Promise<ParticipantInfo[]> {
    const resp = await this.rpc.request<JoinGroupResponse>('group.join', { groupId });
    this.groupId = groupId;
    return resp.otherParticipants ?? [];
  }

  /**
   * Leave the current group and return to the main room.
   * Permissions revert to room-level defaults.
   */
  async leaveGroup(): Promise<void> {
    await this.rpc.request('group.leave', {});
    this.groupId = undefined;
  }

  /**
   * Control who can subscribe to LocalParticipant's published tracks.
   *
   * By default, all participants can subscribe. This allows fine-grained control over
   * who is able to subscribe at a participant and track level.
   *
   * @param allParticipantsAllowed - Allows all participants to subscribe all tracks.
   *   Takes precedence over `participantTrackPermissions` if set to true.
   * @param participantTrackPermissions - Full list of individual permissions per
   *   participant/track. Any omitted participants will not receive any permissions.
   */
  setTrackSubscriptionPermissions(
    allParticipantsAllowed: boolean,
    participantTrackPermissions: ParticipantTrackPermission[] = [],
  ): void {
    this.participantTrackPermissions = participantTrackPermissions;
    this.allParticipantsAllowedToSubscribe = allParticipantsAllowed;
    this.updateTrackSubscriptionPermissions();
  }

  private updateTrackSubscriptionPermissions(): void {
    this.rpc
      .request('subscription.updatePermissions', {
        allParticipantsAllowed: this.allParticipantsAllowedToSubscribe,
        trackPermissions: this.participantTrackPermissions,
      })
      .catch(() => {});
  }

  // --- Messages (chat, whiteboard, document, etc.) ---

  /**
   * Send a message to all participants in the room.
   * @param text - The message text / payload.
   * @param options - Optional settings such as `type`, `transient`, `topic`, etc.
   */
  async sendMessage(
    text: string,
    options?: SendTextOptions & { type?: string; transient?: boolean },
  ): Promise<Message> {
    const msg: Message = {
      id: crypto.randomUUID(),
      type: options?.type,
      message: text,
      timestamp: Date.now(),
      transient: options?.transient,
    };
    this.rpc.notify('message.send', {
      ...msg,
      destinationIdentities: options?.destinationIdentities,
      topic: options?.topic,
      attributes: options?.attributes,
    });
    this.emit(ParticipantEvent.ChatMessage, msg);
    return msg;
  }

  /**
   * Edit a previously sent message.
   */
  async editMessage(editText: string, originalMessage: Message): Promise<Message> {
    const msg: Message = {
      ...originalMessage,
      message: editText,
      editTimestamp: Date.now(),
    };
    this.rpc.notify('message.send', msg);
    this.emit(ParticipantEvent.ChatMessage, msg);
    return msg;
  }

  /**
   * Delete a single message by ID.
   */
  async deleteMessage(id: string): Promise<void> {
    await this.rpc.request('message.delete', { id });
  }

  /**
   * Delete all messages of a given type.
   */
  async deleteMessagesByType(type: string): Promise<void> {
    await this.rpc.request('message.deleteByType', { type });
  }

  // --- Room Shared State ---

  /**
   * Update a key in the room's shared state.
   */
  async updateRoomState(key: string, value: string): Promise<void> {
    await this.rpc.request('state.update', { key, value });
  }

  /**
   * Delete a key from the room's shared state.
   */
  async deleteRoomState(key: string): Promise<void> {
    await this.rpc.request('state.delete', { key });
  }

  /** @deprecated Use {@link sendMessage} instead. */
  async sendChatMessage(
    text: string,
    options?: SendTextOptions,
  ): Promise<Message> {
    return this.sendMessage(text, options);
  }

  /** @deprecated Use {@link editMessage} instead. */
  async editChatMessage(editText: string, originalMessage: Message): Promise<Message> {
    return this.editMessage(editText, originalMessage);
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
      pending.reject(
        new RpcError(
          body.error.code ?? 1500,
          body.error.message ?? 'Application error',
          body.error.data,
        ),
      );
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
      const rpcErr =
        err instanceof RpcError
          ? err
          : new RpcError(
              RpcError.ErrorCode.APPLICATION_ERROR,
              err instanceof Error ? err.message : String(err),
            );
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
    const red = options?.red;
    const bitrate = options?.audioPreset?.maxBitrate ?? options?.audioBitrate;
    const stereo = options?.forceStereo;
    if (!explicit && dtx === undefined && red === undefined && bitrate === undefined && stereo === undefined) {
      return undefined;
    }
    return {
      ...explicit,
      ...(dtx !== undefined && { opusDtx: dtx }),
      ...(red !== undefined && { opusFec: red }),
      ...(bitrate !== undefined && { opusMaxAverageBitrate: bitrate }),
      ...(stereo !== undefined && { opusStereo: stereo }),
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
    this.audioTrackPublications.clear();
    this.videoTrackPublications.clear();
  }

  /**
   * Unpublish all tracks matching the given sources, or all tracks if no sources specified.
   */
  async unpublishTracks(tracks: LocalTrack[]): Promise<void> {
    await Promise.all(tracks.map((t) => this.unpublishTrack(t)));
  }

  /**
   * Create local tracks without publishing. Useful for creating preview tracks.
   */
  async createTracks(options?: {
    audio?: AudioCaptureOptions | boolean;
    video?: VideoCaptureOptions | boolean;
  }): Promise<LocalTrack[]> {
    const tracks: LocalTrack[] = [];
    if (options?.audio !== false) {
      const audioOptions: AudioCaptureOptions | undefined =
        typeof options?.audio === 'object'
          ? { ...this.roomOptions?.audioCaptureDefaults, ...options.audio }
          : this.roomOptions?.audioCaptureDefaults;
      tracks.push(await createLocalAudioTrack(audioOptions));
    }
    if (options?.video !== false) {
      const videoOptions: VideoCaptureOptions | undefined =
        typeof options?.video === 'object'
          ? { ...this.roomOptions?.videoCaptureDefaults, ...options.video }
          : this.roomOptions?.videoCaptureDefaults;
      tracks.push(await createLocalVideoTrack(videoOptions));
    }
    return tracks;
  }

  /**
   * Create screen share tracks without publishing.
   */
  async createScreenTracks(options?: ScreenShareCaptureOptions): Promise<LocalTrack[]> {
    return createLocalScreenTracks(options);
  }

  /**
   * Re-publish all currently published tracks. Useful after a full reconnect
   * or when changing publish options globally.
   *
   * The transportclose handler only clears `producers`, not
   * `trackPublications`, so the publications are still available here even
   * after the old transport has been closed.
   */
  async republishAllTracks(options?: TrackPublishOptions, restartTracks = true): Promise<void> {
    const publications = [...this.trackPublications.values()];
    this.clearPublications();

    for (const pub of publications) {
      if (!pub.track) continue;
      const localTrack = pub.track as LocalTrack;
      localTrack.producer = undefined;

      if (restartTracks && localTrack.mediaStreamTrack?.readyState === 'ended') {
        try {
          await localTrack.restart();
        } catch (err) {
          log.warn(`Failed to restart track ${pub.trackSid}`, err);
          continue;
        }
      }

      try {
        await this.publishTrack(localTrack, {
          name: pub.trackName,
          source: pub.source,
          ...options,
        });
      } catch (err) {
        log.warn(`Failed to republish track ${pub.trackSid}`, err);
      }
    }
  }

  /**
   * Handles per-codec subscribed quality updates from the server.
   * When the server requests a backup codec that hasn't been published yet,
   * this triggers `publishAdditionalCodecForTrack`.
   * @internal
   */
  async handleSubscribedCodecs(
    pub: LocalTrackPublication,
    subscribedCodecs: SubscribedCodecInfo[],
  ): Promise<void> {
    if (!(pub.track instanceof LocalVideoTrack)) return;

    const videoTrack = pub.track as LocalVideoTrack;
    const primaryCodec = videoTrack.publishedCodec;

    for (const sc of subscribedCodecs) {
      const codecLower = sc.codec.toLowerCase();
      const hasEnabled = sc.qualities.some((q) => q.enabled);

      if (codecLower === primaryCodec) {
        // Update primary codec quality (dynacast)
        await videoTrack.setDynacastQuality(sc.qualities);
      } else if (hasEnabled && isBackupVideoCodec(codecLower)) {
        // Backup codec requested and has enabled qualities — publish it
        if (!videoTrack.backupProducer) {
          log.info(`Publishing backup codec ${codecLower} for ${pub.trackSid}`);
          await this.publishAdditionalCodecForTrack(videoTrack, codecLower as BackupVideoCodec, pub);
        }
      } else if (!hasEnabled && videoTrack.backupProducer) {
        // Backup codec no longer needed — close the producer
        log.info(`Stopping backup codec for ${pub.trackSid}`);
        videoTrack.backupProducer.close();
        videoTrack.backupProducer = undefined;
      }
    }
  }

  /**
   * Creates a second producer for the backup codec on an already-published
   * video track. The new producer is registered on the server via
   * `track.publishBackup` RPC.
   */
  private async publishAdditionalCodecForTrack(
    videoTrack: LocalVideoTrack,
    backupCodec: BackupVideoCodec,
    pub: LocalTrackPublication,
  ): Promise<void> {
    const sendTransport = this.transportManager.sendTransport;
    if (!sendTransport) throw new Error('Send transport not available');

    const mimeType = `video/${backupCodec}`;
    const codec = this.transportManager.device.recvRtpCapabilities.codecs?.find(
      (c) => c.mimeType.toLowerCase() === mimeType,
    );
    if (!codec) {
      log.warn(`Backup codec ${backupCodec} not found in device capabilities`);
      return;
    }

    const clientTrackId = generateLogId();

    const producePromise = new Promise<string>((resolve, reject) => {
      this.transportManager.registerProduceCallback(
        clientTrackId,
        async (params, callback, errback) => {
          try {
            const req: PublishBackupTrackRequest = {
              trackSid: pub.trackSid!,
              clientTrackId,
              rtpParameters: params.rtpParameters,
            };
            const resp = await this.rpc.request<PublishBackupTrackResponse>(
              'track.publishBackup',
              req,
            );
            callback({ id: resp.backupTrackSid });
            resolve(resp.backupTrackSid);
          } catch (err) {
            errback(err instanceof Error ? err : new Error(String(err)));
            reject(err);
          }
        },
      );
    });

    // Reuse the same MediaStreamTrack instead of cloning — React Native
    // (react-native-webrtc) does not support MediaStreamTrack.clone().
    // Multiple mediasoup producers can share a single track because each
    // gets its own RTCRtpTransceiver. stopTracks must be false so closing
    // the backup producer doesn't stop the shared track.
    const backupProducer = await sendTransport.produce({
      track: videoTrack.mediaStreamTrack,
      codec,
      stopTracks: false,
      disableTrackOnPause: false,
      appData: { clientTrackId, source: videoTrack.source, backup: true },
    });

    const backupSid = await producePromise;
    videoTrack.backupProducer = backupProducer;
    videoTrack.backupCodec = backupCodec;
    log.info(`Backup codec published: ${backupCodec}, sid=${backupSid}`);
  }

  /** @internal */
  clearPublications(): void {
    this.producers.clear();
    this.dataProducers.clear();
    this.trackPublications.clear();
    this.audioTrackPublications.clear();
    this.videoTrackPublications.clear();
  }
}

/**
 * Resolves the backup codec string from publish options.
 * Returns the backup codec name or undefined if no backup is configured.
 */
export function resolveBackupCodec(opts: TrackPublishOptions): string | undefined {
  if (!opts.backupCodec) return undefined;
  if (opts.backupCodec === true) {
    // For SVC codecs, default backup is vp8
    if (opts.videoCodec && !isBackupVideoCodec(opts.videoCodec)) {
      return 'vp8';
    }
    return undefined;
  }
  if (typeof opts.backupCodec === 'object') {
    if (opts.backupCodec.codec !== opts.videoCodec) {
      return opts.backupCodec.codec;
    }
  }
  return undefined;
}
