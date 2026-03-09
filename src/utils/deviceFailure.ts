/**
 * The type of device failure that occurred.
 */
export type DeviceFailureKind = 'PermissionDenied' | 'NotFound' | 'DeviceInUse';

/**
 * Utility class for determining the type of media device failure from an error
 * object.
 *
 * @example
 * ```ts
 * try {
 *   await createLocalAudioTrack();
 * } catch (e) {
 *   const failure = MediaDeviceFailure.getFailure(e);
 *   if (failure === 'PermissionDenied') {
 *     // show permission dialog
 *   }
 * }
 * ```
 */
export class MediaDeviceFailure {
  /**
   * Determine the failure kind from a caught error.
   *
   * @param error - The error thrown by `getUserMedia` or similar APIs.
   * @returns The categorised failure, or `undefined` if the error is not a
   *   recognised device failure.
   */
  static getFailure(error: any): DeviceFailureKind | undefined {
    if (!error) return undefined;

    const name: string = error.name ?? '';
    const message: string = (error.message ?? '').toLowerCase();

    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return 'PermissionDenied';
    }

    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'NotFound';
    }

    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
      return 'DeviceInUse';
    }

    // Fallback heuristics based on message content
    if (message.includes('permission')) return 'PermissionDenied';
    if (message.includes('not found')) return 'NotFound';
    if (message.includes('in use') || message.includes('could not start')) return 'DeviceInUse';

    return undefined;
  }
}
