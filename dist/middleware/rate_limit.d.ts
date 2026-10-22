import { Request, Response, NextFunction } from "express";
interface RateLimiterOptions {
    windowMs: number;
    max: number;
    message?: string;
    name?: string;
}
export declare function createRateLimiter(options: RateLimiterOptions): (req: Request, res: Response, next: NextFunction) => void;
export {};
