import { Request, Response, NextFunction } from "express";

interface RateLimiterOptions {
  windowMs: number;
  max: number;
  message?: string;
  name?: string;
}

interface ClientRecord {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: RateLimiterOptions) {
  const { windowMs, max, message = "Too Many Requests. Rate limit exceeded, please retry later.", name = "Default" } = options;
  const store = new Map<string, ClientRecord>();

  // Prune expired rate limit entries every 5 minutes to avoid memory bloat
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of store.entries()) {
      if (now > record.resetAt) {
        store.delete(key);
      }
    }
  }, 5 * 60 * 1000).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    // Extract Client IP (supporting Cloudflare cf-connecting-ip and reverse proxies like Traefik / Nginx)
    const cfIp = req.headers["cf-connecting-ip"];
    const xForwardedFor = req.headers["x-forwarded-for"];
    let clientIp = "";
    if (typeof cfIp === "string") {
      clientIp = cfIp.trim();
    } else if (typeof xForwardedFor === "string") {
      clientIp = xForwardedFor.split(",")[0].trim();
    } else if (Array.isArray(xForwardedFor) && xForwardedFor.length > 0) {
      clientIp = xForwardedFor[0].trim();
    } else {
      clientIp = req.socket?.remoteAddress || "unknown";
    }

    // Bypass loopback and internal orchestration networks
    if (
      clientIp === "127.0.0.1" ||
      clientIp === "::1" ||
      clientIp === "::ffff:127.0.0.1" ||
      clientIp.startsWith("10.") ||
      clientIp.startsWith("172.16.") ||
      clientIp.startsWith("172.17.") ||
      clientIp.startsWith("172.18.")
    ) {
      return next();
    }

    const now = Date.now();
    let record = store.get(clientIp);

    if (!record || now > record.resetAt) {
      record = {
        count: 1,
        resetAt: now + windowMs,
      };
      store.set(clientIp, record);
    } else {
      record.count++;
    }

    const remaining = Math.max(0, max - record.count);
    const resetTimeSec = Math.ceil(record.resetAt / 1000);
    const retryAfterSec = Math.ceil((record.resetAt - now) / 1000);

    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", resetTimeSec);

    if (record.count > max) {
      res.setHeader("Retry-After", retryAfterSec);
      res.status(429).json({
        error: "Too Many Requests",
        limiter: name,
        message,
        retryAfterSeconds: retryAfterSec,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    next();
  };
}
