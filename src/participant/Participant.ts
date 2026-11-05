import { EventEmitter } from 'events';
import { TypedEmitter } from '../utils/typedEmitter';
import type {
  ParticipantInfo,
  ParticipantPermission,
  TrackInfo,
  TrackSource,
} from '../protocol/types';
import {
  TrackKind,
  ConnectionQuality,
  ParticipantState,
  ParticipantKind,
  StreamState,
} from '../protocol/types';
import type { Track } from '../track/Track';
import type { LocalAudioTrack } from '../track/LocalAudioTrack';
import type { LocalVideoTrack } from '../track/LocalVideoTrack';
import type { RemoteAudioTrack } from '../track/RemoteAudioTrack';
import type { RemoteVideoTrack } from '../track/RemoteVideoTrack';
import { ParticipantEvent } from '../events';
import type { Message } from '../types';

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

  /** Whether the track is muted. */
  get isMuted(): boolean {
    return this.muted;
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

  /** Whether this publication belongs to the local participant. */
  get isLocal(): boolean {
    return false;
  }
}

export type ParticipantEvents<TPublication extends TrackPublication = TrackPublication> = {
  [ParticipantEvent.TrackPublished]: (publication: TPublication) => void;
  [ParticipantEvent.TrackUnpublished]: (publication: TPublication) => void;
  [ParticipantEvent.TrackMuted]: (publication: TPublication) => void;
  [ParticipantEvent.TrackUnmuted]: (publication: TPublication) => void;
  [ParticipantEvent.TrackSubscribed]: (track: Track, publication: TPublication) => void;
  [ParticipantEvent.TrackUnsubscribed]: (track: Track, publication: TPublication) => void;
  [ParticipantEvent.LocalTrackPublished]: (publication: TPublication) => void;
  [ParticipantEvent.LocalTrackUnpublished]: (publication: TPublication) => void;
  [ParticipantEvent.MetadataChanged]: (
    metadata: string | undefined,
    participant: Participant<TPublication>,
  ) => void;
  [ParticipantEvent.NameChanged]: (
    name: string | undefined,
    participant: Participant<TPublication>,
  ) => void;
  [ParticipantEvent.AttributesChanged]: (
    changedAttributes: Record<string, string>,
    participant: Participant<TPublication>,
  ) => void;
  [ParticipantEvent.IsSpeakingChanged]: (speaking: boolean) => void;
  [ParticipantEvent.ConnectionQualityChanged]: (quality: ConnectionQuality) => void;
  [ParticipantEvent.PermissionsChanged]: (prevPermissions?: ParticipantPermission) => void;
  [ParticipantEvent.TrackStreamStateChanged]: (
    publication: TPublication,
    streamState: StreamState,
  ) => void;
  [ParticipantEvent.DataReceived]: (payload: Uint8Array) => void;
  [ParticipantEvent.ChatMessage]: (message: Message) => void;
};

export abstract class Participant<
  TPublication extends TrackPublication = TrackPublication,
