import { HUMANS } from './human';
import { HORRORS } from './horror';
import { MUTATIONS } from './transformations';
import { TEMPERAMENTS } from './temperaments';
import type { EntityIdentity, RepoSignals, Stage, ViewerContext } from './types';

export const CONFIG_VERSION = 3;
/** Non-security hash for creative selection. Never use for auth or secrets. */
function hash(text: string): number {
  let value = 2166136261;
  for (const c of text) { value ^= c.codePointAt(0)!; value = Math.imul(value, 16777619); }
  return value >>> 0;
}
function pick<T extends { id: string }>(items: readonly T[], seed: string, label: string): T {
  if (!items.length) throw new Error(`No candidates for ${label}`);
  // Independent labeled selection prevents unrelated draws shifting the whole identity.
  return [...items].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)[hash(`${seed}:${label}`) % items.length];
}
function requireId<T extends { id: string }>(items: readonly T[], id: string): T {
  const item = items.find(x => x.id === id);
  if (!item) throw new Error(`Unknown config ID: ${id}. Migrate explicitly; do not reroll.`);
  return item;
}
export function validateConfig(): void {
  for (const list of [HUMANS, HORRORS, MUTATIONS, TEMPERAMENTS]) {
    if (!list.length || new Set(list.map(x=>x.id)).size !== list.length) throw new Error('Empty or duplicate config IDs');
  }
  for (const m of MUTATIONS) {
    m.origins.forEach(id=>requireId(HUMANS,id));
    m.genres.forEach(id=>requireId(HORRORS,id));
    m.incompatibleWith.forEach(id=>requireId(MUTATIONS,id));
  }
}

/** Call ONLY for an unassigned repo. Persist this entire result, not just its seed.
 * Supply a server-created random seed and use an atomic first-write in your database.
 * Caller must reread the winning assignment after a concurrent write conflict.
 */
