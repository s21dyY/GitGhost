import { describe, expect, it } from "vitest";
import { classifyTurn, temperatureFor } from "./conversation";

describe("conversational intent", () => {
  it.each([
    "Are you lonely?",
    "Do you remember me?",
    "Are you afraid of the dark?",
    "Tell me a scary story.",
    "What do you dream about?",
  ])("character: %s", (q) => expect(classifyTurn(q)).toBe("character"));
  it.each([
    "Why was this repo archived?",
    "When was the first commit?",
    "Who maintained this project?",
    "What happened in issue #42?",
    "Why did you die?",
  ])("factual: %s", (q) => expect(classifyTurn(q)).toBe("factual"));
  it.each([
    "How did you feel when development stopped?",
    "What was your happiest commit?",
    "Do you miss your creator?",
  ])("mixed: %s", (q) => expect(classifyTurn(q)).toBe("mixed"));
  it("factual turns keep the provider default temperature; fiction gets more room", () => {
    expect(temperatureFor("factual")).toBeUndefined();
    expect(temperatureFor("mixed")).toBeGreaterThan(0.2);
    expect(temperatureFor("character")).toBeGreaterThan(temperatureFor("mixed")!);
  });
});
