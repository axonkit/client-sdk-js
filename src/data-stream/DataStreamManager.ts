import type { RPCClient } from '../signal/RPCClient';
import type {
  SendTextOptions,
  StreamTextOptions,
  StreamBytesOptions,
  SendFileOptions,
  BaseStreamInfo,
  ByteStreamInfo,
  TextStreamInfo,
} from '../types';
import { getLogger } from '../utils/logger';

const log = getLogger('DataStreamManager');
const CHUNK_SIZE = 15_000;

/**
 * Writer for incrementally sending text to remote participants.
 */
export class TextStreamWriter {
  private streamId: string;
  private rpc: RPCClient;
  private chunkIndex = 0;
  private closed = false;
  private destinationIdentities?: string[];

  /** @internal */
  constructor(streamId: string, rpc: RPCClient, destinationIdentities?: string[]) {
    this.streamId = streamId;
    this.rpc = rpc;
    this.destinationIdentities = destinationIdentities;
  }

  /** Write a chunk of text to the stream. */
  write(text: string): void {
    if (this.closed) throw new Error('Stream is closed');
    this.rpc.notify('dataStream.chunk', {
      streamId: this.streamId,
      chunkIndex: this.chunkIndex++,
      content: text,
      complete: false,
      destinationIdentities: this.destinationIdentities,
    });
  }

  /** Close the stream, signalling no more data will be sent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.rpc.notify('dataStream.chunk', {
      streamId: this.streamId,
      chunkIndex: this.chunkIndex++,
      content: '',
      complete: true,
      destinationIdentities: this.destinationIdentities,
    });
  }
}

/**
 * Writer for incrementally sending bytes to remote participants.
 */
export class ByteStreamWriter {
  private streamId: string;
  private rpc: RPCClient;
  private chunkIndex = 0;
  private closed = false;
  private totalSent = 0;
  private destinationIdentities?: string[];

  /** @internal */
  constructor(streamId: string, rpc: RPCClient, destinationIdentities?: string[]) {
    this.streamId = streamId;
    this.rpc = rpc;
    this.destinationIdentities = destinationIdentities;
  }

  /** Write a chunk of bytes to the stream. */
  write(data: Uint8Array): void {
    if (this.closed) throw new Error('Stream is closed');
    const b64 = uint8ToBase64(data);
    this.rpc.notify('dataStream.chunk', {
      streamId: this.streamId,
      chunkIndex: this.chunkIndex++,
      content: b64,
      encoding: 'base64',
      complete: false,
      destinationIdentities: this.destinationIdentities,
    });
    this.totalSent += data.byteLength;
  }

  /** Close the stream. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.rpc.notify('dataStream.chunk', {
      streamId: this.streamId,
      chunkIndex: this.chunkIndex++,
      content: '',
      complete: true,
      destinationIdentities: this.destinationIdentities,
    });
  }
}

/**
 * Manages outgoing data streams (text, bytes, files).
 * @internal
 */
export class DataStreamManager {
  private rpc: RPCClient;

  constructor(rpc: RPCClient) {
    this.rpc = rpc;
  }

  async sendText(text: string, options?: SendTextOptions): Promise<{ id: string }> {
    const streamId = crypto.randomUUID();
    this.rpc.notify('dataStream.open', {
      streamId,
      streamType: 'text',
      mimeType: 'text/plain',
      topic: options?.topic ?? '',
      totalSize: new TextEncoder().encode(text).byteLength,
      attributes: options?.attributes,
      attachments: options?.attachments,
      destinationIdentities: options?.destinationIdentities,
    });

    const chunks = splitString(text, CHUNK_SIZE);
    for (let i = 0; i < chunks.length; i++) {
      this.rpc.notify('dataStream.chunk', {
        streamId,
        chunkIndex: i,
        content: chunks[i],
        complete: i === chunks.length - 1,
        destinationIdentities: options?.destinationIdentities,
      });
      options?.onProgress?.((i + 1) / chunks.length);
    }

    return { id: streamId };
  }

  streamText(options?: StreamTextOptions): TextStreamWriter {
    const streamId = crypto.randomUUID();
    this.rpc.notify('dataStream.open', {
      streamId,
      streamType: 'text',
      mimeType: 'text/plain',
      topic: options?.topic ?? '',
      totalSize: options?.totalSize,
      attributes: options?.attributes,
      destinationIdentities: options?.destinationIdentities,
    });
    return new TextStreamWriter(streamId, this.rpc, options?.destinationIdentities);
  }

