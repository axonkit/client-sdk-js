import type {
  Message,
  ConnectOptions,
  RoomOptions,
  ScalabilityMode,
  VideoCaptureOptions,
  VideoCodec,
} from '../../src/index';
import {
  BackupCodecPolicy,
  ConnectionQuality,
  RoomState,
  DisconnectReason,
  LogLevel,
  MediaDeviceFailure,
  Participant,
  ParticipantEvent,
  RemoteParticipant,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  ScreenSharePresets,
  TrackPublication,
  TrackSource,
  VideoPresets,
  VideoQuality,
  createAudioAnalyser,
  setLogLevel,
  supportsAV1,
  supportsVP9,
  LocalParticipant,
  LocalTrack,
  Track,
} from '../../src/index';
import { isSVCCodec } from '../../src/track/publishUtils';
import { supportsH265 } from '../../src/utils/browser';
import {
  getDemoCanvasElement,
  startDemoCanvasWorkerAnimation,
  stopDemoCanvasWorkerAnimation,
} from './canvasCaptureSource';

setLogLevel(LogLevel.DEBUG);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
type CanvasVideoTrack = MediaStreamTrack;

const state = {
  isFrontFacing: false,
  encoder: new TextEncoder(),
  decoder: new TextDecoder(),
  defaultDevices: new Map<MediaDeviceKind, string>([['audioinput', 'default']]),
  bitrateInterval: undefined as ReturnType<typeof setInterval> | undefined,
  chatMessages: new Map<string, { text: string; participant?: Participant }>(),
  /** When both camera and canvas are shown, which track is full-screen (default: camera). */
  primaryVideoByIdentity: new Map<string, 'camera' | 'canvas'>(),
  canvasVideo: {
    track: undefined as CanvasVideoTrack | undefined,
    supported: false,
  },
};
let currentRoom: Room | undefined;
const CANVAS_TRACK_NAME = 'demo-canvas-video';
const CANVAS_FRAME_RATE = 30;
/** Matches 1280×720 canvas; raise if quality is insufficient. */
const CANVAS_VIDEO_MAX_BITRATE = 2_000_000;

let startTime: number;

let streamReaderAbortController: AbortController | undefined;

const searchParams = new URLSearchParams(window.location.search);
const storedUrl = searchParams.get('url') ?? 'http://localhost:7990';
const storedRoomName = searchParams.get('room') ?? 'test';
const storedToken = searchParams.get('token') ?? '';
(<HTMLInputElement>$('url')).value = storedUrl;
(<HTMLInputElement>$('room-name')).value = storedRoomName;
(<HTMLInputElement>$('token')).value = storedToken;

// function updateSearchParams(url: string, token: string) {
//   const params = new URLSearchParams({ url, token });
//   window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
// }

