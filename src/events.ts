/**
 * Events emitted by a {@link Room} instance.
 *
 * @example
 * ```ts
 * room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
 *   // handle new track
 * });
 * ```
 */
export enum RoomEvent {
  /** Successfully connected to the room. */
  Connected = 'connected',

  /** The signal channel to the server has been established (join accepted). */
  SignalConnected = 'signalConnected',

  /**
   * Disconnected from the room. This may be triggered by the server, by an
   * explicit call to {@link Room.disconnect}, or because of a network failure.
   *
   * args: `(reason?: {@link DisconnectReason})`
   */
  Disconnected = 'disconnected',

  /** The SDK is attempting to reconnect to the room after a connection interruption. */
  Reconnecting = 'reconnecting',

  /** Successfully reconnected to the room after a temporary disconnection. */
  Reconnected = 'reconnected',

  /**
   * Whenever the connection state of the room changes.
   *
   * args: `(state: RoomState)`
   */
  ConnectionStateChanged = 'connectionStateChanged',

  /**
   * When the signal connection to the server has been interrupted. This is
   * not always noticeable to users. It will resolve with
   * {@link RoomEvent.Reconnected} once re-established. If media also fails,
   * an additional {@link RoomEvent.Reconnecting} will be emitted.
   */
  SignalReconnecting = 'signalReconnecting',

  /**
   * When input or output devices on the machine have changed.
   */
  MediaDevicesChanged = 'mediaDevicesChanged',

  /**
   * When an error occurs while attempting to create a track from a device.
   * Use {@link MediaDeviceFailure.getFailure} to get the specific reason.
   *
   * args: `(error: Error)`
   */
  MediaDevicesError = 'mediaDevicesError',

  /**
   * The active device for a kind has been switched via
   * {@link Room.switchActiveDevice}.
   *
   * args: `(kind: MediaDeviceKind, deviceId: string)`
   */
  ActiveDeviceChanged = 'activeDeviceChanged',

  /**
   * A remote participant has joined the room.
   *
   * args: `(participant: {@link RemoteParticipant})`
   */
  ParticipantConnected = 'participantConnected',

  /**
   * A remote participant has left the room.
   *
   * args: `(participant: {@link RemoteParticipant}, reason?: {@link DisconnectReason})`
   */
  ParticipantDisconnected = 'participantDisconnected',

  /**
   * A remote participant's metadata or attributes have been updated.
   *
   * args: `(participant: {@link RemoteParticipant})`
   */
  ParticipantUpdated = 'participantUpdated',

  /**
   * Participant metadata has changed.
   *
   * args: `(prevMetadata: string | undefined, participant: {@link Participant})`
   */
  ParticipantMetadataChanged = 'participantMetadataChanged',

  /**
   * Participant's display name has changed.
   *
   * args: `(name: string, participant: {@link Participant})`
   */
  ParticipantNameChanged = 'participantNameChanged',

  /**
   * Participant attributes have changed.
   *
   * args: `(changedAttributes: Record<string, string>, participant: {@link Participant})`
   */
  ParticipantAttributesChanged = 'participantAttributesChanged',

  /**
   * A remote participant has published a new track.
   *
   * args: `(publication: {@link RemoteTrackPublication}, participant: {@link RemoteParticipant})`
   */
  TrackPublished = 'trackPublished',

  /**
   * A remote participant has unpublished a track.
   *
   * args: `(publication: {@link RemoteTrackPublication}, participant: {@link RemoteParticipant})`
   */
  TrackUnpublished = 'trackUnpublished',

  /**
   * A remote participant has published a new data track.
   *
   * args: `(dataTrack: {@link DataTrackInfo}, participant: {@link RemoteParticipant})`
   */
  DataTrackPublished = 'dataTrackPublished',

  /**
   * A remote participant has unpublished a data track.
   *
   * args: `(dataTrackSid: string, participant: {@link RemoteParticipant})`
   */
  DataTrackUnpublished = 'dataTrackUnpublished',

