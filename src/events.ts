export enum RoomEvent {
  Connected = 'connected',
  Disconnected = 'disconnected',
  Reconnecting = 'reconnecting',
  Reconnected = 'reconnected',
  ParticipantJoined = 'participantJoined',
  ParticipantLeft = 'participantLeft',
  ParticipantUpdated = 'participantUpdated',
  TrackPublished = 'trackPublished',
  TrackUnpublished = 'trackUnpublished',
  TrackSubscribed = 'trackSubscribed',
  TrackUnsubscribed = 'trackUnsubscribed',
  TrackMuted = 'trackMuted',
  TrackUnmuted = 'trackUnmuted',
  ActiveSpeakersChanged = 'activeSpeakersChanged',
  RoomUpdated = 'roomUpdated',
  DataReceived = 'dataReceived',
  ConnectionQualityChanged = 'connectionQualityChanged',
}

export enum ParticipantEvent {
  TrackPublished = 'trackPublished',
  TrackUnpublished = 'trackUnpublished',
  TrackMuted = 'trackMuted',
  TrackUnmuted = 'trackUnmuted',
  TrackSubscribed = 'trackSubscribed',
  TrackUnsubscribed = 'trackUnsubscribed',
  MetadataChanged = 'metadataChanged',
  NameChanged = 'nameChanged',
  IsSpeakingChanged = 'isSpeakingChanged',
  ConnectionQualityChanged = 'connectionQualityChanged',
  DataReceived = 'dataReceived',
}

export enum TrackEvent {
  Muted = 'muted',
  Unmuted = 'unmuted',
  Ended = 'ended',
  Restarted = 'restarted',
  Subscribed = 'subscribed',
  Unsubscribed = 'unsubscribed',
  ElementAttached = 'elementAttached',
  ElementDetached = 'elementDetached',
}
