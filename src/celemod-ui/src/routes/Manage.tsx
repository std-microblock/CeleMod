import _i18n from "src/i18n";
import {
  type CSSProperties,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./Manage.scss";
import {
  MOD_TYPE_OPTIONS,
  reloadBlacklistState,
  reloadInstalledMods,
  useAlwaysOnMods,
  useAppStore,
  useCurrentBlacklistProfile,
  useGamePath,
  useInstalledMods,
  useModComments,
} from "../states";
import { callRemote, compareVersion } from "../utils";
import {
  installOlympusProfiles,
  installProfileFile,
  installProfileModList,
} from "../profileInstall";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Icon } from "../components/Icon";
import { Button } from "../components/Button";
import { useGlobalContext } from "../App";
import { enforceEverest } from "../components/EnforceEverestPage";
import { useDownloadStore } from "../stores/download";
import { createPopup, PopupContext } from "../components/Popup";
import { ProgressIndicator } from "../components/Progress";
import { CatalogMod, loadModCatalog } from "../api/modCatalog";
import { Content, searchSubmission } from "../api/wegfan";
import { sanitizeDescriptionHtml } from "../sanitizeDescriptionHtml";
import { getAvailableModPageUrl, getOtherModPageSource } from "../modPage";
import {
  ManageCatalogMeta,
  ManageNode,
  alternativesCovering,
  collectSwitchNames,
  excludedDependencyNames,
  getDependencyHealth,
  selectVisibleRootNames,
  resolveManageDisplayNames,
  useManageStore,
  selectDefaultOrphanNames,
} from "../stores/manage";

type ModListCheck = {
  raw: string;
  name: string;
  operator: "@" | ">=" | "==" | "";
  requestedVersion: string;
  catalogVersion: string;
  status: "found" | "missing" | "version-mismatch";
};

const parseModListLine = (line: string) => {
  const raw = line.trim();
  if (!raw || raw.startsWith("#")) return null;
  const match = raw.match(/^(.+?)\s*(?:(@|>=|==)\s*([^\s]+))?$/);
  return {
    raw,
    name: match?.[1]?.trim() || raw,
    operator: (match?.[2] || "") as ModListCheck["operator"],
    requestedVersion: match?.[3]?.trim() || "",
  };
};

const ProfileModListImportPopup = ({
  gamePath,
  catalog,
  onImported,
}: {
  gamePath: string;
  catalog: CatalogMod[];
  onImported: () => void;
}) => {
  const popup = useContext(PopupContext);
  const [name, setName] = useState(_i18n.t("导入列表"));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoDeps, setAutoDeps] = useState(true);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const inlineChecksRef = useRef<HTMLDivElement>(null);

  const catalogByName = useMemo(
    () => new Map(catalog.map((mod) => [mod.name.toLocaleLowerCase(), mod])),
    [catalog]
  );
  const lineChecks = useMemo<(ModListCheck | null)[]>(
    () =>
      text.split(/\r?\n/).map((line) => {
        const item = parseModListLine(line);
        if (!item) return null;
        const mod = catalogByName.get(item.name.toLocaleLowerCase());
        const versionOrder = mod
          ? compareVersion(mod.version, item.requestedVersion)
          : -1;
        const versionMatches =
          !item.requestedVersion ||
          (item.operator === ">=" ? versionOrder >= 0 : versionOrder === 0);
        return {
          ...item,
          catalogVersion: mod?.version || "",
          status: !mod
            ? "missing"
            : versionMatches
            ? "found"
            : "version-mismatch",
        };
      }),
    [catalogByName, text]
  );
  const syncInlineChecks = useCallback(() => {
    const textarea = editorRef.current;
    const overlay = inlineChecksRef.current;
    if (!textarea || !overlay) return;
    const style = window.getComputedStyle(textarea);
    const measure = document.createElement("canvas").getContext("2d");
    if (!measure) return;
    measure.font = style.font;
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
    for (const child of Array.from(overlay.children)) {
      const index = Number((child as HTMLElement).dataset.lineIndex);
      const line = text.split(/\r?\n/)[index] ?? "";
      const width = measure.measureText(line).width;
      (child as HTMLElement).style.left = `${paddingLeft + width + 7}px`;
    }
  }, [text]);

  useEffect(() => syncInlineChecks(), [lineChecks, syncInlineChecks]);
  const checks = lineChecks.filter(
    (item): item is ModListCheck => item !== null
  );
  const invalidCount = checks.filter((item) => item.status !== "found").length;

  return (
    <div className="popup-content profile-mod-list-popup">
      <div className="title">{_i18n.t("从 Mod 列表导入 Profile")}</div>
      <div className="content">
        <div className="profile-editor-field">
          <label>{_i18n.t("Profile 名称")}</label>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="profile-editor-field profile-list-editor-field">
          <div className="profile-editor-label-row">
            <label>{_i18n.t("Mod 列表")}</label>
            <span>
              {checks.length} {_i18n.t("个 Mod")}
              {invalidCount ? ` · ${invalidCount} ${_i18n.t("项有问题")}` : ""}
            </span>
          </div>
          <div className="profile-inline-editor">
            <textarea
              ref={editorRef}
              wrap="off"
              value={text}
              placeholder={_i18n.t("每行一个 Mod，可写 FrostHelper @ 1.68.0")}
              onChange={(event) => setText(event.target.value)}
              onScroll={(event) => {
                if (inlineChecksRef.current) {
                  inlineChecksRef.current.style.transform = `translate(${-event
                    .currentTarget.scrollLeft}px, ${-event.currentTarget
                    .scrollTop}px)`;
                }
              }}
            />
            <div className="profile-inline-checks" ref={inlineChecksRef}>
              {lineChecks.map((item, index) =>
                item ? (
                  <div
                    data-line-index={index}
                    style={{ "--line-index": index } as CSSProperties}
                    className={`profile-inline-check ${item.status}`}
                    key={`${item.raw}-${index}`}
                    title={
                      item.status === "missing"
                        ? _i18n.t("目录中未找到")
                        : item.requestedVersion
                        ? `${item.catalogVersion} / ${item.operator || "=="} ${
                            item.requestedVersion
                          }`
                        : item.catalogVersion
                    }
                  >
                    <Icon
                      name={
                        item.status === "found"
                          ? "i-tick"
                          : item.status === "missing"
                          ? "fail"
                          : "warn"
                      }
                    />
                    <span>
                      {item.status === "missing"
                        ? _i18n.t("未找到")
                        : item.status === "version-mismatch"
                        ? _i18n.t("版本不匹配")
                        : item.catalogVersion}
                    </span>
                  </div>
                ) : null
              )}
            </div>
          </div>
          {!checks.length && (
            <div className="profile-editor-hint">
              {_i18n.t("输入后会在每一行右侧实时显示 Mod 和版本检查结果")}
            </div>
          )}
          <label className="profile-inline-option">
            <input
              type="checkbox"
              checked={autoDeps}
              onChange={(event) => setAutoDeps(event.target.checked)}
            />
            <span>
              <strong>{_i18n.t("自动补全依赖")}</strong>
              <small>{_i18n.t("导入后安装并启用列表内 Mod 的必需依赖")}</small>
            </span>
          </label>
        </div>
      </div>
      <div className="buttons">
        <button onClick={popup.hide}>{_i18n.t("取消")}</button>
        <button
          disabled={
            busy || !name.trim() || checks.length === 0 || invalidCount > 0
          }
          onClick={() => {
            setBusy(true);
            void installProfileModList(
              gamePath,
              name.trim(),
              checks.map((item) => item.name),
              autoDeps,
              onImported
            )
              .then((started) => {
                if (started) popup.hide();
              })
              .catch(console.error)
              .finally(() => setBusy(false));
          }}
        >
          {_i18n.t("导入")}
        </button>
      </div>
    </div>
  );
};

type ProfileExportFormat = "json" | "text" | "link";

