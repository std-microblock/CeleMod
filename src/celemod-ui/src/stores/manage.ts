import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { BackendModInfo } from "../states";

export type ManageEnabledFilter = "all" | "enabled" | "disabled";
export type ManageHealthFilter = "all" | "healthy" | "issues" | "missing";

export interface ManageCatalogMeta {
  submissionId?: string;
  category: string | null;
  subCategory: string | null;
  submitter: string;
  submissionName: string;
  pageUrl: string | null;
  downloads: number;
  catalogSize: number;
  updatedAt: string;
  gameBananaId: number | null;
}
export interface ManageDisplayNames {
  primaryName: string;
  secondaryName: string | null;
}

export const resolveManageDisplayNames = (
  modName: string,
  comment: string | undefined,
  submissionName: string | undefined,
  autoUseSubmissionName: boolean,
): ManageDisplayNames => {
  const normalizedComment = comment?.trim() ?? "";
  const normalizedSubmissionName = submissionName?.trim() ?? "";
  const remarkName =
    normalizedComment ||
    (autoUseSubmissionName && normalizedSubmissionName !== modName.trim()
      ? normalizedSubmissionName
      : "");
  return remarkName
    ? { primaryName: remarkName, secondaryName: modName }
    : { primaryName: modName, secondaryName: null };
};

export interface ManageDependency {
  name: string;
  version: string;
  optional: boolean;
}

export interface ManageNode {
  name: string;
  id: string;
  enabled: boolean;
  /** Whether the Mod name itself is enabled by the active profile. */
  enabledByName: boolean;
  version: string;
  file: string;
  size: number;
  modifiedAt: number;
  isDirectory: boolean;
  dependencies: ManageDependency[];
  dependedBy: string[];
  duplicateFiles: ManageModFile[];
  meta: ManageCatalogMeta | null;
}

export interface ManageModFile {
  file: string;
  version: string;
  size: number;
  modifiedAt: number;
  isDirectory: boolean;
  enabled: boolean;
}

const compareVersion = (left: string, right: string) => {
  const normalize = (value: string) =>
    value.split(/[.-]/).map((part) => Number(part) || 0);
  const a = normalize(left);
  const b = normalize(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0))
      return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
};

/// Picks the file that represents a Mod name in the tree.  An enabled file
/// wins over a disabled one, so the row keeps showing what the game loads.
const preferManageFile = (
  candidate: Pick<ManageModFile, "enabled" | "version" | "modifiedAt">,
  current:
    | Pick<ManageModFile, "enabled" | "version" | "modifiedAt">
    | undefined,
) => {
  if (!current) return true;
  if (candidate.enabled !== current.enabled) return candidate.enabled;
  const versionOrder = compareVersion(candidate.version, current.version);
  if (versionOrder !== 0) return versionOrder > 0;
  return candidate.modifiedAt > current.modifiedAt;
};

export interface DuplicateFixTarget {
  name: string;
  keepFile: string;
  disabledFiles: string[];
}

/// Duplicate Mods that need attention: the Mod name is enabled but the number
/// of enabled files of that name is not exactly one.
export const collectDuplicateFixTargets = (
  nodes: Record<string, ManageNode>,
): DuplicateFixTarget[] =>
  Object.values(nodes).flatMap((node) => {
    if (node.duplicateFiles.length < 2 || !node.enabledByName) return [];
    const enabledFiles = node.duplicateFiles.filter((file) => file.enabled);
    if (enabledFiles.length === 1) return [];
    return [
      {
        name: node.name,
        keepFile: node.file,
        disabledFiles: node.duplicateFiles
          .filter((file) => file.file !== node.file)
          .map((file) => file.file),
      },
    ];
  });

export const normalizeManageDependencies = (
  dependencies: readonly ManageDependency[],
) => {
  const byName = new Map<string, ManageDependency>();
  for (const dependency of dependencies) {
    const current = byName.get(dependency.name);
    if (!current) {
      byName.set(dependency.name, { ...dependency });
      continue;
    }
    if (compareVersion(dependency.version, current.version) > 0)
      current.version = dependency.version;
    // A dependency is optional only when every declaration says it is optional.
    current.optional = current.optional && dependency.optional;
  }
  return [...byName.values()];
};

interface ManageFilters {
  query: string;
  enabled: ManageEnabledFilter;
  health: ManageHealthFilter;
  types: string[];
  updateOnly: boolean;
  duplicateOnly: boolean;
  showHiddenTypes: boolean;
}

interface HydrateInput {
  installedMods: BackendModInfo[];
  disabledNames: string[];
  disabledFiles: string[];
  catalogByName: Record<string, ManageCatalogMeta>;
}

