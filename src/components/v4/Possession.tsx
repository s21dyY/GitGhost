"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CodeFile, CodeOutline, CodeSymbol, CodeTree } from "@/domain/code";
import { enclosing, symbolPath } from "@/domain/outline";
import { playSfx } from "@/lib/sound";
import { askable, rankPaths, searchable, type CodeSearchResult, type CodeSource, type Lines } from "./code";

const SHOWN = 150;

/**
 * Possession: the ghost's code, in a haunted frame over the scene. Two views: its body (a searchable list of its
 * files) and one file (numbered lines; click a line, Shift+click to extend; on the keyboard, arrows move, Shift+arrows
 * extend, Enter asks). The code is shown exactly as read: never glitched, never paraphrased.
 */
export function Possession({ source, at, path, lines, marks = [], onOpen, onSelect, onAsk, onLeave }: {
  source: CodeSource;
  /** A commit SHA when the visitor is in an older era (the code as it stood then), or null for the present. */
  at: string | null;
  path: string | null;
  lines: Lines;
  /** Line ranges the Specialist commented on, marked in gold. */
  marks?: readonly { from: number; to: number }[];
  onOpen: (path: string | null) => void;
  /** `name`: the lines were chosen by a name on the file's map (a whole function or class). */
  onSelect: (lines: Lines, name?: string) => void;
  onAsk: () => void;
  onLeave: () => void;
}) {
  const [tree, setTree] = useState<{ key: string; value: CodeTree | null; error: string | null } | null>(null);
  const [file, setFile] = useState<{ key: string; value: CodeFile | null; error: string | null } | null>(null);
  const [query, setQuery] = useState("");
  // "Where else is this used?": GitHub code search results, shown in place of the file list until cleared
  const [found, setFound] = useState<{ term: string; result?: CodeSearchResult; error?: string } | null>(null);
  const runSearch = source.search
    ? (term: string) => {
        playSfx("open");
        setFound({ term });
        onOpen(null);
        void source.search!(term).then((r) => setFound((f) => (f?.term === term ? (r.ok ? { term, result: r.value } : { term, error: r.message }) : f)));
      }
    : undefined;
  const treeKey = at ?? "now";
  const fileKey = `${treeKey}:${path ?? ""}`;

  useEffect(() => {
    let live = true;
    void source.tree(at).then((r) => live && setTree({ key: treeKey, value: r.ok ? r.value : null, error: r.ok ? null : r.message }));
    return () => {
      live = false;
    };
  }, [source, at, treeKey]);
  useEffect(() => {
    if (!path) return;
    let live = true;
    void source.file(path, at).then((r) => live && setFile({ key: fileKey, value: r.ok ? r.value : null, error: r.ok ? null : r.message }));
    return () => {
      live = false;
    };
  }, [source, path, at, fileKey]);

  const ranked = useMemo(() => (tree?.key === treeKey && tree.value ? rankPaths(tree.value.paths) : []), [tree, treeKey]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ranked.filter((p) => p.toLowerCase().includes(q)) : ranked;
  }, [ranked, query]);
  const shownFile = path && file?.key === fileKey ? file : null;

  // Escape: a selection is cleared first, then the file closes, then the body.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (lines) onSelect(null);
      else if (path) onOpen(null);
      else onLeave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lines, path, onSelect, onOpen, onLeave]);

  return (
    <section className="v4-possess" aria-label="The ghost's code" data-testid="possession">
      <header className="v4-possess-head">
        {path ? (
          <button type="button" className="v4-possess-back" onClick={() => onOpen(null)} data-testid="possess-back">◀ Its body</button>
        ) : (
          <h2 className="v4-possess-title">Its body</h2>
        )}
        <p className="v4-possess-path" title={path ?? undefined}>{path ?? (at ? "as it was in this era" : "every file it is made of")}</p>
        {shownFile?.value?.url ? <a className="v4-link v4-possess-gh" href={shownFile.value.url} target="_blank" rel="noopener noreferrer">GitHub<span className="sr-only"> (opens in a new tab)</span> ↗</a> : null}
        <button type="button" className="v4-possess-leave" onClick={onLeave} aria-label="Leave its code" data-testid="possess-leave">✕</button>
      </header>
      {path ? (
        <FileView file={shownFile} lines={lines} marks={marks} onSelect={onSelect} onAsk={onAsk} onSearch={runSearch} />
      ) : found ? (
        <div className="v4-possess-body" data-testid="possess-found">
          <button type="button" className="v4-possess-back" onClick={() => setFound(null)}>◀ All its files</button>
          <p className="v4-possess-count">
            Where <code className="v4-sha">{found.term}</code> appears
            {found.result ? ` · ${found.result.total.toLocaleString("en-US")} ${found.result.total === 1 ? "file" : "files"} on ${found.result.branch} (GitHub code search)` : ""}
          </p>
          {!found.result && !found.error ? <p className="v4-quiet">Listening for its name…</p> : null}
          {found.error ? <p className="v4-quiet" role="alert">{found.error}</p> : null}
          {/* an empty search proves nothing: GitHub's code search does not cover every repository */}
          {found.result && !found.result.paths.length ? (
            <p className="v4-quiet" data-testid="found-none">
              GitHub&apos;s code search returned nothing for it.{found.result.archived ? " It often does not search archived repositories like this one," : " Its search does not cover every repository,"} so this does not mean the name is unused.
            </p>
          ) : null}
          {found.result ? (
            <ul className="v4-possess-files">
              {found.result.paths.map((p) => (
                <li key={p}>
                  <button type="button" onClick={() => { playSfx("open"); onOpen(p); }} onMouseEnter={() => playSfx("hover")} data-testid="found-file">
                    <span className="v4-possess-dir">{p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : ""}</span>
                    <span className="v4-possess-name">{p.slice(p.lastIndexOf("/") + 1)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="v4-possess-body">
          <label className="v4-possess-search">
            <span className="sr-only">Search its files</span>
            <input className="rpg-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search its files…" autoComplete="off" spellCheck={false} data-testid="possess-search" />
          </label>
          {tree?.key !== treeKey ? <p className="v4-quiet">Feeling for its bones…</p> : null}
          {tree?.key === treeKey && tree.error ? <p className="v4-quiet" role="alert">{tree.error}</p> : null}
          {tree?.key === treeKey && tree.value ? (
            <>
              <p className="v4-possess-count">
                {matches.length.toLocaleString("en-US")} {matches.length === 1 ? "file" : "files"}{query ? " match" : ""}
                {matches.length > SHOWN ? ` · first ${SHOWN} shown, search to find more` : ""}
                {tree.value.truncated ? " · a very large repository: not every file is listed" : ""}
              </p>
              <ul className="v4-possess-files" data-testid="possess-files">
                {matches.slice(0, SHOWN).map((p) => (
                  <li key={p}>
                    <button type="button" onClick={() => { playSfx("open"); onOpen(p); }} onMouseEnter={() => playSfx("hover")} data-testid="possess-file">
                      <span className="v4-possess-dir">{p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : ""}</span>
                      <span className="v4-possess-name">{p.slice(p.lastIndexOf("/") + 1)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}

const GLYPH: Record<CodeSymbol["kind"], string> = { class: "◆", type: "◇", module: "▣", function: "ƒ", method: "·", rule: "#" };

/** The file's map: its declarations, nested; choosing one chooses its lines. */
function CodeMap({ outline, lines, onPick }: { outline: CodeOutline; lines: Lines; onPick: (s: CodeSymbol) => void }) {
  if (outline.method === "none" || !outline.symbols.length) return <p className="v4-quiet v4-map-empty">Nothing here to map.</p>;
  return (
    <>
      {outline.method === "approximate" ? <p className="v4-map-note">An approximate map, read from indentation.</p> : null}
      <ul className="v4-map-list" data-testid="code-map">
        {outline.symbols.map((s) => {
          const on = !!lines && lines.from === s.from && lines.to === s.to;
          return (
            <li key={`${s.from}:${s.name}`} style={{ paddingLeft: `${Math.min(s.depth, 3) * 12}px` }}>
              <button type="button" aria-pressed={on} onClick={() => onPick(s)} title={`${s.kind}, lines ${s.from}–${s.to}`} data-testid="map-symbol">
                <span className="v4-map-glyph" aria-hidden="true">{GLYPH[s.kind]}</span>
                <span className="v4-map-name">{s.name}</span>
                <span className="sr-only">, {s.kind}, lines {s.from} to {s.to}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** One file: its map, numbered lines, a roving keyboard cursor, a selected range. */
function FileView({ file, lines, marks, onSelect, onAsk, onSearch }: { file: { value: CodeFile | null; error: string | null } | null; lines: Lines; marks: readonly { from: number; to: number }[]; onSelect: (l: Lines, name?: string) => void; onAsk: () => void; onSearch?: (term: string) => void }) {
  const anchor = useRef<number | null>(null);
  const [cursor, setCursor] = useState(1);
  const [mapOpen, setMapOpen] = useState<boolean | null>(null); // null: the layout decides (open on wide screens)
  const box = useRef<HTMLDivElement>(null);
  if (!file) return <p className="v4-quiet v4-possess-msg">Reaching into it…</p>;
  if (!file.value) return <p className="v4-quiet v4-possess-msg" role="alert">{file.error}</p>;
  const f = file.value;
  const pick = (n: number, extend: boolean) => {
    setCursor(n);
    if (extend && anchor.current !== null) onSelect({ from: Math.min(anchor.current, n), to: Math.max(anchor.current, n) });
    else {
      anchor.current = n;
      onSelect({ from: n, to: n });
    }
  };
  const move = (n: number, extend: boolean) => {
    const to = Math.max(1, Math.min(f.lines.length, n));
    pick(to, extend);
    box.current?.querySelector<HTMLElement>(`[data-line="${to}"]`)?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      move(cursor + (e.key === "ArrowDown" ? 1 : -1), e.shiftKey);
    } else if (e.key === "Enter" && lines) {
      e.preventDefault();
      onAsk();
    }
  };
  const inRange = (n: number) => !!lines && n >= lines.from && n <= lines.to;
  const pickSymbol = (s: CodeSymbol) => {
    playSfx("select");
    anchor.current = s.from;
    setCursor(Math.min(s.from, f.lines.length));
    onSelect({ from: s.from, to: s.to }, s.name);
    const el = box.current?.querySelector<HTMLElement>(`[data-line="${Math.min(s.from, f.lines.length)}"]`);
    el?.scrollIntoView({ block: "start" });
    if (window.matchMedia("(max-width: 1023px)").matches) setMapOpen(false);
  };
  const where = lines ? symbolPath(f.outline.symbols, lines.from, lines.to) : null;
  const name = lines ? enclosing(f.outline.symbols, lines.from, lines.to).at(-1)?.name : undefined;
  return (
    <div className="v4-possess-file" data-map={mapOpen === null ? undefined : String(mapOpen)}>
      <button type="button" className="v4-map-toggle" aria-expanded={mapOpen ?? undefined} onClick={() => setMapOpen((o) => !(o ?? false))} data-testid="map-toggle">Map</button>
      <nav className="v4-map" aria-label={`Map of ${f.path}`}>
        <CodeMap outline={f.outline} lines={lines} onPick={pickSymbol} />
      </nav>
      <div ref={box} className="v4-code" role="listbox" aria-label={`${f.path}, ${f.lines.length} lines. Select lines to ask the ghost about them.`} aria-multiselectable="true" onKeyDown={onKey} data-testid="possess-code">
        {f.lines.map((text, i) => {
          const n = i + 1;
          return (
            <div key={n} role="option" aria-selected={inRange(n)} tabIndex={n === cursor ? 0 : -1} data-line={n} data-marked={marks.some((m) => n >= m.from && n <= m.to) || undefined} className="v4-code-line"
              onMouseDown={(e) => e.shiftKey && e.preventDefault() /* Shift+click extends the choice; it must not also select text */}
              onClick={(e) => pick(n, e.shiftKey)}>
              <span className="v4-code-n" aria-hidden="true">{n}</span>
              <span className="v4-code-t">{text || " "}</span>
            </div>
          );
        })}
      </div>
      <p className="v4-possess-foot" aria-live="polite">
        {lines ? `Lines ${lines.from}${lines.to > lines.from ? `–${lines.to}` : ""} chosen${where ? ` · in ${where}` : ""}` : "Choose a name on the map, or click a line; Shift+click for more"}
        {f.truncated ? ` · showing ${f.lines.length.toLocaleString("en-US")} of ${f.total.toLocaleString("en-US")} lines` : ""}
        {askable(f.path) ? "" : " · it can show you this file, but not speak about it"}
        {onSearch && name && searchable(name) ? (
          <button type="button" className="v4-possess-where" onClick={() => onSearch(name)} data-testid="where-else">Where else is <code>{name}</code> used?</button>
        ) : null}
      </p>
    </div>
  );
}
