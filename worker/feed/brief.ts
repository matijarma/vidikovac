// What is left of the per-item summary pass: the Workers AI model name and the
// background-write hook the live sentence service (worker/feed/sentences.ts)
// reads from here, unchanged.
//
// The pass itself -- condensing gazette act titles, DHMZ's forecast narrative,
// ZET notices, works descriptions and kvartovske headlines into one line each,
// written onto FeedItem.brief -- served the kiosk's header ticker (WP6), which
// WP1 deleted. The one read left (app/src/city/nearby.ts) takes a brief only
// from an eligible event, and no briefed source is one, so the calls, the KV
// cache and the producers are retired (WP5 B1). FeedItem.brief stays in
// worker/feed/schema.ts for one deploy, so a cached payload that still
// carries it parses.

/** The large Workers AI text model; the live sentence service picks its templates with it. */
export const BRIEF_MODEL_AKT = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** Hands a background write to the runtime, so it outlives the response without delaying it. */
export type BriefWaitUntil = (promise: Promise<unknown>) => void;