const appActions = {
  sendFile: async () => {
    console.log('start sending');
    const file = ($('file') as HTMLInputElement).files?.[0];
    if (!file) return;
    currentRoom?.localParticipant.sendFile(file, {
      mimeType: file.type,
      topic: 'files',
      onProgress: (progress) => console.log('sending file, progress', Math.ceil(progress * 100)),
    });
  },

  connectWithFormInput: async () => {
    const url = (<HTMLInputElement>$('url')).value;
    const roomName = (<HTMLInputElement>$('room-name')).value.trim() || 'test';
    const token = (<HTMLInputElement>$('token')).value;
    const simulcast = (<HTMLInputElement>$('simulcast')).checked;
    const dynacast = (<HTMLInputElement>$('dynacast')).checked;
    const forceTURN = (<HTMLInputElement>$('force-turn')).checked;
    const adaptiveStream = (<HTMLInputElement>$('adaptive-stream')).checked;
    const shouldPublish = (<HTMLInputElement>$('publish-option')).checked;
    const preferredCodec = (<HTMLSelectElement>$('preferred-codec')).value as VideoCodec;
    const scalabilityMode = (<HTMLSelectElement>$('scalability-mode')).value;
    const autoSubscribe = (<HTMLInputElement>$('auto-subscribe')).checked;
    let backupCodecPolicy: BackupCodecPolicy | undefined;
    if ((<HTMLInputElement>$('multicodec-simulcast')).checked) {
      backupCodecPolicy = BackupCodecPolicy.SIMULCAST;
    }

    // updateSearchParams(url, token);

    const roomOpts: RoomOptions = {
      roomName,
      adaptiveStream,
      dynacast,
      publishDefaults: {
        simulcast,
        videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
        videoCodec: preferredCodec || 'av1',
        dtx: true,
        red: true,
        forceStereo: false,
        screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
        scalabilityMode: 'L3T3_KEY',
        backupCodecPolicy,
      },
      videoCaptureDefaults: {
        resolution: VideoPresets.h720.resolution,
      },
    };
    if (
      roomOpts.publishDefaults?.videoCodec === 'av1' ||
      roomOpts.publishDefaults?.videoCodec === 'vp9'
    ) {
      roomOpts.publishDefaults!.backupCodec = true;
      if (scalabilityMode !== '') {
        roomOpts.publishDefaults!.scalabilityMode = scalabilityMode as ScalabilityMode;
      }
    }

    const connectOpts: ConnectOptions = {
      autoSubscribe,
    };
    if (forceTURN) {
      connectOpts.rtcConfig = {
        iceTransportPolicy: 'relay',
      };
    }
    await appActions.connectToRoom(url, token, roomOpts, connectOpts, shouldPublish);

    state.bitrateInterval = setInterval(renderBitrate, 1000);
  },

  connectToRoom: async (
    url: string,
    token: string,
    roomOptions?: RoomOptions,
    connectOptions?: ConnectOptions,
    shouldPublish?: boolean,
  ): Promise<Room | undefined> => {
    const room = new Room(roomOptions);

    startTime = Date.now();
    room
      .on(RoomEvent.ParticipantJoined, participantConnected)
      .on(RoomEvent.ParticipantLeft, participantDisconnected)
      .on(RoomEvent.ChatMessage, handleChatMessage)
      .on(RoomEvent.Disconnected, handleRoomDisconnect)
      .on(RoomEvent.Reconnecting, () => appendLog('Reconnecting to room'))
      .on(RoomEvent.Reconnected, () => {
        appendLog('Successfully reconnected');
      })
      .on(RoomEvent.LocalTrackPublished, (pub) => {
        const track = pub.track;
        if (track && track.kind === 'audio' && room.localParticipant) {
          const { analyser } = createAudioAnalyser(track);
          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          setInterval(() => {
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const avg = sum / dataArray.length / 255;
            $<HTMLProgressElement>('local-volume')?.setAttribute('value', avg.toFixed(4));
          }, 200);
        }
        renderParticipant(room.localParticipant);
        updateButtonsForPublishState();
        renderScreenShare(room);
      })
      .on(RoomEvent.LocalTrackUnpublished, () => {
        renderParticipant(room.localParticipant);
        updateButtonsForPublishState();
        renderScreenShare(room);
      })
      .on(RoomEvent.MediaDevicesChanged, handleDevicesChanged)
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (room.canPlaybackAudio) {
          $('start-audio-button')?.setAttribute('disabled', 'true');
        } else {
          $('start-audio-button')?.removeAttribute('disabled');
        }
      })
      .on(RoomEvent.MediaDevicesError, (e: Error) => {
        const failure = MediaDeviceFailure.getFailure(e);
        appendLog('media device failure', failure);
      })
      .on(
        RoomEvent.ConnectionQualityChanged,
        (quality: ConnectionQuality, participant?: Participant) => {
          appendLog('connection quality changed', participant?.identity, quality);
        },
      )
      .on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
        appendLog('subscribed to track', pub.trackSid, participant.identity);
        renderParticipant(participant);
        renderScreenShare(room);
      })
      .on(RoomEvent.TrackUnsubscribed, (_, pub, participant) => {
        appendLog('unsubscribed from track', pub.trackSid);
        renderParticipant(participant);
        renderScreenShare(room);
      })
      .on(RoomEvent.TrackStreamStateChanged, (pub, streamState, participant) => {
        appendLog(
          `stream state changed for ${pub.trackSid} (${participant.identity}) to ${streamState.toString()}`,
        );
      });

    room.registerTextStreamHandler('lk.chat', async (reader, participant) => {
      streamReaderAbortController = new AbortController();
      (<HTMLButtonElement>$('cancel-chat-receive-button')).style.display = 'block';

      const info = reader.info;

      let message = '';
      try {
        for await (const chunk of reader) {
          if (streamReaderAbortController?.signal.aborted) break;
          message += chunk;
          handleChatMessage(
            { id: info.id, timestamp: info.timestamp, message },
            room.getParticipantByIdentity(participant?.identity),
          );
        }
      } catch {
        message += 'ERROR';
        handleChatMessage(
          { id: info.id, timestamp: info.timestamp, message },
          room.getParticipantByIdentity(participant?.identity),
        );
      }

      streamReaderAbortController = undefined;
      (<HTMLButtonElement>$('cancel-chat-receive-button')).style.display = 'none';
    });

    room.registerByteStreamHandler('files', async (reader, participant) => {
      const info = reader.info;
      appendLog(`started to receive a file called "${info.name}" from ${participant?.identity}`);

      const progressContainer = document.createElement('div');
      progressContainer.style.margin = '10px 0';
      const progressLabel = document.createElement('div');
      progressLabel.innerText = `Receiving "${info.name}" from ${participant?.identity}...`;
      const progressBar = document.createElement('progress');
      progressBar.max = 100;
      progressBar.value = 0;
      progressBar.style.width = '100%';

      progressContainer.appendChild(progressLabel);
      progressContainer.appendChild(progressBar);
      $('chat-area').after(progressContainer);

      streamReaderAbortController = new AbortController();
      (<HTMLButtonElement>$('cancel-chat-receive-button')).style.display = 'block';

      let byteContents: Uint8Array;
      try {
        byteContents = await reader.readAll();
      } catch {
        progressLabel.innerText = `Receiving "${info.name}" - readAll aborted!`;
        return;
      }
      progressBar.value = 100;
      const result = new Blob([byteContents as unknown as BlobPart], { type: info.mimeType });
      appendLog(`Completely received file "${info.name}" from ${participant?.identity}`);

      streamReaderAbortController = undefined;
      (<HTMLButtonElement>$('cancel-chat-receive-button')).style.display = 'none';
      progressContainer.remove();

      if (info.mimeType.startsWith('image/')) {
        const imgContainer = document.createElement('div');
        imgContainer.style.margin = '10px 0';
        imgContainer.style.padding = '10px';

        const img = document.createElement('img');
        img.style.maxWidth = '300px';
        img.style.maxHeight = '300px';
        img.src = URL.createObjectURL(result);

        const downloadLink = document.createElement('a');
        downloadLink.href = img.src;
        downloadLink.innerText = `Download ${info.name}`;
        downloadLink.setAttribute('download', info.name);
        downloadLink.style.display = 'block';
        downloadLink.style.marginTop = '5px';

        imgContainer.appendChild(img);
        imgContainer.appendChild(downloadLink);
        $('chat-area').after(imgContainer);
      } else {
        const downloadLink = document.createElement('a');
        downloadLink.href = URL.createObjectURL(result);
        downloadLink.innerText = `Download ${info.name}`;
        downloadLink.setAttribute('download', info.name);
        downloadLink.style.margin = '10px';
        downloadLink.style.padding = '5px';
        downloadLink.style.display = 'block';
        $('chat-area').after(downloadLink);
      }
    });

    try {
      const publishPromise = new Promise<void>(async (resolve, reject) => {
        try {
          if (shouldPublish) {
            await room.localParticipant.enableCameraAndMicrophone();
            appendLog(`tracks published in ${Date.now() - startTime}ms`);
          }
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      await Promise.all([
        room.connect(url, token, connectOptions),
        publishPromise.catch(appendLog),
      ]);
      const elapsed = Date.now() - startTime;
      appendLog(`successfully connected to ${room.name} in ${Math.round(elapsed)}ms`);
    } catch (error: any) {
      let message: any = error;
      if (error.message) {
        message = error.message;
      }
      appendLog('could not connect:', message);
      return;
    }
    currentRoom = room;
    (window as any).currentRoom = room;
    setButtonsForState(true);

    room.remoteParticipants.forEach((participant) => {
      participantConnected(participant);
    });
    participantConnected(room.localParticipant);
    updateButtonsForPublishState();

    return room;
  },

  toggleAudio: async () => {
    if (!currentRoom) return;
    const enabled = currentRoom.localParticipant.isMicrophoneEnabled;
    setButtonDisabled('toggle-audio-button', true);
    appendLog(enabled ? 'disabling audio' : 'enabling audio');
    await currentRoom.localParticipant.setMicrophoneEnabled(!enabled);
    setButtonDisabled('toggle-audio-button', false);
    updateButtonsForPublishState();
  },

  toggleVideo: async () => {
    if (!currentRoom) return;
    setButtonDisabled('toggle-video-button', true);
    const enabled = currentRoom.localParticipant.isCameraEnabled;
    appendLog(enabled ? 'disabling video' : 'enabling video');
    await currentRoom.localParticipant.setCameraEnabled(!enabled);
    setButtonDisabled('toggle-video-button', false);
    renderParticipant(currentRoom.localParticipant);
    updateButtonsForPublishState();
  },

  toggleCanvasVideo: async () => {
    if (!currentRoom) return;
    setButtonDisabled('toggle-canvas-video-button', true);
    try {
      const existingPublication = getCanvasTrackPublication(currentRoom.localParticipant);
      if (existingPublication?.track) {
        appendLog('stopping canvas video');
        await currentRoom.localParticipant.unpublishTrack(existingPublication.track as LocalTrack);
      } else {
        const canvasTrack = getCanvasCaptureTrack();
        const canvasCodec = getCanvasVideoCodec();
        appendLog(`publishing canvas video with ${canvasCodec}`);
        await currentRoom.localParticipant.publishTrack(canvasTrack, {
          name: CANVAS_TRACK_NAME,
          source: TrackSource.Unknown,
          videoCodec: canvasCodec,
          videoEncoding: {
            maxBitrate: CANVAS_VIDEO_MAX_BITRATE,
            maxFramerate: CANVAS_FRAME_RATE,
          },
          simulcast: false,
          backupCodec: true,
          degradationPreference: 'maintain-framerate',
        });
      }
      renderParticipant(currentRoom.localParticipant);
      updateButtonsForPublishState();
    } catch (error) {
      appendLog('error toggling canvas video', error);
    } finally {
      setButtonDisabled('toggle-canvas-video-button', false);
    }
  },

  flipVideo: () => {
    const videoPub = currentRoom?.localParticipant.getTrackPublication(TrackSource.Camera);
    if (!videoPub) return;
    if (state.isFrontFacing) {
      setButtonState('flip-video-button', 'Front Camera', false);
    } else {
      setButtonState('flip-video-button', 'Back Camera', false);
    }
    state.isFrontFacing = !state.isFrontFacing;
    const options: VideoCaptureOptions = {
      resolution: VideoPresets.h720.resolution,
      facingMode: state.isFrontFacing ? 'user' : 'environment',
    };
    (videoPub as any).videoTrack?.restartTrack(options);
  },

  shareScreen: async () => {
    if (!currentRoom) return;
    const enabled = currentRoom.localParticipant.isScreenShareEnabled;
    appendLog(`${enabled ? 'stopping' : 'starting'} screen share`);
    setButtonDisabled('share-screen-button', true);
    try {
      await currentRoom.localParticipant.setScreenShareEnabled(!enabled, {
        audio: true,
        resolution: VideoPresets.h1080.resolution,
        frameRate: 30,
        /** 本机扬声器不播放被共享源里的声音；远端仍可收到 ScreenShareAudio。 */
        suppressLocalAudioPlayback: true,
      });
    } catch (e) {
      appendLog('error sharing screen', e);
    }
    setButtonDisabled('share-screen-button', false);
    updateButtonsForPublishState();
  },

  startAudio: () => {
    currentRoom?.startAudio();
  },

  enterText: () => {
    if (!currentRoom) return;
    const textField = <HTMLInputElement>$('entry');
    if (textField.value) {
      const lp = currentRoom.localParticipant;
      const message = textField.value;
      lp.sendText(message, { topic: 'lk.chat' }).then(({ id }) => {
        handleChatMessage({ id, timestamp: Date.now(), message }, lp);
      });
      textField.value = '';
    }
  },

  cancelChatReceive: () => {
    if (!streamReaderAbortController) return;
    streamReaderAbortController.abort();
    (<HTMLButtonElement>$('cancel-chat-receive-button')).style.display = 'none';
  },

  disconnectRoom: () => {
    if (currentRoom) {
      currentRoom.disconnect();
    }
    if (state.bitrateInterval) {
      clearInterval(state.bitrateInterval);
    }
  },

  handleDeviceSelected: async (e: Event) => {
    const deviceId = (<HTMLSelectElement>e.target).value;
    const elementId = (<HTMLSelectElement>e.target).id;
    const kind = elementMapping[elementId];
    if (!kind) return;

    if (currentRoom) {
      await currentRoom.switchActiveDevice(kind, deviceId);
    }
  },

  handlePreferredQuality: (e: Event) => {
    const quality = (<HTMLSelectElement>e.target).value;
    let q = VideoQuality.HIGH;
    switch (quality) {
      case 'low':
        q = VideoQuality.LOW;
        break;
      case 'medium':
        q = VideoQuality.MEDIUM;
        break;
      case 'high':
        q = VideoQuality.HIGH;
        break;
      default:
        break;
    }
    if (currentRoom) {
      currentRoom.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((track) => {
          (track as RemoteTrackPublication).setVideoQuality(q);
        });
      });
    }
  },

  handlePreferredFPS: (e: Event) => {
    const fps = +(<HTMLSelectElement>e.target).value;
    if (currentRoom) {
      currentRoom.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((track) => {
          (track as RemoteTrackPublication).setVideoFPS(fps);
        });
      });
    }
  },
};

