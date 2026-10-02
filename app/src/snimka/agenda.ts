// The Poglavlja panel and open(chapterId): pause, seek, subject, scroll the
// instrument into view; reused by the hero's question chips (plan section
// 3.4). Lane V4 owns this file; V0 ships an empty spec.
import type { AgendaPanel } from './contracts';
import { SN } from './strings';

export const agendaPanel: AgendaPanel = () => ({
  id: 'poglavlja',
  title: SN.panel.agenda,
  mountFace: () => () => {},
  mountDepth: () => () => {},
});