const ProfileExportPopup = ({
  profile,
  nodes,
}: {
  profile: { name: string; enabled_mods: string[] };
  nodes: Record<string, ManageNode>;
}) => {
  const popup = useContext(PopupContext);
  const [format, setFormat] = useState<ProfileExportFormat>("json");
  const [autoDeps, setAutoDeps] = useState(false);
  const [includeVersions, setIncludeVersions] = useState(false);
  const [copied, setCopied] = useState("");
  const topLevelMods = profile.enabled_mods.filter((name) => {
    const node = nodes[name];
    if (!node) return true;
    return !node.dependedBy.some((dependent) =>
      profile.enabled_mods.includes(dependent)
    );
  });
  const modNames = autoDeps ? topLevelMods : profile.enabled_mods;
  const profileValue = {
    format: "celemod-profile",
    version: 2,
    ...(autoDeps ? { auto_deps: true } : {}),
    name: profile.name,
    enabled_mods: modNames,
  };
  const json = JSON.stringify(profileValue, null, 2);
  const text = modNames
    .map((name) =>
      includeVersions && nodes[name]?.version
        ? `${name} >= ${nodes[name].version}`
        : name
    )
    .join("\n");
  const link = `celemod://add_profile/${encodeURIComponent(
    JSON.stringify(profileValue)
  )}`;
  const preview = format === "json" ? json : format === "text" ? text : link;
  const markdown = `[安装 ${profile.name} Profile](${link})`;
  const html = `<a href="${link}">安装 ${profile.name} Profile</a>`;

  const copy = (value: string, type: string) => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(type);
      window.setTimeout(() => setCopied(""), 1200);
    });
  };

  const saveExport = async () => {
    const extension = format === "json" ? "json" : "txt";
    const destination = await save({
      title: _i18n.t("导出预设"),
      defaultPath: `${profile.name}.${
        format === "json"
          ? "celemod-profile.json"
          : format === "link"
          ? "celemod-link.txt"
          : "txt"
      }`,
      filters: [
        {
          name: format === "json" ? "CeleMod Profile" : "Text",
          extensions: [extension],
        },
      ],
    });
    if (typeof destination !== "string") return;
    await callRemote("write_text_file", destination, preview);
    popup.hide();
  };

  return (
    <div className="popup-content profile-export-popup">
      <header className="profile-export-header">
        <div>
          <div className="title">{_i18n.t("导出 Profile")}</div>
          <span>{profile.name}</span>
        </div>
        <div className="profile-export-count">
          <strong>{modNames.length}</strong>
          <span>Mods</span>
        </div>
      </header>
      <div className="content">
        <div className="profile-export-tabs">
          {(
            [
              ["json", "JSON"],
              ["text", _i18n.t("Mod 列表")],
              ["link", "安装链接"],
            ] as const
          ).map(([value, label]) => (
            <button
              className={format === value ? "selected" : ""}
              key={value}
              onClick={() => setFormat(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="profile-export-options">
          <label>
            <input
              type="checkbox"
              checked={autoDeps}
              onChange={(event) => setAutoDeps(event.target.checked)}
            />
            <span>{_i18n.t("只保存顶层 Mod")}</span>
          </label>
          {format === "text" && (
            <label>
              <input
                type="checkbox"
                checked={includeVersions}
                onChange={(event) => setIncludeVersions(event.target.checked)}
              />
              <span>{_i18n.t("携带版本要求")}</span>
            </label>
          )}
        </div>
        <div className="profile-export-preview">
          <div className="profile-export-preview-bar">
            <span>
              {format === "json"
                ? "profile.json"
                : format === "text"
                ? "mods.txt"
                : "celemod://add_profile"}
            </span>
            <button onClick={() => copy(preview, "preview")}>
              {copied === "preview" ? _i18n.t("已复制") : _i18n.t("复制")}
            </button>
          </div>
          <textarea readOnly value={preview} />
        </div>
        {format === "link" && (
          <div className="profile-link-copy-row">
            <button onClick={() => copy(markdown, "markdown")}>
              {copied === "markdown" ? _i18n.t("已复制") : "Markdown"}
            </button>
            <button onClick={() => copy(html, "html")}>
              {copied === "html" ? _i18n.t("已复制") : "HTML"}
            </button>
          </div>
        )}
      </div>
      <div className="buttons profile-export-actions">
        <button onClick={popup.hide}>{_i18n.t("取消")}</button>
        <button className="primary" onClick={() => void saveExport()}>
          {_i18n.t("保存文件")}
        </button>
      </div>
    </div>
  );
};

type LatestModInfo = {
  name: string;
  version: string;
  gbFile: string;
  current: string;
  url: string;
};

type FullModCheckProgress = {
  current: number;
  total: number;
  file: string;
  done: boolean;
  issues: { file: string; error: string }[];
};

const formatSize = (size: number) => {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(size) / Math.log(1024))
  );
  return `${(size / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${
    units[index]
  }`;
};

const Badge = ({
  children,
  tone = "neutral",
  title,
  onClick,
  onContextMenu,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "accent";
  title?: string;
  onClick?: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}) => (
  <span
    className={`manage-badge tone-${tone} ${onClick ? "clickable" : ""}`}
    title={title}
    onClick={(event) => {
      event.stopPropagation();
      onClick?.();
    }}
    onContextMenu={(event) => {
      event.preventDefault();
      event.stopPropagation();
      onContextMenu?.(event);
    }}
  >
    {children}
  </span>
);

const catalogMaps = (mods: CatalogMod[]) => {
  const metaByName: Record<string, ManageCatalogMeta> = {};
  const fullByName = new Map<string, CatalogMod>();
  for (const mod of mods) {
    const key = mod.name.trim().toLocaleLowerCase();
    const submission = mod.submissionFile.submission;
    const current = fullByName.get(key);
    if (!current || Date.parse(mod.updateTime) > Date.parse(current.updateTime))
      fullByName.set(key, mod);
    metaByName[key] = {
      submissionId: submission.id,
      category: submission.categoryName,
      subCategory: submission.subCategoryName,
      submitter: submission.submitter,
      submissionName: submission.name,
      pageUrl: submission.pageUrl,
      downloads: mod.submissionFile.downloads,
      catalogSize: mod.submissionFile.size,
      updatedAt: submission.updateTime,
      gameBananaId: submission.gameBananaId,
    };
  }
  return { metaByName, fullByName };
};

const showModDetails = (node: ManageNode, catalogMod?: CatalogMod) => {
  createPopup(
    () => {
      const popup = useContext(PopupContext);
      const [cloud, setCloud] = useState<Content | null>(null);
      const [cloudDone, setCloudDone] = useState(false);
      const modPageSource = useAppStore((state) => state.modPageSource);
      const descriptionRef = useRef<HTMLDivElement>(null);

      useEffect(() => {
        const submission = catalogMod?.submissionFile.submission;
        if (!submission) {
          setCloudDone(true);
          return;
        }
        searchSubmission({ search: submission.name, size: 12 })
          .then((result) => {
            setCloud(
              result.content.find(
                (item) => item.gameBananaId === submission.gameBananaId
              ) ?? null
            );
          })
          .catch(console.error)
          .finally(() => setCloudDone(true));
      }, []);

      useEffect(() => {
        if (!descriptionRef.current || !cloud) return;
        descriptionRef.current.innerHTML = "";
        descriptionRef.current.appendChild(
          sanitizeDescriptionHtml(cloud.description || "")
        );
        for (const link of Array.from(
          descriptionRef.current.querySelectorAll("a")
        )) {
          const url = link.getAttribute("href");
          if (!url) continue;
          link.setAttribute("href", "#");
          link.addEventListener("click", (event) => {
            event.preventDefault();
            void callRemote("open_url", url);
          });
        }
      }, [cloud]);

      const meta = node.meta;
      return (
        <div className="manage-detail-popup">
          <button className="detail-close" onClick={popup.hide}>
            <Icon name="i-cross" />
          </button>
          <div className="detail-heading">
            <div>
              <span className="detail-kicker">
                {meta?.category || _i18n.t("本地 Mod")}
              </span>
              <h2>{meta?.submissionName || node.name}</h2>
              <p>
                {node.name} · {node.version}
              </p>
            </div>
            {(meta?.submissionId || meta?.pageUrl) && (
              <button
                onClick={() => {
                  const url = getAvailableModPageUrl(
                    {
                      submissionId: meta.submissionId,
                      gameBananaUrl: meta.pageUrl,
                    },
                    modPageSource
                  );
                  if (url) callRemote("open_url", url);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  const url = getAvailableModPageUrl(
                    {
                      submissionId: meta.submissionId,
                      gameBananaUrl: meta.pageUrl,
                    },
                    getOtherModPageSource(modPageSource)
                  );
                  if (url) callRemote("open_url", url);
                }}
                title={_i18n.t("左键打开所选来源，右键打开另一个来源")}
              >
                <Icon name="external" />
              </button>
            )}
          </div>
          <div className="detail-stats">
            <div>
              <span>{_i18n.t("作者")}</span>
              <strong>{meta?.submitter || "--"}</strong>
            </div>
            <div>
              <span>{_i18n.t("类型")}</span>
              <strong>{meta?.subCategory || meta?.category || "--"}</strong>
            </div>
            <div>
              <span>{_i18n.t("下载次数")}</span>
              <strong>{meta?.downloads?.toLocaleString() || "--"}</strong>
            </div>
            <div>
              <span>{_i18n.t("文件大小")}</span>
              <strong>{formatSize(meta?.catalogSize || node.size)}</strong>
            </div>
          </div>
          {cloud?.screenshots?.length ? (
            <div className="detail-images">
              {cloud.screenshots.map((image) => (
                <img key={image.id} src={`${image.url}?h=180`} alt="" />
              ))}
            </div>
          ) : null}
          {!cloudDone ? (
            <div className="detail-loading">
              <ProgressIndicator infinite size={28} />
            </div>
          ) : cloud ? (
            <div className="detail-description" ref={descriptionRef} />
          ) : (
            <div className="detail-description detail-local-only">
              {_i18n.t(
                "本地缓存包含版本、分类、作者、下载量、大小和更新时间；云端详情暂不可用。"
              )}
            </div>
          )}
          <div className="detail-files">
            <strong>{_i18n.t("本地文件")}</strong>
            <span>
              {node.file} · {formatSize(node.size)}
            </span>
          </div>
        </div>
      );
    },
    { backgroundMask: "#111318" }
  );
};

interface ManageActions {
  switchNodes: (
    names: string | string[],
    enabled: boolean,
    recursive?: boolean
  ) => void;
  deleteNode: (name: string) => void;
  showDuplicates: (name: string) => void;
  updateNode: (name: string) => Promise<boolean>;
  downloadMissing: (name: string) => Promise<boolean>;
  showDetails: (name: string) => void;
  toggleAlwaysOn: (name: string) => void;
  updateNames: Set<string>;
  updateVersions: Record<string, string>;
  updateStates: Record<string, string>;
  alwaysOnMods: string[];
  comments: Record<string, string>;
  autoUseSubmissionNameAsComment: boolean;
  setComment: (name: string, comment: string) => void;
  isPinned: (name: string) => boolean;
  togglePinned: (name: string) => void;
  checkOptional: boolean;
  fullTree: boolean;
  showDetailed: boolean;
}

const ManageActionsContext = createContext<ManageActions | null>(null);

const MissingDependencyRow = ({
  dependency,
  depth,
}: {
  dependency: { name: string; version: string; optional: boolean };
  depth: number;
}) => {
  const actions = useContext(ManageActionsContext)!;
  const [downloading, setDownloading] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div
      className="manage-tree-row missing"
      style={{ "--tree-depth": depth } as React.CSSProperties}
    >
      <span className="tree-connector" />
      <span className="tree-expander leaf">
        <Icon name="warn" />
      </span>
      <div className="tree-row-main missing-main">
        <div className="tree-primary-line">
          <strong>{dependency.name}</strong>
          <span className="tree-version">≥ {dependency.version}</span>
        </div>
        <div className="tree-secondary-line">
          <Badge tone={dependency.optional ? "warning" : "danger"}>
            {dependency.optional ? _i18n.t("可选依赖") : _i18n.t("缺失依赖")}
          </Badge>
        </div>
      </div>
      <button
        type="button"
        className="missing-download-button"
        disabled={downloading}
        onClick={() => {
          setDownloading(true);
          setFailed(false);
          void actions.downloadMissing(dependency.name).then((success) => {
            setDownloading(false);
            setFailed(!success);
          });
        }}
      >
        <Icon name="download" />
        {downloading
          ? _i18n.t("下载中…")
          : failed
          ? _i18n.t("重试")
          : _i18n.t("下载")}
      </button>
    </div>
  );
};

const ManageTreeNode = ({
  name,
  depth = 0,
  path = [],
  optional = false,
}: {
  name: string;
  depth?: number;
  path?: string[];
  optional?: boolean;
}) => {
  const actions = useContext(ManageActionsContext)!;
  const node = useManageStore((state) => state.nodes[name]);
  const nodes = useManageStore((state) => state.nodes);
  const expanded = useManageStore((state) => Boolean(state.expanded[name]));
  const setExpanded = useManageStore((state) => state.setExpanded);
  const openMenuName = useManageStore((state) => state.openMenuName);
  const setOpenMenuName = useManageStore((state) => state.setOpenMenuName);
  const [editingComment, setEditingComment] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  if (!node || excludedDependencyNames.has(name)) return null;
  const visibleDependencies = node.dependencies.filter(
    (dependency) =>
      !excludedDependencyNames.has(dependency.name) &&
      (actions.checkOptional || !dependency.optional)
  );
  const hasDependencies = visibleDependencies.length > 0;
  const cycle = path.includes(name);
  const health = getDependencyHealth(name, nodes, actions.checkOptional);
  const isAlwaysOn = actions.alwaysOnMods.some(
    (alwaysOnName) => nodes[alwaysOnName]?.file === node.file
  );
  const covered = alternativesCovering(name, nodes);
  const hasUpdate = actions.updateNames.has(name);
  const menuOpen = openMenuName === name;
  const displayNames = resolveManageDisplayNames(
    name,
    actions.comments[name],
    node.meta?.submissionName,
    actions.autoUseSubmissionNameAsComment
  );

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node))
        setOpenMenuName(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen, setOpenMenuName]);

  return (
    <div className="manage-tree-node">
      <div
        className={`manage-tree-row ${node.enabled ? "enabled" : "disabled"} ${
          menuOpen ? "menu-open" : ""
        }`}
        style={{ "--tree-depth": depth } as React.CSSProperties}
      >
        <span className="tree-connector" />
        <button
          className={`tree-expander ${hasDependencies ? "" : "leaf"}`}
          onClick={() => hasDependencies && setExpanded(name, !expanded)}
          title={
            hasDependencies ? _i18n.t(expanded ? "收起依赖" : "展开依赖") : ""
          }
        >
          <Icon
            name={
              hasDependencies ? (expanded ? "i-down" : "i-right") : "i-asterisk"
            }
          />
        </button>
        <div
          className={`tree-row-main ${
            actions.showDetailed ? "detailed" : "compact"
          }`}
        >
          <div className="tree-primary-line">
            <button
              className={`state-switch ${
                isAlwaysOn ? "always" : node.enabled ? "enabled" : ""
              }`}
              onClick={() => actions.switchNodes(name, !node.enabled)}
              onContextMenu={(event) => {
                event.preventDefault();
                actions.toggleAlwaysOn(name);
              }}
              title={_i18n.t("点击切换；右键设为始终开启")}
            >
              {isAlwaysOn
                ? _i18n.t("始终开启")
                : node.enabled
                ? _i18n.t("已启用")
                : _i18n.t("已禁用")}
            </button>
            {editingComment ? (
              <input
                autoFocus
                className="tree-comment-input"
                value={actions.comments[name] ?? ""}
                onChange={(event) =>
                  actions.setComment(name, event.target.value)
                }
                onBlur={() => setEditingComment(false)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === "Escape")
                    setEditingComment(false);
                }}
              />
            ) : (
              <button
                className="tree-name"
                onClick={() => setEditingComment(true)}
                title={_i18n.t("点击编辑备注")}
              >
                {displayNames.primaryName}
              </button>
            )}
            <span className="tree-version">{node.version}</span>
            {displayNames.secondaryName && !editingComment && (
              <span className="tree-mod-name" title={name}>
                {displayNames.secondaryName}
              </span>
            )}
          </div>
          <div className="tree-secondary-line">
            {node.meta?.category && (
              <Badge tone="neutral">{node.meta.category}</Badge>
            )}
            {optional && <Badge tone="warning">{_i18n.t("可选依赖")}</Badge>}
            {health.status === "missing" && (
              <Badge tone="danger" title={health.messages.join("\n")}>
                {_i18n.t("依赖缺失")}
              </Badge>
            )}
            {health.status === "disabled" && (
              <Badge tone="warning" title={health.messages.join("\n")}>
                {_i18n.t("依赖未启用")}
              </Badge>
            )}
            {health.status === "version" && (
              <Badge tone="warning" title={health.messages.join("\n")}>
                {_i18n.t("版本不匹配")}
              </Badge>
            )}
            {cycle && <Badge tone="accent">{_i18n.t("循环依赖")}</Badge>}
            {covered.length > 0 && (
              <Badge tone="info" title={covered.join(", ")}>
                {_i18n.t("已被替代")}
              </Badge>
            )}
            {node.dependedBy.filter((dependent) => nodes[dependent]?.enabled)
              .length > 0 && (
              <Badge tone="info" title={node.dependedBy.join(", ")}>
                {_i18n.t("{count} 个启用项依赖", {
                  count: node.dependedBy.filter(
                    (dependent) => nodes[dependent]?.enabled
                  ).length,
                })}
              </Badge>
            )}
            {node.duplicateFiles.length > 1 && (
              <Badge
                tone="danger"
                title={node.duplicateFiles.map((item) => item.file).join("\n")}
                onClick={() => actions.showDuplicates(name)}
              >
                {_i18n.t("重复")} × {node.duplicateFiles.length}
              </Badge>
            )}
            {hasUpdate && (
              <Badge tone="warning" onClick={() => actions.updateNode(name)}>
                {actions.updateStates[name] ||
                  _i18n.t("更新到 {version}", {
                    version: actions.updateVersions[name],
                  })}
              </Badge>
            )}
            {actions.showDetailed && (
              <span className="tree-file-detail">
                {formatSize(node.size)} · {node.file}
              </span>
            )}
          </div>
        </div>
        <div
          className={`tree-row-actions ${menuOpen ? "menu-open" : ""}`}
          ref={menuRef}
        >
          <button
            className={menuOpen ? "active" : ""}
            onClick={() => setOpenMenuName(menuOpen ? null : name)}
            title={_i18n.t("更多操作")}
          >
            <Icon name="opts-h" />
          </button>
          {menuOpen && (
            <div className="mod-row-menu">
              <button
                onClick={() => {
                  setOpenMenuName(null);
                  actions.showDetails(name);
                }}
              >
                <Icon name="opts-h" />
                {_i18n.t("查看详情")}
              </button>
              <button
                onClick={() => {
                  actions.togglePinned(name);
                  setOpenMenuName(null);
                }}
              >
                <Icon name="flag" />
                {actions.isPinned(name)
                  ? _i18n.t("取消在 Mod 设置内置顶")
                  : _i18n.t("在 Mod 设置内置顶")}
              </button>
              <button
                className="danger"
                onClick={() => {
                  setOpenMenuName(null);
                  actions.deleteNode(name);
                }}
              >
                <Icon name="delete" />
                {_i18n.t("删除 Mod")}
              </button>
            </div>
          )}
        </div>
      </div>
      {expanded && !cycle && (!optional || actions.fullTree) && (
        <div className="tree-children">
          {visibleDependencies.map((dependency) =>
            nodes[dependency.name] ? (
              <ManageTreeNode
                key={`${name}-${dependency.name}`}
                name={dependency.name}
                depth={depth + 1}
                path={[...path, name]}
                optional={dependency.optional}
              />
            ) : (
              <MissingDependencyRow
                key={`${name}-${dependency.name}`}
                dependency={dependency}
                depth={depth + 1}
              />
            )
          )}
        </div>
      )}
    </div>
  );
};

