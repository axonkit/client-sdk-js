/**
 * A message exchanged between participants (chat, whiteboard, document, etc.).
 */
export interface Message {
  /** Unique message identifier. */
  id: string;
  /** Message type: "text", "whiteboard", "document", "image", "video", "audio", "file", "system", etc. */
  type?: string;
  /** Unix timestamp in milliseconds when the message was sent. */
  timestamp: number;
  /** The text content of the message. */
  message: string;
  /** Unix timestamp in milliseconds of the last edit, if edited. */
  editTimestamp?: number;
  /** If true, the message is not persisted (e.g. mouse coordinates). */
  transient?: boolean;
  /** Optional file attachment identifiers. */
  attachedFiles?: string[];
}

/** @deprecated Use {@link Message} instead. */
export type ChatMessage = Message;

/**
 * Options when sending a text message.
 */
export interface SendTextOptions {
  /** Topic identifier used to route the message to appropriate handlers. */
  topic?: string;
  /** Participant identities to send to. If empty, sends to all. */
  destinationIdentities?: string[];
  /** Optional file attachment identifiers. */
  attachments?: string[];
  /** Progress callback (0–1). */
  onProgress?: (progress: number) => void;
  /** Key-value attributes attached to the stream. */
  attributes?: Record<string, string>;
}

/**
 * Options when opening an incremental text stream.
 */
export interface StreamTextOptions {
  /** Topic identifier. */
  topic?: string;
  /** Participant identities to send to. If empty, sends to all. */
  destinationIdentities?: string[];
  /** Key-value attributes attached to the stream. */
  attributes?: Record<string, string>;
  /** Total size in bytes if known ahead of time. */
  totalSize?: number;
}

/**
 * Options when streaming raw bytes.
 */
export interface StreamBytesOptions {
  /** Human-readable name for the stream. */
  name?: string;
  /** Topic identifier. */
  topic?: string;
  /** MIME type of the data. */
  mimeType?: string;
  /** Key-value attributes attached to the stream. */
  attributes?: Record<string, string>;
  /** Participant identities to send to. If empty, sends to all. */
  destinationIdentities?: string[];
  /** Total size in bytes if known ahead of time. */
  totalSize?: number;
}

/**
 * Options when sending a file.
 */
export interface SendFileOptions {
  /** Topic identifier. */
  topic?: string;
  /** MIME type override. If omitted, derived from the File object. */
  mimeType?: string;
  /** Participant identities to send to. */
  destinationIdentities?: string[];
  /** Progress callback (0–1). */
  onProgress?: (progress: number) => void;
}

/**
 * Base information about an incoming data stream.
 */
export interface BaseStreamInfo {
  id: string;
  mimeType: string;
  topic: string;
  timestamp: number;
  /** Total size in bytes for finite streams, `undefined` for unknown-size streams. */
  size?: number;
  attributes?: Record<string, string>;
}

/**
 * Information about an incoming byte stream.
 */
export interface ByteStreamInfo extends BaseStreamInfo {
  name: string;
}

/**
 * Information about an incoming text stream.
 */
export type TextStreamInfo = BaseStreamInfo;

/**
 * Identifies the participant who sent a data stream.
 */
export interface StreamSenderInfo {
  identity: string;
  sid: string;
}

import type { TextStreamReader, ByteStreamReader } from './data-stream/DataStreamManager';

/**
 * Handler called when an incoming text stream is received on a registered topic.
 */
export type TextStreamHandler = (reader: TextStreamReader, sender: StreamSenderInfo) => void;

/**
 * Handler called when an incoming byte stream is received on a registered topic.
 */
export type ByteStreamHandler = (reader: ByteStreamReader, sender: StreamSenderInfo) => void;

/**
 * Parameters for initiating a P2P RPC call.
 */
export interface PerformRpcParams {
  /** The `identity` of the destination participant. */
  destinationIdentity: string;
  /** The method name to call. */
  method: string;
  /** The method payload (typically JSON string). */
  payload: string;
  /**
   * Timeout for receiving a response (milliseconds).
   * @defaultValue 15000
   */
  responseTimeout?: number;
}

/**
 * Data passed to an RPC method handler.
 */
export interface RpcInvocationData {
  /** The unique request ID. */
  requestId: string;
  /** The identity of the caller. */
  callerIdentity: string;
  /** The payload of the request. */
  payload: string;
  /** The maximum time the caller will wait for a response. */
  responseTimeout: number;
}
