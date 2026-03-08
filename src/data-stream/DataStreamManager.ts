import { types as mediasoupTypes } from 'mediasoup-client';
import type { RPCClient } from '../signal/RPCClient';
import type { TransportManager } from '../transport/TransportManager';
import type {
  SendTextOptions,
  StreamTextOptions,
  StreamBytesOptions,
  SendFileOptions,
  TextStreamInfo,
  ByteStreamInfo,
  TextStreamHandler,
  ByteStreamHandler,
} from '../types';
import type {
  DataTrackPublishRequest,
  DataTrackPublishResponse,
} from '../protocol/types';
import { getLogger } from '../utils/logger';
import { generateLogId } from '../utils/id';

const log = getLogger('DataStream');

export const STREAM_DATA_LABEL = '__stream';
const CHUNK_SIZE = 15_000;

// --- Binary frame protocol ---

const FRAME_HEADER = 0x01;
const FRAME_CHUNK = 0x02;
const FRAME_CLOSE = 0x03;

function encodeFrame(type: number, streamId: string, payload: Uint8Array): ArrayBuffer {
  const encoder = new TextEncoder();
  const idBytes = encoder.encode(streamId);
  const buf = new ArrayBuffer(1 + 2 + idBytes.byteLength + payload.byteLength);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);

  view.setUint8(0, type);
  view.setUint16(1, idBytes.byteLength, false);
  u8.set(idBytes, 3);
  u8.set(payload, 3 + idBytes.byteLength);
  return buf;
}

function decodeFrame(data: ArrayBuffer): { type: number; streamId: string; payload: Uint8Array } {
  const view = new DataView(data);
  const u8 = new Uint8Array(data);

  const type = view.getUint8(0);
  const idLen = view.getUint16(1, false);
  const decoder = new TextDecoder();
  const streamId = decoder.decode(u8.subarray(3, 3 + idLen));
  const payload = u8.subarray(3 + idLen);
  return { type, streamId, payload };
}

// --- Reader classes ---

export class TextStreamReader implements AsyncIterable<string> {
  readonly info: TextStreamInfo;
  private readonly stream: ReadableStream<string>;

  /** @internal */
  constructor(info: TextStreamInfo, stream: ReadableStream<string>) {
    this.info = info;
    this.stream = stream;
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    const reader = this.stream.getReader();
    return {
      async next() {
        const { done, value } = await reader.read();
        if (done) return { done: true, value: undefined };
        return { done: false, value };
      },
      async return() {
        reader.releaseLock();
        return { done: true, value: undefined };
      },
    };
  }

  async readAll(): Promise<string> {
    const parts: string[] = [];
    for await (const chunk of this) {
      parts.push(chunk);
    }
    return parts.join('');
  }
}

export class ByteStreamReader implements AsyncIterable<Uint8Array> {
  readonly info: ByteStreamInfo;
  private readonly stream: ReadableStream<Uint8Array>;

  /** @internal */
  constructor(info: ByteStreamInfo, stream: ReadableStream<Uint8Array>) {
    this.info = info;
    this.stream = stream;
  }

  [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    const reader = this.stream.getReader();
    return {
      async next() {
        const { done, value } = await reader.read();
        if (done) return { done: true, value: undefined };
        return { done: false, value };
      },
      async return() {
        reader.releaseLock();
        return { done: true, value: undefined };
      },
    };
  }

  async readAll(): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    let totalLen = 0;
    for await (const chunk of this) {
      parts.push(chunk);
      totalLen += chunk.byteLength;
    }
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const p of parts) {
      result.set(p, offset);
      offset += p.byteLength;
    }
    return result;
  }
}

// --- Writer classes ---

export class TextStreamWriter {
  readonly info: TextStreamInfo;
  private dataProducer: mediasoupTypes.DataProducer;
  private streamId: string;
  private closed = false;

  /** @internal */
  constructor(info: TextStreamInfo, dataProducer: mediasoupTypes.DataProducer, streamId: string) {
    this.info = info;
    this.dataProducer = dataProducer;
    this.streamId = streamId;
  }

