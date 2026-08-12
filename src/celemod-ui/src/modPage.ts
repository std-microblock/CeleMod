import type { ModPageSource } from "./states";

export interface ModPageLinks {
  submissionId?: string | null;
  gameBananaUrl?: string | null;
}

export const getWegfanModPageUrl = (submissionId?: string | null) =>
  submissionId
    ? `https://celeste.weg.fan/submissions/detail/${encodeURIComponent(
        submissionId,
      )}/-`
    : undefined;

export const getModPageUrl = (links: ModPageLinks, source: ModPageSource) =>
  source === "wegfan"
    ? getWegfanModPageUrl(links.submissionId)
    : links.gameBananaUrl || undefined;

export const getOtherModPageSource = (source: ModPageSource): ModPageSource =>
  source === "wegfan" ? "gamebanana" : "wegfan";

export const getAvailableModPageUrl = (
  links: ModPageLinks,
  source: ModPageSource,
) =>
  getModPageUrl(links, source) ??
  getModPageUrl(links, getOtherModPageSource(source));
