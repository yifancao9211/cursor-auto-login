import { describe, it, expect } from "vitest";
import { releaseTagUrl, latestReleaseUrl } from "../electron/services/github-release-url.js";

describe("github-release-url", () => {
  it("releaseTagUrl normalizes v prefix", () => {
    expect(releaseTagUrl("3.3.2")).toBe(
      "https://github.com/yifancao9211/cursor-auto-login/releases/tag/v3.3.2",
    );
    expect(releaseTagUrl("v3.3.2")).toBe(
      "https://github.com/yifancao9211/cursor-auto-login/releases/tag/v3.3.2",
    );
  });

  it("latestReleaseUrl points to /releases/latest", () => {
    expect(latestReleaseUrl()).toBe(
      "https://github.com/yifancao9211/cursor-auto-login/releases/latest",
    );
  });
});
