import { describe, expect, it } from "vitest";
import { SCENES, sceneFor, spriteFor } from "./scene-theme";

describe("scene family", () => {
  it.each([
    [{ name: "atom", description: "A hackable text editor.", language: "JavaScript" }, "frontend"],
    [{ name: "send", description: "A file sharing service.", language: "FreeMarker" }, "comms"],
    [{ name: "request", description: "A simplified HTTP request client for Node.js.", language: "JavaScript" }, "network"],
    [{ name: "bower", description: "A package manager for the web.", language: "JavaScript" }, "infra"],
    [{ name: "moment", description: "A JavaScript date library for parsing and formatting dates.", language: "JavaScript" }, "graveyard"],
    [{ name: "pdf.js", description: "A PDF viewer built with web standards.", language: "JavaScript" }, "frontend"],
    [{ name: "VisualStudioUninstaller", description: "Visual Studio Uninstallation sometimes can be unreliable", language: "C#" }, "infra"],
    [{ name: "tensor-things", description: "Neural nets for research", language: "Python" }, "data"],
    [{ name: "mystery", description: null, language: "Rust" }, "infra"],
    [{ name: "mystery", description: null, language: null }, "graveyard"],
  ])("%j -> %s", (meta, family) => expect(sceneFor(meta)).toBe(family));
  it("reads topics too, and is deterministic", () => {
    expect(sceneFor({ name: "x", topics: ["graphql", "api"] })).toBe("network");
    expect(sceneFor({ name: "x", topics: ["graphql"] })).toBe(sceneFor({ name: "x", topics: ["graphql"] }));
  });
  it("matches whole words only: 'apiary' is not an API", () => {
    expect(sceneFor({ name: "apiary", description: "bees" })).toBe("graveyard");
  });
  it("always returns a known family", () => {
    for (const d of ["", "x", "chat server ui data build"]) expect(SCENES).toContain(sceneFor({ name: "n", description: d }));
  });
});

describe("which ghost body haunts a scene", () => {
  it("watchkeeper, radio-operator, clockmaker and bellwraith origins keep their own bodies in every scene", () => {
    for (const s of SCENES) {
      expect(spriteFor("watchkeeper", s)).toBe("watchkeeper");
      expect(spriteFor("radio-operator", s)).toBe("hound");
      expect(spriteFor("clockmaker", s)).toBe("clockmaker");
      expect(spriteFor("bellwraith", s)).toBe("bellwraith");
    }
  });
  it("other origins take the body of the scene", () => {
    expect(spriteFor("archivist", "graveyard")).toBe("archivist");
    expect(spriteFor("archivist", "network")).toBe("hound");
    expect(spriteFor(undefined)).toBe("archivist");
  });
});
