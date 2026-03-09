import { types as mediasoupTypes } from 'mediasoup-client';
import { Participant, TrackPublication } from './Participant';
import { RemoteTrackPublication } from './RemoteTrackPublication';
import { RemoteTrack } from '../track/RemoteTrack';
import { RemoteAudioTrack } from '../track/RemoteAudioTrack';
import { RemoteVideoTrack } from '../track/RemoteVideoTrack';
import { TransportManager } from '../transport/TransportManager';
import { RPCClient } from '../signal/RPCClient';
import { TrackKind, TrackSource, StreamState } from '../protocol/types';
import type {
  ParticipantInfo,
  TrackInfo,
  SubscriptionCreateRequest,
  DataSubscriptionCreateRequest,
} from '../protocol/types';
import { ParticipantEvent } from '../events';
import { getLogger } from '../utils/logger';
import { STREAM_DATA_LABEL, type DataStreamReceiver } from '../data-stream/DataStreamManager';

const log = getLogger('RemoteParticipant');

export class RemoteParticipant extends Participant {
  private transportManager!: TransportManager;
  private rpc!: RPCClient;
  private consumers = new Map<string, mediasoupTypes.Consumer>();
  private dataConsumers = new Map<string, mediasoupTypes.DataConsumer>();
  private streamReceiver?: DataStreamReceiver;

  get isLocal(): boolean {
    return false;
  }

  /** @internal */
  init(
    transportManager: TransportManager,
    rpc: RPCClient,
    streamReceiver?: DataStreamReceiver,
  ): void {
    this.transportManager = transportManager;
    this.rpc = rpc;
    this.streamReceiver = streamReceiver;
  }

  /** @internal */
  getConsumers(): ReadonlyMap<string, mediasoupTypes.Consumer> {
    return this.consumers;
  }

  /** @internal */
  getDataConsumers(): ReadonlyMap<string, mediasoupTypes.DataConsumer> {
    return this.dataConsumers;
  }

  /**
   * Set the output volume for all audio tracks from this participant.
   * @param volume - Value between 0 and 1.
   */
  setVolume(volume: number): void {
    for (const pub of this.audioTrackPublications.values()) {
      const track = pub.track as RemoteAudioTrack | undefined;
      track?.setVolume(volume);
    }
  }

  /**
   * Get the current output volume for this participant's audio tracks.
   * Returns the volume of the first audio track, or 1 if none.
   */
  getVolume(): number {
    for (const pub of this.audioTrackPublications.values()) {
      const track = pub.track as RemoteAudioTrack | undefined;
      if (track) return track.volume;
    }
    return 1;
  }

  static fromInfo(info: ParticipantInfo): RemoteParticipant {
    const p = new RemoteParticipant(info.sid, info.identity, info.name, info.metadata);
    p.state = info.state;
    if (info.attributes) p.attributes = { ...info.attributes };
    if (info.groupId) p.groupId = info.groupId;

    if (info.tracks) {
      for (const trackInfo of info.tracks) {
        p.addTrackPublication(trackInfo);
      }
    }
    return p;
  }

  /** @internal */
  addTrackPublication(info: TrackInfo): RemoteTrackPublication {
    const pub = new RemoteTrackPublication({
      trackSid: info.sid,
      trackName: info.name,
      kind: info.kind,
      source: info.source,
      muted: info.muted,
      info,
    });
    this.addTrackPublicationToMaps(pub);
    this.emit(ParticipantEvent.TrackPublished, pub);
    return pub;
  }

  /** @internal */
  removeTrackPublication(trackSid: string): TrackPublication | undefined {
    const pub = this.removeTrackPublicationFromMaps(trackSid);
    if (!pub) return undefined;

    if (pub.track) {
      const track = pub.track as RemoteTrack;
      track.stop();
      this.emit(ParticipantEvent.TrackUnsubscribed, track, pub);
    }

    this.emit(ParticipantEvent.TrackUnpublished, pub);
    return pub;
  }

