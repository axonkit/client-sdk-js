import { TypedEventEmitter } from '../utils/events';
import type { ParticipantInfo, ParticipantState, TrackInfo, TrackSource } from '../protocol/types';
import { TrackKind } from '../protocol/types';
import type { Track } from '../track/Track';
import type { LocalAudioTrack } from '../track/LocalAudioTrack';
import type { LocalVideoTrack } from '../track/LocalVideoTrack';
import type { RemoteAudioTrack } from '../track/RemoteAudioTrack';
import type { RemoteVideoTrack } from '../track/RemoteVideoTrack';
import { ParticipantEvent } from '../events';
import type { ChatMessage } from '../types';

/**
 * Subscription status for a remote track publication.
 */
export enum SubscriptionStatus {
  /** The track is desired but not yet subscribed. */
  Desired = 'desired',
  /** The track is subscribed and a {@link Track} is available. */
  Subscribed = 'subscribed',
  /** The track is not subscribed. */
  Unsubscribed = 'unsubscribed',
}

export class TrackPublication {
  trackSid: string;
  trackName: string;
  kind: string;
  source: TrackSource;
  track?: Track;
  muted: boolean;
  info?: TrackInfo;

  /** MIME type of the track (e.g. `video/VP8`, `audio/opus`). */
  mimeType?: string;

  /** Whether the track was published with simulcast. */
  simulcasted?: boolean;

  /** Original video dimensions from the publisher. */
  dimensions?: { width: number; height: number };

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

    if (init.info) {
      if (init.info.width && init.info.height) {
        this.dimensions = { width: init.info.width, height: init.info.height };
      }
    }
  }

  /** Whether the track is subscribed (i.e. a concrete {@link Track} is available). */
  get isSubscribed(): boolean {
    return this.track !== undefined;
  }

  /** Whether the track is enabled (not muted). */
  get isEnabled(): boolean {
    return !this.muted;
  }

  /** Type-safe audio track getter. Returns `undefined` if the track is video. */
  get audioTrack(): LocalAudioTrack | RemoteAudioTrack | undefined {
    if (this.kind === TrackKind.Audio) {
      return this.track as any;
    }
    return undefined;
  }

  /** Type-safe video track getter. Returns `undefined` if the track is audio. */
  get videoTrack(): LocalVideoTrack | RemoteVideoTrack | undefined {
    if (this.kind === TrackKind.Video) {
      return this.track as any;
    }
    return undefined;
  }

  mute(): void {}

  unmute(): void {}
}

export interface ParticipantEvents {
  [ParticipantEvent.TrackPublished]: (publication: TrackPublication) => void;
  [ParticipantEvent.TrackUnpublished]: (publication: TrackPublication) => void;
  [ParticipantEvent.TrackMuted]: (publication: TrackPublication) => void;
  [ParticipantEvent.TrackUnmuted]: (publication: TrackPublication) => void;
  [ParticipantEvent.TrackSubscribed]: (track: Track, publication: TrackPublication) => void;
  [ParticipantEvent.TrackUnsubscribed]: (track: Track, publication: TrackPublication) => void;
  [ParticipantEvent.LocalTrackPublished]: (publication: TrackPublication) => void;
  [ParticipantEvent.LocalTrackUnpublished]: (publication: TrackPublication) => void;
  [ParticipantEvent.MetadataChanged]: (metadata: string | undefined, participant: Participant) => void;
  [ParticipantEvent.NameChanged]: (name: string | undefined, participant: Participant) => void;
  [ParticipantEvent.AttributesChanged]: (changedAttributes: Record<string, string>, participant: Participant) => void;
  [ParticipantEvent.IsSpeakingChanged]: (speaking: boolean) => void;
  [ParticipantEvent.ConnectionQualityChanged]: (quality: string) => void;
  [ParticipantEvent.DataReceived]: (data: ArrayBuffer) => void;
  [ParticipantEvent.ChatMessage]: (message: ChatMessage) => void;
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

  /** Whether the participant has an enabled camera track. */
  get isCameraEnabled(): boolean {
    return this.isTrackEnabled('camera' as TrackSource);
  }

  /** Whether the participant has an enabled microphone track. */
  get isMicrophoneEnabled(): boolean {
    return this.isTrackEnabled('microphone' as TrackSource);
  }

  /** Whether the participant is sharing their screen. */
  get isScreenShareEnabled(): boolean {
    return this.isTrackEnabled('screen_share' as TrackSource);
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
      const changed: Record<string, string> = {};
      for (const [k, v] of Object.entries(info.attributes)) {
        if (this.attributes[k] !== v) {
          changed[k] = v;
        }
      }
      this.attributes = { ...info.attributes };
      if (Object.keys(changed).length > 0) {
        this.emit(ParticipantEvent.AttributesChanged, changed, this);
      }
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

  /**
   * Find a track publication by its name.
   */
  getTrackPublicationByName(name: string): TrackPublication | undefined {
    for (const pub of this.trackPublications.values()) {
      if (pub.trackName === name) return pub;
    }
    return undefined;
  }

  private isTrackEnabled(source: TrackSource): boolean {
    const pub = this.getTrackPublication(source);
    return pub?.isSubscribed === true && pub.isEnabled;
  }
}
