import { types as mediasoupTypes } from 'mediasoup-client';
import { Participant, TrackPublication } from './Participant';
import { RemoteTrackPublication } from './RemoteTrackPublication';
import { RemoteTrack } from '../track/RemoteTrack';
import { RemoteAudioTrack } from '../track/RemoteAudioTrack';
import { RemoteVideoTrack } from '../track/RemoteVideoTrack';
import { TransportManager } from '../transport/TransportManager';
import { RPCClient } from '../signal/RPCClient';
import { TrackKind, TrackSource } from '../protocol/types';
import type {
  ParticipantInfo,
  TrackInfo,
  SubscriptionCreateRequest,
  DataSubscriptionCreateRequest,
} from '../protocol/types';
import { ParticipantEvent } from '../events';
import { getLogger } from '../utils/logger';

const log = getLogger('RemoteParticipant');

export class RemoteParticipant extends Participant {
  private transportManager!: TransportManager;
  private rpc!: RPCClient;
  private consumers = new Map<string, mediasoupTypes.Consumer>();
  private dataConsumers = new Map<string, mediasoupTypes.DataConsumer>();

  /** @internal */
  init(transportManager: TransportManager, rpc: RPCClient): void {
    this.transportManager = transportManager;
    this.rpc = rpc;
  }

  /** @internal */
  getConsumers(): ReadonlyMap<string, mediasoupTypes.Consumer> {
    return this.consumers;
  }

  /** @internal */
  getDataConsumers(): ReadonlyMap<string, mediasoupTypes.DataConsumer> {
    return this.dataConsumers;
  }

  static fromInfo(info: ParticipantInfo): RemoteParticipant {
    const p = new RemoteParticipant(info.sid, info.identity, info.name, info.metadata);
    p.state = info.state;
    if (info.attributes) p.attributes = { ...info.attributes };

    if (info.tracks) {
      for (const trackInfo of info.tracks) {
        p.addTrackPublication(trackInfo);
      }
    }
    return p;
  }

  addTrackPublication(info: TrackInfo): RemoteTrackPublication {
    const pub = new RemoteTrackPublication({
      trackSid: info.sid,
      trackName: info.name,
      kind: info.kind,
      source: info.source,
      muted: info.muted,
      info,
    });
    this.trackPublications.set(info.sid, pub);
    this.emit(ParticipantEvent.TrackPublished, pub);
    return pub;
  }

  removeTrackPublication(trackSid: string): TrackPublication | undefined {
    const pub = this.trackPublications.get(trackSid);
    if (!pub) return undefined;

    this.trackPublications.delete(trackSid);

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
      track = new RemoteAudioTrack(req.subscriptionSid, consumer.track);
    } else {
      track = new RemoteVideoTrack(req.subscriptionSid, TrackSource.Camera, consumer.track);
    }

    track.sid = req.trackSid;
    track.subscriptionSid = req.subscriptionSid;
    track.publisherSid = req.publisherSid;
    track.isMuted = req.trackMuted;

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
      this.trackPublications.set(req.trackSid, pub);
    }

    const publication = pub;

    consumer.observer.on('trackended', () => {
      log.info(`Remote track ended for subscription ${req.subscriptionSid}`);
    });

    consumer.observer.on('pause', () => {
      track.setMuted(true);
      publication.muted = true;
      this.emit(ParticipantEvent.TrackMuted, publication);
    });

    consumer.observer.on('resume', () => {
      track.setMuted(false);
      publication.muted = false;
      this.emit(ParticipantEvent.TrackUnmuted, publication);
    });

    consumer.observer.on('close', () => {
      log.info(`Consumer closed for subscription ${req.subscriptionSid}`);
      this.consumers.delete(req.subscriptionSid);
    });

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

    dataConsumer.on('message', (data: ArrayBuffer) => {
      log.debug(`Data message from ${this.sid} subscription ${req.dataSubscriptionSid}`);
      this.emit(ParticipantEvent.DataReceived, data);
    });

    log.info(`Data subscription created: ${req.dataSubscriptionSid}`);
    return { ok: true };
  }

  /** @internal */
  handleSubscriptionClosed(subscriptionSid: string): void {
    const consumer = this.consumers.get(subscriptionSid);
    if (consumer) {
      consumer.close();
      this.consumers.delete(subscriptionSid);
    }

    for (const [trackSid, pub] of this.trackPublications) {
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
  }
}
