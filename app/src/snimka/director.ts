// The director: while the clock plays and "Karta prati snimku" is on, the
// map flies to the focus of the current chapter or headline and the named
// panel datum is pulsed once (plan section 3.5). Lane V2 owns this file; V0
// ships a stub that binds nothing.
import type { BindDirector } from './contracts';

export const bindDirector: BindDirector = () => () => {};
