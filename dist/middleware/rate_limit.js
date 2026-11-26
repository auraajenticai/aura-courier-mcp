import { isIP } from "node:net";
function normalizeIpLiteral(raw) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("::ffff:")) {
        return trimmed.slice(7);
    }
    return trimmed;
}
function isPrivateOrLoopbackIp(ip) {
    const norm = normalizeIpLiteral(ip).toLowerCase();
    if (!norm || norm === "127.0.0.1" || norm === "::1" || norm === "0.0.0.0")
        return true;
    if (norm.startsWith("127.") || norm.startsWith("10.") || norm.startsWith("192.168.") || norm.startsWith("169.254.")) {
        return true;
    }
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(norm)) {
        return true;
    }
    if (norm.startsWith("fc") || norm.startsWith("fd") || norm.startsWith("fe80:")) {
        return true;
    }
    return false;
}
/**
 * NEW-02 Fix: Spoof-resistant client IP resolution.
 * - Never trusts client-prepended leftmost X-Forwarded-For entries or private/loopback header spoofs.
 * - Only accepts CF-Connecting-IP when accompanied by CF-Ray AND when CF-Connecting-IP is a valid public IP.
 * - Otherwise relies on Express req.ip (with `trust proxy = 1`, which resolves the single trusted reverse-proxy hop).
 */
export function resolveRateLimitIp(req) {
    const cfIpRaw = req.headers["cf-connecting-ip"];
    const cfRay = req.headers["cf-ray"];
    if (typeof cfIpRaw === "string" && typeof cfRay === "string" && cfRay.trim().length > 0) {
        const cfIp = normalizeIpLiteral(cfIpRaw);
        if (isIP(cfIp) !== 0 && !isPrivateOrLoopbackIp(cfIp)) {
            return cfIp;
        }
    }
    const expressIp = typeof req.ip === "string" && req.ip.trim() ? normalizeIpLiteral(req.ip) : "";
    if (expressIp && isIP(expressIp) !== 0) {
        return expressIp;
    }
    const socketIp = req.socket?.remoteAddress ? normalizeIpLiteral(req.socket.remoteAddress) : "";
    return socketIp || "unknown";
}
export function createRateLimiter(options) {
    const { windowMs, max, message = "Too Many Requests. Rate limit exceeded, please retry later.", name = "Default" } = options;
    const store = new Map();
    // Prune expired rate limit entries every 5 minutes to avoid memory bloat
    setInterval(() => {
        const now = Date.now();
        for (const [key, record] of store.entries()) {
            if (now > record.resetAt) {
                store.delete(key);
            }
        }
    }, 5 * 60 * 1000).unref();
    return (req, res, next) => {
        // Allow high-speed local test execution unless test explicitly requests rate-limit enforcement
        if (process.env.NODE_ENV === "test" && req.headers["x-test-enforce-ratelimit"] !== "1") {
            return next();
        }
        const clientIp = resolveRateLimitIp(req);
        const now = Date.now();
        let record = store.get(clientIp);
        if (!record || now > record.resetAt) {
            record = {
                count: 1,
                resetAt: now + windowMs,
            };
            store.set(clientIp, record);
        }
        else {
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
