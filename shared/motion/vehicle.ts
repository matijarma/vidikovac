// The one size a vehicle has on every surface. Shared by the app (the body
// drawn under the pill at high zoom) and the Worker (the gap the ordering
// register keeps between two trams), so it stays DOM-free.

/** One length for every vehicle of a mode, drawn and reasoned with as such:
 *  a TMK 2200 is 32 m; a solo ZET bus 12 m (the articulated ones are 18,
 *  the owner chose one number). Width is the body's, for the line under
 *  the pill. */
export const VEHICLE_LENGTH_M = { tram: 32, bus: 12 } as const;
export const VEHICLE_WIDTH_M = 2.5;
