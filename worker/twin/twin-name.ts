// The twin's Durable Object name, in a module that imports nothing, so the
// cache layer (worker/feed/cache.ts) can build the stub with a type-only
// import of the class and the unit project never has to resolve
// 'cloudflare:workers' (the same reason worker/metrics-do-name.ts exists).
export const TWIN_DO_NAME = 'zet';
