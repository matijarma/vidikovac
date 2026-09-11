import React from 'react';
import { Composition } from 'remotion';
import { EndCard } from './EndCard';
import { TitleCard } from './TitleCard';
import { END_SECONDS, FPS, HEIGHT, TITLE_SECONDS, WIDTH } from './theme';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="TitleCard"
      component={TitleCard}
      durationInFrames={TITLE_SECONDS * FPS}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
    <Composition
      id="EndCard"
      component={EndCard}
      durationInFrames={END_SECONDS * FPS}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  </>
);
