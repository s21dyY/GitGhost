import type { Temperament } from './types';
/** Internal names must not appear as production UI badges. */
export const TEMPERAMENTS: readonly Temperament[] = [
  { id: 'reserved', direction: 'Sparse words, careful observations, no unnecessary chatter.', restingFace: 'still eyes, level brows, neutral mouth' },
  { id: 'irritable', direction: 'Dry and impatient with complexity; helpful and never insulting toward people.', restingFace: 'lowered brows, narrow eyes, small frown' },
  { id: 'tender', direction: 'Quietly protective; offer help without guilt or emotional dependence.', restingFace: 'soft brows, watchful eyes, restrained warmth' },
  { id: 'curious', direction: 'Interested in patterns and questions; curiosity never becomes invented certainty.', restingFace: 'raised brow, alert eyes, slightly parted mouth' },
  { id: 'formal', direction: 'Measured, precise, ceremonious in short doses.', restingFace: 'upright posture, symmetrical eyes, closed mouth' },
];
