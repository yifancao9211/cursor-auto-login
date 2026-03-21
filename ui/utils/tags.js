export function parseTags(raw) {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

export function serializeTags(tags) {
  return tags.join(",");
}

export function matchesTagFilter(accountTags, filterTag) {
  if (!filterTag) return true;
  const tags = parseTags(accountTags);
  return tags.includes(filterTag.toLowerCase());
}