interface ManageTreeState {
  nodes: Record<string, ManageNode>;
  expanded: Record<string, boolean>;
  filters: ManageFilters;
  filterOpen: boolean;
  actionMenuOpen: boolean;
  openMenuName: string | null;
  hydrate: (input: HydrateInput) => void;
  setExpanded: (name: string, expanded: boolean) => void;
  collapseAll: () => void;
  expandAll: () => void;
  setQuery: (query: string) => void;
  setEnabledFilter: (enabled: ManageEnabledFilter) => void;
  setHealthFilter: (health: ManageHealthFilter) => void;
  toggleType: (type: string) => void;
  setUpdateOnly: (value: boolean) => void;
  setDuplicateOnly: (value: boolean) => void;
  setShowHiddenTypes: (value: boolean) => void;
  resetFilters: () => void;
  setFilterOpen: (value: boolean) => void;
  setActionMenuOpen: (value: boolean) => void;
  setOpenMenuName: (value: string | null) => void;
  setNodesEnabled: (names: string[], enabled: boolean) => void;
}

const defaultFilters: ManageFilters = {
  query: "",
  enabled: "all",
  health: "all",
  types: [],
  updateOnly: false,
  duplicateOnly: false,
  showHiddenTypes: false,
};

export const useManageStore = create<ManageTreeState>()(
  persist(
    immer((set) => ({
      nodes: {},
      expanded: {},
      filters: defaultFilters,
      filterOpen: false,
      actionMenuOpen: false,
      openMenuName: null,
      hydrate({ installedMods, disabledNames, disabledFiles, catalogByName }) {
        set((state) => {
          const disabled = new Set(disabledNames);
          const disabledPackages = new Set(
            disabledFiles.map((file) => file.toLocaleLowerCase()),
          );
          const nodes: Record<string, ManageNode> = {};
          for (const mod of installedMods) {
            const current = nodes[mod.name];
            const enabledByName = !disabled.has(mod.name);
            const file = {
              file: mod.file,
              version: mod.version,
              size: mod.size,
              modifiedAt: mod.modified_at,
              isDirectory: mod.is_directory,
              enabled:
                enabledByName &&
                !disabledPackages.has(mod.file.toLocaleLowerCase()),
            };
            if (current) {
              current.duplicateFiles.push(file);
              const currentFile = current.duplicateFiles.find(
                (item) => item.file === current.file,
              );
              if (preferManageFile(file, currentFile)) {
                current.id = String(mod.game_banana_id);
                current.version = mod.version;
                current.file = mod.file;
                current.size = mod.size;
                current.modifiedAt = mod.modified_at;
                current.isDirectory = mod.is_directory;
                current.dependencies = normalizeManageDependencies(mod.deps);
              }
              current.enabled = current.enabled || file.enabled;
              continue;
            }
            nodes[mod.name] = {
              name: mod.name,
              id: String(mod.game_banana_id),
              enabled: file.enabled,
              enabledByName,
              version: mod.version,
              file: mod.file,
              size: mod.size,
              modifiedAt: mod.modified_at,
              isDirectory: mod.is_directory,
              dependencies: normalizeManageDependencies(mod.deps),
              dependedBy: [],
              duplicateFiles: [file],
              meta: catalogByName[mod.name.trim().toLocaleLowerCase()] ?? null,
            };
          }
          for (const node of Object.values(nodes)) {
            for (const dependency of node.dependencies) {
              if (!dependency.optional && nodes[dependency.name]) {
                if (!nodes[dependency.name].dependedBy.includes(node.name))
                  nodes[dependency.name].dependedBy.push(node.name);
              }
            }
          }
          state.nodes = nodes;
          for (const name of Object.keys(state.expanded)) {
            if (!nodes[name]) delete state.expanded[name];
          }
        });
      },
      setExpanded(name, expanded) {
        set((state) => {
          state.expanded[name] = expanded;
        });
      },
      collapseAll() {
        set((state) => {
          state.expanded = {};
        });
      },
      expandAll() {
        set((state) => {
          for (const node of Object.values(state.nodes)) {
            if (node.dependencies.length > 0) state.expanded[node.name] = true;
          }
        });
      },
      setQuery(query) {
        set((state) => {
          state.filters.query = query;
        });
      },
      setEnabledFilter(enabled) {
        set((state) => {
          state.filters.enabled = enabled;
        });
      },
      setHealthFilter(health) {
        set((state) => {
          state.filters.health = health;
        });
      },
      toggleType(type) {
        set((state) => {
          state.filters.types = state.filters.types.includes(type)
            ? state.filters.types.filter((value) => value !== type)
            : [...state.filters.types, type];
        });
      },
      setUpdateOnly(value) {
        set((state) => {
          state.filters.updateOnly = value;
        });
      },
      setDuplicateOnly(value) {
        set((state) => {
          state.filters.duplicateOnly = value;
        });
      },
      setShowHiddenTypes(value) {
        set((state) => {
          state.filters.showHiddenTypes = value;
        });
      },
      resetFilters() {
        set((state) => {
          state.filters = defaultFilters;
        });
      },
      setFilterOpen(value) {
        set((state) => {
          state.filterOpen = value;
        });
      },
      setActionMenuOpen(value) {
        set((state) => {
          state.actionMenuOpen = value;
        });
      },
      setOpenMenuName(value) {
        set((state) => {
          state.openMenuName = value;
        });
      },
      setNodesEnabled(names, enabled) {
        set((state) => {
          for (const name of names) {
            if (state.nodes[name]) state.nodes[name].enabled = enabled;
          }
        });
      },
    })),
    {
      name: "celemod-manage-tree",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        expanded: state.expanded,
        filters: state.filters,
      }),
    },
  ),
);

