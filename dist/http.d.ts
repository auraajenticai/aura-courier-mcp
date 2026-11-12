import { Request } from "express";
import { EnvSource } from "./config.js";
/**
 * F10 Fix: Pull client courier keys strictly from request headers.
 * Query parameters are completely ignored to prevent credential leakage in URL logs.
 */
export declare function keysFromRequest(req: Request): EnvSource;
export declare const app: import("express-serve-static-core").Express;