  /**
   * Subscribed to a new track from a remote participant. This is the event
   * where you would typically attach the track to a media element.
   *
   * args: `(track: {@link RemoteTrack}, publication: {@link RemoteTrackPublication}, participant: {@link RemoteParticipant})`
   */
  TrackSubscribed = 'trackSubscribed',

  /**
   * Could not subscribe to a track.
   *
   * args: `(trackSid: string, participant: {@link RemoteParticipant})`
   */
  TrackSubscriptionFailed = 'trackSubscriptionFailed',

  /**
   * Unsubscribed from a remote track. The track should be detached from any
   * media elements at this point.
   *
   * args: `(track: {@link RemoteTrack}, publication: {@link RemoteTrackPublication}, participant: {@link RemoteParticipant})`
   */
  TrackUnsubscribed = 'trackUnsubscribed',

  /**
   * A track has been muted. Fires on both remote and local participants.
   *
   * args: `(publication: {@link TrackPublication}, participant: {@link Participant})`
   */
  TrackMuted = 'trackMuted',

  /**
   * A track has been unmuted. Fires on both remote and local participants.
   *
   * args: `(publication: {@link TrackPublication}, participant: {@link Participant})`
   */
  TrackUnmuted = 'trackUnmuted',

  /**
   * A local track was published successfully.
   *
   * args: `(publication: {@link LocalTrackPublication}, participant: {@link LocalParticipant})`
   */
  LocalTrackPublished = 'localTrackPublished',

  /**
   * A local track was unpublished. When a user stops sharing their screen
   * by pressing "End" on the browser UI, this event will also fire.
   *
   * args: `(publication: {@link LocalTrackPublication}, participant: {@link LocalParticipant})`
   */
  LocalTrackUnpublished = 'localTrackUnpublished',

  /**
   * When a local audio track is published, the SDK checks whether there is
   * complete silence on that track and emits this event. This allows
   * applications to show UI informing users about hardware issues.
   */
  LocalAudioSilenceDetected = 'localAudioSilenceDetected',

  /**
   * Active speakers changed. List of speakers ordered by audio level.
   * Includes the local participant.
   *
   * args: `(speakers: {@link ActiveSpeaker}[])`
   */
  ActiveSpeakersChanged = 'activeSpeakersChanged',

  /** Room-level metadata has been updated by the server. */
  RoomMetadataChanged = 'roomMetadataChanged',

  /**
   * Data received from a remote participant via a DataChannel.
   *
   * args: `(data: ArrayBuffer, participant?: {@link RemoteParticipant})`
   */
  DataReceived = 'dataReceived',

  /**
   * The connection quality of a participant has changed.
   *
   * args: `(quality: {@link ConnectionQuality}, participant: {@link Participant})`
   */
  ConnectionQualityChanged = 'connectionQualityChanged',

  /**
   * The room's recording status has changed.
   *
   * args: `(recording: boolean)`
   */
  RecordingStatusChanged = 'recordingStatusChanged',

  /**
   * A participant's permissions have changed.
   *
   * args: `(prevPermissions: ParticipantPermission | undefined, participant: {@link Participant})`
   */
  ParticipantPermissionsChanged = 'participantPermissionsChanged',

  /**
   * Audio playback status has changed. When `canPlaybackAudio` becomes
   * `false`, the application should display UI to prompt user interaction,
   * then call {@link Room.startAudio}.
   */
  AudioPlaybackStatusChanged = 'audioPlaybackChanged',

  /**
   * A message has been received or sent (chat, whiteboard, document, etc.).
   *
   * args: `(message: {@link Message}, participant?: {@link Participant})`
   */
  ChatMessage = 'chatMessage',

  /**
   * Messages have been deleted.
   *
   * args: `(ids: string[], type?: string)`
   */
  MessageDeleted = 'messageDeleted',

  /**
   * A room shared state key has been updated.
   *
   * args: `(key: string, value: string, participantSid?: string, participantIdentity?: string)`
   */
  StateUpdated = 'stateUpdated',

