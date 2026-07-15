// ═══════════════════════════════════════════════════════════════
// Notification Queue — Redis-backed persistent queue
// ═══════════════════════════════════════════════════════════════
//
// Provides guaranteed notification delivery:
//   - Persistent job queue (Redis LPUSH/BRPOPLPUSH)
//   - Automatic retry with exponential backoff (3 attempts: 1s, 5s, 25s)
//   - Dead-letter queue for permanently failed jobs
//   - Real-time stats and health monitoring
//
// Usage from API routes:
//   import { enqueueNotification, getQueueStats } from '@/lib/notification-queue';
//   await enqueueNotification(storeId, 'new-order', { orderNumber: '...' });
//
// Architecture:
//   API Route → enqueueNotification() → Redis Queue → Worker Loop → POST /notify (port 3004)
//                                                   ↓ (fail ×3)
//                                            Dead-Letter Queue (Redis)
//
// The worker loop starts automatically on first import (singleton pattern).
// In development, the Next.js dev server keeps the process alive.
// ═══════════════════════════════════════════════════════════════

import type { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotificationJob {
  id: string;
  storeId: string;
  event: 'new-order' | 'status-change';
  data: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  lastError?: string;
}

export interface QueueStats {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  deadLettered: number;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFY_URL ?? 'http://localhost:3004/notify';

const QUEUE_KEY = 'queue:notifications';
const PROCESSING_KEY = 'queue:notifications:processing';
const DLQ_KEY = 'queue:notifications:dead-letter';
const STATS_KEY = 'stats:notifications';

const MAX_ATTEMPTS = 3;
const BACKOFF_DELAYS = [1000, 5000, 25000]; // exponential: 1s, 5s, 25s
const WORKER_CONCURRENCY = 3;
const POLL_INTERVAL_MS = 500;

// ---------------------------------------------------------------------------
// Lazy Redis connection (imported only when REDIS_URL is set)
// ---------------------------------------------------------------------------

let redis: InstanceType<typeof import('ioredis').default> | null = null;
let queueEnabled = false;

// Senior Architect Note: Using global object for singleton safety in Next.js Dev Mode (Hot Reloading)
const globalWorker = global as unknown as { __workerRunning?: boolean };

async function ensureRedis(): Promise<InstanceType<typeof import('ioredis').default> | null> {
  if (redis) return redis;
  try {
    const Redis = (await import('ioredis')).default;
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      retryStrategy(times) {
        return Math.min(times * 300, 3000);
      },
    });
    redis.on('error', (err: Error) => console.error('[queue:redis] error:', err.message));
    redis.on('connect', () => console.log('[queue:redis] connected'));
    queueEnabled = true;

    // Start worker loop on first successful connection, ensuring singleton status
    if (!globalWorker.__workerRunning) {
      globalWorker.__workerRunning = true;
      startWorkerLoop();
    }

    return redis;
  } catch (err) {
    console.warn('[queue] Redis unavailable — queue disabled, notifications fire-and-forget');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Queue operations (pure Redis)
// ---------------------------------------------------------------------------

async function enqueueJob(job: NotificationJob): Promise<void> {
  const r = await ensureRedis();
  if (!r) return;
  await r.lpush(QUEUE_KEY, JSON.stringify(job));
}

async function dequeueJob(): Promise<NotificationJob | null> {
  const r = redis;
  if (!r) return null;

  // BRPOPLPUSH atomically moves item to processing queue (1s timeout)
  const result = await r.brpoplpush(QUEUE_KEY, PROCESSING_KEY, 1);
  if (!result) return null;

  try {
    return JSON.parse(result) as NotificationJob;
  } catch {
    await r.lpop(PROCESSING_KEY); // remove malformed
    return null;
  }
}

async function requeueFailedJob(job: NotificationJob, error: string): Promise<void> {
  const r = redis;
  if (!r) return;

  job.attempts += 1;
  job.lastError = error;

  if (job.attempts >= job.maxAttempts) {
    // Move to dead-letter queue
    await r.rpush(DLQ_KEY, JSON.stringify(job));
    await r.lpop(PROCESSING_KEY);
    await r.incr(`${STATS_KEY}:deadLettered`);
    console.error(`[queue] Job ${job.id} → DLQ after ${job.attempts} attempts: ${error}`);
  } else {
    // Requeue with exponential backoff
    await r.lpop(PROCESSING_KEY);
    const delay = BACKOFF_DELAYS[Math.min(job.attempts - 1, BACKOFF_DELAYS.length - 1)];
    setTimeout(async () => {
      try {
        await enqueueJob(job);
        console.warn(`[queue] Job ${job.id} requeued (${job.attempts}/${job.maxAttempts}) after ${delay}ms`);
      } catch (err) {
        console.error(`[queue] Failed to requeue ${job.id}:`, (err as Error).message);
      }
    }, delay);
  }
}

async function completeJob(): Promise<void> {
  const r = redis;
  if (!r) return;
  await r.lpop(PROCESSING_KEY);
  await r.incr(`${STATS_KEY}:completed`);
}

// ---------------------------------------------------------------------------
// Fire-and-forget fallback (when Redis is unavailable)
// ---------------------------------------------------------------------------

async function fireAndForget(storeId: string, event: string, data: Record<string, unknown>): Promise<void> {
  try {
    const response = await fetch(NOTIFICATION_SERVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId, event, data }),
    });
    if (!response.ok) {
      console.warn(`[queue:direct] Notification service returned ${response.status}`);
    }
  } catch (err) {
    console.warn('[queue:direct] Fire-and-forget failed:', (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Worker loop — processes jobs from the queue
// ---------------------------------------------------------------------------

async function startWorkerLoop(): Promise<void> {
  console.log(`[queue:worker] Started (concurrency: ${WORKER_CONCURRENCY}, poll: ${POLL_INTERVAL_MS}ms)`);

  for (let i = 0; i < WORKER_CONCURRENCY; i++) {
    workerLoop().catch((err) => console.error(`[queue:worker-${i}] Fatal:`, err));
  }
}

async function workerLoop(): Promise<void> {
  while (globalWorker.__workerRunning) {
    try {
      const job = await dequeueJob();
      if (!job) continue;

      console.log(`[queue:worker] Processing ${job.id}: ${job.event} → ${job.storeId} (${job.attempts + 1}/${job.maxAttempts})`);

      try {
        const response = await fetch(NOTIFICATION_SERVICE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storeId: job.storeId, event: job.event, data: job.data }),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => 'no body');
          throw new Error(`Notification service returned ${response.status}: ${text}`);
        }

        console.log(`[queue:worker] ✓ Job ${job.id} completed`);
        await completeJob();
      } catch (err) {
        const errorMsg = (err as Error).message;
        console.error(`[queue:worker] ✗ Job ${job.id} failed: ${errorMsg}`);
        const r = redis;
        if (r) await r.incr(`${STATS_KEY}:failed`);
        await requeueFailedJob(job, errorMsg);
      }
    } catch {
      // Redis or connection error — wait and retry
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enqueue a notification for guaranteed delivery.
 * Falls back to fire-and-forget if Redis is unavailable.
 *
 * @param storeId - Target store ID for room-based broadcasting
 * @param event - Event type: 'new-order' | 'status-change'
 * @param data - Payload to broadcast
 * @returns Job ID if queued, or null if fire-and-forget
 */
export async function enqueueNotification(
  storeId: string,
  event: 'new-order' | 'status-change',
  data: Record<string, unknown>,
): Promise<string | null> {
  const job: NotificationJob = {
    id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    storeId,
    event,
    data,
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    createdAt: new Date().toISOString(),
  };

  const r = await ensureRedis();
  if (r) {
    await enqueueJob(job);
    return job.id;
  }

  // Fallback: fire-and-forget
  await fireAndForget(storeId, event, data);
  return null;
}

/**
 * Get queue statistics.
 */
export async function getQueueStats(): Promise<QueueStats> {
  const r = redis;
  if (!r) {
    return { queued: 0, processing: 0, completed: 0, failed: 0, deadLettered: 0, enabled: false };
  }

  const [queued, processing, completed, failed, deadLettered] = await Promise.all([
    r.llen(QUEUE_KEY),
    r.llen(PROCESSING_KEY),
    r.get(`${STATS_KEY}:completed`).then((v) => parseInt(v ?? '0', 10)),
    r.get(`${STATS_KEY}:failed`).then((v) => parseInt(v ?? '0', 10)),
    r.llen(DLQ_KEY),
  ]);

  return { queued, processing, completed, failed, deadLettered, enabled: true };
}

/**
 * Check if the queue is enabled (Redis connected).
 */
export function isQueueEnabled(): boolean {
  return queueEnabled;
}
