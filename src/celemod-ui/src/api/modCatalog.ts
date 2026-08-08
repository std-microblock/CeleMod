import type { Content, File as SubmissionFile } from "./wegfan";
import { callRemote } from "../utils";

export interface CatalogSubmission {
  id: string;
  createTime: string;
  updateTime: string;
  deleteTime: null;
  name: string;
  submissionType: string;
  submitter: string;
  pageUrl: string | null;
  gameBananaSection: string | null;
  gameBananaId: number | null;
  categoryId: number | null;
  categoryName: string | null;
  subCategoryId: number | null;
  subCategoryName: string | null;
  latestUpdateAddedTime: string;
}

export interface CatalogSubmissionFile {
  id: string;
  createTime: string;
  updateTime: string;
  deleteTime: null;
  url: string;
  description: string;
  downloads: number;
  size: number;
  gameBananaId: number | null;
  submission: CatalogSubmission;
}

export interface CatalogMod {
  id: string;
  createTime: string;
  updateTime: string;
  deleteTime: null;
  name: string;
  version: string;
  xxHash: string[];
  submissionFile: CatalogSubmissionFile;
}

interface CatalogResponse {
  data: CatalogMod[];
  code: number;
  message: string;
}

export interface LocalCatalogFilters {
  search: string;
  category: string;
  subCategory: string;
  section: string;
  submitter: string;
  updatedAfter: string;
  updatedBefore: string;
  minDownloads: number | null;
  maxDownloads: number | null;
  minSizeMb: number | null;
  maxSizeMb: number | null;
  sort: "updated" | "created" | "updateAdded" | "downloads" | "size" | "name";
  direction: "asc" | "desc";
}

export interface LocalCatalogOptions {
  categories: string[];
  subCategories: string[];
  sections: string[];
}

export interface LocalSubmission extends Content {
  catalogSize: number;
  catalogModNames: string[];
  catalogVersions: string[];
}

let catalog: CatalogMod[] | null = null;
let catalogPromise: Promise<CatalogMod[]> | null = null;

export const loadModCatalog = async (
  ttlHours = 24,
  forceRefresh = false
): Promise<CatalogMod[]> => {
  await callRemote("configure_mod_cache", Math.max(0, ttlHours) * 60 * 60);
  if (catalog && !forceRefresh) return catalog;
  if (catalogPromise && !forceRefresh) return catalogPromise;

  catalogPromise = callRemote<string>("get_mod_catalog", forceRefresh)
    .then((raw) => {
      const parsed = JSON.parse(raw) as CatalogResponse;
      catalog = Array.isArray(parsed.data) ? parsed.data : [];
      return catalog;
    })
    .finally(() => {
      catalogPromise = null;
    });
  return catalogPromise;
};

export const clearInMemoryModCatalog = () => {
  catalog = null;
  catalogPromise = null;
};

const numberInRange = (
  value: number,
  minimum: number | null,
  maximum: number | null
) =>
  (minimum === null || value >= minimum) &&
  (maximum === null || value <= maximum);

const dateInRange = (value: string, after: string, before: string) => {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return !after && !before;
  if (after && timestamp < new Date(`${after}T00:00:00`).getTime())
    return false;
  if (before && timestamp > new Date(`${before}T23:59:59.999`).getTime())
    return false;
  return true;
};

export const getLocalCatalogOptions = (
  mods: CatalogMod[]
): LocalCatalogOptions => {
  const categories = new Set<string>();
  const subCategories = new Set<string>();
  const sections = new Set<string>();
  for (const mod of mods) {
    const submission = mod.submissionFile.submission;
    if (submission.categoryName) categories.add(submission.categoryName);
    if (submission.subCategoryName)
      subCategories.add(submission.subCategoryName);
    if (submission.gameBananaSection)
      sections.add(submission.gameBananaSection);
  }
  const sort = (values: Set<string>) =>
    [...values].sort((a, b) => a.localeCompare(b));
  return {
    categories: sort(categories),
    subCategories: sort(subCategories),
    sections: sort(sections),
  };
};

