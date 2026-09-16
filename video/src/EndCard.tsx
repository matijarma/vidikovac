import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { CLAMP, COLORS, EASE_OUT, SAFE, loadBodyFont, loadDisplayFont } from './theme';

const display = loadDisplayFont();
const body = loadBodyFont(['400', '500']);

// Verbatim strings from docs/izvori.md; the end card is one of the four
// attribution places the plan requires.
const ATTRIBUTIONS = [
  'Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669',
  'Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom',
  'Izvor: DHMZ, Otvorena dozvola',
  'Izvor: EMSC, seismicportal.eu',
];

const Line: React.FC<{ from: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  from,
  children,
  style,
}) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        opacity: interpolate(frame, [from, from + 20], [0, 1], { ...CLAMP, easing: EASE_OUT }),
        translate: `0px ${interpolate(frame, [from, from + 20], [14, 0], { ...CLAMP, easing: EASE_OUT })}px`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.night,
        color: COLORS.fg,
        opacity: interpolate(frame, [durationInFrames - 15, durationInFrames], [1, 0], CLAMP),
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: `${SAFE.y}px ${SAFE.x}px`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Line from={0} style={{ fontFamily: display.fontFamily, fontWeight: 700, fontSize: 120, lineHeight: 1, letterSpacing: '-0.02em' }}>
            zagreb.aningfilm.hr
          </Line>
          <Line from={10} style={{ fontFamily: body.fontFamily, fontWeight: 500, fontSize: 52, color: COLORS.muted }}>
            Otvoreni kod: AGPL-3.0-or-later. Izvedeni podaci: Otvorena dozvola.
          </Line>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Line from={30} style={{ fontFamily: body.fontFamily, fontWeight: 500, fontSize: 40, color: COLORS.accent }}>
            Izgrađeno na otvorenim podacima
          </Line>
          {ATTRIBUTIONS.map((text, i) => (
            <Line
              key={text}
              from={40 + i * 12}
              style={{ fontFamily: body.fontFamily, fontWeight: 400, fontSize: 36, lineHeight: 1.25, color: COLORS.fg, maxWidth: 1640 }}
            >
              {text}
            </Line>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
