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
  /**
   * Successfully connected to the room.
   */
  Connected = 'connected',

  /**
   * Disconnected from the room. This may be triggered by the server, by an
   * explicit call to {@link Room.disconnect}, or because of a network failure.
   *
   * args: `(reason?: DisconnectReason)`
   */
  Disconnected = 'disconnected',

  /**
   * The SDK is attempting to reconnect to the room after a connection
   * interruption.
   */
  Reconnecting = 'reconnecting',

  /**
   * Successfully reconnected to the room after a temporary disconnection.
   */
  Reconnected = 'reconnected',

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
   * Unsubscribed from a remote track. The track should be detached from any
   * media elements at this point.
   *
   * args: `(track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant)`
   */
  TrackUnsubscribed = 'trackUnsubscribed',

  /**
   * A remote track has been muted.
   *
   * args: `(publication: RemoteTrackPublication, participant: RemoteParticipant)`
   */
  TrackMuted = 'trackMuted',

  /**
   * A remote track has been unmuted.
   *
   * args: `(publication: RemoteTrackPublication, participant: RemoteParticipant)`
   */
  TrackUnmuted = 'trackUnmuted',

  /**
   * The list of active speakers in the room has changed.
   *
   * args: `(speakers: ActiveSpeaker[])`
   */
  ActiveSpeakersChanged = 'activeSpeakersChanged',

  /**
   * Room-level metadata has been updated by the server.
   *
   * args: `(room: RoomInfo)`
   */
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

  /**
   * One of the participant's tracks has been muted.
   *
   * args: `(publication: TrackPublication)`
   */
  TrackMuted = 'trackMuted',

  /**
   * One of the participant's tracks has been unmuted.
   *
   * args: `(publication: TrackPublication)`
   */
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
   * The participant's metadata has changed.
   *
   * args: `(metadata: string | undefined, participant: Participant)`
   */
  MetadataChanged = 'metadataChanged',

  /**
   * The participant's display name has changed.
   *
   * args: `(name: string | undefined, participant: Participant)`
   */
  NameChanged = 'nameChanged',

  /**
   * The participant's speaking status has changed.
   *
   * args: `(speaking: boolean, participant: Participant)`
   */
  IsSpeakingChanged = 'isSpeakingChanged',

  /**
   * The connection quality of this participant has changed.
   *
   * args: `(quality: ConnectionQuality, participant: Participant)`
   */
  ConnectionQualityChanged = 'connectionQualityChanged',

  /**
   * Data received from this participant.
   *
   * args: `(data: ArrayBuffer)`
   */
  DataReceived = 'dataReceived',
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
   *
   * args: `(track: Track)`
   */
  Muted = 'muted',

  /**
   * The track has been unmuted.
   *
   * args: `(track: Track)`
   */
  Unmuted = 'unmuted',

  /**
   * The track has permanently ended. For local tracks, this typically means
   * the underlying `MediaStreamTrack` has been stopped.
   *
   * args: `(track: Track)`
   */
  Ended = 'ended',

  /**
   * The local track has been restarted with new constraints (e.g. device
   * change).
   *
   * args: `(track: LocalTrack)`
   */
  Restarted = 'restarted',

  /**
   * Subscribed to a remote track.
   *
   * args: `(track: RemoteTrack)`
   */
  Subscribed = 'subscribed',

  /**
   * Unsubscribed from a remote track.
   *
   * args: `(track: RemoteTrack)`
   */
  Unsubscribed = 'unsubscribed',

  /**
   * An `HTMLMediaElement` has been attached to this track via
   * {@link Track.attach}.
   *
   * args: `(element: HTMLMediaElement, track: Track)`
   */
  ElementAttached = 'elementAttached',

  /**
   * An `HTMLMediaElement` has been detached from this track via
   * {@link Track.detach}.
   *
   * args: `(element: HTMLMediaElement, track: Track)`
   */
  ElementDetached = 'elementDetached',
}
