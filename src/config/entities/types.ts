/** Creative descriptions are briefs, not generated artwork or repository facts. */
export type Stage = 'human' | 'distorted' | 'transformed';
export type AssetBrief = { key: string; status: 'needs-art'; description: string };
export type StageDesign = { silhouette: string; face: string; movement: string; asset: AssetBrief };
export type HumanOrigin = {
  id: string; internalName: string; purposeKeywords: readonly string[];
  signatureObject: string; palette: readonly string[];
  humanVoice: string; habits: readonly string[]; fictionalMemory: string;
  stages: Record<Stage, StageDesign>;
  greetings: readonly string[]; creativeNotes: string;
};
export type HorrorProfile = {
  id: string; internalName: string; themes: readonly string[];
  voice: string; humanEcho: string; vocabulary: readonly string[];
  atmosphereLines: readonly string[]; evidenceTemplate: string;
  recognition: { unknown: string; selfIdentified: string; currentOwner: string; returningVisitor: string };
  visualDirection: string; avoid: readonly string[]; creativeNotes: string;
};
export type Mutation = {
  id: string; origins: readonly string[]; genres: readonly string[];
  slot: 'face' | 'aura' | 'shadow'; incompatibleWith: readonly string[];
  stages: Record<Stage, string>; reducedMotion: string; asset: AssetBrief;
};
export type Temperament = { id: string; direction: string; restingFace: string };
export type RepoSignals = {
  repoId: number; repoName: string; description?: string; topics?: readonly string[];
  createdAt?: string; primaryLanguage?: string;
};
export type EntityIdentity = {
  configVersion: number; repoId: number; seed: string; originId: string;
  horrorId: string; temperamentId: string; mutationIds: string[];
  eraId: string; languageMotif: string; currentStage: Exclude<Stage, 'human'>;
  originAssignment: { method: 'keyword' | 'fallback'; matchedKeywords: string[] };
};
export type ViewerContext = {
  relationship: 'unknown' | 'self-identified' | 'current-personal-owner';
  hasRecordedVisit: boolean;
};
