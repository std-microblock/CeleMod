// Mod descriptions come from GameBanana, where links are often written as
// scheme-relative ("//discord.gg/xxx"): a browser resolves those against the
// current page, but the app hands links straight to the OS, which only
// understands absolute URLs and treats everything else as a file path.
export function externalLinkUrl(
  url: string | null | undefined,
): string | undefined {
  if (!url) return undefined;
  let value = url.trim();
  if (!value) return undefined;
  if (value.startsWith("//")) value = `https:${value}`;
  if (!/^https?:\/\//i.test(value)) return undefined;
  try {
    return new URL(value).href;
  } catch {
    return undefined;
  }
}