let lastApplyRequest = 0;

export const Manage = () => {
  const noEverest = enforceEverest();
  const [gamePath] = useGamePath();
  const modPath = `${gamePath}/Mods`;
  const global = useGlobalContext();
  const { installedMods } = useInstalledMods();
  const {
    profiles,
    setProfilesCallback,
    currentProfileName,
    activeProfileNames,
    setCurrentProfileName,
    currentProfile,
    setCurrentProfile,
  } = useCurrentBlacklistProfile();
  const [alwaysOnMods, setAlwaysOnMods] = useAlwaysOnMods();
  const [comments, setComments] = useModComments();
  const downloadMod = useDownloadStore((state) => state.downloadMod);
  const [catalog, setCatalog] = useState<CatalogMod[]>([]);
  const [latestRaw, setLatestRaw] = useState<
    [string, string, string, string][]
  >([]);
  const [updateStates, setUpdateStates] = useState<Record<string, string>>({});
  const activeUpdates = useRef(new Set<string>());
  const [fullCheckRunning, setFullCheckRunning] = useState(false);
  const [fixingDependencies, setFixingDependencies] = useState(false);
  const [olympusProfiles, setOlympusProfiles] = useState<string[]>([]);
  const [profileImportOpen, setProfileImportOpen] = useState(false);
  const [filtersSuspended, setFiltersSuspended] = useState(false);
  const [profileNameInput, setProfileNameInput] = useState("");
  const filterWrapRef = useRef<HTMLDivElement>(null);
  const actionsWrapRef = useRef<HTMLDivElement>(null);

  const nodes = useManageStore((state) => state.nodes);
  const filters = useManageStore((state) => state.filters);
  const hydrate = useManageStore((state) => state.hydrate);
  const setNodesEnabled = useManageStore((state) => state.setNodesEnabled);
  const filterOpen = useManageStore((state) => state.filterOpen);
  const setFilterOpen = useManageStore((state) => state.setFilterOpen);
  const actionMenuOpen = useManageStore((state) => state.actionMenuOpen);
  const setActionMenuOpen = useManageStore((state) => state.setActionMenuOpen);
  const setQuery = useManageStore((state) => state.setQuery);
  const setEnabledFilter = useManageStore((state) => state.setEnabledFilter);
  const setHealthFilter = useManageStore((state) => state.setHealthFilter);
  const toggleType = useManageStore((state) => state.toggleType);
  const setUpdateOnly = useManageStore((state) => state.setUpdateOnly);
  const setShowHiddenTypes = useManageStore(
    (state) => state.setShowHiddenTypes
  );
  const resetFilters = useManageStore((state) => state.resetFilters);
  const collapseAll = useManageStore((state) => state.collapseAll);
  const expandAll = useManageStore((state) => state.expandAll);

  const rootOnly = useAppStore((state) => state.excludeDependents);
  const setRootOnly = useAppStore((state) => state.setExcludeDependents);
  const checkOptional = useAppStore((state) => state.checkOptionalDep);
  const fullTree = useAppStore((state) => state.fullTree);
  const setFullTree = useAppStore((state) => state.setFullTree);
  const showUpdate = useAppStore((state) => state.showUpdate);
  const showDetailed = useAppStore((state) => state.showDetailed);
  const autoUseSubmissionNameAsComment = useAppStore(
    (state) => state.autoUseSubmissionNameAsComment
  );
  const autoToggleDependencies = useAppStore(
    (state) => state.autoToggleDependencies
  );
  const autoToggleOptionalDependencies = useAppStore(
    (state) => state.autoToggleOptionalDependencies
  );
  const deleteOrphansByDefault = useAppStore(
    (state) => state.deleteOrphansByDefault
  );
  const orphanActionTypes = useAppStore((state) => state.orphanActionTypes);
  const hiddenModTypes = useAppStore((state) => state.hiddenModTypes);
  const cacheTtl = useAppStore((state) => state.modCacheTtlHours);
  const profileEnabled = useAppStore((state) => state.profileEnabled);

  const { metaByName, fullByName } = useMemo(
    () => catalogMaps(catalog),
    [catalog]
  );
  const displayNamesByMod = useMemo(
    () =>
      Object.fromEntries(
        Object.values(nodes).map((node) => [
          node.name,
          resolveManageDisplayNames(
            node.name,
            comments[node.name],
            node.meta?.submissionName,
            autoUseSubmissionNameAsComment
          ),
        ])
      ),
    [autoUseSubmissionNameAsComment, comments, nodes]
  );

  useEffect(() => {
    if (!gamePath) return;
    void reloadBlacklistState(gamePath).catch(console.error);
  }, [gamePath, profileEnabled]);

  useEffect(() => {
    loadModCatalog(cacheTtl).then(setCatalog).catch(console.error);
    callRemote("get_mod_latest_info", (data: string) =>
      setLatestRaw(JSON.parse(data))
    );
  }, [cacheTtl]);

  useEffect(() => {
    if (!gamePath || !profileEnabled) {
      setOlympusProfiles([]);
      return;
    }
    void callRemote<string>("get_olympus_presets", gamePath)
      .then((data) =>
        setOlympusProfiles(
          (JSON.parse(data) as { name: string }[]).map(
            (profile) => profile.name
          )
        )
      )
      .catch(console.error);
  }, [gamePath, profileEnabled]);

  useEffect(() => {
    const enabledNames = new Set(currentProfile?.enabled_mods ?? []);
    hydrate({
      installedMods,
      disabledNames: installedMods
        .filter((mod) => !enabledNames.has(mod.name))
        .map((mod) => mod.name),
      disabledFiles: [],
      catalogByName: metaByName,
    });
  }, [installedMods, currentProfile, metaByName]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (filterOpen && !filterWrapRef.current?.contains(event.target as Node))
        setFilterOpen(false);
      if (
        actionMenuOpen &&
        !actionsWrapRef.current?.contains(event.target as Node)
      )
        setActionMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [actionMenuOpen, filterOpen]);

  const updates = useMemo<LatestModInfo[]>(
    () =>
      Object.values(nodes).flatMap((node) => {
        const latest = latestRaw.find((item) => item[0] === node.name);
        if (!latest || compareVersion(latest[1], node.version) <= 0) return [];
        return [
          {
            name: node.name,
            version: latest[1],
            gbFile: latest[2],
            current: node.version,
            url: latest[3],
          },
        ];
      }),
    [nodes, latestRaw]
  );
  const updateNames = useMemo(
    () => new Set(updates.map((update) => update.name)),
    [updates]
  );
  const updateVersions = useMemo(
    () =>
      Object.fromEntries(
        updates.map((update) => [update.name, update.version])
      ),
    [updates]
  );

  const filteredRoots = useMemo(
    () =>
      selectVisibleRootNames({
        nodes,
        filters,
        rootOnly,
        includeOptional: checkOptional,
        hiddenTypes: hiddenModTypes,
        updateNames,
        displayNames: displayNamesByMod,
      }),
    [
      nodes,
      filters,
      rootOnly,
      checkOptional,
      hiddenModTypes,
      updateNames,
      displayNamesByMod,
    ]
  );

  const keywordOnlyFilters = useMemo(
    () => ({
      ...filters,
      enabled: "all" as const,
      health: "all" as const,
      types: [],
      updateOnly: false,
      showHiddenTypes: true,
    }),
    [filters]
  );
  const keywordRoots = useMemo(
    () =>
      selectVisibleRootNames({
        nodes,
        filters: keywordOnlyFilters,
        rootOnly: false,
        includeOptional: checkOptional,
        hiddenTypes: hiddenModTypes,
        updateNames,
        displayNames: displayNamesByMod,
      }),
    [
      nodes,
      keywordOnlyFilters,
      checkOptional,
      hiddenModTypes,
      updateNames,
      displayNamesByMod,
    ]
  );
  const hasSearchQuery = filters.query.trim().length > 0;
  const hiddenKeywordMatchCount = hasSearchQuery
    ? keywordRoots.filter((name) => !filteredRoots.includes(name)).length
    : 0;
  const visibleRoots =
    filtersSuspended && hasSearchQuery ? keywordRoots : filteredRoots;

  const missingDependencies = useMemo(() => {
    const missing = new Map<string, string>();
    for (const node of Object.values(nodes)) {
      for (const dependency of node.dependencies) {
        if (excludedDependencyNames.has(dependency.name) || dependency.optional)
          continue;
        if (!nodes[dependency.name])
          missing.set(dependency.name, dependency.version);
      }
    }
    return [...missing.entries()].map(([name, version]) => ({ name, version }));
  }, [nodes]);

  const applyProfileSoon = useCallback(() => {
    const request = Date.now();
    lastApplyRequest = request;
    window.setTimeout(() => {
      const names = activeProfileNames.length
        ? activeProfileNames
        : currentProfileName
        ? [currentProfileName]
        : [];
      if (lastApplyRequest !== request || names.length === 0) return;
      void callRemote(
        "apply_mod_profiles",
        gamePath,
        JSON.stringify(names),
        JSON.stringify(alwaysOnMods)
      );
    }, 350);
  }, [activeProfileNames, alwaysOnMods, currentProfileName, gamePath]);

  const batchSwitch = useCallback(
    (names: string[], enabled: boolean) => {
      if (!currentProfile || names.length === 0) return;
      const requestedNames = new Set(names);
      const packageNames = Object.values(nodes)
        .filter((node) => requestedNames.has(node.name))
        .map((node) => node.name);
      const alwaysOnFiles = new Set(
        alwaysOnMods
          .map((name) => nodes[name]?.file)
          .filter(Boolean) as string[]
      );
      const effectiveNames = enabled
        ? packageNames
        : packageNames.filter((name) => !alwaysOnFiles.has(nodes[name]?.file));
      const files = effectiveNames
        .map((name) => nodes[name]?.file)
        .filter(Boolean) as string[];
      if (effectiveNames.length === 0) return;
      if (profileEnabled) {
        void callRemote(
          "switch_mod_profile_mods",
          gamePath,
          currentProfileName,
          JSON.stringify(effectiveNames),
          enabled
        );
      } else {
        void callRemote(
          "switch_direct_blacklist",
          gamePath,
          JSON.stringify(files),
          enabled
        );
      }
      const switchedNames = new Set(effectiveNames);
      const nextProfile = {
        ...currentProfile,
        enabled_mods: enabled
          ? [...new Set([...currentProfile.enabled_mods, ...effectiveNames])]
          : currentProfile.enabled_mods.filter(
              (name) => !switchedNames.has(name)
            ),
      };
      setCurrentProfile(nextProfile);
      setProfilesCallback((items) =>
        items.map((profile) =>
          profile.name === currentProfile.name ? nextProfile : profile
        )
      );
      setNodesEnabled(effectiveNames, enabled);
      if (profileEnabled) applyProfileSoon();
    },
    [
      alwaysOnMods,
      applyProfileSoon,
      currentProfile,
      currentProfileName,
      gamePath,
      profileEnabled,
      nodes,
      setCurrentProfile,
      setProfilesCallback,
      setNodesEnabled,
    ]
  );

  const switchNodes = useCallback(
    (input: string | string[], enabled: boolean, recursive = true) => {
      const names = Array.isArray(input) ? input : [input];
      batchSwitch(
        collectSwitchNames({
          names,
          enabled,
          nodes,
          includeDependencies: recursive && autoToggleDependencies,
          includeOptional: autoToggleOptionalDependencies,
          autoDisableTypes: orphanActionTypes,
        }),
        enabled
      );
    },
    [
      orphanActionTypes,
      autoToggleDependencies,
      autoToggleOptionalDependencies,
      batchSwitch,
      nodes,
    ]
  );

  const confirmBatchSwitch = useCallback(
    (enabled: boolean) => {
      setActionMenuOpen(false);
      createPopup(() => {
        const popup = useContext(PopupContext);
        return (
          <div className="popup-content delete-mod-popup">
            <div className="title">
              {_i18n.t(enabled ? "确认启用全部 Mod" : "确认禁用全部 Mod")}
            </div>
            <p>
              {_i18n.t(
                enabled
                  ? "将启用当前 Profile 中的全部 Mod，是否继续？"
                  : "将禁用当前 Profile 中除始终开启项外的全部 Mod，是否继续？"
              )}
            </p>
            <div className="buttons">
              <button onClick={popup.hide}>{_i18n.t("取消")}</button>
              <button
                className={enabled ? "" : "delete-confirm"}
                onClick={() => {
                  batchSwitch(Object.keys(nodes), enabled);
                  popup.hide();
                }}
              >
                {_i18n.t(enabled ? "启用全部" : "禁用全部")}
              </button>
            </div>
          </div>
        );
      });
    },
    [batchSwitch, nodes, setActionMenuOpen]
  );

  const reloadMods = useCallback(
    () => reloadInstalledMods(gamePath),
    [gamePath]
  );

  const downloadMissing = useCallback(
    (name: string): Promise<boolean> => {
      return new Promise((resolve) => {
        callRemote("get_mod_update", name, (data: string) => {
          if (!data) {
            resolve(false);
            return;
          }
          const [fileId] = JSON.parse(data);
          downloadMod(name, fileId, {
            onFinished: () => resolve(true),
            onFailed: () => resolve(false),
          });
        }).catch(() => resolve(false));
      });
    },
    [downloadMod]
  );

  const updateNode = useCallback(
    (name: string): Promise<boolean> => {
      const update = updates.find((item) => item.name === name);
      if (!update || activeUpdates.current.has(name))
        return Promise.resolve(false);
      activeUpdates.current.add(name);
      setUpdateStates((state) => ({ ...state, [name]: _i18n.t("更新中…") }));
      return new Promise((resolve) => {
        downloadMod(name, update.gbFile === "-1" ? update.url : update.gbFile, {
          force: true,
          onProgress: (_task, progress) =>
            setUpdateStates((state) => ({
              ...state,
              [name]: `${progress.toFixed(0)}%`,
            })),
          onFinished: () => {
            activeUpdates.current.delete(name);
            setUpdateStates((state) => ({
              ...state,
              [name]: _i18n.t("已更新"),
            }));
            resolve(true);
          },
          onFailed: () => {
            activeUpdates.current.delete(name);
            setUpdateStates((state) => ({
              ...state,
              [name]: _i18n.t("更新失败"),
            }));
            resolve(false);
          },
        });
      });
    },
    [downloadMod, updates]
  );

  const deleteNode = useCallback(
    (name: string) => {
      const node = nodes[name];
      if (!node) return;
      const nodeIsAlwaysOn = alwaysOnMods.some(
        (alwaysOnName) => nodes[alwaysOnName]?.file === node.file
      );
      const orphaned: string[] = [];
      const visited = new Set<string>();
      const visit = (nodeName: string) => {
        if (visited.has(nodeName)) return;
        visited.add(nodeName);
        for (const dependency of nodes[nodeName]?.dependencies ?? []) {
          const dependencyNode = nodes[dependency.name];
          if (!dependencyNode) continue;
          const remaining = dependencyNode.dependedBy.filter(
            (dependent) => dependent !== name && !orphaned.includes(dependent)
          );
          if (remaining.length === 0 && !orphaned.includes(dependency.name)) {
            orphaned.push(dependency.name);
            visit(dependency.name);
          }
        }
      };
      visit(name);
      createPopup(() => {
        const popup = useContext(PopupContext);
        const [selected, setSelected] = useState<string[]>(
          deleteOrphansByDefault
            ? selectDefaultOrphanNames({
                names: orphaned,
                nodes,
                allowedTypes: orphanActionTypes,
                alwaysOnMods,
              })
            : []
        );
        return (
          <div className="popup-content delete-mod-popup">
            <div className="title">{_i18n.t("删除 Mod")}</div>
            <div className="delete-target">
              <strong>{name}</strong>
              <span>
                {node.version} · {node.file} ·{" "}
                {node.meta?.category ?? _i18n.t("未知类型")} ·{" "}
                {_i18n.t(node.enabled ? "已启用" : "已禁用")}
                {` · ${_i18n.t(nodeIsAlwaysOn ? "始终开启" : "非始终开启")}`}
              </span>
            </div>
            {node.dependedBy.length > 0 && (
              <div className="warning-section">
                <strong>{_i18n.t("以下 Mod 依赖此项目")}</strong>
                <span>{node.dependedBy.join(", ")}</span>
              </div>
            )}
            {orphaned.length > 0 && (
              <div className="orphan-section">
                <strong>{_i18n.t("同时删除不再被依赖的 Mod")}</strong>
                <div className="orphan-list">
                  {orphaned.map((orphan) => {
                    const orphanNode = nodes[orphan];
                    const orphanIsAlwaysOn = alwaysOnMods.some(
                      (alwaysOnName) =>
                        nodes[alwaysOnName]?.file === orphanNode?.file
                    );
                    return (
                      <label key={orphan}>
                        <input
                          type="checkbox"
                          checked={selected.includes(orphan)}
                          onChange={(event) =>
                            setSelected(
                              event.target.checked
                                ? [...selected, orphan]
                                : selected.filter((value) => value !== orphan)
                            )
                          }
                        />
                        <span className="orphan-mod-info">
                          <strong>{orphan}</strong>
                          <small>
                            <span>
                              {orphanNode?.meta?.category ??
                                _i18n.t("未知类型")}
                            </span>
                            <span
                              className={
                                orphanNode?.enabled ? "enabled" : "disabled"
                              }
                            >
                              {_i18n.t(
                                orphanNode?.enabled ? "已启用" : "已禁用"
                              )}
                            </span>
                            <span
                              className={orphanIsAlwaysOn ? "always-on" : ""}
                            >
                              {_i18n.t(
                                orphanIsAlwaysOn ? "始终开启" : "非始终开启"
                              )}
                            </span>
                          </small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="buttons">
              <button onClick={popup.hide}>{_i18n.t("取消")}</button>
              <button
                className="delete-confirm"
                onClick={() => {
                  const files = [name, ...selected].flatMap(
                    (selectedName) =>
                      nodes[selectedName]?.duplicateFiles.map(
                        (item) => item.file
                      ) ?? []
                  );
                  callRemote(
                    "delete_mod_files",
                    modPath,
                    JSON.stringify(files),
                    () => {
                      reloadMods();
                      popup.hide();
                    }
                  );
                }}
              >
                {_i18n.t("确认删除")}
              </button>
            </div>
          </div>
        );
      });
    },
    [
      alwaysOnMods,
      orphanActionTypes,
      deleteOrphansByDefault,
      modPath,
      nodes,
      reloadMods,
    ]
  );

  const showDuplicates = useCallback(
    (name: string) => {
      const node = nodes[name];
      if (!node || node.duplicateFiles.length < 2) return;
      const files = [...node.duplicateFiles].sort((left, right) => {
        const versionOrder = compareVersion(right.version, left.version);
        return versionOrder || right.modifiedAt - left.modifiedAt;
      });
      const latestFile = node.file;
      createPopup(() => {
        const popup = useContext(PopupContext);
        const [selected, setSelected] = useState<string[]>(
          files
            .filter((item) => item.file !== latestFile)
            .map((item) => item.file)
        );
        return (
          <div className="duplicate-mod-popup">
            <div className="title">
              {_i18n.t("重复 Mod ·")} {name}
            </div>
            <p>{_i18n.t("选择要删除的文件")}</p>
            <div className="duplicate-file-list">
              {files.map((item) => {
                const latest = item.file === latestFile;
                return (
                  <label key={item.file} className={latest ? "latest" : ""}>
                    <input
                      type="checkbox"
                      checked={selected.includes(item.file)}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? [...selected, item.file]
                            : selected.filter((value) => value !== item.file)
                        )
                      }
                    />
                    <span>
                      <strong>{item.file}</strong>
                      <small>
                        {item.version} · {formatSize(item.size)}
                      </small>
                    </span>
                    {latest && <em>{_i18n.t("最新版本")}</em>}
                  </label>
                );
              })}
            </div>
            <div className="buttons">
              <button onClick={popup.hide}>{_i18n.t("取消")}</button>
              <button
                className="delete-confirm"
                disabled={selected.length === 0}
                onClick={() => {
                  callRemote(
                    "delete_mod_files",
                    modPath,
                    JSON.stringify(selected),
                    () => {
                      reloadMods();
                      popup.hide();
                    }
                  );
                }}
              >
                {_i18n.t("删除选中")} ({selected.length})
              </button>
            </div>
          </div>
        );
      });
    },
    [modPath, nodes, reloadMods]
  );

  const startFullCheck = () => {
    if (fullCheckRunning) return;
    setFullCheckRunning(true);
    createPopup(
      () => {
        const popup = useContext(PopupContext);
        const [progress, setProgress] = useState<FullModCheckProgress>({
          current: 0,
          total: 0,
          file: "",
          done: false,
          issues: [],
        });
        useEffect(() => {
          callRemote("check_all_mod_contents", modPath, (data: string) => {
            const next = JSON.parse(data);
            setProgress(next);
            if (next.done) setFullCheckRunning(false);
          });
        }, []);
        return (
          <div className="popup-content full-mod-check-popup">
            <div className="title">{_i18n.t("检查 Mod 压缩包")}</div>
            {!progress.done ? (
              <div className="check-progress">
                <ProgressIndicator
                  value={progress.current}
                  max={progress.total || 1}
                  size={76}
                />
                <span>
                  {progress.current}/{progress.total}
                </span>
                <small>{progress.file}</small>
              </div>
            ) : progress.issues.length === 0 ? (
              <div className="check-result success">
                <Icon name="i-tick" />
                <span>{_i18n.t("全部 Mod 压缩包均可正常读取")}</span>
              </div>
            ) : (
              <div className="check-result">
                <strong>
                  {_i18n.t("发现 {count} 个问题", {
                    count: progress.issues.length,
                  })}
                </strong>
                <div className="issue-list">
                  {progress.issues.map((issue) => (
                    <div key={issue.file}>
                      <b>{issue.file}</b>
                      <span>{issue.error}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="buttons">
              {progress.done && progress.issues.length > 0 && (
                <button
                  onClick={() =>
                    callRemote(
                      "delete_mod_files",
                      modPath,
                      JSON.stringify(
                        progress.issues.map((issue) => issue.file)
                      ),
                      () => {
                        reloadMods();
                        popup.hide();
                      }
                    )
                  }
                >
                  {_i18n.t("删除损坏文件")}
                </button>
              )}
              <button disabled={!progress.done} onClick={popup.hide}>
                {progress.done ? _i18n.t("完成") : _i18n.t("检查中…")}
              </button>
            </div>
          </div>
        );
      },
      { cancelable: false, className: "full-mod-check-overlay" }
    );
  };

  const actions = useMemo<ManageActions>(
    () => ({
      switchNodes,
      deleteNode,
      showDuplicates,
      updateNode,
      downloadMissing,
      showDetails(name) {
        const node = nodes[name];
        if (node)
          showModDetails(node, fullByName.get(name.trim().toLocaleLowerCase()));
      },
      toggleAlwaysOn(name) {
        const file = nodes[name]?.file;
        if (!file) return;
        const packageIsAlwaysOn = alwaysOnMods.some(
          (value) => nodes[value]?.file === file
        );
        setAlwaysOnMods(
          packageIsAlwaysOn
            ? alwaysOnMods.filter((value) => nodes[value]?.file !== file)
            : [...alwaysOnMods, name]
        );
      },
      updateNames: showUpdate ? updateNames : new Set<string>(),
      updateVersions,
      updateStates,
      alwaysOnMods,
      comments,
      autoUseSubmissionNameAsComment,
      setComment(name, comment) {
        setComments({ ...comments, [name]: comment });
      },
      isPinned() {
        return false;
      },
      togglePinned() {},
      checkOptional,
      fullTree,
      showDetailed,
    }),
    [
      autoUseSubmissionNameAsComment,
      alwaysOnMods,
      checkOptional,
      comments,
      currentProfile,
      currentProfileName,
      deleteNode,
      downloadMissing,
      fullByName,
      fullTree,
      gamePath,
      profileEnabled,
      nodes,
      setAlwaysOnMods,
      setComments,
      setCurrentProfile,
      setProfilesCallback,
      showDetailed,
      showDuplicates,
      showUpdate,
      switchNodes,
      updateNames,
      updateNode,
      updateStates,
      updateVersions,
    ]
  );

  const activeFilterCount =
    filters.types.length +
    Number(filters.enabled !== "all") +
    Number(filters.health !== "all") +
    Number(filters.updateOnly) +
    Number(filters.showHiddenTypes) +
    Number(rootOnly) +
    Number(fullTree);
  const resetManageFilters = () => {
    resetFilters();
    setRootOnly(false);
    setFullTree(false);
    setFiltersSuspended(false);
  };

  if (noEverest) return noEverest;

  return (
    <div className={`manage-page${profileEnabled ? "" : " profiles-disabled"}`}>
      <ManageActionsContext.Provider value={actions}>
        <section className="manage-main">
          <header className="manage-toolbar">
            <div className="manage-title-block">
              <h1>{_i18n.t("Mod 管理")}</h1>
              <span>
                {_i18n.t("{visible} / {total} 个 Mod", {
                  visible: visibleRoots.length,
                  total: Object.keys(nodes).length,
                })}
              </span>
            </div>
            <div className="manage-search">
              <Icon name="search" />
              <input
                value={filters.query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={_i18n.t("搜索名称、备注、作者或文件…")}
              />
              {filters.query && (
                <button onClick={() => setQuery("")}>
                  <Icon name="i-cross" />
                </button>
              )}
            </div>
            <div className="toolbar-menu-wrap" ref={filterWrapRef}>
              <Button
                className={`toolbar-icon-button ${filterOpen ? "active" : ""}`}
                onClick={() => setFilterOpen(!filterOpen)}
              >
                <Icon name="filter" />
                {activeFilterCount > 0 && (
                  <span className="toolbar-count">{activeFilterCount}</span>
                )}
              </Button>
              {filterOpen && (
                <div className="manage-filter-popup">
                  <div className="popup-heading">
                    <strong>{_i18n.t("筛选已下载 Mod")}</strong>
                    <button onClick={resetManageFilters}>
                      {_i18n.t("重置")}
                    </button>
                  </div>
                  <label>
                    <span>{_i18n.t("启用状态")}</span>
                    <select
                      value={filters.enabled}
                      onChange={(event) =>
                        setEnabledFilter(
                          event.target.value as typeof filters.enabled
                        )
                      }
                    >
                      <option value="all">{_i18n.t("全部")}</option>
                      <option value="enabled">{_i18n.t("已启用")}</option>
                      <option value="disabled">{_i18n.t("已禁用")}</option>
                    </select>
                  </label>
                  <label>
                    <span>{_i18n.t("依赖状态")}</span>
                    <select
                      value={filters.health}
                      onChange={(event) =>
                        setHealthFilter(
                          event.target.value as typeof filters.health
                        )
                      }
                    >
                      <option value="all">{_i18n.t("全部")}</option>
                      <option value="healthy">{_i18n.t("正常")}</option>
                      <option value="issues">{_i18n.t("有问题")}</option>
                      <option value="missing">{_i18n.t("缺失依赖")}</option>
                    </select>
                  </label>
                  <div className="filter-checks">
                    <label>
                      <input
                        type="checkbox"
                        checked={rootOnly}
                        onChange={(event) => setRootOnly(event.target.checked)}
                      />
                      {_i18n.t("只显示不被依赖的Mod")}
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={filters.showHiddenTypes}
                        onChange={(event) =>
                          setShowHiddenTypes(event.target.checked)
                        }
                      />
                      {_i18n.t("显示设置中隐藏的类型")}
                    </label>
                  </div>
                  <div className="filter-type-title">{_i18n.t("类型")}</div>
                  <div className="filter-type-list">
                    {MOD_TYPE_OPTIONS.map((type) => (
                      <label key={type}>
                        <input
                          type="checkbox"
                          checked={filters.types.includes(type)}
                          onChange={() => toggleType(type)}
                        />
                        <span>{type}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="toolbar-menu-wrap" ref={actionsWrapRef}>
              <Button
                className={`toolbar-action-button ${
                  actionMenuOpen ? "active" : ""
                }`}
                onClick={() => setActionMenuOpen(!actionMenuOpen)}
              >
                {_i18n.t("操作")} <Icon name="i-down" />
              </Button>
              {actionMenuOpen && (
                <div className="manage-action-menu">
                  <button onClick={() => callRemote("open_url", modPath)}>
                    <Icon name="file" />
                    {_i18n.t("打开 Mods 文件夹")}
                  </button>
                  <button onClick={() => confirmBatchSwitch(true)}>
                    <Icon name="i-tick" />
                    {_i18n.t("启用全部")}
                  </button>
                  <button onClick={() => confirmBatchSwitch(false)}>
                    <Icon name="i-cross" />
                    {_i18n.t("禁用全部")}
                  </button>
                  <button
                    onClick={() =>
                      switchNodes(
                        Object.values(nodes)
                          .filter((node) => node.enabled)
                          .map((node) => node.name),
                        true
                      )
                    }
                  >
                    <Icon name="replay" />
                    {_i18n.t("启用全部依赖")}
                  </button>
                  <button onClick={expandAll}>
                    <Icon name="i-down" />
                    {_i18n.t("展开全部")}
                  </button>
                  <button onClick={collapseAll}>
                    <Icon name="i-right" />
                    {_i18n.t("收起全部")}
                  </button>
                  <button onClick={startFullCheck}>
                    <Icon name="warn" />
                    {fullCheckRunning
                      ? _i18n.t("检查中…")
                      : _i18n.t("检查 Mod 压缩包")}
                  </button>
                </div>
              )}
            </div>
          </header>
          {(updates.length > 0 || missingDependencies.length > 0) && (
            <div className="manage-notice-bar">
              {showUpdate && updates.length > 0 && (
                <button
                  onClick={() => {
                    const names = updates.map((update) => update.name);
                    void Promise.all(names.map(updateNode))
                      .then(() => reloadMods())
                      .then(() =>
                        setUpdateStates((state) =>
                          Object.fromEntries(
                            Object.entries(state).filter(
                              ([name]) => !names.includes(name)
                            )
                          )
                        )
                      );
                  }}
                >
                  {_i18n.t("更新全部 Mod")} ({updates.length})
                </button>
              )}
              {missingDependencies.length > 0 && (
                <button
                  disabled={fixingDependencies}
                  onClick={() => {
                    setFixingDependencies(true);
                    void Promise.all(
                      missingDependencies.map((dependency) =>
                        downloadMissing(dependency.name)
                      )
                    )
                      .then(() => reloadMods())
                      .finally(() => setFixingDependencies(false));
                  }}
                >
                  {_i18n.t("安装缺失依赖")} ({missingDependencies.length})
                </button>
              )}
            </div>
          )}

          {hasSearchQuery &&
            (hiddenKeywordMatchCount > 0 || filtersSuspended) && (
              <div className="manage-filter-hint">
                <span>
                  {_i18n.t("部分搜索结果被筛选条件隐藏")}
                  {hiddenKeywordMatchCount > 0
                    ? ` (${hiddenKeywordMatchCount})`
                    : ""}
                </span>
                <button onClick={() => setFiltersSuspended((value) => !value)}>
                  {filtersSuspended
                    ? _i18n.t("恢复筛选条件")
                    : _i18n.t("暂时关闭筛选条件")}
                </button>
              </div>
            )}

          <div className="manage-tree-scroll">
            {visibleRoots.length > 0 ? (
              visibleRoots.map((name) => (
                <ManageTreeNode key={name} name={name} />
              ))
            ) : (
              <div className="manage-empty">
                <Icon name="search" />
                <strong>{_i18n.t("没有符合筛选条件的 Mod")}</strong>
                <button onClick={resetManageFilters}>
                  {_i18n.t("清除筛选")}
                </button>
              </div>
            )}
          </div>
        </section>

        {profileEnabled && (
          <aside className="manage-side">
            <div className="side-section profile-section">
              <div className="side-title">
                <span>{_i18n.t("Profile")}</span>
                <div className="profile-title-actions">
                  <small>{profiles.length}</small>
                  <button
                    type="button"
                    className="profile-folder"
                    title={_i18n.t("打开预设文件夹")}
                    onClick={() =>
                      void callRemote(
                        "open_url",
                        `${gamePath}/celemod_blacklist_profiles`
                      )
                    }
                  >
                    <Icon name="folder" />
                  </button>
                  <div className="profile-import-wrap">
                    <button
                      type="button"
                      className="profile-import"
                      title={_i18n.t("导入预设")}
                      onClick={() => setProfileImportOpen((value) => !value)}
                    >
                      <Icon name="import" />
                    </button>
                    {profileImportOpen && (
                      <div className="profile-import-menu">
                        <button
                          onClick={() => {
                            createPopup(() => (
                              <ProfileModListImportPopup
                                gamePath={gamePath}
                                catalog={catalog}
                                onImported={() => {
                                  setProfileImportOpen(false);
                                  void reloadBlacklistState(gamePath);
                                }}
                              />
                            ));
                          }}
                        >
                          {_i18n.t("粘贴 Mod 列表")}
                        </button>
                        <button
                          onClick={() => {
                            void open({
                              multiple: false,
                              filters: [
                                {
                                  name: "CeleMod Profile",
                                  extensions: ["json"],
                                },
                              ],
                            })
                              .then((source) => {
                                if (typeof source !== "string") return;
                                return installProfileFile(
                                  gamePath,
                                  source,
                                  () => {
                                    setProfileImportOpen(false);
                                    void reloadBlacklistState(gamePath);
                                  }
                                );
                              })
                              .catch(console.error);
                          }}
                        >
                          {_i18n.t("导入 CeleMod 预设")}
                        </button>
                        {olympusProfiles.length > 0 && (
                          <button
                            onClick={() => {
                              createPopup(() => {
                                const popup = useContext(PopupContext);
                                const [selected, setSelected] =
                                  useState<string[]>(olympusProfiles);
                                return (
                                  <div className="popup-content olympus-import-popup">
                                    <div className="title">
                                      {_i18n.t("导入 Olympus 预设")}
                                    </div>
                                    <div className="content">
                                      {olympusProfiles.map((name) => (
                                        <label key={name}>
                                          <input
                                            type="checkbox"
                                            checked={selected.includes(name)}
                                            onChange={() =>
                                              setSelected((names) =>
                                                names.includes(name)
                                                  ? names.filter(
                                                      (item) => item !== name
                                                    )
                                                  : [...names, name]
                                              )
                                            }
                                          />
                                          {name}
                                        </label>
                                      ))}
                                    </div>
                                    <div className="buttons">
                                      <button onClick={popup.hide}>
                                        {_i18n.t("取消")}
                                      </button>
                                      <button
                                        disabled={selected.length === 0}
                                        onClick={() => {
                                          void installOlympusProfiles(
                                            gamePath,
                                            selected,
                                            () => {
                                              setProfileImportOpen(false);
                                              popup.hide();
                                              void reloadBlacklistState(
                                                gamePath
                                              );
                                            }
                                          ).catch(console.error);
                                        }}
                                      >
                                        {_i18n.t("导入")}
                                      </button>
                                    </div>
                                  </div>
                                );
                              });
                            }}
                          >
                            {_i18n.t("导入 Olympus 预设")}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="profile-list">
                {profiles.map((profile) => (
                  <div
                    key={profile.name}
                    className={`profile-row ${
                      profile.name === currentProfileName ? "selected" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className="profile-select"
                      onClick={() => {
                        setCurrentProfileName(profile.name);
                        setCurrentProfile(profile);
                      }}
                    >
                      <span className="profile-name">{profile.name}</span>
                      <small>{profile.enabled_mods.length}</small>
                    </button>
                    <div className="profile-export-wrap">
                      <button
                        type="button"
                        className="profile-export"
                        title={_i18n.t("导出预设")}
                        onClick={() => {
                          createPopup(() => (
                            <ProfileExportPopup
                              profile={profile}
                              nodes={nodes}
                            />
                          ));
                        }}
                      >
                        <Icon name="save" />
                      </button>
                    </div>
                    <button
                      type="button"
                      className="profile-delete"
                      title={_i18n.t("删除")}
                      onClick={() => {
                        void callRemote(
                          "remove_mod_blacklist_profile",
                          gamePath,
                          profile.name
                        )
                          .then((result) => {
                            if (String(result) !== "Success")
                              throw new Error(String(result));
                            return reloadBlacklistState(gamePath);
                          })
                          .catch(console.error);
                      }}
                    >
                      <Icon name="delete" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="profile-create">
                <input
                  value={profileNameInput}
                  maxLength={30}
                  onChange={(event) => setProfileNameInput(event.target.value)}
                  placeholder={_i18n.t("新 Profile 名称")}
                />
                <button
                  onClick={() => {
                    const name = profileNameInput.trim();
                    if (
                      !name ||
                      profiles.some((profile) => profile.name === name)
                    )
                      return;
                    void callRemote("new_mod_blacklist_profile", gamePath, name)
                      .then((result) => {
                        if (String(result) !== "Success")
                          throw new Error(String(result));
                        const profile = { name, enabled_mods: [] };
                        setProfilesCallback((items) => [...items, profile]);
                        setCurrentProfileName(name);
                        setCurrentProfile(profile);
                        setProfileNameInput("");
                      })
                      .catch(console.error);
                  }}
                >
                  <Icon name="i-tick" />
                </button>
              </div>
            </div>
          </aside>
        )}
      </ManageActionsContext.Provider>
    </div>
  );
};
