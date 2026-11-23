import type { Content, Credit } from "../api/wegfan";
import {
  getModPageUrl,
  getOtherModPageSource,
  type ModPageLinks,
} from "../modPage";
import type { ModPageSource } from "../states";

export interface NormalizedCreditAuthor {
  name: string;
  role?: string;
  url?: string;
}

export interface NormalizedCreditGroup {
  groupName: string;
  authors: NormalizedCreditAuthor[];
}

export interface ResolvedExternalLink {
  source: ModPageSource;
  label: string;
  url: string;
}

export const formatCompactNumber = (num: number): string => {
  if (!Number.isFinite(num) || num < 0) return "0";
  if (num < 1000) return Math.round(num).toString();
  if (num < 1_000_000) return `${(num / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (num < 1_000_000_000)
    return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  return `${(num / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}b`;
};

export const formatDetailSize = (bytes?: number | null): string => {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "--";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
};

export const formatDetailDate = (
  value?: string | Date | number | null,
  withTime = false,
): string | null => {
  if (value == null || value === "" || value === 0) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return null;
  const pad = (v: number) => v.toString().padStart(2, "0");
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
  if (!withTime) return datePart;
  return `${datePart} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const matchCloudSubmission = (
  candidates: readonly Content[],
  target: {
    submissionId?: string | null;
    gameBananaId?: number | null;
    submissionName?: string | null;
  },
): Content | null => {
  if (candidates.length === 0) return null;

  if (target.submissionId) {
    const byId = candidates.find((item) => item.id === target.submissionId);
    if (byId) return byId;
  }

  if (target.gameBananaId && target.gameBananaId > 0) {
    const byGb = candidates.find(
      (item) => item.gameBananaId === target.gameBananaId,
    );
    if (byGb) return byGb;
  }

  const normalizedName = target.submissionName?.trim().toLocaleLowerCase();
  if (normalizedName) {
    const byName = candidates.find(
      (item) =>
        item.name.trim().toLocaleLowerCase() === normalizedName &&
        (!target.gameBananaId ||
          target.gameBananaId <= 0 ||
          item.gameBananaId === target.gameBananaId),
    );
    if (byName) return byName;
  }

  return null;
};

export const normalizeCredits = (
  credits?: readonly Credit[] | null,
  fallbackAuthors?: readonly string[] | null,
  defaultGroupLabel = "Credits",
): NormalizedCreditGroup[] => {
  const groups: NormalizedCreditGroup[] = [];

  if (credits && credits.length > 0) {
    for (const group of credits) {
      const seen = new Set<string>();
      const authors: NormalizedCreditAuthor[] = [];
      for (const author of group.authors ?? []) {
        const name = author.name?.trim();
        if (!name) continue;
        const key = `${name.toLocaleLowerCase()}::${(author.role ?? "").trim().toLocaleLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        authors.push({
          name,
          role: author.role?.trim() || undefined,
          url: author.url?.trim() || undefined,
        });
      }
      if (authors.length > 0) {
        groups.push({
          groupName: group.groupName?.trim() || defaultGroupLabel,
          authors,
        });
      }
    }
  }

  if (groups.length > 0) return groups;

  if (fallbackAuthors && fallbackAuthors.length > 0) {
    const seen = new Set<string>();
    const authors: NormalizedCreditAuthor[] = [];
    for (const raw of fallbackAuthors) {
      const name = raw.trim();
      if (!name) continue;
      const key = name.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      authors.push({ name });
    }
    if (authors.length > 0) {
      return [{ groupName: defaultGroupLabel, authors }];
    }
  }

  return [];
};

export const resolveExternalLinks = (
  links: ModPageLinks,
  preferredSource: ModPageSource,
): ResolvedExternalLink[] => {
  const orderedSources: ModPageSource[] = [
    preferredSource,
    getOtherModPageSource(preferredSource),
  ];
  const result: ResolvedExternalLink[] = [];
  for (const source of orderedSources) {
    const url = getModPageUrl(links, source);
    if (!url) continue;
    result.push({
      source,
      label: source === "wegfan" ? "WEGFan" : "GameBanana",
      url,
    });
  }
  return result;
};
