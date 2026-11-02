/** The ghost's body, as the code viewer receives it. Display only: answers about code come from the chat's evidence. */
export type CodeTree = {
  /** The commit SHA or branch the list was read at. */
  at: string;
  paths: string[];
  /** GitHub cut the list short, or GitGhost did (very large repositories). */
  truncated: boolean;
};

export type CodeFile = {
  path: string;
  at: string;
  /** Lines in order, cleaned of control characters; tabs become two spaces. */
  lines: string[];
  /** How many lines the file really has (it may have more than are shown). */
  total: number;
  truncated: boolean;
  /** The file on GitHub, at the same commit. */
  url: string;
  /** Its functions, classes and methods, for the map and for pointing at a whole function. */
  outline: CodeOutline;
};

/** One declaration in a file: what it is called, what kind of thing it is, and the lines it spans (1-based, inclusive). */
export type CodeSymbol = {
  name: string;
  kind: "class" | "function" | "method" | "type" | "module" | "rule";
  from: number;
  to: number;
  /** 0 for top level, 1 inside a class, and so on. */
  depth: number;
};

/**
 * A file's map. `parsed`: exact, from a real parser (tree-sitter). `approximate`: from indentation and keywords, for
 * languages without a parser; good enough to point at, not to trust to the line. `none`: nothing to map (data, prose).
 */
export type CodeOutline = { method: "parsed" | "approximate" | "none"; language: string | null; symbols: CodeSymbol[] };
