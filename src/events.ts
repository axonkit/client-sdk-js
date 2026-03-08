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

  /**
   * Disconnected from the room. This may be triggered by the server, by an
   * explicit call to {@link Room.disconnect}, or because of a network failure.
   *
   * args: `(reason?: DisconnectReason)`
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
   * A remote participant has joined the room.
   *
   * args: `(participant: RemoteParticipant)`
   */
  ParticipantJoined = 'participantJoined',

  /**
   * A remote participant has left the room.
   *
   * args: `(participant: RemoteParticipant, reason?: string)`
   */
  ParticipantLeft = 'participantLeft',

  /**
   * A remote participant's metadata or attributes have been updated.
   *
   * args: `(participant: RemoteParticipant)`
   */
  ParticipantUpdated = 'participantUpdated',

  /**
   * Participant metadata has changed.
   *
   * args: `(prevMetadata: string | undefined, participant: Participant)`
   */
  ParticipantMetadataChanged = 'participantMetadataChanged',

  /**
   * Participant's display name has changed.
   *
   * args: `(name: string, participant: Participant)`
   */
  ParticipantNameChanged = 'participantNameChanged',

  /**
   * Participant attributes have changed.
   *
   * args: `(changedAttributes: Record<string, string>, participant: Participant)`
   */
  ParticipantAttributesChanged = 'participantAttributesChanged',

  /**
   * A remote participant has published a new track.
   *
   * args: `(publication: RemoteTrackPublication, participant: RemoteParticipant)`
   */
  TrackPublished = 'trackPublished',

  /**
   * A remote participant has unpublished a track.
   *
   * args: `(publication: RemoteTrackPublication, participant: RemoteParticipant)`
   */
  TrackUnpublished = 'trackUnpublished',

  /**
   * Subscribed to a new track from a remote participant. This is the event
   * where you would typically attach the track to a media element.
   *
   * args: `(track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant)`
   */
  TrackSubscribed = 'trackSubscribed',

  /**
   * Could not subscribe to a track.
   *
   * args: `(trackSid: string, participant: RemoteParticipant)`
   */
  TrackSubscriptionFailed = 'trackSubscriptionFailed',

  /**
   * Unsubscribed from a remote track. The track should be detached from any
   * media elements at this point.
   *
   * args: `(track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant)`
   */
  TrackUnsubscribed = 'trackUnsubscribed',

  /**
   * A track has been muted. Fires on both remote and local participants.
   *
   * args: `(publication: TrackPublication, participant: Participant)`
   */
  TrackMuted = 'trackMuted',

  /**
   * A track has been unmuted. Fires on both remote and local participants.
   *
   * args: `(publication: TrackPublication, participant: Participant)`
   */
  TrackUnmuted = 'trackUnmuted',

  /**
   * A local track was published successfully.
   *
   * args: `(publication: LocalTrackPublication, participant: LocalParticipant)`
   */
  LocalTrackPublished = 'localTrackPublished',

  /**
   * A local track was unpublished. When a user stops sharing their screen
   * by pressing "End" on the browser UI, this event will also fire.
   *
   * args: `(publication: LocalTrackPublication, participant: LocalParticipant)`
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
   * args: `(speakers: ActiveSpeaker[])`
   */
  ActiveSpeakersChanged = 'activeSpeakersChanged',

  /** Room-level metadata has been updated by the server. */
  RoomUpdated = 'roomUpdated',

  /**
   * Data received from a remote participant via a DataChannel.
   *
   * args: `(data: ArrayBuffer, participant?: RemoteParticipant)`
   */
  DataReceived = 'dataReceived',

  /**
   * The connection quality of a participant has changed.
   *
   * args: `(quality: ConnectionQuality, participant: Participant)`
   */
  ConnectionQualityChanged = 'connectionQualityChanged',

  /**
   * Audio playback status has changed. When `canPlaybackAudio` becomes
   * `false`, the application should display UI to prompt user interaction,
   * then call {@link Room.startAudio}.
   */
  AudioPlaybackStatusChanged = 'audioPlaybackStatusChanged',

  /**
   * A chat message has been received or sent.
   *
   * args: `(message: ChatMessage, participant?: Participant)`
   */
  ChatMessage = 'chatMessage',



  /**
   * Video playback status has changed. Similar to
   * {@link RoomEvent.AudioPlaybackStatusChanged} but for video.
   */
  VideoPlaybackStatusChanged = 'videoPlaybackStatusChanged',

  /**
   * The stream state of a remote track has changed (e.g. the server
   * paused or resumed forwarding media).  This is distinct from
   * {@link RoomEvent.TrackMuted} which indicates the publisher's intent.
   *
   * args: `(publication: RemoteTrackPublication, streamState: StreamState, participant: RemoteParticipant)`
   */
  TrackStreamStateChanged = 'trackStreamStateChanged',
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
   * args: `(publication: TrackPublication)`
   */
  TrackPublished = 'trackPublished',

  /**
   * The participant has unpublished a track.
   *
   * args: `(publication: TrackPublication)`
   */
  TrackUnpublished = 'trackUnpublished',

  /** One of the participant's tracks has been muted. */
  TrackMuted = 'trackMuted',

  /** One of the participant's tracks has been unmuted. */
  TrackUnmuted = 'trackUnmuted',

  /**
   * Subscribed to a new track from this participant.
   *
   * args: `(track: RemoteTrack, publication: RemoteTrackPublication)`
   */
  TrackSubscribed = 'trackSubscribed',

  /**
   * Unsubscribed from a track of this participant.
   *
   * args: `(track: RemoteTrack, publication: RemoteTrackPublication)`
   */
  TrackUnsubscribed = 'trackUnsubscribed',

  /**
   * A local track was published by this participant.
   *
   * args: `(publication: LocalTrackPublication)`
   */
  LocalTrackPublished = 'localTrackPublished',

  /**
   * A local track was unpublished by this participant.
   *
   * args: `(publication: LocalTrackPublication)`
   */
  LocalTrackUnpublished = 'localTrackUnpublished',

  /** The participant's metadata has changed. */
  MetadataChanged = 'metadataChanged',

  /** The participant's display name has changed. */
  NameChanged = 'nameChanged',

  /**
   * The participant's attributes have changed.
   *
   * args: `(changedAttributes: Record<string, string>, participant: Participant)`
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
   * args: `(publication: RemoteTrackPublication, streamState: StreamState)`
   */
  TrackStreamStateChanged = 'trackStreamStateChanged',

  /** Data received from this participant. */
  DataReceived = 'dataReceived',

  /**
   * A chat message from this participant.
   *
   * args: `(message: ChatMessage)`
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
   * args: `(visible: boolean, track: RemoteVideoTrack)`
   */
  VisibilityChanged = 'visibilityChanged',

  /**
   * The dimensions of the video element changed (adaptive stream).
   *
   * args: `(dimensions: { width: number; height: number }, track: RemoteVideoTrack)`
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
   * args: `(track: Track, streamState: StreamState)`
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