export const queryLocalCatalog = (
  mods: CatalogMod[],
  filters: LocalCatalogFilters
): LocalSubmission[] => {
  type MutableSubmission = LocalSubmission & {
    fileMap: Map<string, SubmissionFile>;
  };
  const grouped = new Map<string, MutableSubmission>();
  const searchTerms = filters.search
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const submitter = filters.submitter.trim().toLocaleLowerCase();
  const minSize =
    filters.minSizeMb === null ? null : filters.minSizeMb * 1024 * 1024;
  const maxSize =
    filters.maxSizeMb === null ? null : filters.maxSizeMb * 1024 * 1024;

  for (const catalogMod of mods) {
    const file = catalogMod.submissionFile;
    const submission = file.submission;
    if (filters.category && submission.categoryName !== filters.category)
      continue;
    if (
      filters.subCategory &&
      submission.subCategoryName !== filters.subCategory
    )
      continue;
    if (filters.section && submission.gameBananaSection !== filters.section)
      continue;
    if (
      submitter &&
      !submission.submitter.toLocaleLowerCase().includes(submitter)
    )
      continue;
    if (
      !dateInRange(
        submission.updateTime,
        filters.updatedAfter,
        filters.updatedBefore
      )
    )
      continue;
    if (
      !numberInRange(file.downloads, filters.minDownloads, filters.maxDownloads)
    )
      continue;
    if (!numberInRange(file.size, minSize, maxSize)) continue;

    const haystack = [
      submission.name,
      submission.submitter,
      submission.categoryName ?? "",
      submission.subCategoryName ?? "",
      file.description,
      catalogMod.name,
      catalogMod.version,
    ]
      .join("\n")
      .toLocaleLowerCase();
    if (!searchTerms.every((term) => haystack.includes(term))) continue;

    let item = grouped.get(submission.id);
    if (!item) {
      item = {
        id: submission.id,
        createTime: submission.createTime as unknown as Date,
        updateTime: submission.updateTime as unknown as Date,
        deleteTime: null,
        name: submission.name.trim() || catalogMod.name.trim(),
        submissionType: submission.submissionType as Content["submissionType"],
        submitter: submission.submitter,
        pageUrl: submission.pageUrl ?? "",
        gameBananaSection: (submission.gameBananaSection ??
          "Mod") as Content["gameBananaSection"],
        gameBananaId: submission.gameBananaId ?? -1,
        categoryId: submission.categoryId ?? -1,
        categoryName: (submission.categoryName ??
          "Other/Misc") as Content["categoryName"],
        subCategoryId: submission.subCategoryId,
        subCategoryName:
          submission.subCategoryName as Content["subCategoryName"],
        subtitle: "",
        description: "",
        views: 0,
        likes: 0,
        downloads: 0,
        screenshots: [],
        credits: [],
        latestUpdateAddedTime:
          submission.latestUpdateAddedTime as unknown as Date,
        files: [],
        catalogSize: 0,
        catalogModNames: [],
        catalogVersions: [],
        fileMap: new Map(),
      };
      grouped.set(submission.id, item);
    }

    let contentFile = item.fileMap.get(file.id);
    if (!contentFile) {
      contentFile = {
        id: file.id,
        createTime: file.createTime as unknown as Date,
        updateTime: file.updateTime as unknown as Date,
        deleteTime: null,
        url: file.url,
        description: file.description,
        downloads: file.downloads,
        size: file.size,
        gameBananaId: file.gameBananaId ?? -1,
        mods: [],
      };
      item.fileMap.set(file.id, contentFile);
      item.files.push(contentFile);
      item.downloads += file.downloads;
      item.catalogSize += file.size;
    }
    if (!contentFile.mods.some((mod) => mod.id === catalogMod.id)) {
      contentFile.mods.push({
        id: catalogMod.id,
        createTime: catalogMod.createTime as unknown as Date,
        updateTime: catalogMod.updateTime as unknown as Date,
        deleteTime: null,
        name: catalogMod.name.trim(),
        version: catalogMod.version,
        xxHash: catalogMod.xxHash,
      });
      item.catalogModNames.push(catalogMod.name.trim());
      item.catalogVersions.push(catalogMod.version);
    }
  }

  const result = [...grouped.values()].map(
    ({ fileMap: _fileMap, ...item }) => item
  );
  const direction = filters.direction === "asc" ? 1 : -1;
  return result.sort((a, b) => {
    let comparison = 0;
    if (filters.sort === "name") comparison = a.name.localeCompare(b.name);
    else if (filters.sort === "downloads")
      comparison = a.downloads - b.downloads;
    else if (filters.sort === "size")
      comparison = a.catalogSize - b.catalogSize;
    else {
      const field =
        filters.sort === "created"
          ? "createTime"
          : filters.sort === "updateAdded"
          ? "latestUpdateAddedTime"
          : "updateTime";
      comparison = new Date(a[field]).getTime() - new Date(b[field]).getTime();
    }
    return comparison * direction;
  });
};

export const getCatalogModType = (mods: CatalogMod[], modName: string) => {
  const normalizedName = modName.trim().toLocaleLowerCase();
  return (
    mods.find((mod) => mod.name.trim().toLocaleLowerCase() === normalizedName)
      ?.submissionFile.submission.categoryName ?? null
  );
};
