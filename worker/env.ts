export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  ASSETS: Fetcher;
  FEED: KVNamespace;
  BEACON_DO: DurableObjectNamespace;
  ROOM_DO: DurableObjectNamespace;
  INDEX_DO: DurableObjectNamespace;
  METRICS_DO: DurableObjectNamespace;
  RL_SCAN: RateLimiter;
  RL_DATA: RateLimiter;
  RL_OPEN: RateLimiter;
  // Runtime values, all optional: code falls back to the defaults in config.ts.
  SESSION_SECRET?: string;
  NET_KEY_SECRET?: string;
  SESSION_MINUTES?: string;
  PEER_MINUTES?: string;
  CODE_ROTATE_SECONDS?: string;
  NETWORK_CHECK?: string; // enforce | warn | off
  SCAN_TURNSTILE?: string; // on | off
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  /**
   * Test-only admin bypass: verifyAccess accepts a request carrying header
   * `x-e2e-admin-bypass` equal to this value, and ONLY when networkCheck(env)
   * is 'off' (never in production, where NETWORK_CHECK is enforce).
   */
  E2E_ADMIN_BYPASS?: string;
}
