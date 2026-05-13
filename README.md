# @axonkit/client-sdk-js

AxonKit JavaScript/TypeScript Client SDK for real-time communication, built on top of [mediasoup-client](https://github.com/versatica/mediasoup-client).

> **License**: This SDK is proprietary software licensed exclusively for use
> with the AxonKit Service. See [LICENSE](./LICENSE) for the full terms.
> For commercial inquiries, contact <jiyeyuran@gmail.com>.

## Installation

```bash
pnpm add @axonkit/client-sdk-js
```

## Quick Start

```typescript
import { Room, RoomState, setLogLevel, LogLevel } from '@axonkit/client-sdk-js';

setLogLevel(LogLevel.INFO);

const room = new Room({
  autoSubscribe: true,
  dynacast: true,
  adaptiveStream: true,
});

// Connect
await room.connect('https://your-server.com', 'your-jwt-token');

// Publish camera and microphone
await room.localParticipant.setCameraEnabled(true);
await room.localParticipant.setMicrophoneEnabled(true);

// Listen for remote tracks
room.on('trackSubscribed', (track, publication, participant) => {
  if (track.kind === 'video') {
    const element = track.attach();
    document.getElementById('remote-videos')?.appendChild(element);
  } else {
    const element = track.attach();
    element.play();
  }
});

// Listen for participants
room.on('participantJoined', (participant) => {
  console.log(`${participant.identity} joined`);
});

room.on('participantLeft', (participant) => {
  console.log(`${participant.identity} left`);
});

// Disconnect
await room.disconnect();
```

## Features

- **WebRTC Transport** — Powered by mediasoup-client for reliable media transport
- **DataChannel RPC** — Axon Protocol for signaling over DataChannel (after initial HTTP join)
- **Auto Subscribe** — Automatically subscribe to new tracks
- **Dynacast** — Dynamic simulcast layer control based on subscriber needs
- **Adaptive Stream** — Visibility and size-based subscription management
- **Reconnection** — Automatic reconnect with exponential backoff and state sync
- **Heartbeat** — Ping/pong keep-alive with RTT measurement

## API Reference

### Room

| Method                | Description                                |
| --------------------- | ------------------------------------------ |
| `connect(url, token)` | Connect to a room                          |
| `disconnect()`        | Disconnect from the room                   |
| `startAudio()`        | Start audio playback (for autoplay policy) |

### LocalParticipant

| Method                           | Description                 |
| -------------------------------- | --------------------------- |
| `setCameraEnabled(enabled)`      | Toggle camera               |
| `setMicrophoneEnabled(enabled)`  | Toggle microphone           |
| `setScreenShareEnabled(enabled)` | Toggle screen share         |
| `publishTrack(track, options?)`  | Publish a local track       |
| `unpublishTrack(track)`          | Unpublish a track           |
| `publishData(data, options?)`    | Send data via DataChannel   |
| `updateMetadata(metadata)`       | Update participant metadata |
| `updateName(name)`               | Update participant name     |

### Events

```typescript
room.on('connected', () => {});
room.on('disconnected', (reason) => {});
room.on('reconnecting', () => {});
room.on('reconnected', () => {});
room.on('participantJoined', (participant) => {});
room.on('participantLeft', (participant) => {});
room.on('trackSubscribed', (track, publication, participant) => {});
room.on('trackUnsubscribed', (track, publication, participant) => {});
room.on('activeSpeakersChanged', (speakers) => {});
```

## Building

```bash
pnpm install
pnpm build
```

Outputs:

- `dist/axonkit-client.esm.js` — ES Module
- `dist/axonkit-client.umd.js` — UMD (for `<script>` tags)
- `dist/index.d.ts` — TypeScript declarations

## Demo

Open `examples/demo/index.html` in a browser after building. Requires a running AxonKit server.

## License

MIT
