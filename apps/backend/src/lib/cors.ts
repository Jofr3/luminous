import type { Bindings } from "../types";

const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5173"];

function normalizeOrigins(value: string | undefined): Set<string> {
  const origins = value
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set([...(origins ?? []), ...DEFAULT_ALLOWED_ORIGINS]);
}

export function getCorsOrigin(origin: string | undefined, env: Bindings): string | null {
  if (!origin) {
    return null;
  }

  return normalizeOrigins(env.ALLOWED_ORIGINS).has(origin) ? origin : null;
}