  /**
   * A room shared state key has been deleted.
   *
   * args: `(key: string, participantSid?: string, participantIdentity?: string)`
   */
  StateDeleted = 'stateDeleted',

  /**
   * The server has pushed a new refresh token. Applications should persist
   * this token for reconnection.
   *
   * args: `(token: string)`
   */
  TokenRefreshed = 'tokenRefreshed',

  /**
   * Video playback status has changed. Similar to
   * {@link RoomEvent.AudioPlaybackStatusChanged} but for video.
   */
  VideoPlaybackStatusChanged = 'videoPlaybackChanged',

  /**
   * The stream state of a remote track has changed (e.g. the server
   * paused or resumed forwarding media).  This is distinct from
   * {@link RoomEvent.TrackMuted} which indicates the publisher's intent.
   *
   * args: `(publication: {@link RemoteTrackPublication}, streamState: {@link StreamState}, participant: {@link RemoteParticipant})`
   */
  TrackStreamStateChanged = 'trackStreamStateChanged',

  /**
   * A new group (breakout room) has been created.
   *
   * args: `(group: {@link GroupInfo})`
   */
  GroupCreated = 'groupCreated',

  /**
   * A group's metadata or participant count has changed.
   *
   * args: `(group: {@link GroupInfo})`
   */
  GroupUpdated = 'groupUpdated',

  /**
   * A group has been deleted. All participants in the group are
   * returned to the main room.
   *
   * args: `(groupId: string)`
   */
  GroupDeleted = 'groupDeleted',

  /**
   * A participant has joined a group.
   *
   * args: `(groupId: string, participant: {@link RemoteParticipant} | {@link LocalParticipant})`
   */
  GroupParticipantJoined = 'groupParticipantJoined',

  /**
   * A participant has left a group (returned to the main room).
   *
   * args: `(groupId: string, participant: {@link RemoteParticipant} | {@link LocalParticipant})`
   */
  GroupParticipantLeft = 'groupParticipantLeft',
}

/**
 * Events emitted by a {@link Participant} instance (local or remote).
 *
 * @example
 * ```ts
 * participant.on(ParticipantEvent.TrackMuted, (publication) => {
 *   console.log('track muted', publication.trackName);
 * });
 * ```
 */
export enum ParticipantEvent {
  /**
   * The participant has published a new track.
   *
   * args: `(publication: {@link TrackPublication})`
   */
  TrackPublished = 'trackPublished',

  /**
   * The participant has unpublished a track.
   *
   * args: `(publication: {@link TrackPublication})`
   */
  TrackUnpublished = 'trackUnpublished',

  /** One of the participant's tracks has been muted. */
  TrackMuted = 'trackMuted',

  /** One of the participant's tracks has been unmuted. */
  TrackUnmuted = 'trackUnmuted',

  /**
   * Subscribed to a new track from this participant.
   *
   * args: `(track: {@link RemoteTrack}, publication: {@link RemoteTrackPublication})`
   */
  TrackSubscribed = 'trackSubscribed',

  /**
   * Unsubscribed from a track of this participant.
   *
   * args: `(track: {@link RemoteTrack}, publication: {@link RemoteTrackPublication})`
   */
  TrackUnsubscribed = 'trackUnsubscribed',

  /**
   * A local track was published by this participant.
   *
   * args: `(publication: {@link LocalTrackPublication})`
   */
  LocalTrackPublished = 'localTrackPublished',

  /**
   * A local track was unpublished by this participant.
   *
   * args: `(publication: {@link LocalTrackPublication})`
   */
  LocalTrackUnpublished = 'localTrackUnpublished',

  /** The participant's metadata has changed. */
  MetadataChanged = 'metadataChanged',

  /** The participant's display name has changed. */
  NameChanged = 'nameChanged',

  /**
   * The participant's attributes have changed.
   *
   * args: `(changedAttributes: Record<string, string>, participant: {@link Participant})`
   */
  AttributesChanged = 'attributesChanged',