(window as any).appActions = appActions;

// ----------------------------- event handlers ----------------------------- //

function handleChatMessage(msg: Message, participant?: Participant) {
  state.chatMessages.set(msg.id, { text: msg.message, participant });

  const chatEl = <HTMLTextAreaElement>$('chat');
  chatEl.value = '';
  for (const chatMsg of state.chatMessages.values()) {
    const isLocal = chatMsg.participant instanceof LocalParticipant;
    chatEl.value += `${chatMsg.participant?.identity}${isLocal ? ' (me)' : ''}: ${chatMsg.text}\n`;
  }
}

function participantConnected(participant: Participant) {
  appendLog('participant', participant.identity, 'connected', participant.metadata);
  participant
    .on(ParticipantEvent.TrackMuted, (pub: TrackPublication) => {
      appendLog('track was muted', pub.trackSid, participant.identity);
      renderParticipant(participant);
    })
    .on(ParticipantEvent.TrackUnmuted, (pub: TrackPublication) => {
      appendLog('track was unmuted', pub.trackSid, participant.identity);
      renderParticipant(participant);
    })
    .on(ParticipantEvent.IsSpeakingChanged, () => {
      renderParticipant(participant);
    })
    .on(ParticipantEvent.ConnectionQualityChanged, () => {
      renderParticipant(participant);
    });
}

