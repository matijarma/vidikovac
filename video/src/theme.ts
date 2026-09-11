import { Easing } from 'remotion';
import { loadFont as loadSpaceGrotesk } from '@remotion/google-fonts/SpaceGrotesk';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';

// The dashboard's layer-1 tokens, mirrored for the two cards so the video and
// the product share one canvas: deep night blue, paper white, one cool accent.
export const COLORS = {
  night: '#0b1020',
  fg: '#e8ecf5',
  muted: '#9aa5bf',
  accent: '#7cd4ff',
  paper: '#f7f3ea',
} as const;

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
/** Safe area for 1920x1080: 140 px sides, 180 px top and bottom (scaled from the 80/100 rule at 1080 wide). */
export const SAFE = { x: 140, y: 180 } as const;
export const TITLE_SECONDS = 4;
export const END_SECONDS = 6;

// Shared across both cards: the entrance easing and the standard
// interpolate() clamp, so TitleCard.tsx and EndCard.tsx don't each redefine
// the same two constants.
export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
export const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

type InterWeight = '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';

/** The display face (SpaceGrotesk, weight 700) shared by both cards. */
export const loadDisplayFont = () =>
  loadSpaceGrotesk('normal', { weights: ['700'], subsets: ['latin', 'latin-ext'] });

/** The body face (Inter) shared by both cards; each card picks its own weights. */
export const loadBodyFont = (weights: InterWeight[]) =>
  loadInter('normal', { weights, subsets: ['latin', 'latin-ext'] });
