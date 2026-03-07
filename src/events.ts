export enum RoomEvent {
  /**
   * Disconnected from room
   * args: (reason?: DisconnectReason)
   */
  Disconnected = 'disconnected',

  /**
   * Connected to room
   */
  Connected = 'connected',

  /**
   * Reconnecting to room
   */
  Reconnecting = 'reconnecting',

  /**
   * Reconnected to room
   */
  Reconnected = 'reconnected',

  /**
   * Remote participant joined
   * args: (participant: RemoteParticipant)
   */
  ParticipantJoined = 'participantJoined',

  /**
   * Remote participant left
   * args: (participant: RemoteParticipant, reason?: string)
   */
  ParticipantLeft = 'participantLeft',

  /**
   * Participant metadata updated
   * args: (participant: RemoteParticipant)
   */
  ParticipantUpdated = 'participantUpdated',

  /**
   * Track published by a remote participant
   * args: (publication: RemoteTrackPublication, participant: RemoteParticipant)
   */
  TrackPublished = 'trackPublished',

  /**
   * Track unpublished by a remote participant
   * args: (publication: RemoteTrackPublication, participant: RemoteParticipant)
   */
  TrackUnpublished = 'trackUnpublished',

  /**
   * Subscribed to a remote track
   * args: (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant)
   */
  TrackSubscribed = 'trackSubscribed',

  /**
   * Unsubscribed from a remote track
   * args: (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant)
   */
  TrackUnsubscribed = 'trackUnsubscribed',

  /**
   * Remote track muted
   * args: (publication: RemoteTrackPublication, participant: RemoteParticipant)
   */
  TrackMuted = 'trackMuted',

  /**
   * Remote track unmuted
   * args: (publication: RemoteTrackPublication, participant: RemoteParticipant)
   */
  TrackUnmuted = 'trackUnmuted',

  /**
   * Active speakers changed
   * args: (speakers: ActiveSpeaker[])
   */
  ActiveSpeakersChanged = 'activeSpeakersChanged',

  /**
   * Room metadata updated
   * args: (room: RoomInfo)
   */
  RoomUpdated = 'roomUpdated',

  /**
   * Data received from a participant
   * args: (data: ArrayBuffer, participant?: RemoteParticipant)
   */
  DataReceived = 'dataReceived',

  /**
   * Connection quality changed
   * args: (quality: ConnectionQuality, participant: Participant)
   */
  ConnectionQualityChanged = 'connectionQualityChanged',
}

export enum ParticipantEvent {
  /**
   * Track published
   * args: (publication: TrackPublication)
   */
  TrackPublished = 'trackPublished',

  /**
   * Track unpublished
   * args: (publication: TrackPublication)
   */
  TrackUnpublished = 'trackUnpublished',

  /**
   * Track muted
   * args: (publication: TrackPublication)
   */
  TrackMuted = 'trackMuted',

  /**
   * Track unmuted
   * args: (publication: TrackPublication)
   */
  TrackUnmuted = 'trackUnmuted',

  /**
   * Track subscribed
   * args: (track: RemoteTrack, publication: RemoteTrackPublication)
   */
  TrackSubscribed = 'trackSubscribed',

  /**
   * Track unsubscribed
   * args: (track: RemoteTrack, publication: RemoteTrackPublication)
   */
  TrackUnsubscribed = 'trackUnsubscribed',

  /**
   * Metadata changed
   * args: (metadata: string | undefined, participant: Participant)
   */
  MetadataChanged = 'metadataChanged',

  /**
   * Name changed
   * args: (name: string | undefined, participant: Participant)
   */
  NameChanged = 'nameChanged',

  /**
   * Speaking status changed
   * args: (speaking: boolean, participant: Participant)
   */
  IsSpeakingChanged = 'isSpeakingChanged',

  /**
   * Connection quality changed
   * args: (quality: ConnectionQuality, participant: Participant)
   */
  ConnectionQualityChanged = 'connectionQualityChanged',

  /**
   * Data received
   * args: (data: ArrayBuffer)
   */
  DataReceived = 'dataReceived',
}

export enum TrackEvent {
  /**
   * Track muted
   * args: (track: Track)
   */
  Muted = 'muted',

  /**
   * Track unmuted
   * args: (track: Track)
   */
  Unmuted = 'unmuted',

  /**
   * Track ended
   * args: (track: Track)
   */
  Ended = 'ended',

  /**
   * Track restarted (LocalTrack only)
   * args: (track: LocalTrack)
   */
  Restarted = 'restarted',

  /**
   * Track subscribed (RemoteTrack only)
   * args: (track: RemoteTrack)
   */
  Subscribed = 'subscribed',

  /**
   * Track unsubscribed (RemoteTrack only)
   * args: (track: RemoteTrack)
   */
  Unsubscribed = 'unsubscribed',

  /**
   * HTMLMediaElement attached
   * args: (element: HTMLMediaElement, track: Track)
   */
  ElementAttached = 'elementAttached',

  /**
   * HTMLMediaElement detached
   * args: (element: HTMLMediaElement, track: Track)
   */
  ElementDetached = 'elementDetached',
}