  async sendFile(file: File, options?: SendFileOptions): Promise<{ id: string }> {
    const streamId = crypto.randomUUID();
    const mimeType = options?.mimeType ?? (file.type || 'application/octet-stream');

    this.rpc.notify('dataStream.open', {
      streamId,
      streamType: 'byte',
      mimeType,
      name: file.name,
      topic: options?.topic ?? '',
      totalSize: file.size,
      destinationIdentities: options?.destinationIdentities,
    });

    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    const totalChunks = Math.ceil(data.byteLength / CHUNK_SIZE) || 1;

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, data.byteLength);
      const chunk = data.subarray(start, end);
      this.rpc.notify('dataStream.chunk', {
        streamId,
        chunkIndex: i,
        content: uint8ToBase64(chunk),
        encoding: 'base64',
        complete: i === totalChunks - 1,
        destinationIdentities: options?.destinationIdentities,
      });
      options?.onProgress?.((i + 1) / totalChunks);
    }

    return { id: streamId };
  }

  streamBytes(options?: StreamBytesOptions): ByteStreamWriter {
    const streamId = options?.name ? crypto.randomUUID() : crypto.randomUUID();
    this.rpc.notify('dataStream.open', {
      streamId,
      streamType: 'byte',
      mimeType: options?.mimeType ?? 'application/octet-stream',
      name: options?.name,
      topic: options?.topic ?? '',
      totalSize: options?.totalSize,
      attributes: options?.attributes,
      destinationIdentities: options?.destinationIdentities,
    });
    return new ByteStreamWriter(streamId, this.rpc, options?.destinationIdentities);
  }
}

/**
 * Reassembles incoming data stream chunks.
 * @internal
 */
export class IncomingStreamAssembler {
  private streams = new Map<string, {
    info: BaseStreamInfo & { name?: string; streamType: string };
    chunks: Map<number, string>;
    complete: boolean;
    senderIdentity: string;
  }>();

  private textStreamCallback?: (info: TextStreamInfo, reader: ReadableStream<string>, participantIdentity: string) => void;
  private byteStreamCallback?: (info: ByteStreamInfo, reader: ReadableStream<Uint8Array>, participantIdentity: string) => void;

  onTextStream(cb: (info: TextStreamInfo, reader: ReadableStream<string>, participantIdentity: string) => void): void {
    this.textStreamCallback = cb;
  }

  onByteStream(cb: (info: ByteStreamInfo, reader: ReadableStream<Uint8Array>, participantIdentity: string) => void): void {
    this.byteStreamCallback = cb;
  }

  handleOpen(body: any, senderIdentity: string): void {
    const streamId = body.streamId as string;
    this.streams.set(streamId, {
      info: {
        id: streamId,
        mimeType: body.mimeType ?? 'application/octet-stream',
        topic: body.topic ?? '',
        timestamp: Date.now(),
        size: body.totalSize,
        attributes: body.attributes,
        name: body.name,
        streamType: body.streamType ?? 'byte',
      },
      chunks: new Map(),
      complete: false,
      senderIdentity,
    });
  }

  handleChunk(body: any, senderIdentity: string): void {
    const streamId = body.streamId as string;
    let entry = this.streams.get(streamId);
    if (!entry) {
      entry = {
        info: {
          id: streamId,
          mimeType: 'application/octet-stream',
          topic: '',
          timestamp: Date.now(),
          streamType: 'byte',
        },
        chunks: new Map(),
        complete: false,
        senderIdentity,
      };
      this.streams.set(streamId, entry);
    }

    entry.chunks.set(body.chunkIndex as number, body.content as string);

    if (body.complete) {
      entry.complete = true;
      this.emitCompleteStream(streamId);
    }
  }

  private emitCompleteStream(streamId: string): void {
    const entry = this.streams.get(streamId);
    if (!entry) return;

    const sortedKeys = [...entry.chunks.keys()].sort((a, b) => a - b);
    const contents = sortedKeys.map((k) => entry.chunks.get(k)!);

    if (entry.info.streamType === 'text') {
      const fullText = contents.join('');
      const stream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue(fullText);
          controller.close();
        },
      });
      this.textStreamCallback?.(entry.info as TextStreamInfo, stream, entry.senderIdentity);
    } else {
      const byteChunks = contents.map((c) => {
        if (c.length === 0) return new Uint8Array(0);
        try {
          return base64ToUint8(c);
        } catch {
          return new TextEncoder().encode(c);
        }
      });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of byteChunks) {
            if (chunk.byteLength > 0) controller.enqueue(chunk);
          }
          controller.close();
        },
      });
      const byteInfo: ByteStreamInfo = {
        ...entry.info,
        name: entry.info.name ?? '',
      };
      this.byteStreamCallback?.(byteInfo, stream, entry.senderIdentity);
    }

    this.streams.delete(streamId);
  }
}

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

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
