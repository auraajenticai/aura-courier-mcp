import { Request } from "express";
import { EnvSource } from "./config.js";
/**
 * Pull this client's courier keys from request headers or query params.
 * Task T1 Tenant Isolation: Only fall back to master process.env credentials when
 * the caller authenticated with the master key (tenantId === "master").
 */
export declare function keysFromRequest(req: Request): EnvSource;
export declare const app: import("express-serve-static-core").Express;
