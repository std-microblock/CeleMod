import type { File as SubmissionFile } from "./api/wegfan";

/** A Mod the mirror reports as packed inside a file archive. */
export interface FileMod {
  id: string;
  name: string;
  version: string;
}

/** The part of a submission the download picker works with. */
export interface DownloadFileSource {
  name: string;
  gameBananaId?: number | null;
  files?: SubmissionFile[] | null;
}

/** A file offered for download, before it is formatted for the picker. */
export interface DownloadFileEntry {
  /** GameBanana file id, "-1" when only the mirror knows the file. */
  id: string;
  name: string;
  size: number;
  url: string;
  isPrimary: boolean;
  mods: FileMod[];
}

const normalizeName = (value: string) =>
  value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");

const fileLabel = (file: SubmissionFile, submission: DownloadFileSource) =>
  file.mods?.[0]?.name ?? (file.description?.trim() || submission.name);

/**
 * The files a submission offers for download.
 *
 * The mirror reports the Mods packed inside a file in `mods`; the picker uses
 * that to label a file and to hide the older files of the same Mod. Those
 * entries only exist for files the mirror's Mod catalog knows about, so `mods`
 * comes back empty for everything else (WEGFan currently only lists its own
 * Mods). Such files must still be offered, otherwise the picker shows nothing
 * and the download button reports 文件列表为空 instead of handing the file to
 * the downloader.
 */
export const pickDownloadFiles = (
  submission: DownloadFileSource,
): DownloadFileEntry[] => {
  const files = submission.files ?? [];

  // WEGFan-only submissions have no GameBanana file id; the picker hands the
  // mirror URL to the downloader instead.
  if (!submission.gameBananaId || submission.gameBananaId < 0) {
    const file = files[0];
    if (!file?.url) return [];
    return [
      {
        id: file.gameBananaId > 0 ? file.gameBananaId.toString() : "-1",
        name: fileLabel(file, submission),
        size: file.size,
        url: file.url,
        isPrimary: true,
        mods: file.mods ?? [],
      },
    ];
  }

  const seenMods = new Set<string>();
  const entries: DownloadFileEntry[] = [];
  for (const file of files) {
    const mods = file.mods ?? [];
    if (mods.length > 0) {
      // Several files of one Mod: the mirror lists the newest one first.
      if (seenMods.has(mods[0].id)) continue;
      seenMods.add(mods[0].id);
    }
    entries.push({
      id: file.gameBananaId > 0 ? file.gameBananaId.toString() : "-1",
      name: fileLabel(file, submission),
      size: file.size,
      url: file.url,
      isPrimary: false,
      mods,
    });
  }

  const submissionName = normalizeName(submission.name);
  const primaryIndex = Math.max(
    0,
    entries.findIndex((entry) =>
      entry.mods.some((mod) => normalizeName(mod.name) === submissionName),
    ),
  );
  return entries.map((entry, index) => ({
    ...entry,
    isPrimary: index === primaryIndex,
  }));
};