const EXCLUDED_DEPENDENCIES = new Set(["Everest", "Celeste", "EverestCore"]);
const ALTERNATIVE_MODS = [
  "CelesteNet.Client",
  "MiaoNet",
  "Miao.CelesteNet.Client",
];

export const alternativesCovering = (
  name: string,
  nodes: Record<string, ManageNode>,
) => {
  if (!ALTERNATIVE_MODS.includes(name)) return [];
  return ALTERNATIVE_MODS.filter(
    (alternative) => alternative !== name && nodes[alternative]?.enabled,
  );
};

export interface ManageDependencyHealth {
  status: "healthy" | "missing" | "disabled" | "version";
  messages: string[];
}

export const getDependencyHealth = (
  name: string,
  nodes: Record<string, ManageNode>,
  includeOptional: boolean,
): ManageDependencyHealth => {
  if (!nodes[name]?.enabled) return { status: "healthy", messages: [] };
  const messages: string[] = [];
  let status: ManageDependencyHealth["status"] = "healthy";
  const visiting = new Set<string>();
  const ranks = { healthy: 0, version: 1, disabled: 2, missing: 3 };

  const merge = (next: ManageDependencyHealth["status"], message: string) => {
    if (ranks[next] > ranks[status]) status = next;
    if (message) messages.push(message);
  };

  const visit = (nodeName: string) => {
    if (visiting.has(nodeName)) return;
    const node = nodes[nodeName];
    if (!node) return;
    visiting.add(nodeName);
    for (const dependency of node.dependencies) {
      if (
        EXCLUDED_DEPENDENCIES.has(dependency.name) ||
        (dependency.optional && !includeOptional)
      )
        continue;
      const installed = nodes[dependency.name];
      const covered = alternativesCovering(dependency.name, nodes).length > 0;
      if (!installed) {
        if (!covered) merge("missing", `${node.name} → ${dependency.name}`);
        continue;
      }
      if (compareVersion(installed.version, dependency.version) < 0) {
        merge(
          "version",
          `${dependency.name} ${installed.version} < ${dependency.version}`,
        );
      }
      if (!installed.enabled && !covered) {
        merge("disabled", dependency.name);
        continue;
      }
      visit(installed.name);
    }
    visiting.delete(nodeName);
  };
  visit(name);
  return { status, messages };
};

export const collectSwitchNames = ({
  names,
  enabled,
  nodes,
  includeDependencies,
  includeOptional,
  autoDisableTypes,
}: {
  names: string[];
  enabled: boolean;
  nodes: Record<string, ManageNode>;
  includeDependencies: boolean;
  includeOptional: boolean;
  autoDisableTypes: string[];
}) => {
  const result = new Set<string>();
  const visit = (name: string) => {
    if (result.has(name) || !nodes[name]) return;
    result.add(name);
    if (!includeDependencies) return;
    const node = nodes[name];
    for (const dependency of node.dependencies) {
      if (
        EXCLUDED_DEPENDENCIES.has(dependency.name) ||
        (dependency.optional && !includeOptional)
      )
        continue;
      const installed = nodes[dependency.name];
      if (!installed || ALTERNATIVE_MODS.includes(dependency.name)) continue;
      if (enabled) {
        visit(dependency.name);
      } else {
        if (
          installed.meta?.category &&
          !autoDisableTypes.includes(installed.meta.category)
        )
          continue;
        const hasOtherEnabledDependent = installed.dependedBy.some(
          (dependent) =>
            dependent !== name &&
            nodes[dependent]?.enabled &&
            !result.has(dependent),
        );
        if (!hasOtherEnabledDependent) visit(dependency.name);
      }
    }
  };
  names.forEach(visit);
  return [...result];
};

