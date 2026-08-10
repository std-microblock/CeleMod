import _i18n from "src/i18n";
import {
  Fragment,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import "./ModList.scss";
import { Button } from "./Button";
import { Icon } from "./Icon";
import {
  Awaitable,
  callRemote,
  displayDate,
  horizontalScrollMouseWheelHandler,
} from "../utils";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Content } from "../api/wegfan";
import { useAppStore, useAutoDisableNewMods } from "../states";
import { useDownloadStore } from "../stores/download";
import { PopupContext, createPopup } from "./Popup";
import { ProgressIndicator } from "./Progress";
import { sanitizeDescriptionHtml } from "../sanitizeDescriptionHtml";
import {
  getAvailableModPageUrl,
  getOtherModPageSource,
} from "../modPage";
// @ts-ignore
import celemodIcon from "../resources/Celemod.png";

const processLargeNum = (num: number) => {
  if (num < 1000) return num.toString();
  if (num < 1000000) return (num / 1000).toFixed(1) + "k";
  if (num < 1000000000) return (num / 1000000).toFixed(1) + "m";
  return (num / 1000000000).toFixed(1) + "b";
};

const formatShortDate = (dateValue: string | Date) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "--";
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear().toString().slice(-2)}/${pad(
    date.getMonth() + 1
  )}/${pad(date.getDate())}`;
};

const getCategoryLabel = (category: string) => {
  const categoryI18nMap: Record<string, string> = {
    Map: _i18n.t("地图"),
    Maps: _i18n.t("地图"),
    Assets: _i18n.t("资源"),
    Effects: _i18n.t("特效"),
    Dialog: _i18n.t("对话"),
    "Other/Misc": _i18n.t("其他"),
    Helpers: _i18n.t("辅助"),
    "Lönn Plugin": _i18n.t("辅助"),
    Skins: _i18n.t("皮肤"),
    Mechanics: _i18n.t("机制"),
    UI: "UI",
  };

  return categoryI18nMap[category]
    ? _i18n.t(categoryI18nMap[category])
    : category;
};

const BackgroundEle = memo(
  ({ preview, name }: { preview: string; name: string }) => (
    <Fragment>
      <div className="mod-media">
        <img
          src={preview + "?w=560"}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
        />
        <div className="mod-media-shade" />
        <span className="sr-only">{name}</span>
      </div>
      <div className="mod-info-backdrop" aria-hidden="true">
        <img src={preview + "?w=560"} alt="" loading="lazy" decoding="async" />
      </div>
    </Fragment>
  )
);

const CARD_HEIGHT = 242;
const LIST_CARD_HEIGHT = 64;
const CARD_MIN_WIDTH = 300;
const GRID_GAP = 16;
const GRID_PADDING = 14;

export interface ModDetailInfo {
  // HTML compatible
  description: string;
  authors?: string[];
  images?: string[];
  files?: {
    name: string;
    downloadUrl: string;
  }[];
  lastUpdate?: Date;
  submissionId?: string;
  externalUrl?: string;
}

export interface FileToDownload {
  name: string;
  url: string;
  id: string;
  size: string;
  isInstalled?: boolean;
  isPrimary?: boolean;
}

interface InstalledModSummary {
  game_banana_id: number;
  name: string;
  version: string;
}

export interface ModInfo {
  name: string;
  downloadKey?: string;
  downloadUrl: () => Awaitable<string | FileToDownload[]>;
  previewUrl: string;
  author: string;
  other: string;
  category?: string;
  stats?: {
    likes: number;
    views: number;
    downloads: number;
  };
  dates?: {
    published: Date;
    updated: Date;
  };
  detail?: () => Promise<ModDetailInfo>;
}
export const Mod = memo(
  (props: {
    mod: ModInfo;
    onClick?: any;
    expanded?: boolean;
    modFolder: string;
    isInstalled: boolean;
  }) => {
    const downloadMod = useDownloadStore((state) => state.downloadMod);
    const [autoDisableNewMods] = useAutoDisableNewMods();
    const { mod } = props;
    const preview = mod.previewUrl;
    const downloadOwnerId = mod.downloadKey ?? mod.name;
    const downloadTask = useDownloadStore(
      (state) =>
        Object.values(state.tasks).find(
          (task) => task.ownerId === downloadOwnerId
        ) ?? state.tasks[mod.name]
    );
    const downloadActive =
      downloadTask?.state === "pending" && !downloadTask.canceled;
    const downloadProgress = Math.max(
      0,
      Math.min(100, Number(downloadTask?.progress ?? 0))
    );

    return (
      <div
        onClick={props.onClick}
        className={`mod ${props.expanded ? "expanded" : ""}`}
        key={mod.name}
      >
        <BackgroundEle preview={preview} name={mod.name} />

        <div className="mod-badges">
          {props.isInstalled && (
            <span className="mod-installed-badge">
              <Icon name="i-tick" />
              {_i18n.t("已安装")}
            </span>
          )}
          {mod.category && (
            <span className="mod-category-badge">{mod.category}</span>
          )}
        </div>

        <div className="operations">
          <Button
            title={
              downloadActive
                ? `${Math.round(downloadProgress)}%`
                : props.isInstalled
                ? _i18n.t("已安装")
                : _i18n.t("下载")
            }
            aria-label={
              downloadActive
                ? `${Math.round(downloadProgress)}%`
                : props.isInstalled
                ? _i18n.t("已安装")
                : _i18n.t("下载")
            }
            onClick={async (event) => {
              event.stopPropagation();
              if (props.isInstalled) return;

              const down = (name: string, fileid: string) => {
                downloadMod(name, fileid, {
                  autoDisableNewMods,
                  ownerId: downloadOwnerId,
                });
              };

              if (downloadTask) {
                if (downloadTask.state === "failed" && downloadTask.source) {
                  downloadMod(downloadTask.name, downloadTask.source, {
                    force: true,
                    autoDisableNewMods,
                    ownerId: downloadOwnerId,
                  });
                }
                return;
              }

              let ctx: any;
              createPopup(() => {
                const popupCtx = useContext(PopupContext);
                const [downloads, setDownloads] = useState<
                  FileToDownload[] | null
                >(null);
                const [error, setError] = useState<string | null>(null);
                ctx = {
                  hide() {
                    popupCtx.hide();
                  },
                  setDownloads(data: any) {
                    setDownloads(data);
                  },
                  setError(data: any) {
                    setError(data);
                  },
                };

                if (downloads === null && error === null)
                  return (
                    <div
                      style={{
                        width: "min-content",
                      }}
                    >
                      <ProgressIndicator infinite />
                    </div>
                  );

                return (
                  <div
                    className="download-file-popup"
                    onClick={(e) => {
                      if (e.target === e.currentTarget) ctx.hide();
                    }}
                  >
                    {downloads && (
                      <div
                        className="download-file-dialog"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="download-file-header">
                          <span className="download-file-header-icon">
                            <Icon name="file" />
                          </span>
                          <div className="download-file-heading">
                            <strong title={mod.name}>{mod.name}</strong>
                            <span>{downloads.length}</span>
                          </div>
                          <button
                            type="button"
                            className="download-file-close"
                            title={_i18n.t("关闭")}
                            aria-label={_i18n.t("关闭")}
                            onClick={() => popupCtx.hide()}
                          >
                            <Icon name="i-cross" />
                          </button>
                        </div>

                        <div className="download-file-list">
                          {downloads.map((file) => (
                            <button
                              type="button"
                              key={`${file.id}-${file.name}`}
                              className={`file ${
                                file.isPrimary ? "file-primary" : ""
                              } ${file.isInstalled ? "file-installed" : ""}`}
                              onClick={() => {
                                down(
                                  file.name,
                                  parseInt(file.id) === -1 ? file.url : file.id
                                );
                                popupCtx.hide();
                              }}
                            >
                              <span className="file-icon">
                                <Icon
                                  name={file.isInstalled ? "i-tick" : "file"}
                                />
                              </span>
                              <span className="file-content">
                                <span className="name" title={file.name}>
                                  {file.name}
                                </span>
                                <span className="info">
                                  <span className="size">{file.size}</span>
                                  <span className="id">#{file.id}</span>
                                  {file.isInstalled && (
                                    <span className="installed-badge">
                                      <Icon name="i-tick" />
                                      {_i18n.t("已安装")}
                                    </span>
                                  )}
                                </span>
                                <span className="url" title={file.url}>
                                  {file.url}
                                </span>
                              </span>
                              <span className="file-action">
                                <Icon name="download" />
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {error && (
                      <span className="download-file-error">{error}</span>
                    )}
                  </div>
                );
              });

              const downloadInfo = await mod.downloadUrl();

              if (typeof downloadInfo === "string") {
                ctx.hide();
                down(mod.name, downloadInfo);
              } else {
                if (downloadInfo.length === 1) {
                  ctx.hide();
                  down(downloadInfo[0].name, downloadInfo[0].id);
                } else if (downloadInfo.length === 0) {
                  ctx.setError(_i18n.t("文件列表为空"));
                } else {
                  ctx.setDownloads(downloadInfo);
                }
              }
            }}
          >
            {props.isInstalled ? (
              <Icon name="i-tick" />
            ) : downloadTask ? (
              downloadActive ? (
                <span
                  className="download-progress"
                  style={
                    {
                      "--download-progress": `${downloadProgress}%`,
                    } as CSSProperties
                  }
                >
                  <span>{downloadTask.subtasks.length}</span>
                </span>
              ) : downloadTask.state === "failed" || downloadTask.canceled ? (
                <Icon name="i-cross" />
              ) : (
                <Icon name="i-tick" />
              )
            ) : (
              <Icon name="download" />
            )}
          </Button>

          {props.mod.detail && (
            <Button
              title={_i18n.t("更多")}
              aria-label={_i18n.t("更多")}
              onClick={async (event) => {
                event.stopPropagation();
                createPopup(
                  () => {
                    const [data, setData] = useState<ModDetailInfo | null>(
                      null
                    );
                    const modPageSource = useAppStore(
                      (state) => state.modPageSource
                    );
                    const ctx = useContext(PopupContext);
                    useEffect(() => {
                      mod.detail?.().then(setData);
                    }, []);

                    const refContent = useRef<HTMLDivElement>(null);
                    const refImages = useRef<HTMLDivElement>(null);
                    useEffect(() => {
                      if (!refImages.current) return;
                      // horizontal scroll
                      refImages.current.addEventListener(
                        "mousewheel",
                        horizontalScrollMouseWheelHandler()
                      );
                    }, [data]);

                    useEffect(() => {
                      if (!refContent.current) return;
                      refContent.current.innerHTML = "";
                      refContent.current.appendChild(
                        sanitizeDescriptionHtml(data?.description ?? "")
                      );

                      // Keep external links going through the native opener.
                      // @ts-ignore
                      for (const a of refContent.current.querySelectorAll(
                        "a"
                      )) {
                        const url = a.getAttribute("href");
                        if (!url) continue;
                        a.href = "#";
                        a.onclick = (e: any) => {
                          e.preventDefault();
                          e.stopPropagation();
                          callRemote("open_url", url);
                        };
                      }

                      // @ts-ignore
                      for (const img of refContent.current.querySelectorAll(
                        "img"
                      ))
                        img.style.maxWidth = "300px";
                    }, [data]);

                    if (!data)
                      return (
                        <div
                          style={{
                            width: "min-content",
                          }}
                        >
                          <ProgressIndicator infinite />
                        </div>
                      );

                    return (
                      <div className="mod-detail-popup">
                        <div className="closeBtn" onClick={() => ctx.hide()}>
                          <Icon name="i-cross" />
                        </div>
                        {(data.submissionId || data.externalUrl) && (
                          <div
                            className="openExternal"
                            onClick={() => {
                              const url = getAvailableModPageUrl(
                                {
                                  submissionId: data.submissionId,
                                  gameBananaUrl: data.externalUrl,
                                },
                                modPageSource
                              );
                              if (url) callRemote("open_url", url);
                            }}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              const url = getAvailableModPageUrl(
                                {
                                  submissionId: data.submissionId,
                                  gameBananaUrl: data.externalUrl,
                                },
                                getOtherModPageSource(modPageSource)
                              );
                              if (url) callRemote("open_url", url);
                            }}
                            title={_i18n.t(
                              "左键打开所选来源，右键打开另一个来源"
                            )}
                          >
                            <Icon name="external" />
                          </div>
                        )}

                        <h2>{mod.name}</h2>
                        <div className="info">
                          Mod ·{" "}
                          {data.lastUpdate
                            ? displayDate(data.lastUpdate) + " ·"
                            : ""}
                          {mod.author}
                        </div>
                        {data.authors &&
                          data.authors.join(" ") !== mod.author && (
                            <Fragment>
                              <div className="credits-title">Credits</div>
                              <div className="info credits">
                                {data.authors.join(" / ")}
                              </div>
                            </Fragment>
                          )}
                        {data.images && (
                          <div className="images" ref={refImages}>
                            {data.images.map((v) => (
                              <img
                                src={v + "?h=160"}
                                alt=""
                                srcSet=""
                                onClick={() =>
                                  createPopup(() => (
                                    <div className="image-view">
                                      <img src={v} alt="" srcSet="" />
                                    </div>
                                  ))
                                }
                              />
                            ))}
                          </div>
                        )}

                        <div className="content" ref={refContent}></div>
                      </div>
                    );
                  },
                  {
                    backgroundMask: "#131313",
                  }
                );
              }}
            >
              <Icon name="opts-h" />
            </Button>
          )}
        </div>

        <div className="info">
          <div className="name" title={mod.name}>
            {mod.name}
          </div>
          <div className="author" title={mod.author}>
            {mod.author}
          </div>
          {mod.stats ? (
            <div className="mod-stats">
              <span>
                <Icon name="heart" />
                {processLargeNum(mod.stats.likes)}
              </span>
              <span>
                <Icon name="eye" />
                {processLargeNum(mod.stats.views)}
              </span>
              <span>
                <Icon name="download" />
                {processLargeNum(mod.stats.downloads)}
              </span>
              {mod.dates && (
                <Fragment>
                  <span className="mod-date-stat" title={_i18n.t("发布")}>
                    <Icon name="calendar" />
                    <time>{formatShortDate(mod.dates.published)}</time>
                  </span>
                  <span className="mod-date-stat" title={_i18n.t("更新")}>
                    <Icon name="clock" />
                    <time>{formatShortDate(mod.dates.updated)}</time>
                  </span>
                </Fragment>
              )}
            </div>
          ) : (
            <div className="other">{mod.other}</div>
          )}
        </div>
      </div>
    );
  }
);
export const ModList = (props: {
  mods: Content[];
  onLoadMore?: () => Promise<void> | void;
  haveMore?: boolean;
  modFolder: string;
  loading?: boolean;
  viewMode?: "grid" | "list";
}) => {
  const [installedMods, setInstalledMods] = useState<
    InstalledModSummary[] | null
  >(null);
  const [listWidth, setListWidth] = useState(0);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const refList = useRef<HTMLDivElement>(null);
  const loadMoreLocked = useRef(false);

  useEffect(() => {
    callRemote("get_installed_mods", props.modFolder, (data: string) => {
      setInstalledMods(JSON.parse(data));
    });
  }, [props.modFolder]);

  const installedModIDs = useMemo(
    () =>
      installedMods === null
        ? null
        : new Set(installedMods.map((item) => item.game_banana_id.toString())),
    [installedMods]
  );
  const installedModVersions = useMemo(() => {
    const versions = new Map<string, Set<string>>();
    for (const item of installedMods ?? []) {
      const name = item.name.toLocaleLowerCase();
      const current = versions.get(name) ?? new Set<string>();
      current.add(item.version);
      versions.set(name, current);
    }
    return versions;
  }, [installedMods]);

  useEffect(() => {
    const element = refList.current;
    if (!element) return;

    const updateWidth = () => {
      setListWidth(element.clientWidth);
      setScrollbarWidth(element.offsetWidth - element.clientWidth);
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const viewMode = props.viewMode ?? "grid";
  const gridRightPadding = Math.max(0, GRID_PADDING - scrollbarWidth);
  const columnCount = useMemo(() => {
    if (viewMode === "list") return 1;
    const available = Math.max(0, listWidth - GRID_PADDING * 2);
    return Math.max(
      1,
      Math.floor((available + GRID_GAP) / (CARD_MIN_WIDTH + GRID_GAP))
    );
  }, [listWidth, viewMode]);

  const rowCount = Math.ceil(props.mods.length / columnCount);
  const rowHeight = viewMode === "list" ? LIST_CARD_HEIGHT : CARD_HEIGHT;
  const rowGap = viewMode === "list" ? 0 : GRID_GAP;
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => refList.current,
    estimateSize: () => rowHeight + rowGap,
    overscan: 2,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    const lastRow = virtualRows.at(-1);
    if (
      !lastRow ||
      !props.haveMore ||
      props.loading ||
      loadMoreLocked.current ||
      lastRow.index < rowCount - 2
    )
      return;

    loadMoreLocked.current = true;
    Promise.resolve(props.onLoadMore?.()).finally(() => {
      loadMoreLocked.current = false;
    });
  }, [props.haveMore, props.loading, props.onLoadMore, rowCount, virtualRows]);

  const firstModId = props.mods[0]?.id;
  useEffect(() => {
    rowVirtualizer.scrollToOffset(0);
  }, [firstModId]);

  useEffect(() => {
    rowVirtualizer.measure();
    rowVirtualizer.scrollToOffset(0);
  }, [rowGap, rowHeight, viewMode]);

  const formatSize = (size: number) => {
    const i = size === 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024));
    const sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    return `${(size / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  };

  const createModInfo = useCallback(
    (mod2: Content) => {
      const mod = {
        name: mod2.name,
        downloadKey: String(mod2.gameBananaId ?? mod2.id ?? mod2.name),
        downloadUrl: () => {
          const dedup = new Set();
          if (!mod2.gameBananaId || mod2.gameBananaId < 0) {
            return mod2.files[0]?.url ? mod2.files[0].url : [];
          }
          const files = mod2.files.filter((file) => {
            if (file.mods.length === 0) return false;
            if (dedup.has(file.mods[0].id)) return false;
            dedup.add(file.mods[0].id);
            return true;
          });
          const normalizeName = (value: string) =>
            value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
          const submissionName = normalizeName(mod2.name);
          const primaryIndex = Math.max(
            0,
            files.findIndex((file) =>
              file.mods.some(
                (fileMod) => normalizeName(fileMod.name) === submissionName
              )
            )
          );

          return Promise.resolve(
            files.map((file, index) => ({
              id: file.gameBananaId.toString(),
              name: `${
                file.description.includes(file.mods[0].version)
                  ? ""
                  : file.mods[0].version + "-"
              }${file.description}-${file.mods[0].name}`,
              size: formatSize(file.size),
              url: file.url,
              isPrimary: index === primaryIndex,
              isInstalled: file.mods.every((fileMod) =>
                installedModVersions
                  .get(fileMod.name.toLocaleLowerCase())
                  ?.has(fileMod.version)
              ),
            }))
          );
        },
        previewUrl: mod2?.screenshots?.[0]?.url ?? celemodIcon,
        author: mod2.submitter,
        isInstalled:
          installedModIDs?.has(mod2.gameBananaId?.toString()) ?? false,
        other: `${mod2.likes} · ${processLargeNum(
          mod2.views
        )} · ${processLargeNum(mod2.downloads)}`,
        category: getCategoryLabel(mod2.categoryName),
        stats: {
          likes: mod2.likes,
          views: mod2.views,
          downloads: mod2.downloads,
        },
        dates: {
          published: mod2.createTime,
          updated: mod2.latestUpdateAddedTime ?? mod2.updateTime,
        },
        detail: () =>
          Promise.resolve({
            description: mod2.description,
            authors: mod2.credits
              .map((v) => v.authors.map((v) => v.name))
              .flat(),
            images: mod2.screenshots.map((v) => v.url),
            files: mod2.files.map((v) => ({
              name: v.description,
              downloadUrl: v.url,
            })),
            lastUpdate: mod2.latestUpdateAddedTime,
            submissionId: mod2.id,
            externalUrl: mod2.pageUrl,
          }),
      };
      return mod;
    },
    [installedModIDs, installedModVersions]
  );

  return (
    <div className={`mod-list-shell view-${viewMode}`}>
      <div className="mod-list" ref={refList}>
        <div
          className="mod-virtual-canvas"
          style={{ height: rowVirtualizer.getTotalSize() + GRID_PADDING * 2 }}
        >
          {installedMods !== null &&
            virtualRows.map((virtualRow) => {
              const startIndex = virtualRow.index * columnCount;
              const rowMods = props.mods.slice(
                startIndex,
                startIndex + columnCount
              );

              return (
                <div
                  className="mod-grid-row"
                  key={virtualRow.key}
                  style={{
                    height: rowHeight,
                    gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                    paddingRight: gridRightPadding,
                    transform: `translateY(${
                      virtualRow.start + GRID_PADDING
                    }px)`,
                  }}
                >
                  {rowMods.map((mod2) => {
                    const mod = createModInfo(mod2);
                    return (
                      <Mod
                        key={`${mod2.gameBananaId ?? mod2.id}-${mod2.name}`}
                        mod={mod}
                        modFolder={props.modFolder}
                        isInstalled={mod.isInstalled}
                      />
                    );
                  })}
                </div>
              );
            })}
        </div>
      </div>

      {(props.loading || installedMods === null) && (
        <div className="mod-list-loading" aria-label={_i18n.t("加载中")}>
          <ProgressIndicator infinite size={26} lineWidth={3} />
        </div>
      )}
    </div>
  );
};
