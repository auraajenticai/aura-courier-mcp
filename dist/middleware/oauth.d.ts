import type { Express, Request } from "express";
import { type AuthScope } from "./auth.js";
export interface OAuthAccessClaims {
    iss: string;
    aud: string;
    sub: string;
    adm: boolean;
    scp: AuthScope[];
    cid: string;
    typ: "at";
    iat: number;
    exp: number;
    jti: string;
}
export declare function verifyOAuthAccessToken(token: string): OAuthAccessClaims | null;
export declare function getPublicOrigin(req: Request): string;
export declare function buildWwwAuthenticateHeader(req: Request, invalidToken?: boolean): string;
export declare function isAllowedRedirectUri(uri: string): boolean;
export declare function registerOAuthRoutes(app: Express): void;