  async write(text: string): Promise<void> {
    if (this.closed) throw new Error('Stream is closed');
    const encoder = new TextEncoder();
    const chunks = splitString(text, CHUNK_SIZE);
    for (const chunk of chunks) {
      const frame = encodeFrame(FRAME_CHUNK, this.streamId, encoder.encode(chunk));
      this.dataProducer.send(frame);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const frame = encodeFrame(FRAME_CLOSE, this.streamId, new Uint8Array(0));
    this.dataProducer.send(frame);
  }
}

export class ByteStreamWriter {
  readonly info: ByteStreamInfo;
  private dataProducer: mediasoupTypes.DataProducer;
  private streamId: string;
  private closed = false;

  /** @internal */
  constructor(info: ByteStreamInfo, dataProducer: mediasoupTypes.DataProducer, streamId: string) {
    this.info = info;
    this.dataProducer = dataProducer;
    this.streamId = streamId;
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.closed) throw new Error('Stream is closed');
    for (let offset = 0; offset < data.byteLength; offset += CHUNK_SIZE) {
      const end = Math.min(offset + CHUNK_SIZE, data.byteLength);
      const chunk = data.subarray(offset, end);
      const frame = encodeFrame(FRAME_CHUNK, this.streamId, chunk);
      this.dataProducer.send(frame);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const frame = encodeFrame(FRAME_CLOSE, this.streamId, new Uint8Array(0));
    this.dataProducer.send(frame);
  }
}

// --- DataStreamSender ---

export class DataStreamSender {
  private rpc: RPCClient;
  private transportManager: TransportManager;
  private dataProducer?: mediasoupTypes.DataProducer;
  private dataProducerPromise?: Promise<mediasoupTypes.DataProducer>;

  constructor(rpc: RPCClient, transportManager: TransportManager) {
    this.rpc = rpc;
    this.transportManager = transportManager;
  }

  private async ensureDataProducer(): Promise<mediasoupTypes.DataProducer> {
    if (this.dataProducer && !this.dataProducer.closed) {
      return this.dataProducer;
    }
    if (this.dataProducerPromise) {
      return this.dataProducerPromise;
    }

    this.dataProducerPromise = this.createDataProducer();
    try {
      this.dataProducer = await this.dataProducerPromise;
      return this.dataProducer;
    } finally {
      this.dataProducerPromise = undefined;
    }
  }

  private async createDataProducer(): Promise<mediasoupTypes.DataProducer> {
    const sendTransport = this.transportManager.sendTransport;
    if (!sendTransport) throw new Error('Send transport not available');

    const clientTrackId = generateLogId();

    const publishPromise = new Promise<string>((resolve, reject) => {
      this.transportManager.registerProduceDataCallback(clientTrackId, async (params, callback, errback) => {
        try {
          const req: DataTrackPublishRequest = {
            clientTrackId,
            transportSid: sendTransport.id,
            sctpStreamParameters: params.sctpStreamParameters as any,
            name: STREAM_DATA_LABEL,
            label: params.label ?? STREAM_DATA_LABEL,
            protocol: params.protocol ?? '',
          };
          const resp = await this.rpc.request<DataTrackPublishResponse>('dataTrack.publish', req);
          callback({ id: resp.dataTrackSid });
          resolve(resp.dataTrackSid);
        } catch (err) {
          errback(err instanceof Error ? err : new Error(String(err)));
          reject(err);
        }
      });
    });

    const dp = await sendTransport.produceData({
      ordered: true,
      label: STREAM_DATA_LABEL,
      protocol: '',
      appData: { clientTrackId },
    });

    await publishPromise;
    log.info('Stream DataProducer created');
    return dp;
  }

  async sendText(text: string, options?: SendTextOptions): Promise<{ id: string }> {
    const dp = await this.ensureDataProducer();
    const streamId = crypto.randomUUID();
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text);

    const headerPayload = JSON.stringify({
      topic: options?.topic ?? '',
      streamType: 'text',
      mimeType: 'text/plain',
      totalSize: encoded.byteLength,
      timestamp: Date.now(),
      attributes: options?.attributes,
      destinationIdentities: options?.destinationIdentities,
    });
    dp.send(encodeFrame(FRAME_HEADER, streamId, encoder.encode(headerPayload)));

