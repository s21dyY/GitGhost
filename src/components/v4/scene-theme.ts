/**
 * Cosmetic scene families. A repository's metadata (name, description, topics, language) picks one of a few
 * haunted backdrops and, for some saved identities, which ghost body haunts it. This is a heuristic for mood only:
 * it says nothing about what the project is or why it stopped, and it is deterministic (same repository, same scene).
 */
export type SceneFamily = "graveyard" | "network" | "frontend" | "infra" | "data" | "comms";
export type SpriteKind = "archivist" | "watchkeeper" | "hound" | "clockmaker";
export const SCENES: readonly SceneFamily[] = ["graveyard", "network", "frontend", "infra", "data", "comms"];

type Meta = { name?: string | null; description?: string | null; language?: string | null; topics?: readonly string[] | null };

// Order matters: the first family whose words appear wins. Whole words only, lower case.
const RULES: [SceneFamily, RegExp][] = [
  ["comms", /\b(file[- ]?shar\w*|chat|messag\w+|mail|email|irc|sms|voip|forum|social|send|share|sharing|stream\w*)\b/],
  ["network", /\b(http|https|api|rest|graphql|socket\w*|network\w*|proxy|server|backend|request|router|rpc|grpc|websocket|client|tcp|udp|dns|cdn|webhook)\b/],
  ["data", /\b(data|dataset\w*|machine[- ]learning|ml|ai|neural|nlp|model\w*|research|science|scientific|database|sql|statistic\w*|tensor\w*|analytic\w*|notebook|visuali[sz]ation)\b/],
  ["infra", /\b(compiler|kernel|build|bundler|cli|devtool\w*|package[- ]manager|docker|container\w*|deploy\w*|infra\w*|terraform|linux|driver|runtime|toolchain|installer|uninstall\w*|firmware|embedded|operating[- ]system|shell|binary|assembly)\b/],
  ["frontend", /\b(ui|ux|css|html|react|vue|angular|svelte|component\w*|frontend|front-end|browser|dom|design|widget\w*|editor|viewer|render\w*|web[- ]standards|canvas|animation)\b/],
];
const LANGUAGE: Record<string, SceneFamily> = {
  c: "infra", "c++": "infra", rust: "infra", go: "infra", shell: "infra", assembly: "infra", makefile: "infra", zig: "infra",
  python: "data", r: "data", julia: "data", "jupyter notebook": "data",
  html: "frontend", css: "frontend", vue: "frontend", svelte: "frontend", typescript: "frontend",
};

export function sceneFor(m: Meta): SceneFamily {
  const text = `${m.name ?? ""} ${m.description ?? ""} ${(m.topics ?? []).join(" ")}`.toLowerCase().replace(/[._/]/g, " ");
  for (const [family, re] of RULES) if (re.test(text)) return family;
  return LANGUAGE[(m.language ?? "").toLowerCase()] ?? "graveyard";
}

/** The place a ghost haunts, in the voice of the game. Fiction; not a claim about the project. */
export const SCENE_PLACE: Record<SceneFamily, string> = {
  graveyard: "the old graveyard",
  network: "the wire fields",
  frontend: "the glass ruins",
  infra: "the iron works",
  data: "the observatory",
  comms: "the signal shore",
};

/**
 * The drawn body for a saved identity. A watchkeeper or radio operator keeps its own body. The other origins
 * take the body that suits the scene, so different kinds of repository are haunted by different kinds of spirit.
 */
export function spriteFor(originId: string | undefined, scene: SceneFamily = "graveyard"): SpriteKind {
  if (originId === "watchkeeper") return "watchkeeper";
  if (originId === "radio-operator") return "hound";
  if (originId === "clockmaker") return "clockmaker";
  const bySceneKind: Record<SceneFamily, SpriteKind> = { graveyard: "archivist", frontend: "archivist", data: "archivist", network: "hound", comms: "hound", infra: "watchkeeper" };
  return bySceneKind[scene];
}
