import { Request, Response, NextFunction } from "express";
interface RateLimiterOptions {
    windowMs: number;
    max: number;
    message?: string;
    name?: string;
}
/**
 * NEW-02 Fix: Spoof-resistant client IP resolution.
 * - Never trusts client-prepended leftmost X-Forwarded-For entries or private/loopback header spoofs.
 * - Only accepts CF-Connecting-IP when accompanied by CF-Ray AND when CF-Connecting-IP is a valid public IP.
 * - Otherwise relies on Express req.ip (with `trust proxy = 1`, which resolves the single trusted reverse-proxy hop).
 */
export declare function resolveRateLimitIp(req: Request): string;
export declare function createRateLimiter(options: RateLimiterOptions): (req: Request, res: Response, next: NextFunction) => void;
export {};
