/**
 * Socket.io Redis adapter wiring (Plan 15).
 *
 * Why: docker-compose.app.yml scales chat / websocket / notification servers
 * to multiple replicas. Without an inter-replica message bus a `io.to(room).emit(...)`
 * call only reaches sockets attached to the same Node process — half the
 * room (the half on the other replica) never sees the message.
 *
 * @socket.io/redis-adapter solves this by publishing every emit to a Redis
 * Pub/Sub channel; each replica's subscriber relays into local sockets.
 * No sticky sessions required — clients can hit any replica via nginx
 * round-robin.
 *
 * Usage:
 *   const { attachRedisAdapter } = require('../../lib/socket-adapter');
 *   io = new Server(httpServer, { cors: { origin: '*' } });
 *   await attachRedisAdapter(io, '<service-name>');
 *
 * Behaviour:
 *   - REDIS_URL set → adapter attached, returns true.
 *   - REDIS_URL unset → no-op, returns false (single-process fallback works).
 *   - Adapter setup errors are logged + swallowed so a Redis hiccup doesn't
 *     prevent the service from booting; single-process behaviour resumes.
 *
 * The two Redis clients (pub + sub) are NOT the shared ioredis instance from
 * backend/lib/redis.js — Pub/Sub mode hogs the connection (a SUBSCRIBE'd
 * client can't issue regular commands). The adapter requires dedicated
 * clients; that's what `duplicate()` from a fresh ioredis is for.
 */

const { createAdapter } = require('@socket.io/redis-adapter');
const { Redis } = require('ioredis');

let attached = false;

async function attachRedisAdapter(io, serviceName = 'socket') {
  if (attached) return true;

  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn(
      `[${serviceName}] REDIS_URL not set — socket.io running single-process. ` +
        `Multi-replica deploys MUST set REDIS_URL or rooms split per replica.`
    );
    return false;
  }

  try {
    const pubClient = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: null, // Pub/Sub needs unbounded retry; commands tolerate it.
    });
    const subClient = pubClient.duplicate();

    // Surface connection failures so a misconfigured REDIS_URL isn't silent.
    pubClient.on('error', (err) => {
      console.warn(`[${serviceName}] socket adapter pub error: ${err.message}`);
    });
    subClient.on('error', (err) => {
      console.warn(`[${serviceName}] socket adapter sub error: ${err.message}`);
    });

    io.adapter(createAdapter(pubClient, subClient));
    attached = true;
    console.log(`[${serviceName}] socket.io redis adapter attached (${url})`);
    return true;
  } catch (err) {
    console.warn(
      `[${serviceName}] socket.io redis adapter failed to attach: ${err.message}. ` +
        `Falling back to single-process (multi-replica broadcasts will not work).`
    );
    return false;
  }
}

module.exports = { attachRedisAdapter };
