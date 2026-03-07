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
import type { TrackPublishOptions, DataPublishOptions, AudioCaptureOptions, VideoCaptureOptions } from '../track/options';
import { ParticipantEvent, TrackEvent } from '../events';
import { getLogger } from '../utils/logger';
import { generateLogId } from '../utils/id';

const log = getLogger('LocalParticipant');

export class LocalParticipant extends Participant {
  private rpc!: RPCClient;
  private transportManager!: TransportManager;
  private producers = new Map<string, mediasoupTypes.Producer>();
  private dataProducers = new Map<string, mediasoupTypes.DataProducer>();
  private trackSidMap = new Map<string, string>(); // trackSid -> localTrack id

  /** @internal */
  init(rpc: RPCClient, transportManager: TransportManager): void {
    this.rpc = rpc;
    this.transportManager = transportManager;
  }

  /** @internal */
  getProducers(): ReadonlyMap<string, mediasoupTypes.Producer> {
    return this.producers;
  }

  /** @internal */
  getDataProducers(): ReadonlyMap<string, mediasoupTypes.DataProducer> {
    return this.dataProducers;
  }

  async setCameraEnabled(enabled: boolean, options?: VideoCaptureOptions): Promise<TrackPublication | undefined> {
    if (enabled) {
      const track = await createLocalVideoTrack(options);
      return this.publishTrack(track, { source: TrackSource.Camera });
    } else {
      const pub = this.getTrackPublication(TrackSource.Camera);
      if (pub?.track) {
        await this.unpublishTrack(pub.track as LocalTrack);
      }
      return pub;
    }
  }

  async setMicrophoneEnabled(enabled: boolean, options?: AudioCaptureOptions): Promise<TrackPublication | undefined> {
    if (enabled) {
      const track = await createLocalAudioTrack(options);
      return this.publishTrack(track, { source: TrackSource.Microphone });
    } else {
      const pub = this.getTrackPublication(TrackSource.Microphone);
      if (pub?.track) {
        await this.unpublishTrack(pub.track as LocalTrack);
      }
      return pub;
    }
  }

  async setScreenShareEnabled(enabled: boolean): Promise<TrackPublication | undefined> {
    if (enabled) {
      const tracks = await createLocalScreenTracks();
      let pub: TrackPublication | undefined;
      for (const t of tracks) {
        pub = await this.publishTrack(t, { source: t.source });
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
    let encodings: RTCRtpEncodingParameters[] | undefined;

    if (isVideo && localTrack instanceof LocalVideoTrack) {
      if (options?.simulcast !== false) {
        localTrack.setSimulcast(true);
      }
      if (options?.videoEncoding) {
        localTrack.setEncoding(options.videoEncoding);
      }
      encodings = localTrack.getSimulcastEncodings();
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

  /** @internal */
  closeAll(keepTracks = false): void {
    for (const [, producer] of this.producers) {
      producer.close();
    }
    for (const [, dp] of this.dataProducers) {
      dp.close();
    }
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