    const chunks = splitString(text, CHUNK_SIZE);
    for (let i = 0; i < chunks.length; i++) {
      dp.send(encodeFrame(FRAME_CHUNK, streamId, encoder.encode(chunks[i])));
      options?.onProgress?.((i + 1) / chunks.length);
    }

    dp.send(encodeFrame(FRAME_CLOSE, streamId, new Uint8Array(0)));
    return { id: streamId };
  }

  async streamText(options?: StreamTextOptions): Promise<TextStreamWriter> {
    const dp = await this.ensureDataProducer();
    const streamId = crypto.randomUUID();
    const encoder = new TextEncoder();

    const info: TextStreamInfo = {
      id: streamId,
      mimeType: 'text/plain',
      topic: options?.topic ?? '',
      timestamp: Date.now(),
      size: options?.totalSize,
      attributes: options?.attributes,
    };

    const headerPayload = JSON.stringify({
      topic: options?.topic ?? '',
      streamType: 'text',
      mimeType: 'text/plain',
      totalSize: options?.totalSize,
      timestamp: info.timestamp,
      attributes: options?.attributes,
      destinationIdentities: options?.destinationIdentities,
    });
    dp.send(encodeFrame(FRAME_HEADER, streamId, encoder.encode(headerPayload)));

    return new TextStreamWriter(info, dp, streamId);
  }

  async sendFile(file: File, options?: SendFileOptions): Promise<{ id: string }> {
    const dp = await this.ensureDataProducer();
    const streamId = crypto.randomUUID();
    const encoder = new TextEncoder();
    const mimeType = options?.mimeType ?? (file.type || 'application/octet-stream');

    const headerPayload = JSON.stringify({
      topic: options?.topic ?? '',
      streamType: 'byte',
      mimeType,
      name: file.name,
      totalSize: file.size,
      timestamp: Date.now(),
      destinationIdentities: options?.destinationIdentities,
    });
    dp.send(encodeFrame(FRAME_HEADER, streamId, encoder.encode(headerPayload)));

    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    const totalChunks = Math.ceil(data.byteLength / CHUNK_SIZE) || 1;

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, data.byteLength);
      dp.send(encodeFrame(FRAME_CHUNK, streamId, data.subarray(start, end)));
      options?.onProgress?.((i + 1) / totalChunks);
    }

    dp.send(encodeFrame(FRAME_CLOSE, streamId, new Uint8Array(0)));
    return { id: streamId };
  }

  async streamBytes(options?: StreamBytesOptions): Promise<ByteStreamWriter> {
    const dp = await this.ensureDataProducer();
    const streamId = crypto.randomUUID();
    const encoder = new TextEncoder();

    const info: ByteStreamInfo = {
      id: streamId,
      mimeType: options?.mimeType ?? 'application/octet-stream',
      topic: options?.topic ?? '',
      timestamp: Date.now(),
      size: options?.totalSize,
      name: options?.name ?? '',
      attributes: options?.attributes,
    };

    const headerPayload = JSON.stringify({
      topic: options?.topic ?? '',
      streamType: 'byte',
      mimeType: info.mimeType,
      name: options?.name,
      totalSize: options?.totalSize,
      timestamp: info.timestamp,
      attributes: options?.attributes,
      destinationIdentities: options?.destinationIdentities,
    });
    dp.send(encodeFrame(FRAME_HEADER, streamId, encoder.encode(headerPayload)));

    return new ByteStreamWriter(info, dp, streamId);
  }

  close(): void {
    this.dataProducer?.close();
    this.dataProducer = undefined;
  }
}

// --- DataStreamReceiver ---

interface ActiveStream {
  info: any;
  streamType: string;
  controller: ReadableStreamDefaultController<any>;
  senderIdentity: string;
  senderSid: string;
}

export class DataStreamReceiver {
  private textHandlers = new Map<string, TextStreamHandler>();
  private byteHandlers = new Map<string, ByteStreamHandler>();
  private activeStreams = new Map<string, ActiveStream>();
  private localIdentity = '';

  setLocalIdentity(identity: string): void {
    this.localIdentity = identity;
  }

  registerTextStreamHandler(topic: string, handler: TextStreamHandler): void {
    this.textHandlers.set(topic, handler);
  }

  unregisterTextStreamHandler(topic: string): void {
    this.textHandlers.delete(topic);
  }

