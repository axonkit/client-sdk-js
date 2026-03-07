import { RPCClient } from '../signal/RPCClient';
import { TransportManager } from '../transport/TransportManager';
import { LocalParticipant } from '../participant/LocalParticipant';
import { RemoteParticipant } from '../participant/RemoteParticipant';
import { getLogger } from '../utils/logger';

const log = getLogger('StatsCollector');

interface TransportStats {
  id: string;
  direction: 'send' | 'recv';
  stats: Record<string, unknown>[];
}

interface ProducerStats {
  id: string;
  trackSid: string;
  stats: Record<string, unknown>[];
}

interface ConsumerStats {
  id: string;
  participantSid: string;
  stats: Record<string, unknown>[];
}

interface StatsReport {
  timestamp: number;
  transports?: TransportStats[];
  producers?: ProducerStats[];
  consumers?: ConsumerStats[];
}

function rtcStatsToArray(report: RTCStatsReport): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  report.forEach((value) => {
    result.push(value);
  });
  return result;
}

export class StatsCollector {
  private rpc: RPCClient;
  private transportManager: TransportManager;
  private localParticipant: LocalParticipant;
  private remoteParticipants: Map<string, RemoteParticipant>;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    rpc: RPCClient,
    transportManager: TransportManager,
    localParticipant: LocalParticipant,
    remoteParticipants: Map<string, RemoteParticipant>,
  ) {
    this.rpc = rpc;
    this.transportManager = transportManager;
    this.localParticipant = localParticipant;
    this.remoteParticipants = remoteParticipants;
  }

  start(intervalSec: number): void {
    this.stop();
    if (intervalSec <= 0) return;

    this.timer = setInterval(() => {
      this.collect().catch((err) => {
        log.warn('Failed to collect stats', err);
      });
    }, intervalSec * 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async collect(): Promise<void> {
    const report: StatsReport = { timestamp: Date.now() };

    // Transport stats
    const transports: TransportStats[] = [];
    if (this.transportManager.sendTransport) {
      try {
        const stats = await this.transportManager.sendTransport.getStats();
        transports.push({
          id: this.transportManager.sendTransport.id,
          direction: 'send',
          stats: rtcStatsToArray(stats),
        });
      } catch { /* transport may be closed */ }
    }
    if (this.transportManager.recvTransport) {
      try {
        const stats = await this.transportManager.recvTransport.getStats();
        transports.push({
          id: this.transportManager.recvTransport.id,
          direction: 'recv',
          stats: rtcStatsToArray(stats),
        });
      } catch { /* transport may be closed */ }
    }
    if (transports.length > 0) report.transports = transports;

    // Producer stats
    const producers: ProducerStats[] = [];
    for (const [trackSid, producer] of this.localParticipant.getProducers()) {
      try {
        const stats = await producer.getStats();
        producers.push({ id: producer.id, trackSid, stats: rtcStatsToArray(stats) });
      } catch { /* producer may be closed */ }
    }
    if (producers.length > 0) report.producers = producers;

    // Consumer stats
    const consumers: ConsumerStats[] = [];
    for (const [pSid, rp] of this.remoteParticipants) {
      for (const [, consumer] of rp.getConsumers()) {
        try {
          const stats = await consumer.getStats();
          consumers.push({ id: consumer.id, participantSid: pSid, stats: rtcStatsToArray(stats) });
        } catch { /* consumer may be closed */ }
      }
    }
    if (consumers.length > 0) report.consumers = consumers;

    this.rpc.notify('stats.report', report);
  }
}
