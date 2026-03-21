/** GitHub Releases 链接（与 package.json build.publish 一致） */
const OWNER = "yifancao9211";
const REPO = "cursor-auto-login";

/** @param {string} version 例如 3.3.2，可带或不带 v 前缀 */
export function releaseTagUrl(version) {
  const v = String(version || "").trim().replace(/^v/i, "");
  return `https://github.com/${OWNER}/${REPO}/releases/tag/v${v}`;
}

export function latestReleaseUrl() {
  return `https://github.com/${OWNER}/${REPO}/releases/latest`;
}
