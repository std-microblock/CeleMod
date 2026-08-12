import type { CrashModFix } from "./updateInfo";

interface CrashFixAnalysis {
  exception: string;
  excerpt: string;
  suspects: Array<{
    name: string;
    installedVersion: string;
  }>;
}

interface InstalledModVersion {
  name: string;
  version: string;
}

export const findCrashModFix = (
  fixes: CrashModFix[] | undefined,
  analysis: CrashFixAnalysis,
): CrashModFix | null => {
  const crashText =
    `${analysis.exception}\n${analysis.excerpt}`.toLocaleLowerCase();
  return (
    (fixes || []).find((fix) => {
      const suspect = analysis.suspects.find(
        (item) =>
          item.name.toLocaleLowerCase() === fix.mod_name.toLocaleLowerCase(),
      );
      if (suspect && fix.affected_versions.includes(suspect.installedVersion)) {
        return true;
      }

      const affectedVersionInCrash = fix.affected_versions.some((version) =>
        crashText.includes(`${fix.mod_name} ${version}`.toLocaleLowerCase()),
      );
      return Boolean(
        affectedVersionInCrash &&
        (fix.match?.contains || []).every((part) =>
          crashText.includes(part.toLocaleLowerCase()),
        ),
      );
    }) || null
  );
};

export const findInstalledCrashModFix = (
  fixes: CrashModFix[],
  installedMods: InstalledModVersion[],
): CrashModFix | null =>
  fixes.find((fix) =>
    installedMods.some(
      (mod) =>
        mod.name.toLocaleLowerCase() === fix.mod_name.toLocaleLowerCase() &&
        fix.affected_versions.includes(mod.version),
    ),
  ) || null;