function participantDisconnected(participant: RemoteParticipant) {
  appendLog('participant', participant.sid, 'disconnected');
  renderParticipant(participant, true);
}

function handleRoomDisconnect(reason?: DisconnectReason) {
  if (!currentRoom) return;
  appendLog('disconnected from room', { reason });
  setButtonsForState(false);
  renderParticipant(currentRoom.localParticipant, true);
  currentRoom.remoteParticipants.forEach((p) => {
    renderParticipant(p, true);
  });
  renderScreenShare(currentRoom);
  state.primaryVideoByIdentity.clear();

  const container = $('participants-area');
  if (container) container.innerHTML = '';

  const chat = <HTMLTextAreaElement>$('chat');
  chat.value = '';

  currentRoom = undefined;
  (window as any).currentRoom = undefined;
}

// ----------------------------- rendering ---------------------------------- //

function appendLog(...args: any[]) {
  const logger = $('log')!;
  for (let i = 0; i < args.length; i += 1) {
    if (typeof args[i] === 'object') {
      logger.innerHTML += `${JSON.stringify(args[i], undefined, 2)} `;
    } else {
      logger.innerHTML += `${args[i]} `;
    }
  }
  logger.innerHTML += '\n';
  logger.scrollTop = logger.scrollHeight;
}

