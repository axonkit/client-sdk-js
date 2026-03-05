import { TypedEventEmitter } from '../utils/events';
import type { ParticipantInfo, ParticipantState, TrackInfo, TrackSource } from '../protocol/types';
import type { Track } from '../track/Track';

export interface TrackPublication {
  trackSid: string;
  trackName: string;
  kind: string;
  source: TrackSource;
  track?: Track;
  muted: boolean;
  info?: TrackInfo;
}

export interface ParticipantEvents {
  trackPublished: (publication: TrackPublication) => void;
  trackUnpublished: (publication: TrackPublication) => void;
  trackMuted: (publication: TrackPublication) => void;
  trackUnmuted: (publication: TrackPublication) => void;
  trackSubscribed: (track: Track, publication: TrackPublication) => void;
  trackUnsubscribed: (track: Track, publication: TrackPublication) => void;
  metadataChanged: (metadata: string | undefined, participant: Participant) => void;
  nameChanged: (name: string | undefined, participant: Participant) => void;
  isSpeakingChanged: (speaking: boolean) => void;
  connectionQualityChanged: (quality: string) => void;
}

export abstract class Participant extends TypedEventEmitter<ParticipantEvents> {
  sid: string;
  identity: string;
  name?: string;
  metadata?: string;
  state: ParticipantState;
  isSpeaking = false;
  audioLevel = 0;
  attributes: Record<string, string> = {};
  trackPublications = new Map<string, TrackPublication>();

  constructor(sid: string, identity: string, name?: string, metadata?: string) {
    super();
    this.sid = sid;
    this.identity = identity;
    this.name = name;
    this.metadata = metadata;
    this.state = 0; // Joining
  }

  updateFromInfo(info: ParticipantInfo): void {
    this.sid = info.sid;
    this.identity = info.identity;
    this.state = info.state;

    if (info.name !== undefined && info.name !== this.name) {
      this.name = info.name;
      this.emit('nameChanged', this.name, this);
    }

    if (info.metadata !== undefined && info.metadata !== this.metadata) {
      this.metadata = info.metadata;
      this.emit('metadataChanged', this.metadata, this);
    }

    if (info.attributes) {
      this.attributes = { ...info.attributes };
    }
  }

  getTrackPublication(source: TrackSource): TrackPublication | undefined {
    for (const pub of this.trackPublications.values()) {
      if (pub.source === source) return pub;
    }
    return undefined;
  }

  getTrackPublicationBySid(trackSid: string): TrackPublication | undefined {
    return this.trackPublications.get(trackSid);
  }
}