  /** @internal */
  async handleSubscriptionCreate(req: SubscriptionCreateRequest): Promise<{ ok: boolean }> {
    const recvTransport = this.transportManager.recvTransport;
    if (!recvTransport) throw new Error('Recv transport not available');

    const consumer = await recvTransport.consume({
      id: req.subscriptionSid,
      producerId: req.trackSid,
      kind: req.kind === TrackKind.Audio ? 'audio' : 'video',
      rtpParameters: req.rtpParameters,
    });

    this.consumers.set(req.subscriptionSid, consumer);

    let track: RemoteTrack;
    if (req.kind === TrackKind.Audio) {
      track = new RemoteAudioTrack(consumer.track);
    } else {
      track = new RemoteVideoTrack(TrackSource.Camera, consumer.track);
    }

    track.sid = req.trackSid;
    track.subscriptionSid = req.subscriptionSid;
    track.publisherSid = req.publisherSid;
    track.consumer = consumer;
    if (req.trackMuted) {
      track.setMuted(true);
    }

    let pub = this.trackPublications.get(req.trackSid) as RemoteTrackPublication | undefined;
    if (pub) {
      pub.track = track;
      pub.consumer = consumer;
      pub.rpc = this.rpc;
    } else {
      pub = new RemoteTrackPublication({
        trackSid: req.trackSid,
        trackName: req.subscriptionSid,
        kind: req.kind,
        source: TrackSource.Unknown,
        track,
        muted: req.trackMuted,
        consumer,
        rpc: this.rpc,
      });
      this.addTrackPublicationToMaps(pub);
    }

    const publication = pub;

    consumer.observer.on('trackended', () => {
      log.info(`Remote track ended for subscription ${req.subscriptionSid}`);
    });

    consumer.observer.on('pause', () => {
      track.setStreamState(StreamState.Paused);
      publication.streamState = StreamState.Paused;
      this.emit(ParticipantEvent.TrackStreamStateChanged, publication, StreamState.Paused);
    });

    consumer.observer.on('resume', () => {
      track.setStreamState(StreamState.Active);
      publication.streamState = StreamState.Active;
      this.emit(ParticipantEvent.TrackStreamStateChanged, publication, StreamState.Active);
    });

    consumer.observer.on('close', () => {
      log.info(`Consumer closed for subscription ${req.subscriptionSid}`);
      this.consumers.delete(req.subscriptionSid);
    });

    track.startMonitor();
    this.emit(ParticipantEvent.TrackSubscribed, track, publication);

    log.info(`Subscribed to track ${req.trackSid} via subscription ${req.subscriptionSid}`);
    return { ok: true };
  }

  /** @internal */
  async handleDataSubscriptionCreate(req: DataSubscriptionCreateRequest): Promise<{ ok: boolean }> {
    const recvTransport = this.transportManager.recvTransport;
    if (!recvTransport) throw new Error('Recv transport not available');

    const dataConsumer = await recvTransport.consumeData({
      id: req.dataSubscriptionSid,
      dataProducerId: req.dataTrackSid,
      sctpStreamParameters: req.sctpStreamParameters as any,
      label: req.label,
      protocol: req.protocol,
    });

    this.dataConsumers.set(req.dataSubscriptionSid, dataConsumer);

    if (req.label === STREAM_DATA_LABEL && this.streamReceiver) {
      const receiver = this.streamReceiver;
      const senderIdentity = this.identity ?? '';
      const senderSid = this.sid;
      dataConsumer.on('message', (data: ArrayBuffer) => {
        receiver.handleMessage(data, senderIdentity, senderSid);
      });
    } else {
      dataConsumer.on('message', (data: ArrayBuffer) => {
        log.debug(`Data message from ${this.sid} subscription ${req.dataSubscriptionSid}`);
        this.emit(ParticipantEvent.DataReceived, data);
      });
    }

    log.info(`Data subscription created: ${req.dataSubscriptionSid} (label=${req.label})`);
    return { ok: true };
  }

  /** @internal */
  handleSubscriptionClosed(subscriptionSid: string): void {
    const consumer = this.consumers.get(subscriptionSid);
    if (consumer) {
      consumer.close();
      this.consumers.delete(subscriptionSid);
    }

    for (const [, pub] of this.trackPublications) {
      if (pub.track && (pub.track as RemoteTrack).subscriptionSid === subscriptionSid) {
        const track = pub.track as RemoteTrack;
        pub.track = undefined;
        this.emit(ParticipantEvent.TrackUnsubscribed, track, pub);
        track.stop();
        break;
      }
    }
  }

  /** @internal */
  handleDataSubscriptionClosed(dataSubscriptionSid: string): void {
    const dc = this.dataConsumers.get(dataSubscriptionSid);
    if (dc) {
      dc.close();
      this.dataConsumers.delete(dataSubscriptionSid);
    }
  }

  /** @internal */
  setTrackMuted(trackSid: string, muted: boolean): void {
    const pub = this.trackPublications.get(trackSid);
    if (!pub) return;

    pub.muted = muted;
    if (pub.track) {
      (pub.track as RemoteTrack).setMuted(muted);
    }
    this.emit(muted ? ParticipantEvent.TrackMuted : ParticipantEvent.TrackUnmuted, pub);
  }

  /** @internal */
  closeAll(): void {
    for (const [, consumer] of this.consumers) {
      consumer.close();
    }
    for (const [, dc] of this.dataConsumers) {
      dc.close();
    }
    for (const [, pub] of this.trackPublications) {
      if (pub.track) {
        pub.track.stop();
      }
    }
    this.consumers.clear();
    this.dataConsumers.clear();
    this.trackPublications.clear();
    this.audioTrackPublications.clear();
    this.videoTrackPublications.clear();
  }
}
