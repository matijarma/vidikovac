import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { CLAMP, COLORS, EASE_OUT, SAFE, loadBodyFont, loadDisplayFont } from './theme';

const display = loadDisplayFont();
const body = loadBodyFont(['500']);

/** The QR ring from the kiosk: the only continuous motion in the product, and here. */
const Ring: React.FC<{ progress: number }> = ({ progress }) => {
  const r = 54;
  const circumference = 2 * Math.PI * r;
  return (
    <svg
      width={140}
      height={140}
      viewBox="0 0 140 140"
      style={{ position: 'absolute', right: SAFE.x, bottom: SAFE.y - 40 }}
      aria-hidden
    >
      <circle cx={70} cy={70} r={r} fill="none" stroke={COLORS.fg} strokeOpacity={0.15} strokeWidth={6} />
      <circle
        cx={70}
        cy={70}
        r={r}
        fill="none"
        stroke={COLORS.accent}
        strokeWidth={6}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
        style={{ rotate: '-90deg', transformOrigin: '70px 70px' }}
      />
    </svg>
  );
};

export const TitleCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.night,
        color: COLORS.fg,
        justifyContent: 'center',
        alignItems: 'center',
        opacity: interpolate(frame, [durationInFrames - 12, durationInFrames], [1, 0], CLAMP),
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 32,
          maxWidth: 1920 - SAFE.x * 2,
          padding: `0 ${SAFE.x}px`,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontFamily: body.fontFamily,
            fontWeight: 500,
            fontSize: 48,
            letterSpacing: '0.01em',
            color: COLORS.muted,
            opacity: interpolate(frame, [0, 24], [0, 1], { ...CLAMP, easing: EASE_OUT }),
            translate: `0px ${interpolate(frame, [0, 24], [16, 0], { ...CLAMP, easing: EASE_OUT })}px`,
          }}
        >
          Dobro došli u budućnost.
        </div>
        <div
          style={{
            fontFamily: display.fontFamily,
            fontWeight: 700,
            fontSize: 172,
            lineHeight: 1,
            letterSpacing: '-0.02em',
            opacity: interpolate(frame, [18, 54], [0, 1], { ...CLAMP, easing: EASE_OUT }),
            translate: `0px ${interpolate(frame, [18, 54], [48, 0], { ...CLAMP, easing: EASE_OUT })}px`,
          }}
        >
          Zagreb, povezan.
        </div>
      </div>
      <Ring progress={interpolate(frame, [0, durationInFrames], [0, 1], CLAMP)} />
    </AbsoluteFill>
  );
};