function isLocal(participant: Participant): participant is LocalParticipant {
  return participant instanceof LocalParticipant;
}

function resolveParticipantInRoom(room: Room, identity: string): Participant | undefined {
  if (room.localParticipant.identity === identity) {
    return room.localParticipant;
  }
  return room.getParticipantByIdentity(identity);
}

function handleParticipantMediaClick(this: HTMLElement, ev: Event) {
  if (!(ev.target instanceof HTMLVideoElement)) return;
  const room = currentRoom;
  if (!room || room.state !== RoomState.Connected) return;

  const identity = this.id.startsWith('participant-') ? this.id.slice('participant-'.length) : '';
  if (!identity) return;

  const participant = resolveParticipantInRoom(room, identity);
  if (!participant) return;

  const videoPub = participant.getTrackPublication(TrackSource.Camera);
  const canvasPub = getCanvasTrackPublication(participant);
  const camOk =
    videoPub && videoPub.isSubscribed && !videoPub.isMuted && Boolean(videoPub.videoTrack);
  const canvasOk =
    canvasPub && canvasPub.isSubscribed && !canvasPub.isMuted && Boolean(canvasPub.videoTrack);
  if (!camOk || !canvasOk) return;

  const vid = `video-${identity}`;
  const cid = `canvas-${identity}`;
  if (ev.target.id !== vid && ev.target.id !== cid) return;

  const cur = state.primaryVideoByIdentity.get(identity) ?? 'camera';
  state.primaryVideoByIdentity.set(identity, cur === 'camera' ? 'canvas' : 'camera');
  renderParticipant(participant);
}