  registerByteStreamHandler(topic: string, handler: ByteStreamHandler): void {
    this.byteHandlers.set(topic, handler);
  }

  unregisterByteStreamHandler(topic: string): void {
    this.byteHandlers.delete(topic);
  }

  handleMessage(data: ArrayBuffer, senderIdentity: string, senderSid: string): void {
    let frame: { type: number; streamId: string; payload: Uint8Array };
    try {
      frame = decodeFrame(data);
    } catch {
      log.warn('Failed to decode data stream frame');
      return;
    }

    switch (frame.type) {
      case FRAME_HEADER:
        this.handleHeader(frame.streamId, frame.payload, senderIdentity, senderSid);
        break;
      case FRAME_CHUNK:
        this.handleChunk(frame.streamId, frame.payload);
        break;
      case FRAME_CLOSE:
        this.handleClose(frame.streamId);
        break;
      default:
        log.warn(`Unknown frame type: ${frame.type}`);
    }
  }

  private handleHeader(
    streamId: string,
    payload: Uint8Array,
    senderIdentity: string,
    senderSid: string,
  ): void {
    const decoder = new TextDecoder();
    let header: any;
    try {
      header = JSON.parse(decoder.decode(payload));
    } catch {
      log.warn('Failed to parse stream header');
      return;
    }

    const destIds: string[] | undefined = header.destinationIdentities;
    if (destIds && destIds.length > 0 && !destIds.includes(this.localIdentity)) {
      return;
    }

    const topic: string = header.topic ?? '';
    const streamType: string = header.streamType ?? 'byte';
    const isText = streamType === 'text';

    const handler = isText ? this.textHandlers.get(topic) : this.byteHandlers.get(topic);
    if (!handler) {
      log.debug(`No handler for topic '${topic}' (${streamType}), ignoring stream ${streamId}`);
      return;
    }

    if (isText) {
      let controller!: ReadableStreamDefaultController<string>;
      const stream = new ReadableStream<string>({
        start(c) { controller = c; },
      });

      const info: TextStreamInfo = {
        id: streamId,
        mimeType: header.mimeType ?? 'text/plain',
        topic,
        timestamp: header.timestamp ?? Date.now(),
        size: header.totalSize,
        attributes: header.attributes,
      };

      this.activeStreams.set(streamId, {
        info,
        streamType,
        controller,
        senderIdentity,
        senderSid,
      });

      const reader = new TextStreamReader(info, stream);
      (handler as TextStreamHandler)(reader, { identity: senderIdentity, sid: senderSid });
    } else {
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(c) { controller = c; },
      });

      const info: ByteStreamInfo = {
        id: streamId,
        mimeType: header.mimeType ?? 'application/octet-stream',
        topic,
        timestamp: header.timestamp ?? Date.now(),
        size: header.totalSize,
        name: header.name ?? '',
        attributes: header.attributes,
      };

      this.activeStreams.set(streamId, {
        info,
        streamType,
        controller,
        senderIdentity,
        senderSid,
      });

      const reader = new ByteStreamReader(info, stream);
      (handler as ByteStreamHandler)(reader, { identity: senderIdentity, sid: senderSid });
    }
  }

  private handleChunk(streamId: string, payload: Uint8Array): void {
    const entry = this.activeStreams.get(streamId);
    if (!entry) return;

    if (entry.streamType === 'text') {
      const decoder = new TextDecoder();
      entry.controller.enqueue(decoder.decode(payload));
    } else {
      entry.controller.enqueue(new Uint8Array(payload));
    }
  }

  private handleClose(streamId: string): void {
    const entry = this.activeStreams.get(streamId);
    if (!entry) return;

    try {
      entry.controller.close();
    } catch {
      // already closed
    }
    this.activeStreams.delete(streamId);
  }
}

// --- Helpers ---

function splitString(str: string, maxBytes: number): string[] {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let offset = 0;
  while (offset < str.length) {
    let end = Math.min(offset + maxBytes, str.length);
    while (end > offset && encoder.encode(str.slice(offset, end)).byteLength > maxBytes) {
      end--;
    }
    if (end === offset) end = offset + 1;
    chunks.push(str.slice(offset, end));
    offset = end;
  }
  if (chunks.length === 0) chunks.push('');
  return chunks;
}