export function buildEntity(repo: RepoSignals, seed: string): EntityIdentity {
  validateConfig();
  if (!Number.isSafeInteger(repo.repoId) || repo.repoId <= 0 || !seed.trim()) throw new Error('Valid numeric repoId and seed required');
  const tokens = new Set(`${repo.description ?? ''} ${(repo.topics ?? []).join(' ')}`.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const scored = HUMANS.map(h => ({ h, matched: h.purposeKeywords.filter(k=>tokens.has(k)) }));
  const max = Math.max(...scored.map(x=>x.matched.length));
  const origin = max === 0 ? requireId(HUMANS,'archivist') : pick(scored.filter(x=>x.matched.length===max).map(x=>x.h),seed,'origin');
  const matched = scored.find(x=>x.h.id===origin.id)!.matched;
  const horror = pick(HORRORS,seed,'horror');
  const temperament = pick(TEMPERAMENTS,seed,'temperament');
  const available = MUTATIONS.filter(m=>m.origins.includes(origin.id)&&m.genres.includes(horror.id));
  const chosen: typeof available = [];
  for (const slot of ['face','aura','shadow'] as const) {
    const candidates = available.filter(m=>m.slot===slot && chosen.every(c=>!c.incompatibleWith.includes(m.id)&&!m.incompatibleWith.includes(c.id)));
    if (candidates.length && chosen.length < 2) chosen.push(pick(candidates,seed,`mutation:${slot}`));
  }
  const year = repo.createdAt ? new Date(repo.createdAt).getUTCFullYear() : NaN;
  const eraId = !Number.isFinite(year) ? 'timeless' : year < 2010 ? 'early-web-inspired' : year < 2020 ? 'terminal-workshop' : 'contemporary-archive';
  const motifs: Record<string,string> = { typescript: 'blue enamel index tabs', javascript: 'amber glass markers', python: 'woven notebook ribbon', rust: 'oxidized copper fasteners', go: 'pale cyan thread', c: 'brushed metal tools', 'c++': 'layered metal plates' };
  return { configVersion: CONFIG_VERSION, repoId: repo.repoId, seed, originId: origin.id, horrorId: horror.id, temperamentId: temperament.id,
    mutationIds: chosen.map(x=>x.id), eraId, languageMotif: motifs[repo.primaryLanguage?.toLowerCase() ?? ''] ?? 'weathered brass details',
    currentStage: hash(`${seed}:stage`) % 2 ? 'distorted' : 'transformed',
    originAssignment: { method: max ? 'keyword' : 'fallback', matchedKeywords: [...matched] } };
}

export function resolveEntity(entity: EntityIdentity) {
  if (entity.configVersion !== CONFIG_VERSION) throw new Error('Explicit config migration required');
  const origin = requireId(HUMANS,entity.originId);
  const horror = requireId(HORRORS,entity.horrorId);
  const temperament = requireId(TEMPERAMENTS,entity.temperamentId);
  const mutations = entity.mutationIds.map(id=>requireId(MUTATIONS,id));
  if (new Set(entity.mutationIds).size !== mutations.length || new Set(mutations.map(m=>m.slot)).size !== mutations.length || mutations.length>2) throw new Error('Invalid saved mutation selection');
  for (const m of mutations) {
    if (!m.origins.includes(origin.id)||!m.genres.includes(horror.id)||mutations.some(other=>m.incompatibleWith.includes(other.id))) throw new Error('Incompatible saved mutation');
  }
  return { origin, horror, temperament, mutations };
}

/** ViewerContext must be derived by the server for authenticated relationships.
 * This function selects prose; it does NOT verify GitHub ownership or prior visits.
 */
export function recognitionLine(entity: EntityIdentity, viewer: ViewerContext): string {
  const { horror } = resolveEntity(entity);
  if (viewer.hasRecordedVisit) return horror.recognition.returningVisitor;
  if (viewer.relationship === 'current-personal-owner') return horror.recognition.currentOwner;
  if (viewer.relationship === 'self-identified') return horror.recognition.selfIdentified;
  return horror.recognition.unknown;
}

/** Only call with an issue in the current scoped evidence registry. */
export function issuePerformance(entity: EntityIdentity, issueNumber: number, allowedIssueNumbers: readonly number[]): string {
  if (!Number.isSafeInteger(issueNumber)||issueNumber<=0||!allowedIssueNumbers.includes(issueNumber)) throw new Error('Issue not in scoped evidence');
  return resolveEntity(entity).horror.evidenceTemplate.replaceAll('{issueNumber}', `#${issueNumber}`);
}

/** Append this trusted character direction to your evidence-aware system prompt.
 * Put repository text and viewer input in separate untrusted data messages.
 * No API calls, model IDs, credentials, or artwork generation in this module.
 */
export function buildCharacterDirection(entity: EntityIdentity, stage: Stage = entity.currentStage): string {
  const { origin, horror, temperament } = resolveEntity(entity);
  return [
    'Portray a fictional repository entity. Display its repository name, never internal archetype labels.',
    'The human origin and transformation are imagined art, not biography or factual repository history.',
    `Stage: ${stage}. Signature object: ${origin.signatureObject}.`,
    `Temperament: ${temperament.direction}`,
    stage === 'human' ? `Human voice: ${origin.humanVoice} ${horror.humanEcho}` : `Horror voice: ${horror.voice}`,
    stage === 'distorted' ? 'Use light fragmentation; preserve the human cadence.' : '',
    'Atmosphere may be fictional. Repository assertions, including inside theatrical lines, require supporting evidence.',
    'Use at most one brief flourish before technical guidance. Never corrupt code, commands, paths, or citations.',
    'Return readable base text; the application controls visual corruption and accessible alternatives.',
    'Never infer viewer identity or original authorship. Current ownership is not original creation.',
    'Do not say the viewer returned unless a trusted recorded-visit flag allows it.',
    `Avoid: ${horror.avoid.join('; ')}.`,
  ].filter(Boolean).join('\n');
}