function renderParticipant(participant: Participant, remove: boolean = false) {
  const container = $('participants-area');
  if (!container) return;
  const { identity } = participant;
  let div = container.querySelector(`#participant-${identity}`);
  if (!div && !remove) {
    div = document.createElement('div');
    div.id = `participant-${identity}`;
    div.className = 'participant';
    div.addEventListener('click', handleParticipantMediaClick);
    div.innerHTML = `
      <video id="video-${identity}" class="track-camera"></video>
      <video id="canvas-${identity}" class="track-canvas"></video>
      <audio id="audio-${identity}"></audio>
      <div class="info-bar">
        <div id="name-${identity}" class="name"></div>
        <div style="text-align: center;">
          <span id="codec-${identity}" class="codec"></span>
          <span id="size-${identity}" class="size"></span>
          <span id="bitrate-${identity}" class="bitrate"></span>
        </div>
        <div class="right">
          <span id="signal-${identity}"></span>
          <span id="mic-${identity}" class="mic-on"></span>
        </div>
      </div>
      ${
        !isLocal(participant)
          ? `<div class="volume-control">
        <input id="volume-${identity}" type="range" min="0" max="1" step="0.1" value="1" orient="vertical" />
      </div>`
          : `<progress id="local-volume" max="1" value="0" />`
      }
    `;
    container.appendChild(div);

    const sizeElm = container.querySelector(`#size-${identity}`);
    const videoElm = <HTMLVideoElement>container.querySelector(`#video-${identity}`);
    videoElm.onresize = () => {
      updateVideoSize(videoElm!, sizeElm!);
    };
  }
  const videoElm = <HTMLVideoElement>container.querySelector(`#video-${identity}`);
  const canvasElm = <HTMLVideoElement>container.querySelector(`#canvas-${identity}`);
  const audioElm = <HTMLAudioElement>container.querySelector(`#audio-${identity}`);
  if (remove) {
    state.primaryVideoByIdentity.delete(identity);
    div?.remove();
    if (videoElm) {
      videoElm.srcObject = null;
      videoElm.src = '';
    }
    if (audioElm) {
      audioElm.srcObject = null;
      audioElm.src = '';
    }
    if (canvasElm) {
      canvasElm.srcObject = null;
      canvasElm.src = '';
    }
    return;
  }

  container.querySelector(`#name-${identity}`)!.innerHTML = participant.identity;
  if (isLocal(participant)) {
    container.querySelector(`#name-${identity}`)!.innerHTML += ' (you)';
  }
  const micElm = container.querySelector(`#mic-${identity}`)!;
  const signalElm = container.querySelector(`#signal-${identity}`)!;
  const videoPub = participant.getTrackPublication(TrackSource.Camera);
  const canvasPub = getCanvasTrackPublication(participant);
  const micPub = participant.getTrackPublication(TrackSource.Microphone);

  if (participant.isSpeaking) {
    div!.classList.add('speaking');
  } else {
    div!.classList.remove('speaking');
  }

  if (!isLocal(participant)) {
    const volumeSlider = <HTMLInputElement>container.querySelector(`#volume-${identity}`);
    volumeSlider?.addEventListener('input', (ev) => {
      (participant as RemoteParticipant).setVolume(
        Number.parseFloat((ev.target as HTMLInputElement).value),
      );
    });
  }

  const videoEnabled = videoPub && videoPub.isSubscribed && !videoPub.isMuted;
  if (videoEnabled) {
    if (isLocal(participant)) {
      videoElm.style.transform = 'scale(-1, 1)';
    } else {
      videoElm.style.transform = '';
    }
    if (!isLocal(participant) && !videoPub?.videoTrack?.attachedElements.includes(videoElm)) {
      const renderStartTime = Date.now();
      videoElm.onloadeddata = () => {
        const elapsed = Date.now() - renderStartTime;
        let fromJoin = 0;
        if (participant.joinedAt && participant.joinedAt.getTime() < startTime) {
          fromJoin = Date.now() - startTime;
        }
        appendLog(
          `RemoteVideoTrack ${videoPub?.trackSid} (${videoElm.videoWidth}x${videoElm.videoHeight}) rendered in ${elapsed}ms`,
          fromJoin > 0 ? `, ${fromJoin}ms from start` : '',
        );
      };
    }
    videoPub?.videoTrack?.attach(videoElm);
  } else {
    container.querySelector(`#size-${identity}`)!.innerHTML = '';
    videoElm.style.transform = '';
    if (videoPub?.videoTrack) {
      videoPub.videoTrack?.detach(videoElm);
    } else {
      videoElm.src = '';
      videoElm.srcObject = null;
    }
  }

  const canvasEnabled = canvasPub && canvasPub.isSubscribed && !canvasPub.isMuted;
  if (!canvasEnabled) {
    state.primaryVideoByIdentity.delete(identity);
  }
  if (canvasEnabled) {
    canvasElm.style.display = 'block';
    canvasPub?.videoTrack?.attach(canvasElm);
  } else {
    canvasElm.style.display = 'none';
    if (canvasPub?.videoTrack) {
      canvasPub.videoTrack?.detach(canvasElm);
    } else {
      canvasElm.srcObject = null;
      canvasElm.src = '';
    }
  }

  const bothVideo = Boolean(videoEnabled && canvasEnabled);
  if (bothVideo) {
    videoElm.classList.add('swap-target');
  } else {
    videoElm.classList.remove('swap-target');
  }

  div!.classList.toggle('canvas-only', Boolean(canvasEnabled && !videoEnabled));
  const primary = state.primaryVideoByIdentity.get(identity) ?? 'camera';
  div!.classList.toggle('canvas-primary', Boolean(bothVideo && primary === 'canvas'));

  const micEnabled = micPub && micPub.isSubscribed && !micPub.isMuted;
  if (micEnabled) {
    if (!isLocal(participant)) {
      audioElm.onloadeddata = () => {
        if (participant.joinedAt && participant.joinedAt.getTime() < startTime) {
          const fromJoin = Date.now() - startTime;
          appendLog(`RemoteAudioTrack ${micPub?.trackSid} played ${fromJoin}ms from start`);
        }
      };
      micPub?.audioTrack?.attach(audioElm);
    }
    micElm.className = 'mic-on';
    micElm.innerHTML = '🎤';
  } else {
    micElm.className = 'mic-off';
    micElm.innerHTML = '🔇';
  }

  switch (participant.connectionQuality) {
    case ConnectionQuality.Excellent:
    case ConnectionQuality.Good:
    case ConnectionQuality.Poor:
      signalElm.className = `connection-${participant.connectionQuality}`;
      signalElm.innerHTML = '●';
      break;
    default:
      signalElm.innerHTML = '';
  }
}

function renderScreenShare(room: Room) {
  const div = $('screenshare-area')!;
  const videoElm = <HTMLVideoElement>$('screenshare-video');
  if (room.state !== RoomState.Connected) {
    div.style.display = 'none';
    clearScreenShareElement(videoElm);
    return;
  }
  let participant: Participant | undefined;
  let screenSharePub: TrackPublication | undefined = room.localParticipant.getTrackPublication(
    TrackSource.ScreenShare,
  );
  let screenShareAudioPub: TrackPublication | undefined;

  if (!screenSharePub) {
    room.remoteParticipants.forEach((p) => {
      const pub = p.getTrackPublication(TrackSource.ScreenShare);
      if (!pub?.isSubscribed || screenSharePub) return;
      screenSharePub = pub;
      participant = p;
      const audioPub = p.getTrackPublication(TrackSource.ScreenShareAudio);
      if (audioPub?.isSubscribed) {
        screenShareAudioPub = audioPub;
      }
    });
  } else {
    participant = room.localParticipant;
    const audioPub = room.localParticipant.getTrackPublication(TrackSource.ScreenShareAudio);
    if (audioPub?.isSubscribed) {
      screenShareAudioPub = audioPub;
    }
  }

  if (screenSharePub && participant) {
    div.style.display = 'block';
    // 本地预览只绑视频轨，避免共享音频再从本机 <video> 放出；远端仍合并音轨。
    const previewAudioTrack = participant.isLocal ? undefined : screenShareAudioPub?.audioTrack;
    attachScreenShareTracks(videoElm, screenSharePub.videoTrack, previewAudioTrack);
    videoElm.onresize = () => {
      updateVideoSize(videoElm, <HTMLSpanElement>$('screenshare-resolution'));
    };
    const infoElm = $('screenshare-info')!;
    infoElm.innerHTML = `Screenshare from ${participant.identity}`;
  } else {
    div.style.display = 'none';
    clearScreenShareElement(videoElm);
  }
}