> extends TypedEmitter<ParticipantEvents<TPublication>> {
  sid: string;
  identity: string;
  name?: string;
  metadata?: string;
  state: ParticipantState;
  isSpeaking = false;
  audioLevel = 0;
  attributes: Record<string, string> = {};
  permissions?: ParticipantPermission;
  /** The group (breakout room) this participant is currently in. `undefined` = main room. */
  groupId?: string;
  trackPublications = new Map<string, TPublication>();
  audioTrackPublications = new Map<string, TPublication>();
  videoTrackPublications = new Map<string, TPublication>();
  lastSpokeAt?: Date;
  joinedAt?: Date;

  private _connectionQuality: ConnectionQuality = ConnectionQuality.Unknown;
  private _kind: ParticipantKind = ParticipantKind.Standard;
  private _activeResolvers: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

  private emitParticipantEvent<E extends keyof ParticipantEvents<TPublication>>(
    event: E,
    ...args: Parameters<ParticipantEvents<TPublication>[E]>
  ): void {
    EventEmitter.prototype.emit.call(this, event, ...args);
  }

  constructor(sid: string, identity: string, name?: string, metadata?: string) {
    super();
    this.sid = sid;
    this.identity = identity;
    this.name = name;
    this.metadata = metadata;
    this.state = ParticipantState.Joining;
  }

  abstract get isLocal(): boolean;

  /** The kind of participant (Standard, Agent, etc.). */
  get kind(): ParticipantKind {
    return this._kind;
  }

  /** Whether this participant is an AI agent. */
  get isAgent(): boolean {
    return this._kind === ParticipantKind.Agent;
  }

  /** Whether the participant is in an active (joined) state. */
  get isActive(): boolean {
    return this.state === ParticipantState.Joined;
  }

  /**
   * Returns a promise that resolves once the participant is active
   * and ready to receive data messages. Rejects if the participant
   * transitions away from the active state first.
   */
  waitUntilActive(): Promise<void> {
    if (this.isActive) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this._activeResolvers.push({ resolve, reject });
    });
  }

  /** Current connection quality for this participant. */
  get connectionQuality(): ConnectionQuality {
    return this._connectionQuality;
  }

  /** @internal */
  setConnectionQuality(quality: ConnectionQuality): void {
    if (this._connectionQuality === quality) return;
    this._connectionQuality = quality;
    this.emitParticipantEvent(ParticipantEvent.ConnectionQualityChanged, quality);
  }

  /** @internal */
  setPermissions(permissions: ParticipantPermission): boolean {
    const prevPermissions = this.permissions;
    const changed =
      permissions.canPublish !== this.permissions?.canPublish ||
      permissions.canSubscribe !== this.permissions?.canSubscribe ||
      permissions.canPublishData !== this.permissions?.canPublishData ||
      permissions.hidden !== this.permissions?.hidden ||
      permissions.recorder !== this.permissions?.recorder ||
      (permissions.canPublishSources?.length ?? 0) !==
        (this.permissions?.canPublishSources?.length ?? 0) ||
      (permissions.canPublishSources ?? []).some(
        (value, index) => value !== this.permissions?.canPublishSources?.[index],
      );
    this.permissions = permissions;

    if (changed) {
      this.emitParticipantEvent(ParticipantEvent.PermissionsChanged, prevPermissions);
    }
    return changed;
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

  /**
   * Returns all track publications as an array.
   */
  getTrackPublications(): TPublication[] {
    return Array.from(this.trackPublications.values());
  }

  updateFromInfo(info: ParticipantInfo): void {
    this.sid = info.sid;
    this.identity = info.identity;

    const wasActive = this.isActive;
    this.state = info.state;

    if (info.kind !== undefined) {
      this._kind = info.kind;
    }
    if (info.joinedAt !== undefined && !this.joinedAt) {
      this.joinedAt = new Date(info.joinedAt);
    }

    if (info.name !== undefined && info.name !== this.name) {
      this.name = info.name;
      this.emitParticipantEvent(
        ParticipantEvent.NameChanged,
        this.name,
        this as Participant<TPublication>,
      );
    }

    if (info.metadata !== undefined && info.metadata !== this.metadata) {
      this.metadata = info.metadata;
      this.emitParticipantEvent(
        ParticipantEvent.MetadataChanged,
        this.metadata,
        this as Participant<TPublication>,
      );
    }

    if (info.permission) {
      this.setPermissions(info.permission);
    }

    if (info.groupId !== undefined) {
      this.groupId = info.groupId || undefined;
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
        this.emitParticipantEvent(
          ParticipantEvent.AttributesChanged,
          changed,
          this as Participant<TPublication>,
        );
      }
    }

    if (!wasActive && this.isActive) {
      for (const { resolve } of this._activeResolvers) {
        resolve();
      }
      this._activeResolvers = [];
    } else if (wasActive && !this.isActive) {
      // Participant went inactive (left / disconnected) — unblock waiters
      // instead of leaving their promises pending forever.
      for (const { reject } of this._activeResolvers) {
        reject(new Error(`Participant ${this.identity} is no longer active`));
      }
      this._activeResolvers = [];
    }
  }

  getTrackPublication(source: TrackSource): TPublication | undefined {
    for (const pub of this.trackPublications.values()) {
      if (pub.source === source) return pub;
    }
    return undefined;
  }

  /** @internal */
  getTrackPublicationBySid(trackSid: string): TPublication | undefined {
    return this.trackPublications.get(trackSid);
  }

  /**
   * Find a track publication by its name.
   */
  getTrackPublicationByName(name: string): TPublication | undefined {
    for (const pub of this.trackPublications.values()) {
      if (pub.trackName === name) return pub;
    }
    return undefined;
  }

  /** @internal */
  protected addTrackPublicationToMaps(pub: TPublication): void {
    this.trackPublications.set(pub.trackSid, pub);
    if (pub.kind === TrackKind.Audio) {
      this.audioTrackPublications.set(pub.trackSid, pub);
    } else if (pub.kind === TrackKind.Video) {
      this.videoTrackPublications.set(pub.trackSid, pub);
    }
  }

  /** @internal */
  protected removeTrackPublicationFromMaps(trackSid: string): TPublication | undefined {
    const pub = this.trackPublications.get(trackSid);
    if (!pub) return undefined;
    this.trackPublications.delete(trackSid);
    this.audioTrackPublications.delete(trackSid);
    this.videoTrackPublications.delete(trackSid);
    return pub;
  }

  private isTrackEnabled(source: TrackSource): boolean {
    const pub = this.getTrackPublication(source);
    return pub?.isSubscribed === true && pub.isEnabled;
  }
}
