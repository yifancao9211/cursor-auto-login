import { describe, it, expect } from "vitest";
import { parseTags, matchesTagFilter, serializeTags } from "../ui/utils/tags.js";

describe("parseTags", () => {
  it("parses comma-separated string", () => {
    expect(parseTags("dev, production, test")).toEqual(["dev", "production", "test"]);
  });

  it("handles empty/null", () => {
    expect(parseTags("")).toEqual([]);
    expect(parseTags(null)).toEqual([]);
    expect(parseTags(undefined)).toEqual([]);
  });

  it("deduplicates and trims", () => {
    expect(parseTags("dev,  dev , DEV")).toEqual(["dev"]);
  });
});

describe("serializeTags", () => {
  it("joins array into comma-separated string", () => {
    expect(serializeTags(["dev", "prod"])).toBe("dev,prod");
  });

  it("handles empty array", () => {
    expect(serializeTags([])).toBe("");
  });
});

describe("matchesTagFilter", () => {
  it("matches when account has the tag", () => {
    expect(matchesTagFilter("dev,prod", "dev")).toBe(true);
    expect(matchesTagFilter("dev,prod", "prod")).toBe(true);
  });

  it("does not match when tag is absent", () => {
    expect(matchesTagFilter("dev,prod", "staging")).toBe(false);
  });

  it("returns true for empty filter (show all)", () => {
    expect(matchesTagFilter("dev,prod", "")).toBe(true);
    expect(matchesTagFilter("dev,prod", null)).toBe(true);
  });

  it("handles account with no tags", () => {
    expect(matchesTagFilter("", "dev")).toBe(false);
    expect(matchesTagFilter(null, "dev")).toBe(false);
    expect(matchesTagFilter(null, "")).toBe(true);
  });
});