/**
 * `Track.attach` assigns a single-track MediaStream to the element; attaching screen video then
 * screen-share audio would overwrite `srcObject` and drop the video. Merge both into one stream.
 */
function attachScreenShareTracks(
  videoElm: HTMLVideoElement,
  videoTrack: Track | undefined,
  audioTrack: Track | undefined,
): void {
  videoTrack?.detach(videoElm);
  audioTrack?.detach(videoElm);

  const v = videoTrack?.mediaStreamTrack;
  const a = audioTrack?.mediaStreamTrack;
  const tracks: MediaStreamTrack[] = [];
  if (v) tracks.push(v);
  if (a) tracks.push(a);
  if (tracks.length === 0) {
    videoElm.srcObject = null;
    return;
  }

  videoElm.autoplay = true;
  videoElm.playsInline = true;
  videoElm.srcObject = new MediaStream(tracks);
  videoElm.muted = !a;
  videoElm.play().catch(() => {});
}

function clearScreenShareElement(videoElm: HTMLVideoElement): void {
  videoElm.srcObject = null;
}

function getCanvasTrackPublication(participant: Participant): TrackPublication | undefined {
  return participant.getTrackPublicationByName(CANVAS_TRACK_NAME);
}

/** Demo canvas draws in a worker (OffscreenCanvas); main thread only runs captureStream. */
function initializeCanvasSource() {
  try {
    startDemoCanvasWorkerAnimation();
    state.canvasVideo.supported = true;
  } catch (err) {
    appendLog('failed to start canvas worker', err);
    setButtonDisabled('toggle-canvas-video-button', true);
  }
}

function getCanvasCaptureTrack(): CanvasVideoTrack {
  if (state.canvasVideo.track?.readyState === 'live') {
    return state.canvasVideo.track as CanvasVideoTrack;
  }

  const canvas = getDemoCanvasElement();
  if (!canvas) {
    throw new Error('canvas source is not initialized');
  }

  const stream = canvas.captureStream(CANVAS_FRAME_RATE);
  const track = stream.getVideoTracks()[0] as CanvasVideoTrack | undefined;
  if (!track) {
    throw new Error('unable to capture canvas video track');
  }
  if ('contentHint' in track) {
    track.contentHint = 'motion';
  }

  track.addEventListener('ended', () => {
    if (state.canvasVideo.track === track) {
      state.canvasVideo.track = undefined;
      updateButtonsForPublishState();
    }
  });

  state.canvasVideo.track = track;
  return track;
}

function getCanvasVideoCodec(): VideoCodec {
  const raw = (<HTMLSelectElement>$('preferred-codec')).value as VideoCodec;
  const preferred = (raw || 'av1') as VideoCodec;

  const browserCanEncode = (c: VideoCodec): boolean => {
    switch (c) {
      case 'av1':
        return supportsAV1();
      case 'vp9':
        return supportsVP9();
      case 'h265':
        return supportsH265();
      case 'vp8':
      case 'h264':
        return true;
      default:
        return true;
    }
  };

  if (browserCanEncode(preferred)) {
    return preferred;
  }

  appendLog(`canvas video: cannot encode ${preferred} in this browser, using fallback`);
  if (supportsAV1()) return 'av1';
  if (supportsVP9()) return 'vp9';
  return 'vp8';
}

function disposeCanvasCapture() {
  state.canvasVideo.track?.stop();
  state.canvasVideo.track = undefined;
  stopDemoCanvasWorkerAnimation();
}

function renderBitrate() {
  if (!currentRoom || currentRoom.state !== RoomState.Connected) return;
  const participants: Participant[] = [...currentRoom.remoteParticipants.values()];
  participants.push(currentRoom.localParticipant);
  const container = $('participants-area');

  for (const p of participants) {
    const elm = container.querySelector(`#bitrate-${p.identity}`);
    let totalBitrate = 0;
    for (const t of p.trackPublications.values()) {
      if (t.track) {
        totalBitrate += t.track.currentBitrate;
      }
    }
    let displayText = '';
    if (totalBitrate > 0) {
      displayText = `${Math.round(totalBitrate / 1024).toLocaleString()} kbps`;
    }
    if (elm) {
      elm.innerHTML = displayText;
    }
  }
}

function updateVideoSize(element: HTMLVideoElement, target: Element) {
  target.innerHTML = `(${element.videoWidth}x${element.videoHeight})`;
}

function setButtonState(
  buttonId: string,
  buttonText: string,
  isActive: boolean,
  isDisabled: boolean | undefined = undefined,
) {
  const el = $(buttonId) as HTMLButtonElement;
  if (!el) return;
  if (isDisabled !== undefined) {
    el.disabled = isDisabled;
  }
  el.innerHTML = buttonText;
  if (isActive) {
    el.classList.add('active');
  } else {
    el.classList.remove('active');
  }
}

