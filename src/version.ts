import { readFileSync } from "node:fs";

function readPackageVersion(): string {
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    const raw = readFileSync(pkgUrl, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.version === "string" && parsed.version.trim()) {
      return parsed.version.trim();
    }
  } catch {
    // Fallback if package.json is unavailable at runtime
  }
  return "2.6.1";
}

export const APP_VERSION: string = readPackageVersion();