  /** The participant's speaking status has changed. */
  IsSpeakingChanged = 'isSpeakingChanged',

  /** The connection quality of this participant has changed. */
  ConnectionQualityChanged = 'connectionQualityChanged',

  /** The participant's permissions have changed. */
  PermissionsChanged = 'permissionsChanged',

  /**
   * The stream state of a remote track changed (server paused/resumed forwarding).
   *
   * args: `(publication: {@link RemoteTrackPublication}, streamState: {@link StreamState})`
   */
  TrackStreamStateChanged = 'trackStreamStateChanged',

  /** Data received from this participant. */
  DataReceived = 'dataReceived',

  /**
   * A chat message from this participant.
   *
   * args: `(message: {@link ChatMessage})`
   */
  ChatMessage = 'chatMessage',
}

/**
 * Events emitted by a {@link Track} instance.
 *
 * @example
 * ```ts
 * track.on(TrackEvent.Muted, () => {
 *   console.log('track was muted');
 * });
 * ```
 */
export enum TrackEvent {
  /**
   * The track has been muted. For local tracks this happens when
   * `setMuted(true)` is called or the producer is paused.
   */
  Muted = 'muted',

  /** The track has been unmuted. */
  Unmuted = 'unmuted',

  /**
   * The track has permanently ended. For local tracks, this typically means
   * the underlying `MediaStreamTrack` has been stopped.
   */
  Ended = 'ended',

  /** The local track has been restarted with new constraints (e.g. device change). */
  Restarted = 'restarted',

  /** Subscribed to a remote track. */
  Subscribed = 'subscribed',

  /** Unsubscribed from a remote track. */
  Unsubscribed = 'unsubscribed',

  /** An `HTMLMediaElement` has been attached to this track. */
  ElementAttached = 'elementAttached',

  /** An `HTMLMediaElement` has been detached from this track. */
  ElementDetached = 'elementDetached',

  /** Audio playback started successfully after calling `attach`. */
  AudioPlaybackStarted = 'audioPlaybackStarted',

  /**
   * Audio playback failed, typically due to browser autoplay policy.
   *
   * args: `(error?: Error)`
   */
  AudioPlaybackFailed = 'audioPlaybackFailed',

  /** Video playback started successfully after calling `attach`. */
  VideoPlaybackStarted = 'videoPlaybackStarted',

  /**
   * Video playback failed.
   *
   * args: `(error?: Error)`
   */
  VideoPlaybackFailed = 'videoPlaybackFailed',

  /**
   * The visibility of the video element changed (adaptive stream).
   *
   * args: `(visible: boolean, track: {@link RemoteVideoTrack})`
   */
  VisibilityChanged = 'visibilityChanged',

  /**
   * The dimensions of the video element changed (adaptive stream).
   *
   * args: `(dimensions: { width: number; height: number }, track: {@link RemoteVideoTrack})`
   */
  VideoDimensionsChanged = 'videoDimensionsChanged',

  /**
   * The upstream (publisher to SFU) has been paused by the SFU due to
   * lack of subscribers.
   */
  UpstreamPaused = 'upstreamPaused',

  /** The upstream has resumed after being paused. */
  UpstreamResumed = 'upstreamResumed',

  /**
   * Detected complete silence on an audio track after publishing.
   * This may indicate a hardware issue.
   */
  AudioSilenceDetected = 'audioSilenceDetected',

  /**
   * The stream state of this track changed (server paused/resumed forwarding).
   * Only emitted on remote tracks.
   *
   * args: `(track: {@link Track}, streamState: {@link StreamState})`
   */
  StreamStateChanged = 'streamStateChanged',

  /**
   * Fired when a new time-sync update is available for a remote track.
   * Provides the RTP timestamp and the corresponding local timestamp.
   *
   * args: `(update: { timestamp: number; rtpTimestamp: number })`
   */
  TimeSyncUpdate = 'timeSyncUpdate',
}
