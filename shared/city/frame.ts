// Seam S2 (docs/companion-2026-09-22.md §15.2): the wall's frame, "N stops
// around the place". Owned by WP2; read by WP1 (the "U blizini" circle and
// pill), WP3 (the camera span), WP4 (Karta) and the Worker. Pure, no imports
// at run time. The measured radius lands with the S2 commit; this first cut
// carries the type the screen protocol (S1) needs.

/** Kadar 4 / 6 / 8: how many tram stops around the place the frame reaches. */
export const FRAME_STOPS = [4, 6, 8] as const;
export type FrameStops = (typeof FRAME_STOPS)[number];