function setButtonDisabled(buttonId: string, isDisabled: boolean) {
  const el = $(buttonId) as HTMLButtonElement;
  el.disabled = isDisabled;
}

setTimeout(handleDevicesChanged, 100);

function setButtonsForState(connected: boolean) {
  const connectedSet = [
    'toggle-video-button',
    'toggle-audio-button',
    'toggle-canvas-video-button',
    'share-screen-button',
    'flip-video-button',
    'disconnect-room-button',
    'send-button',
  ];
  const disconnectedSet = ['connect-button'];

  const toRemove = connected ? connectedSet : disconnectedSet;
  const toAdd = connected ? disconnectedSet : connectedSet;

  toRemove.forEach((id) => $(id)?.removeAttribute('disabled'));
  toAdd.forEach((id) => $(id)?.setAttribute('disabled', 'true'));
}

const elementMapping: { [k: string]: MediaDeviceKind } = {
  'video-input': 'videoinput',
  'audio-input': 'audioinput',
  'audio-output': 'audiooutput',
} as const;

async function handleDevicesChanged() {
  Promise.all(
    Object.keys(elementMapping).map(async (id) => {
      const kind = elementMapping[id];
      if (!kind) return;
      const devices = await Room.getLocalDevices(kind);
      const element = <HTMLSelectElement>$(id);
      populateSelect(element, devices, state.defaultDevices.get(kind));
    }),
  );
}

function populateSelect(
  element: HTMLSelectElement,
  devices: MediaDeviceInfo[],
  selectedDeviceId?: string,
) {
  element.innerHTML = '';
  for (const device of devices) {
    const option = document.createElement('option');
    option.text = device.label;
    option.value = device.deviceId;
    if (device.deviceId === selectedDeviceId) {
      option.selected = true;
    }
    element.appendChild(option);
  }
}

function updateButtonsForPublishState() {
  if (!currentRoom) return;
  const lp = currentRoom.localParticipant;
  const canvasPublished = Boolean(getCanvasTrackPublication(lp));

  setButtonState(
    'toggle-video-button',
    `${lp.isCameraEnabled ? 'Disable' : 'Enable'} Video`,
    lp.isCameraEnabled,
  );
  setButtonState(
    'toggle-audio-button',
    `${lp.isMicrophoneEnabled ? 'Disable' : 'Enable'} Audio`,
    lp.isMicrophoneEnabled,
  );
  setButtonState(
    'share-screen-button',
    lp.isScreenShareEnabled ? 'Stop Screen Share' : 'Share Screen',
    lp.isScreenShareEnabled,
  );
  setButtonState(
    'toggle-canvas-video-button',
    canvasPublished ? 'Stop Canvas Video' : 'Publish Canvas Video',
    canvasPublished,
    !state.canvasVideo.supported,
  );
}

function populateSupportedCodecs() {
  const codecSelect = $('preferred-codec');
  const options: string[][] = [
    ['', 'Preferred codec'],
    ['h264', 'H.264'],
    ['vp8', 'VP8'],
  ];
  if (supportsVP9()) {
    options.push(['vp9', 'VP9']);
  }
  if (supportsAV1()) {
    options.push(['av1', 'AV1']);
  }
  if (supportsH265()) {
    options.push(['h265', 'H.265']);
  }
  const defaultCodec = supportsAV1() ? 'av1' : 'vp8';
  for (const o of options) {
    const n = document.createElement('option');
    n.value = o[0];
    n.appendChild(document.createTextNode(o[1]));
    if (o[0] === defaultCodec) {
      n.selected = true;
    }
    codecSelect.appendChild(n);
  }
}

function populateScalabilityModes() {
  const modeSelect = $('scalability-mode');
  const modes: string[] = [
    'L1T1',
    'L1T2',
    'L1T3',
    'L2T1',
    'L2T1h',
    'L2T1_KEY',
    'L2T2',
    'L2T2h',
    'L2T2_KEY',
    'L2T3',
    'L2T3h',
    'L2T3_KEY',
    'L3T1',
    'L3T1h',
    'L3T1_KEY',
    'L3T2',
    'L3T2h',
    'L3T2_KEY',
    'L3T3',
    'L3T3h',
    'L3T3_KEY',
  ];
  let n = document.createElement('option');
  n.value = '';
  n.text = 'ScalabilityMode';
  modeSelect.appendChild(n);
  for (const mode of modes) {
    n = document.createElement('option');
    n.value = mode;
    n.text = mode;
    modeSelect.appendChild(n);
  }

  const codecSelect = <HTMLSelectElement>$('preferred-codec');
  codecSelect.onchange = () => {
    if (isSVCCodec(codecSelect.value)) {
      modeSelect.removeAttribute('disabled');
    } else {
      modeSelect.setAttribute('disabled', 'true');
    }
  };
}

acquireDeviceList();
populateSupportedCodecs();
populateScalabilityModes();
initializeCanvasSource();
window.addEventListener('beforeunload', disposeCanvasCapture);

function acquireDeviceList() {
  handleDevicesChanged();
}
