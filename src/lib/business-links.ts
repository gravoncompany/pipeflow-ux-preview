/** Classify only exact Instagram profile URLs supplied by a trusted source. */
export function instagramProfile(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !["instagram.com", "www.instagram.com"].includes(url.hostname.toLowerCase())) return "";
    const parts = url.pathname.split("/").filter(Boolean);
    const handle = parts[0] ?? "";
    if (parts.length !== 1 || !/^[a-z0-9._]{1,30}$/i.test(handle) || ["p", "reel", "reels", "stories", "explore", "tv", "accounts", "direct"].includes(handle.toLowerCase())) return "";
    return `https://www.instagram.com/${handle.toLowerCase()}/`;
  } catch { return ""; }
}
export function businessLinks(website: string, instagram = "") {
  const profile = instagramProfile(website);
  if (!profile) return { website, instagram };
  // A conflicting confirmed Instagram stays untouched; retain the other supplied URL too.
  if (instagram && instagramProfile(instagram) !== profile) return { website, instagram };
  return { website: "", instagram: instagram || profile };
}