/**
 * Collect required dependencies that become orphaned when deleting a Mod.
 * Optional dependencies are intentionally ignored: they are suggestions, not
 * runtime requirements, and should not be pulled into the deletion dialog.
 */
export const collectOrphanDependencyNames = ({
  name,
  nodes,
}: {
  name: string;
  nodes: Record<string, ManageNode>;
}) => {
  const orphaned: string[] = [];
  const orphanedSet = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeName: string) => {
    if (visited.has(nodeName)) return;
    visited.add(nodeName);
    for (const dependency of nodes[nodeName]?.dependencies ?? []) {
      // Optional dependencies (and engine-provided dependencies) are not
      // candidates for automatic deletion.
      if (dependency.optional || EXCLUDED_DEPENDENCIES.has(dependency.name))
        continue;
      const dependencyNode = nodes[dependency.name];
      if (!dependencyNode || orphanedSet.has(dependency.name)) continue;
      const remaining = dependencyNode.dependedBy.filter(
        (dependent) => dependent !== name && !orphanedSet.has(dependent),
      );
      if (remaining.length > 0) continue;
      orphaned.push(dependency.name);
      orphanedSet.add(dependency.name);
      visit(dependency.name);
    }
  };
  visit(name);
  return orphaned;
};

export const selectDefaultOrphanNames = ({
  names,
  nodes,
  allowedTypes,
  alwaysOnMods,
}: {
  names: string[];
  nodes: Record<string, ManageNode>;
  allowedTypes: string[];
  alwaysOnMods: string[];
}) => {
  const alwaysOnFiles = new Set(
    alwaysOnMods.flatMap((name) => {
      const file = nodes[name]?.file;
      return file ? [file] : [];
    }),
  );
  return names.filter((name) => {
    const node = nodes[name];
    return Boolean(
      node?.meta?.category &&
      allowedTypes.includes(node.meta.category) &&
      !alwaysOnFiles.has(node.file),
    );
  });
};

export const selectVisibleRootNames = ({
  nodes,
  filters,
  rootOnly,
  includeOptional,
  hiddenTypes,
  updateNames,
  displayNames,
}: {
  nodes: Record<string, ManageNode>;
  filters: ManageFilters;
  rootOnly: boolean;
  includeOptional: boolean;
  hiddenTypes: string[];
  updateNames: Set<string>;
  displayNames?: Record<string, ManageDisplayNames>;
}) => {
  const query = filters.query.trim().toLocaleLowerCase();
  const matches = (node: ManageNode) => {
    if (
      !filters.showHiddenTypes &&
      node.meta?.category &&
      hiddenTypes.includes(node.meta.category)
    )
      return false;
    if (
      filters.types.length > 0 &&
      (!node.meta?.category || !filters.types.includes(node.meta.category))
    )
      return false;
    if (filters.enabled === "enabled" && !node.enabled) return false;
    if (filters.enabled === "disabled" && node.enabled) return false;
    if (filters.updateOnly && !updateNames.has(node.name)) return false;
    if (filters.duplicateOnly && node.duplicateFiles.length < 2) return false;
    const health = getDependencyHealth(node.name, nodes, includeOptional);
    if (filters.health === "healthy" && health.status !== "healthy")
      return false;
    if (filters.health === "issues" && health.status === "healthy")
      return false;
    if (filters.health === "missing" && health.status !== "missing")
      return false;
    if (query) {
      const text = [
        node.name,
        displayNames?.[node.name]?.primaryName,
        displayNames?.[node.name]?.secondaryName,
        node.version,
        node.file,
        node.meta?.submissionName,
        node.meta?.submitter,
        node.meta?.category,
      ]
        .filter(Boolean)
        .join("\n")
        .toLocaleLowerCase();
      if (!query.split(/\s+/).every((term) => text.includes(term)))
        return false;
    }
    return true;
  };
  const getSortName = (name: string) =>
    displayNames?.[name]?.primaryName.trim() || name;
  return Object.values(nodes)
    .filter(matches)
    .filter((node) => {
      if (!rootOnly || query) return true;
      return !node.dependedBy.some((dependent) => Boolean(nodes[dependent]));
    })
    .map((node) => node.name)
    .sort(
      (a, b) =>
        getSortName(a).localeCompare(getSortName(b)) || a.localeCompare(b),
    );
};

export const excludedDependencyNames = EXCLUDED_DEPENDENCIES;
