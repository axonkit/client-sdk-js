import { TypedEventEmitter } from '../utils/events';
import type { ParticipantInfo, ParticipantState, TrackInfo, TrackSource } from '../protocol/types';
import type { Track } from '../track/Track';
import { ParticipantEvent } from '../events';

export class TrackPublication {
  trackSid: string;
  trackName: string;
  kind: string;
  source: TrackSource;
  track?: Track;
  muted: boolean;
  info?: TrackInfo;

  constructor(init: {
    trackSid: string;
    trackName: string;
    kind: string;
    source: TrackSource;
    track?: Track;
    muted: boolean;
    info?: TrackInfo;
  }) {
    this.trackSid = init.trackSid;
    this.trackName = init.trackName;
    this.kind = init.kind;
    this.source = init.source;
    this.track = init.track;
    this.muted = init.muted;
    this.info = init.info;
  }
}

export interface ParticipantEvents {
  [ParticipantEvent.TrackPublished]: (publication: TrackPublication) => void;
  [ParticipantEvent.TrackUnpublished]: (publication: TrackPublication) => void;
  [ParticipantEvent.TrackMuted]: (publication: TrackPublication) => void;
  [ParticipantEvent.TrackUnmuted]: (publication: TrackPublication) => void;
  [ParticipantEvent.TrackSubscribed]: (track: Track, publication: TrackPublication) => void;
  [ParticipantEvent.TrackUnsubscribed]: (track: Track, publication: TrackPublication) => void;
  [ParticipantEvent.MetadataChanged]: (metadata: string | undefined, participant: Participant) => void;
  [ParticipantEvent.NameChanged]: (name: string | undefined, participant: Participant) => void;
  [ParticipantEvent.IsSpeakingChanged]: (speaking: boolean) => void;
  [ParticipantEvent.ConnectionQualityChanged]: (quality: string) => void;
  [ParticipantEvent.DataReceived]: (data: ArrayBuffer) => void;
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
      this.emit(ParticipantEvent.NameChanged, this.name, this);
    }

    if (info.metadata !== undefined && info.metadata !== this.metadata) {
      this.metadata = info.metadata;
      this.emit(ParticipantEvent.MetadataChanged, this.metadata, this);
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
