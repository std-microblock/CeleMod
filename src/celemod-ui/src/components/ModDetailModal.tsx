import _i18n from "src/i18n";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import "./ModDetailModal.scss";
import { Icon } from "./Icon";
import { ProgressIndicator } from "./Progress";
import { PopupContext, createPopup } from "./Popup";
import { currentMirror, useAppStore, useAutoDisableNewMods } from "../states";
import { useDownloadStore } from "../stores/download";
import {
  getDependencyHealth,
  isAlwaysOnPackage,
  resolveManageDisplayNames,
  useManageStore,
  type ManageNode,
} from "../stores/manage";
import { searchSubmission, type Content, type Credit } from "../api/wegfan";
import type { CatalogMod } from "../api/modCatalog";
import { sanitizeDescriptionHtml } from "../sanitizeDescriptionHtml";
import { callRemote, type Awaitable } from "../utils";
import {
  formatCompactNumber,
  formatDetailDate,
  formatDetailSize,
  matchCloudSubmission,
  normalizeCredits,
  resolveExternalLinks,
  type NormalizedCreditGroup,
} from "./modDetailHelpers";

export interface ModDetailScreenshot {
  id?: string;
  url: string;
  caption?: string | null;
}

export interface ModDetailFileEntry {
  id: string;
  name: string;
  description?: string;
  size: string;
  url: string;
  downloads?: number;
  isPrimary?: boolean;
  isInstalled?: boolean;
  mods?: { name: string; version: string }[];
}

export interface ModDetailPayload {
  description: string;
  subtitle?: string;
  authors?: string[];
  credits?: Credit[];
  images?: string[];
  screenshots?: ModDetailScreenshot[];
  files?: {
    name: string;
    downloadUrl: string;
  }[];
  lastUpdate?: Date | string;
  submissionId?: string;
  externalUrl?: string;
  gameBananaId?: number | null;
  subCategory?: string | null;
  catalogSize?: number;
  isLocalOnly?: boolean;
}

const withThumbHeight = (url: string, height: number) => {
  if (!url) return url;
  if (!/^https?:\/\//i.test(url)) return url;
  if (url.includes("?h=") || url.includes("&h=")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}h=${height}`;
};

const isTopmostPopup = (element: HTMLElement | null) => {
  const container = element?.closest(".popup-container");
  if (!container) return false;
  const openPopups = Array.from(
    document.querySelectorAll('.popup-container:not([data-state="closing"])'),
  );
  return openPopups[openPopups.length - 1] === container;
};

/* -------------------------------------------------------------------------- */
/*                               Image Lightbox                               */
/* -------------------------------------------------------------------------- */

const LightboxViewer = ({
  images,
  initialIndex,
}: {
  images: ModDetailScreenshot[];
  initialIndex: number;
}) => {
  const popup = useContext(PopupContext);
  const [index, setIndex] = useState(
    Math.max(0, Math.min(images.length - 1, initialIndex)),
  );
  const [loadedUrl, setLoadedUrl] = useState<string>("");
  const rootRef = useRef<HTMLDivElement>(null);

  const current = images[index] ?? images[0];
  const hasMultiple = images.length > 1;

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + images.length) % images.length);
  }, [images.length]);

  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % images.length);
  }, [images.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopmostPopup(rootRef.current)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        popup.hide();
      } else if (hasMultiple && event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
      } else if (hasMultiple && event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [goNext, goPrev, hasMultiple, popup]);

  if (!current) return null;
  const isLoaded = loadedUrl === current.url;

  return (
    <div
      ref={rootRef}
      className="mod-lightbox"
      onClick={(event) => {
        if (event.target === event.currentTarget) popup.hide();
      }}
    >
      <div className="mod-lightbox-topbar">
        <div className="mod-lightbox-meta">
          {hasMultiple && (
            <span className="mod-lightbox-counter">
              {index + 1} / {images.length}
            </span>
          )}
          {current.caption && (
            <span className="mod-lightbox-caption" title={current.caption}>
              {current.caption}
            </span>
          )}
        </div>
        <div className="mod-lightbox-actions">
          {/^https?:\/\//i.test(current.url) && (
            <button
              type="button"
              className="mod-lightbox-btn"
              title={_i18n.t("在浏览器中打开原图")}
              onClick={() => void callRemote("open_url", current.url)}
            >
              <Icon name="external" />
            </button>
          )}
          <button
            type="button"
            className="mod-lightbox-btn"
            title={_i18n.t("关闭")}
            aria-label={_i18n.t("关闭")}
            onClick={() => popup.hide()}
          >
            <Icon name="i-cross" />
          </button>
        </div>
      </div>

      <div
        className="mod-lightbox-stage"
        onClick={(event) => {
          if (event.target === event.currentTarget) popup.hide();
        }}
      >
        {hasMultiple && (
          <button
            type="button"
            className="mod-lightbox-nav prev"
            aria-label={_i18n.t("上一张")}
            onClick={(event) => {
              event.stopPropagation();
              goPrev();
            }}
          >
            <Icon name="i-left" />
          </button>
        )}

        <div className="mod-lightbox-image-frame">
          {!isLoaded && (
            <div className="mod-lightbox-spinner">
              <ProgressIndicator infinite size={28} />
            </div>
          )}
          <img
            key={current.url}
            src={current.url}
            alt={current.caption || ""}
            className={isLoaded ? "is-loaded" : undefined}
            onLoad={() => setLoadedUrl(current.url)}
            onError={() => setLoadedUrl(current.url)}
            onClick={(event) => event.stopPropagation()}
          />
        </div>

        {hasMultiple && (
          <button
            type="button"
            className="mod-lightbox-nav next"
            aria-label={_i18n.t("下一张")}
            onClick={(event) => {
              event.stopPropagation();
              goNext();
            }}
          >
            <Icon name="i-right" />
          </button>
        )}
      </div>

      {hasMultiple && (
        <div
          className="mod-lightbox-thumbs"
          onClick={(event) => event.stopPropagation()}
        >
          {images.map((image, idx) => (
            <button
              type="button"
              key={`${image.url}-${idx}`}
              className={`mod-lightbox-thumb ${idx === index ? "active" : ""}`}
              onClick={() => setIndex(idx)}
              aria-label={`${idx + 1} / ${images.length}`}
            >
              <img
                src={withThumbHeight(image.url, 120)}
                alt={image.caption || ""}
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const openModImageLightbox = (
  images: ModDetailScreenshot[],
  initialIndex = 0,
) => {
  if (images.length === 0) return;
  createPopup(
    () => <LightboxViewer images={images} initialIndex={initialIndex} />,
    {
      className: "mod-lightbox-overlay",
      backgroundMask: "rgba(6, 7, 10, 0.88)",
    },
  );
};

/* -------------------------------------------------------------------------- */
/*                              Shared Sub-Views                              */
/* -------------------------------------------------------------------------- */

const ModScreenshotGallery = ({
  screenshots,
}: {
  screenshots: ModDetailScreenshot[];
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({
    left: false,
    right: false,
  });

  const updateScrollButtons = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setScrollState({
      left: el.scrollLeft > 8,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 8,
    });
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    updateScrollButtons();
    const observer = new ResizeObserver(updateScrollButtons);
    observer.observe(el);

    const onWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth + 4) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const goingRight = event.deltaY > 0;
      const atStart = el.scrollLeft <= 1;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      if ((goingRight && atEnd) || (!goingRight && atStart)) return;
      event.preventDefault();
      el.scrollLeft += event.deltaY * 1.4;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  }, [screenshots.length, updateScrollButtons]);

  if (screenshots.length === 0) return null;

  const scrollByPage = (direction: -1 | 1) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({
      left: direction * Math.max(260, el.clientWidth * 0.72),
      behavior: "smooth",
    });
  };

  return (
    <section className="mod-detail-section mod-detail-gallery-section">
      <div className="mod-detail-section-header">
        <span className="mod-detail-section-title">
          <Icon name="image" />
          {_i18n.t("预览截图")}
        </span>
        <span className="mod-detail-section-count">{screenshots.length}</span>
      </div>
      <div className="mod-detail-gallery-wrap">
        {scrollState.left && (
          <button
            type="button"
            className="mod-detail-gallery-arrow prev"
            aria-label={_i18n.t("上一张")}
            onClick={() => scrollByPage(-1)}
          >
            <Icon name="i-left" />
          </button>
        )}
        <div
          ref={trackRef}
          className="mod-detail-gallery"
          onScroll={updateScrollButtons}
        >
          {screenshots.map((shot, idx) => (
            <button
              type="button"
              key={`${shot.id ?? shot.url}-${idx}`}
              className="mod-detail-shot"
              onClick={() => openModImageLightbox(screenshots, idx)}
            >
              <img
                src={withThumbHeight(shot.url, 300)}
                alt={shot.caption || ""}
                loading="lazy"
                decoding="async"
              />
              <span className="mod-detail-shot-zoom" aria-hidden="true">
                <Icon name="expand" />
              </span>
              {shot.caption && (
                <span className="mod-detail-shot-caption">{shot.caption}</span>
              )}
            </button>
          ))}
        </div>
        {scrollState.right && (
          <button
            type="button"
            className="mod-detail-gallery-arrow next"
            aria-label={_i18n.t("下一张")}
            onClick={() => scrollByPage(1)}
          >
            <Icon name="i-right" />
          </button>
        )}
      </div>
    </section>
  );
};

const ModDescriptionHtml = ({ html }: { html: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = "";
    el.appendChild(sanitizeDescriptionHtml(html));

    for (const anchor of Array.from(el.querySelectorAll("a"))) {
      const href = anchor.getAttribute("href");
      if (!href) continue;
      anchor.setAttribute("href", "#");
      anchor.setAttribute("title", href);
      anchor.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void callRemote("open_url", href);
      });
    }

    const inlineImages = Array.from(el.querySelectorAll("img"));
    const inlineShots: ModDetailScreenshot[] = inlineImages
      .map((img) => ({
        url: img.getAttribute("src") || "",
        caption: img.getAttribute("alt") || img.getAttribute("title") || null,
      }))
      .filter((item) => Boolean(item.url));

    inlineImages.forEach((img) => {
      img.setAttribute("loading", "lazy");
      img.setAttribute("decoding", "async");
      const src = img.getAttribute("src") || "";
      const shotIndex = inlineShots.findIndex((item) => item.url === src);
      if (shotIndex >= 0) {
        img.classList.add("is-zoomable");
        img.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openModImageLightbox(inlineShots, shotIndex);
        });
      }
    });

    for (const spoiler of Array.from(el.querySelectorAll(".Spoiler"))) {
      spoiler.addEventListener("click", () => {
        spoiler.classList.toggle("is-revealed");
      });
    }
  }, [html]);

  return <div ref={containerRef} className="mod-detail-prose ui-fade-enter" />;
};

const DescriptionSkeleton = () => (
  <div
    className="mod-detail-skeleton ui-fade-enter"
    role="status"
    aria-label={_i18n.t("加载中")}
  >
    <span className="sr-only">{_i18n.t("加载中")}</span>
    <span className="detail-skel-line w-36" />
    <span className="detail-skel-line w-92" />
    <span className="detail-skel-line w-84" />
    <span className="detail-skel-line w-68" />
    <span className="detail-skel-line w-76" />
  </div>
);

const ModCreditsPanel = ({ groups }: { groups: NormalizedCreditGroup[] }) => {
  if (groups.length === 0) return null;
  return (
    <div className="mod-detail-credits-grid ui-fade-enter">
      {groups.map((group) => (
        <div className="mod-detail-credit-group" key={group.groupName}>
          <h4>{group.groupName}</h4>
          <div className="mod-detail-credit-list">
            {group.authors.map((author, idx) => {
              const clickable = Boolean(
                author.url && /^https?:\/\//i.test(author.url),
              );
              return clickable ? (
                <button
                  type="button"
                  key={`${author.name}-${idx}`}
                  className="mod-detail-credit-card clickable"
                  onClick={() => void callRemote("open_url", author.url!)}
                  title={author.url}
                >
                  <span className="credit-name">{author.name}</span>
                  {author.role && (
                    <span className="credit-role">{author.role}</span>
                  )}
                  <Icon name="external" />
                </button>
              ) : (
                <div
                  key={`${author.name}-${idx}`}
                  className="mod-detail-credit-card"
                >
                  <span className="credit-name">{author.name}</span>
                  {author.role && (
                    <span className="credit-role">{author.role}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

interface MetricItem {
  key: string;
  icon: string;
  label: string;
  value: string;
  title?: string;
}

const MetricsStrip = ({ items }: { items: MetricItem[] }) => {
  if (items.length === 0) return null;
  return (
    <div className="mod-detail-metrics">
      {items.map((item) => (
        <div
          className="mod-detail-metric"
          key={item.key}
          title={item.title ?? item.value}
        >
          <span className="metric-label">
            <Icon name={item.icon} />
            {item.label}
          </span>
          <strong className="metric-value">{item.value}</strong>
        </div>
      ))}
    </div>
  );
};

interface DetailShellProps {
  title: string;
  compactHeaderTitle?: string;
  coverUrl?: string | null;
  kicker?: ReactNode;
  backButton?: { label: string; onClick: () => void };
  externalLinks: ReturnType<typeof resolveExternalLinks>;
  onRightClickPrimaryExternal?: () => void;
  hero: ReactNode;
  metrics: MetricItem[];
  tabs: {
    id: string;
    label: string;
    icon: string;
    count?: number;
    alertTone?: "warning" | "danger";
  }[];
  activeTab: string;
  onTabChange: (id: string) => void;
  children: ReactNode;
  bodyRef?: React.RefObject<HTMLDivElement>;
}

const ModDetailShell = ({
  title,
  compactHeaderTitle,
  coverUrl,
  kicker,
  backButton,
  externalLinks,
  onRightClickPrimaryExternal,
  hero,
  metrics,
  tabs,
  activeTab,
  onTabChange,
  children,
  bodyRef: externalBodyRef,
}: DetailShellProps) => {
  const popup = useContext(PopupContext);
  const dialogRef = useRef<HTMLDivElement>(null);
  const internalBodyRef = useRef<HTMLDivElement>(null);
  const bodyRef = externalBodyRef ?? internalBodyRef;
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!isTopmostPopup(dialogRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
      popup.hide();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [popup]);

  const handleScroll = useCallback(() => {
    const scrollTop = bodyRef.current?.scrollTop ?? 0;
    setScrolled(scrollTop > 76);
  }, [bodyRef]);

  return (
    <div
      ref={dialogRef}
      className="mod-detail-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => event.stopPropagation()}
    >
      <div ref={bodyRef} className="mod-detail-body" onScroll={handleScroll}>
        <header
          className={`mod-detail-topbar ${scrolled ? "is-scrolled" : ""}`}
        >
          <div className="mod-detail-topbar-left">
            {backButton && (
              <button
                type="button"
                className="mod-detail-icon-btn mod-detail-back-btn"
                onClick={backButton.onClick}
                title={backButton.label}
                aria-label={backButton.label}
              >
                <Icon name="i-left" />
              </button>
            )}
            <div className="mod-detail-topbar-title-wrap">
              {kicker && (
                <span className="mod-detail-topbar-kicker">{kicker}</span>
              )}
              <strong
                className={`mod-detail-topbar-title ${scrolled ? "is-visible" : ""}`}
                title={compactHeaderTitle ?? title}
              >
                {compactHeaderTitle ?? title}
              </strong>
            </div>
          </div>

          <div className="mod-detail-topbar-right">
            {externalLinks.map((link, idx) => (
              <button
                key={link.source}
                type="button"
                className={`mod-detail-link-btn ${idx === 0 ? "primary-link" : "secondary-link"}`}
                onClick={() => void callRemote("open_url", link.url)}
                onContextMenu={
                  idx === 0 && onRightClickPrimaryExternal
                    ? (event) => {
                        event.preventDefault();
                        onRightClickPrimaryExternal();
                      }
                    : undefined
                }
                title={
                  idx === 0 && externalLinks.length > 1
                    ? `${link.label} (${_i18n.t("左键打开所选来源，右键打开另一个来源")})`
                    : link.label
                }
              >
                <Icon name="external" />
                <span>{link.label}</span>
              </button>
            ))}
            <button
              type="button"
              className="mod-detail-icon-btn mod-detail-close-btn"
              onClick={() => popup.hide()}
              title={`${_i18n.t("关闭")} (Esc)`}
              aria-label={_i18n.t("关闭")}
            >
              <Icon name="i-cross" />
            </button>
          </div>
        </header>

        <div className="mod-detail-hero-surface">
          <div className="mod-detail-cover-bg" aria-hidden="true">
            {coverUrl && (
              <img
                src={withThumbHeight(coverUrl, 360)}
                alt=""
                decoding="async"
              />
            )}
            <div className="mod-detail-cover-fade" />
          </div>

          <div className="mod-detail-hero-inner">
            {hero}
            <MetricsStrip items={metrics} />
          </div>
        </div>

        {tabs.length > 1 && (
          <nav className="mod-detail-tabs" role="tablist">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`mod-detail-tab ${activeTab === tab.id ? "active" : ""}`}
                onClick={() => onTabChange(tab.id)}
              >
                <Icon name={tab.icon} />
                <span>{tab.label}</span>
                {typeof tab.count === "number" && tab.count > 0 && (
                  <span className="mod-detail-tab-count">{tab.count}</span>
                )}
                {tab.alertTone && (
                  <span
                    className={`mod-detail-tab-dot tone-${tab.alertTone}`}
                    aria-hidden="true"
                  />
                )}
              </button>
            ))}
          </nav>
        )}

        <div className="mod-detail-content">{children}</div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/*                             Search Mod Detail                              */
/* -------------------------------------------------------------------------- */

export interface OpenSearchModDetailOptions {
  name: string;
  author: string;
  category?: string;
  subCategory?: string | null;
  subtitle?: string;
  previewUrl?: string;
  isInstalled: boolean;
  downloadKey: string;
  stats?: {
    likes?: number;
    views?: number;
    downloads?: number;
    sizeBytes?: number;
  };
  dates?: {
    published?: Date | string;
    updated?: Date | string;
  };
  loadDetail: () => Promise<ModDetailPayload>;
  loadFiles: () => Awaitable<string | ModDetailFileEntry[]>;
  onDownloadFile: (name: string, fileSource: string) => void;
  cloudLookup?: {
    submissionId?: string;
    gameBananaId?: number | null;
    searchName?: string;
  };
}

const SearchModDetailContent = (props: OpenSearchModDetailOptions) => {
  const modPageSource = useAppStore((state) => state.modPageSource);
  const [autoDisableNewMods] = useAutoDisableNewMods();
  const downloadMod = useDownloadStore((state) => state.downloadMod);
  const downloadTask = useDownloadStore(
    (state) =>
      Object.values(state.tasks).find(
        (task) => task.ownerId === props.downloadKey,
      ) ?? state.tasks[props.name],
  );

  const [detail, setDetail] = useState<ModDetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [cloudSupplement, setCloudSupplement] = useState<Content | null>(null);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudError, setCloudError] = useState(false);
  const [cloudRetryKey, setCloudRetryKey] = useState(0);

  const [files, setFiles] = useState<ModDetailFileEntry[] | null>(null);
  const [singleFileSource, setSingleFileSource] = useState<string | null>(null);
  const [filesLoading, setFilesLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "files" | "credits">(
    "overview",
  );
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setDetailLoading(true);
    props
      .loadDetail()
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.loadDetail]);

  useEffect(() => {
    let cancelled = false;
    setFilesLoading(true);
    Promise.resolve(props.loadFiles())
      .then((result) => {
        if (cancelled) return;
        if (typeof result === "string") {
          setSingleFileSource(result);
          setFiles([]);
        } else {
          setSingleFileSource(null);
          setFiles(result);
        }
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setFiles([]);
      })
      .finally(() => {
        if (!cancelled) setFilesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.loadFiles]);

  // If the search item came from the local catalog (no description / screenshots),
  // enrich it from the cloud mirror automatically.
  const needsCloudEnrichment = Boolean(
    !detailLoading &&
    detail &&
    !detail.description?.trim() &&
    !(detail.screenshots?.length || detail.images?.length) &&
    (props.cloudLookup?.searchName || props.name),
  );

  useEffect(() => {
    if (!needsCloudEnrichment) return;
    let cancelled = false;
    setCloudLoading(true);
    setCloudError(false);
    const searchName = props.cloudLookup?.searchName || props.name;
    searchSubmission({
      search: searchName,
      size: 12,
      includeExclusiveSubmissions: currentMirror() === "wegfan",
    })
      .then((result) => {
        if (cancelled) return;
        const matched = matchCloudSubmission(result.content, {
          submissionId:
            detail?.submissionId ?? props.cloudLookup?.submissionId ?? null,
          gameBananaId:
            detail?.gameBananaId ?? props.cloudLookup?.gameBananaId ?? null,
          submissionName: searchName,
        });
        setCloudSupplement(matched);
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setCloudError(true);
      })
      .finally(() => {
        if (!cancelled) setCloudLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    cloudRetryKey,
    detail?.gameBananaId,
    detail?.submissionId,
    needsCloudEnrichment,
    props.cloudLookup?.gameBananaId,
    props.cloudLookup?.searchName,
    props.cloudLookup?.submissionId,
    props.name,
  ]);

  const screenshots = useMemo<ModDetailScreenshot[]>(() => {
    if (detail?.screenshots && detail.screenshots.length > 0) {
      return detail.screenshots;
    }
    if (detail?.images && detail.images.length > 0) {
      return detail.images.map((url) => ({ url }));
    }
    if (cloudSupplement?.screenshots?.length) {
      return cloudSupplement.screenshots.map((shot) => ({
        id: shot.id,
        url: shot.url,
        caption: shot.caption,
      }));
    }
    return [];
  }, [cloudSupplement, detail]);

  const descriptionHtml =
    detail?.description?.trim() || cloudSupplement?.description?.trim() || "";
  const subtitle =
    props.subtitle?.trim() ||
    detail?.subtitle?.trim() ||
    cloudSupplement?.subtitle?.trim() ||
    "";
  const subCategory =
    props.subCategory ||
    detail?.subCategory ||
    cloudSupplement?.subCategoryName ||
    null;

  const creditGroups = useMemo(
    () =>
      normalizeCredits(
        detail?.credits?.length ? detail.credits : cloudSupplement?.credits,
        detail?.authors,
        _i18n.t("制作人员"),
      ),
    [cloudSupplement?.credits, detail?.authors, detail?.credits],
  );
  const totalCredits = useMemo(
    () => creditGroups.reduce((sum, g) => sum + g.authors.length, 0),
    [creditGroups],
  );

  const externalLinks = useMemo(
    () =>
      resolveExternalLinks(
        {
          submissionId: detail?.submissionId ?? cloudSupplement?.id,
          gameBananaUrl: detail?.externalUrl ?? cloudSupplement?.pageUrl,
        },
        modPageSource,
      ),
    [
      cloudSupplement?.id,
      cloudSupplement?.pageUrl,
      detail?.externalUrl,
      detail?.submissionId,
      modPageSource,
    ],
  );

  const downloadActive =
    downloadTask?.state === "pending" && !downloadTask.canceled;
  const downloadFailed =
    Boolean(downloadTask) &&
    (downloadTask?.state === "failed" || Boolean(downloadTask?.canceled));
  const downloadDone =
    props.isInstalled ||
    (Boolean(downloadTask) && !downloadActive && !downloadFailed);
  const downloadProgress = Math.max(
    0,
    Math.min(100, Math.round(Number(downloadTask?.progress ?? 0))),
  );

  const triggerPrimaryDownload = () => {
    if (downloadActive || downloadDone) return;
    if (downloadTask?.state === "failed" && downloadTask.source) {
      downloadMod(downloadTask.name, downloadTask.source, {
        force: true,
        autoDisableNewMods,
        ownerId: props.downloadKey,
      });
      return;
    }
    if (singleFileSource) {
      props.onDownloadFile(props.name, singleFileSource);
      return;
    }
    if (files && files.length === 1) {
      const [file] = files;
      props.onDownloadFile(
        file.name,
        parseInt(file.id) === -1 ? file.url : file.id,
      );
      return;
    }
    if (files && files.length > 1) {
      setActiveTab("files");
    }
  };

  const likes = cloudSupplement?.likes ?? props.stats?.likes ?? 0;
  const views = cloudSupplement?.views ?? props.stats?.views ?? 0;
  const downloads =
    (props.stats?.downloads && props.stats.downloads > 0
      ? props.stats.downloads
      : cloudSupplement?.downloads) ?? 0;
  const sizeBytes = detail?.catalogSize ?? props.stats?.sizeBytes;
  const updatedText = formatDetailDate(
    detail?.lastUpdate ?? props.dates?.updated ?? cloudSupplement?.updateTime,
  );
  const publishedText = formatDetailDate(
    props.dates?.published ?? cloudSupplement?.createTime,
  );

  const metrics = useMemo<MetricItem[]>(() => {
    const list: MetricItem[] = [];
    if (downloads > 0) {
      list.push({
        key: "downloads",
        icon: "download",
        label: _i18n.t("下载次数"),
        value: formatCompactNumber(downloads),
        title: downloads.toLocaleString(),
      });
    }
    if (likes > 0) {
      list.push({
        key: "likes",
        icon: "heart",
        label: _i18n.t("点赞"),
        value: formatCompactNumber(likes),
        title: likes.toLocaleString(),
      });
    }
    if (views > 0) {
      list.push({
        key: "views",
        icon: "eye",
        label: _i18n.t("浏览"),
        value: formatCompactNumber(views),
        title: views.toLocaleString(),
      });
    }
    if (sizeBytes && sizeBytes > 0 && list.length < 4) {
      list.push({
        key: "size",
        icon: "drive",
        label: _i18n.t("文件大小"),
        value: formatDetailSize(sizeBytes),
      });
    }
    if (updatedText && list.length < 4) {
      list.push({
        key: "updated",
        icon: "clock",
        label: _i18n.t("更新时间"),
        value: updatedText,
      });
    } else if (publishedText && list.length < 4) {
      list.push({
        key: "published",
        icon: "calendar",
        label: _i18n.t("发布时间"),
        value: publishedText,
      });
    }
    return list;
  }, [downloads, likes, publishedText, sizeBytes, updatedText, views]);

  const coverUrl =
    screenshots[0]?.url ||
    (props.previewUrl && /^https?:\/\//i.test(props.previewUrl)
      ? props.previewUrl
      : null);

  const hasMultipleFiles = Boolean(files && files.length > 1);
  const hasAnyFiles = Boolean(files && files.length > 0);

  const tabs = useMemo(() => {
    const list: DetailShellProps["tabs"] = [
      { id: "overview", label: _i18n.t("详情"), icon: "info" },
    ];
    if (hasAnyFiles) {
      list.push({
        id: "files",
        label: _i18n.t("文件"),
        icon: "file",
        count: files?.length ?? 0,
      });
    }
    if (creditGroups.length > 0) {
      list.push({
        id: "credits",
        label: _i18n.t("制作人员"),
        icon: "users",
        count: totalCredits,
      });
    }
    return list;
  }, [creditGroups.length, files?.length, hasAnyFiles, totalCredits]);

  return (
    <ModDetailShell
      title={props.name}
      coverUrl={coverUrl}
      kicker={props.category}
      externalLinks={externalLinks}
      onRightClickPrimaryExternal={
        externalLinks[1]
          ? () => void callRemote("open_url", externalLinks[1].url)
          : undefined
      }
      bodyRef={bodyRef}
      metrics={metrics}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as "overview" | "files" | "credits")}
      hero={
        <div className="mod-detail-hero">
          {coverUrl && (
            <button
              type="button"
              className="mod-detail-thumb"
              onClick={() =>
                openModImageLightbox(
                  screenshots.length > 0 ? screenshots : [{ url: coverUrl }],
                  0,
                )
              }
              title={_i18n.t("查看大图")}
            >
              <img src={withThumbHeight(coverUrl, 220)} alt="" />
            </button>
          )}
          <div className="mod-detail-hero-copy">
            <div className="mod-detail-badges">
              {props.category && (
                <span className="detail-pill tone-neutral">
                  {props.category}
                </span>
              )}
              {subCategory && (
                <span className="detail-pill tone-subtle">{subCategory}</span>
              )}
              {downloadDone && (
                <span className="detail-pill tone-success">
                  <Icon name="i-tick" />
                  {_i18n.t("已安装")}
                </span>
              )}
            </div>
            <h2 className="mod-detail-title">{props.name}</h2>
            {subtitle && <p className="mod-detail-subtitle">{subtitle}</p>}
            <div className="mod-detail-byline">
              {props.author && (
                <span className="byline-author">{props.author}</span>
              )}
              {publishedText && (
                <span className="byline-meta">
                  <Icon name="calendar" />
                  {_i18n.t("发布")} {publishedText}
                </span>
              )}
              {updatedText && (
                <span className="byline-meta">
                  <Icon name="clock" />
                  {_i18n.t("更新")} {updatedText}
                </span>
              )}
            </div>

            <div className="mod-detail-actions">
              <button
                type="button"
                className={`detail-action-btn ${
                  downloadDone
                    ? "is-installed"
                    : downloadFailed
                      ? "is-danger"
                      : "is-primary"
                }`}
                disabled={
                  downloadActive ||
                  filesLoading ||
                  (!singleFileSource && (!files || files.length === 0))
                }
                onClick={triggerPrimaryDownload}
              >
                {downloadActive ? (
                  <>
                    <ProgressIndicator infinite size={14} lineWidth={2} />
                    <span>
                      {_i18n.t("正在下载")} {downloadProgress}%
                    </span>
                  </>
                ) : downloadDone ? (
                  <>
                    <Icon name="i-tick" />
                    <span>{_i18n.t("已安装")}</span>
                  </>
                ) : downloadFailed ? (
                  <>
                    <Icon name="replay" />
                    <span>{_i18n.t("重试")}</span>
                  </>
                ) : hasMultipleFiles ? (
                  <>
                    <Icon name="download" />
                    <span>
                      {_i18n.t("选择文件下载")} ({files?.length})
                    </span>
                  </>
                ) : (
                  <>
                    <Icon name="download" />
                    <span>{_i18n.t("下载")}</span>
                  </>
                )}
              </button>

              {hasMultipleFiles && (
                <button
                  type="button"
                  className="detail-action-btn"
                  onClick={() => setActiveTab("files")}
                >
                  <Icon name="file" />
                  <span>
                    {_i18n.t("查看全部文件")} ({files?.length})
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      }
    >
      {activeTab === "overview" && (
        <div className="mod-detail-tab-panel ui-fade-enter">
          <ModScreenshotGallery screenshots={screenshots} />

          <section className="mod-detail-section">
            <div className="mod-detail-section-header">
              <span className="mod-detail-section-title">
                <Icon name="info" />
                {_i18n.t("模组介绍")}
              </span>
            </div>

            {detailLoading || cloudLoading ? (
              <DescriptionSkeleton />
            ) : descriptionHtml ? (
              <ModDescriptionHtml html={descriptionHtml} />
            ) : cloudError ? (
              <div className="mod-detail-notice is-warning">
                <Icon name="warn" />
                <span>{_i18n.t("云端详情加载失败")}</span>
                <button
                  type="button"
                  onClick={() => setCloudRetryKey((v) => v + 1)}
                >
                  <Icon name="replay" />
                  {_i18n.t("重试")}
                </button>
              </div>
            ) : (
              <div className="mod-detail-notice">
                <Icon name="info" />
                <span>{_i18n.t("暂无详细文字介绍")}</span>
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === "files" && (
        <div className="mod-detail-tab-panel ui-fade-enter">
          {filesLoading ? (
            <DescriptionSkeleton />
          ) : !files || files.length === 0 ? (
            <div className="mod-detail-notice">
              <Icon name="file" />
              <span>{_i18n.t("文件列表为空")}</span>
            </div>
          ) : (
            <div className="mod-detail-file-list">
              {files.map((file) => (
                <div
                  key={`${file.id}-${file.name}`}
                  className={`mod-detail-file-card ${
                    file.isPrimary ? "is-primary" : ""
                  } ${file.isInstalled ? "is-installed" : ""}`}
                >
                  <span className="file-card-icon">
                    <Icon name={file.isInstalled ? "i-tick" : "file"} />
                  </span>
                  <div className="file-card-body">
                    <div className="file-card-title-row">
                      <strong title={file.name}>{file.name}</strong>
                      {file.isPrimary && (
                        <span className="detail-pill tone-primary">
                          {_i18n.t("推荐")}
                        </span>
                      )}
                      {file.isInstalled && (
                        <span className="detail-pill tone-success">
                          <Icon name="i-tick" />
                          {_i18n.t("已安装")}
                        </span>
                      )}
                    </div>
                    {file.description &&
                      file.description.trim() &&
                      file.description.trim() !== file.name.trim() && (
                        <div className="file-card-desc">{file.description}</div>
                      )}
                    <div className="file-card-meta">
                      <span>{file.size}</span>
                      {typeof file.downloads === "number" &&
                        file.downloads > 0 && (
                          <span>
                            <Icon name="download" />
                            {formatCompactNumber(file.downloads)}
                          </span>
                        )}
                      {file.id !== "-1" && (
                        <span className="file-card-id">#{file.id}</span>
                      )}
                      {file.mods && file.mods.length > 0 && (
                        <span className="file-card-mods">
                          {file.mods
                            .slice(0, 3)
                            .map((m) => `${m.name} v${m.version}`)
                            .join(" · ")}
                          {file.mods.length > 3
                            ? ` +${file.mods.length - 3}`
                            : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`file-card-download ${
                      file.isPrimary ? "is-primary" : ""
                    }`}
                    onClick={() =>
                      props.onDownloadFile(
                        file.name,
                        parseInt(file.id) === -1 ? file.url : file.id,
                      )
                    }
                  >
                    <Icon name="download" />
                    <span>
                      {file.isInstalled ? _i18n.t("重新下载") : _i18n.t("下载")}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "credits" && (
        <div className="mod-detail-tab-panel ui-fade-enter">
          <ModCreditsPanel groups={creditGroups} />
        </div>
      )}
    </ModDetailShell>
  );
};

export const openSearchModDetail = (options: OpenSearchModDetailOptions) =>
  createPopup(() => <SearchModDetailContent {...options} />, {
    className: "mod-detail-overlay",
    backgroundMask: "rgba(8, 9, 12, 0.64)",
  });

/* -------------------------------------------------------------------------- */
/*                             Manage Mod Detail                              */
/* -------------------------------------------------------------------------- */

export interface OpenManageModDetailOptions {
  modName: string;
  getCatalogMod: (name: string) => CatalogMod | undefined;
  modPath: string;
  currentEverestVersion: string;
  checkOptional: boolean;
  autoUseSubmissionNameAsComment: boolean;
  getUpdateInfo: (name: string) => {
    hasUpdate: boolean;
    version?: string;
    state?: string;
  };
  actions: {
    switchNodes: (
      names: string | string[],
      enabled: boolean,
      recursive?: boolean,
    ) => void;
    updateNode: (name: string) => Promise<boolean>;
    downloadMissing: (name: string) => Promise<boolean>;
    toggleAlwaysOn: (name: string) => void;
    showDuplicates: (name: string) => void;
    deleteNode: (name: string) => void;
    setComment: (name: string, comment: string) => void;
  };
}

const ManageModDetailContent = (props: OpenManageModDetailOptions) => {
  const popup = useContext(PopupContext);
  const [history, setHistory] = useState<string[]>([props.modName]);
  const activeName = history[history.length - 1] ?? props.modName;

  const nodes = useManageStore((state) => state.nodes);
  const node: ManageNode | undefined = nodes[activeName];
  const alwaysOnMods = useAppStore((state) => state.alwaysOnMods);
  const comments = useAppStore((state) => state.modComments);
  const modPageSource = useAppStore((state) => state.modPageSource);

  const catalogMod = props.getCatalogMod(activeName);
  const [cloud, setCloud] = useState<Content | null>(null);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudError, setCloudError] = useState(false);
  const [cloudRetryKey, setCloudRetryKey] = useState(0);

  const [activeTab, setActiveTab] = useState<
    "overview" | "dependencies" | "local" | "credits"
  >("overview");
  const [updating, setUpdating] = useState(false);
  const [downloadingDeps, setDownloadingDeps] = useState<
    Record<string, "loading" | "done" | "failed">
  >({});
  const [copiedKey, setCopiedKey] = useState<string>("");
  const [editingRemark, setEditingRemark] = useState(false);
  const [remarkDraft, setRemarkDraft] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  const navigateToMod = useCallback(
    (targetName: string) => {
      if (!targetName || targetName === activeName) return;
      setHistory((prev) => [...prev, targetName]);
      setActiveTab("overview");
      setEditingRemark(false);
      bodyRef.current?.scrollTo({ top: 0, behavior: "instant" });
    },
    [activeName],
  );

  const navigateBack = useCallback(() => {
    setHistory((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
    setActiveTab("overview");
    setEditingRemark(false);
    bodyRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  useEffect(() => {
    setCloud(null);
    setCloudError(false);
    const submission = catalogMod?.submissionFile.submission;
    const searchName = submission?.name || node?.meta?.submissionName;
    if (!searchName) {
      setCloudLoading(false);
      return;
    }

    let cancelled = false;
    setCloudLoading(true);
    searchSubmission({
      search: searchName,
      size: 12,
      includeExclusiveSubmissions: currentMirror() === "wegfan",
    })
      .then((result) => {
        if (cancelled) return;
        const matched = matchCloudSubmission(result.content, {
          submissionId: submission?.id ?? node?.meta?.submissionId ?? null,
          gameBananaId:
            submission?.gameBananaId ?? node?.meta?.gameBananaId ?? null,
          submissionName: searchName,
        });
        setCloud(matched);
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setCloudError(true);
      })
      .finally(() => {
        if (!cancelled) setCloudLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeName,
    catalogMod?.submissionFile.submission,
    cloudRetryKey,
    node?.meta?.gameBananaId,
    node?.meta?.submissionId,
    node?.meta?.submissionName,
  ]);

  if (!node) {
    return (
      <div className="mod-detail-dialog mod-detail-missing-node">
        <div className="mod-detail-notice">
          <Icon name="info" />
          <span>{_i18n.t("该 Mod 已不存在")}</span>
          <button type="button" onClick={() => popup.hide()}>
            {_i18n.t("关闭")}
          </button>
        </div>
      </div>
    );
  }

  const meta = node.meta;
  const isAlwaysOn = isAlwaysOnPackage(node.name, nodes, alwaysOnMods);
  const displayNames = resolveManageDisplayNames(
    node.name,
    comments[node.name],
    meta?.submissionName,
    props.autoUseSubmissionNameAsComment,
  );
  const title =
    meta?.submissionName?.trim() || displayNames.primaryName || node.name;
  const health = getDependencyHealth(
    node.name,
    nodes,
    props.checkOptional,
    props.currentEverestVersion,
  );
  const updateInfo = props.getUpdateInfo(node.name);
  const screenshots: ModDetailScreenshot[] =
    cloud?.screenshots?.map((shot) => ({
      id: shot.id,
      url: shot.url,
      caption: shot.caption,
    })) ?? [];

  const creditGroups = normalizeCredits(
    cloud?.credits,
    null,
    _i18n.t("制作人员"),
  );
  const totalCredits = creditGroups.reduce(
    (sum, group) => sum + group.authors.length,
    0,
  );

  const externalLinks = resolveExternalLinks(
    {
      submissionId: meta?.submissionId ?? cloud?.id,
      gameBananaUrl: meta?.pageUrl ?? cloud?.pageUrl,
    },
    modPageSource,
  );

  const requiredDeps = node.dependencies.filter((dep) => !dep.optional);
  const optionalDeps = node.dependencies.filter((dep) => dep.optional);
  const depTotalCount = node.dependencies.length + node.dependedBy.length;
  const hasDuplicates = node.duplicateFiles.length > 1;
  const unresolvedDuplicates =
    hasDuplicates &&
    node.duplicateFiles.filter((file) => file.enabled).length !== 1;

  const updatedText = formatDetailDate(
    cloud?.latestUpdateAddedTime ?? cloud?.updateTime ?? meta?.updatedAt,
  );
  const modifiedText = formatDetailDate(node.modifiedAt, true);
  const latestCatalogVersion =
    updateInfo.version || catalogMod?.version || undefined;

  const metrics: MetricItem[] = [
    {
      key: "author",
      icon: "users",
      label: _i18n.t("作者"),
      value: meta?.submitter || cloud?.submitter || "--",
    },
    {
      key: "category",
      icon: "grid",
      label: _i18n.t("类型"),
      value:
        [meta?.category, meta?.subCategory].filter(Boolean).join(" · ") ||
        _i18n.t("本地 Mod"),
    },
    meta?.downloads || cloud?.downloads
      ? {
          key: "downloads",
          icon: "download",
          label: _i18n.t("下载次数"),
          value: formatCompactNumber(meta?.downloads || cloud?.downloads || 0),
          title: (meta?.downloads || cloud?.downloads || 0).toLocaleString(),
        }
      : {
          key: "version",
          icon: "info",
          label: _i18n.t("当前版本"),
          value: `v${node.version}`,
        },
    {
      key: "size",
      icon: "drive",
      label: _i18n.t("文件大小"),
      value: formatDetailSize(node.size || meta?.catalogSize),
    },
  ];

  const tabs: DetailShellProps["tabs"] = [
    { id: "overview", label: _i18n.t("概览"), icon: "info" },
    {
      id: "dependencies",
      label: _i18n.t("依赖"),
      icon: "branch",
      count: depTotalCount,
      alertTone:
        health.status === "missing"
          ? "danger"
          : health.status === "disabled" || health.status === "version"
            ? "warning"
            : undefined,
    },
    {
      id: "local",
      label: _i18n.t("本地信息"),
      icon: "file",
      alertTone: unresolvedDuplicates ? "warning" : undefined,
    },
  ];
  if (creditGroups.length > 0) {
    tabs.push({
      id: "credits",
      label: _i18n.t("制作人员"),
      icon: "users",
      count: totalCredits,
    });
  }

  const copyText = (value: string, key: string) => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(""), 1200);
    });
  };

  const handleDownloadDep = (depName: string) => {
    setDownloadingDeps((prev) => ({ ...prev, [depName]: "loading" }));
    void props.actions
      .downloadMissing(depName)
      .then((ok) => {
        setDownloadingDeps((prev) => ({
          ...prev,
          [depName]: ok ? "done" : "failed",
        }));
      })
      .catch(() => {
        setDownloadingDeps((prev) => ({ ...prev, [depName]: "failed" }));
      });
  };

  const renderDependencyRow = (dep: {
    name: string;
    version: string;
    optional: boolean;
  }) => {
    const depNode = nodes[dep.name];
    const dlState = downloadingDeps[dep.name];
    const isInstalled = Boolean(depNode);
    const isEnabled = Boolean(depNode?.enabled);

    return (
      <div
        key={`${dep.optional ? "opt" : "req"}-${dep.name}`}
        className={`mod-detail-dep-row ${
          !isInstalled
            ? dep.optional
              ? "is-optional-missing"
              : "is-missing"
            : !isEnabled
              ? "is-disabled"
              : "is-healthy"
        }`}
      >
        <div
          className={`dep-row-main ${isInstalled ? "clickable" : ""}`}
          onClick={isInstalled ? () => navigateToMod(dep.name) : undefined}
        >
          <div className="dep-row-title">
            <strong>{dep.name}</strong>
            <span className="dep-req-version">≥ {dep.version}</span>
            {depNode && (
              <span className="dep-cur-version">v{depNode.version}</span>
            )}
          </div>
          <div className="dep-row-badges">
            {dep.optional && (
              <span className="detail-pill tone-subtle">
                {_i18n.t("可选依赖")}
              </span>
            )}
            {!isInstalled ? (
              <span
                className={`detail-pill ${
                  dep.optional ? "tone-warning" : "tone-danger"
                }`}
              >
                {_i18n.t("未安装")}
              </span>
            ) : !isEnabled ? (
              <span className="detail-pill tone-warning">
                {_i18n.t("已禁用")}
              </span>
            ) : (
              <span className="detail-pill tone-success">
                <Icon name="i-tick" />
                {_i18n.t("已启用")}
              </span>
            )}
          </div>
        </div>

        <div className="dep-row-actions">
          {!isInstalled ? (
            <button
              type="button"
              className="dep-mini-btn is-danger"
              disabled={dlState === "loading"}
              onClick={() => handleDownloadDep(dep.name)}
            >
              <Icon name="download" />
              <span>
                {dlState === "loading"
                  ? _i18n.t("下载中…")
                  : dlState === "failed"
                    ? _i18n.t("重试")
                    : _i18n.t("下载")}
              </span>
            </button>
          ) : !isEnabled ? (
            <button
              type="button"
              className="dep-mini-btn"
              onClick={() => props.actions.switchNodes(dep.name, true, false)}
            >
              <Icon name="play" />
              <span>{_i18n.t("启用")}</span>
            </button>
          ) : (
            <button
              type="button"
              className="dep-mini-btn is-ghost"
              onClick={() => navigateToMod(dep.name)}
              title={_i18n.t("查看详情")}
            >
              <Icon name="i-right" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <ModDetailShell
      title={title}
      compactHeaderTitle={title}
      coverUrl={screenshots[0]?.url ?? null}
      kicker={meta?.category || _i18n.t("本地 Mod")}
      backButton={
        history.length > 1
          ? {
              label: `${_i18n.t("返回")} ${history[history.length - 2]}`,
              onClick: navigateBack,
            }
          : undefined
      }
      externalLinks={externalLinks}
      onRightClickPrimaryExternal={
        externalLinks[1]
          ? () => void callRemote("open_url", externalLinks[1].url)
          : undefined
      }
      bodyRef={bodyRef}
      metrics={metrics}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(id) =>
        setActiveTab(id as "overview" | "dependencies" | "local" | "credits")
      }
      hero={
        <div className="mod-detail-hero">
          {screenshots[0]?.url && (
            <button
              type="button"
              className="mod-detail-thumb"
              onClick={() => openModImageLightbox(screenshots, 0)}
              title={_i18n.t("查看大图")}
            >
              <img src={withThumbHeight(screenshots[0].url, 220)} alt="" />
            </button>
          )}
          <div className="mod-detail-hero-copy">
            <div className="mod-detail-badges">
              {isAlwaysOn ? (
                <span className="detail-pill tone-info">
                  <Icon name="i-asterisk" />
                  {_i18n.t("始终开启")}
                </span>
              ) : node.enabled ? (
                <span className="detail-pill tone-success">
                  <Icon name="i-tick" />
                  {_i18n.t("已启用")}
                </span>
              ) : (
                <span className="detail-pill tone-subtle">
                  {_i18n.t("已禁用")}
                </span>
              )}
              {meta?.category && (
                <span className="detail-pill tone-neutral">
                  {meta.category}
                </span>
              )}
              {node.isDirectory && (
                <span className="detail-pill tone-info">
                  {_i18n.t("文件夹")}
                </span>
              )}
              {updateInfo.hasUpdate && updateInfo.version && (
                <span className="detail-pill tone-warning">
                  {_i18n.t("更新到 {version}", { version: updateInfo.version })}
                </span>
              )}
              {hasDuplicates && (
                <button
                  type="button"
                  className="detail-pill tone-warning clickable"
                  onClick={() => props.actions.showDuplicates(node.name)}
                >
                  <Icon name="warn" />
                  {_i18n.t("重复")} ×{node.duplicateFiles.length}
                </button>
              )}
            </div>

            <h2 className="mod-detail-title">{title}</h2>
            {cloud?.subtitle && (
              <p className="mod-detail-subtitle">{cloud.subtitle}</p>
            )}

            <div className="mod-detail-byline">
              <span className="byline-code">{node.name}</span>
              <span className="byline-version">v{node.version}</span>
              {(meta?.submitter || cloud?.submitter) && (
                <span className="byline-author">
                  {meta?.submitter || cloud?.submitter}
                </span>
              )}
              {updatedText && (
                <span className="byline-meta">
                  <Icon name="clock" />
                  {updatedText}
                </span>
              )}
            </div>

            <div className="mod-detail-actions">
              <button
                type="button"
                className={`detail-action-btn ${
                  isAlwaysOn
                    ? "is-info"
                    : node.enabled
                      ? "is-enabled"
                      : "is-primary"
                }`}
                onClick={() =>
                  props.actions.switchNodes(node.name, !node.enabled, false)
                }
              >
                <Icon
                  name={
                    isAlwaysOn ? "i-asterisk" : node.enabled ? "pause" : "play"
                  }
                />
                <span>
                  {isAlwaysOn
                    ? _i18n.t("始终开启")
                    : node.enabled
                      ? _i18n.t("禁用")
                      : _i18n.t("启用")}
                </span>
              </button>

              {updateInfo.hasUpdate && updateInfo.version && (
                <button
                  type="button"
                  className="detail-action-btn is-warning"
                  disabled={updating}
                  onClick={() => {
                    setUpdating(true);
                    void props.actions
                      .updateNode(node.name)
                      .finally(() => setUpdating(false));
                  }}
                >
                  <Icon name="download" />
                  <span>
                    {updating
                      ? _i18n.t("更新中…")
                      : updateInfo.state ||
                        _i18n.t("更新到 {version}", {
                          version: updateInfo.version,
                        })}
                  </span>
                </button>
              )}

              <button
                type="button"
                className={`detail-action-btn ${isAlwaysOn ? "is-active" : ""}`}
                onClick={() => props.actions.toggleAlwaysOn(node.name)}
                title={_i18n.t(isAlwaysOn ? "取消始终开启" : "设为始终开启")}
              >
                <Icon name="i-asterisk" />
                <span>
                  {_i18n.t(isAlwaysOn ? "取消始终开启" : "设为始终开启")}
                </span>
              </button>

              <button
                type="button"
                className="detail-action-btn"
                onClick={() => void callRemote("open_url", props.modPath)}
                title={_i18n.t("Mods 文件夹")}
              >
                <Icon name="folder" />
                <span>{_i18n.t("Mods 文件夹")}</span>
              </button>

              <button
                type="button"
                className="detail-action-btn is-danger-ghost"
                onClick={() => {
                  popup.hide();
                  props.actions.deleteNode(node.name);
                }}
                title={_i18n.t("删除 Mod")}
              >
                <Icon name="delete" />
              </button>
            </div>
          </div>
        </div>
      }
    >
      {activeTab === "overview" && (
        <div className="mod-detail-tab-panel ui-fade-enter">
          {(health.status !== "healthy" || unresolvedDuplicates) && (
            <div
              className={`mod-detail-callout ${
                health.status === "missing" ? "tone-danger" : "tone-warning"
              }`}
            >
              <Icon name="warn" />
              <div className="callout-text">
                <strong>
                  {health.status === "missing"
                    ? _i18n.t("存在缺失依赖")
                    : health.status === "disabled"
                      ? _i18n.t("部分依赖未启用")
                      : health.status === "version"
                        ? _i18n.t("依赖版本不匹配")
                        : _i18n.t("存在同名重复文件")}
                </strong>
                <span>
                  {health.messages[0] ||
                    _i18n.t("同名 Mod 只能启用一个文件，点击选择保留或删除")}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (health.status !== "healthy") setActiveTab("dependencies");
                  else props.actions.showDuplicates(node.name);
                }}
              >
                {health.status !== "healthy"
                  ? _i18n.t("查看依赖")
                  : _i18n.t("处理重复")}
              </button>
            </div>
          )}

          <ModScreenshotGallery screenshots={screenshots} />

          <section className="mod-detail-section">
            <div className="mod-detail-section-header">
              <span className="mod-detail-section-title">
                <Icon name="info" />
                {_i18n.t("模组介绍")}
              </span>
            </div>

            {cloudLoading ? (
              <DescriptionSkeleton />
            ) : cloud?.description?.trim() ? (
              <ModDescriptionHtml html={cloud.description} />
            ) : cloudError ? (
              <div className="mod-detail-notice is-warning">
                <Icon name="warn" />
                <span>{_i18n.t("云端详情加载失败")}</span>
                <button
                  type="button"
                  onClick={() => setCloudRetryKey((v) => v + 1)}
                >
                  <Icon name="replay" />
                  {_i18n.t("重试")}
                </button>
              </div>
            ) : (
              <div className="mod-detail-notice">
                <Icon name="info" />
                <span>
                  {_i18n.t(
                    "本地缓存包含版本、分类、作者、下载量、大小和更新时间；云端详情暂不可用。",
                  )}
                </span>
              </div>
            )}
          </section>

          <section className="mod-detail-local-strip">
            <div className="local-strip-file">
              <Icon name={node.isDirectory ? "folder" : "file"} />
              <strong title={node.file}>{node.file}</strong>
              <span>{formatDetailSize(node.size)}</span>
              {modifiedText && <span>· {modifiedText}</span>}
            </div>
            <button type="button" onClick={() => setActiveTab("local")}>
              {_i18n.t("本地信息")}
              <Icon name="i-right" />
            </button>
          </section>
        </div>
      )}

      {activeTab === "dependencies" && (
        <div className="mod-detail-tab-panel ui-fade-enter">
          {requiredDeps.length === 0 &&
          optionalDeps.length === 0 &&
          node.dependedBy.length === 0 ? (
            <div className="mod-detail-notice">
              <Icon name="branch" />
              <span>{_i18n.t("该 Mod 没有声明依赖关系")}</span>
            </div>
          ) : (
            <div className="mod-detail-dep-sections">
              {requiredDeps.length > 0 && (
                <section className="mod-detail-section">
                  <div className="mod-detail-section-header">
                    <span className="mod-detail-section-title">
                      <Icon name="branch" />
                      {_i18n.t("必需依赖")}
                    </span>
                    <span className="mod-detail-section-count">
                      {requiredDeps.length}
                    </span>
                  </div>
                  <div className="mod-detail-dep-list">
                    {requiredDeps.map(renderDependencyRow)}
                  </div>
                </section>
              )}

              {optionalDeps.length > 0 && (
                <section className="mod-detail-section">
                  <div className="mod-detail-section-header">
                    <span className="mod-detail-section-title">
                      <Icon name="branch" />
                      {_i18n.t("可选依赖")}
                    </span>
                    <span className="mod-detail-section-count">
                      {optionalDeps.length}
                    </span>
                  </div>
                  <div className="mod-detail-dep-list">
                    {optionalDeps.map(renderDependencyRow)}
                  </div>
                </section>
              )}

              {node.dependedBy.length > 0 && (
                <section className="mod-detail-section">
                  <div className="mod-detail-section-header">
                    <span className="mod-detail-section-title">
                      <Icon name="users" />
                      {_i18n.t("被以下 Mod 依赖")}
                    </span>
                    <span className="mod-detail-section-count">
                      {node.dependedBy.length}
                    </span>
                  </div>
                  <div className="mod-detail-rev-deps">
                    {node.dependedBy.map((depName) => {
                      const depNode = nodes[depName];
                      return (
                        <button
                          key={depName}
                          type="button"
                          className={`mod-detail-rev-chip ${
                            depNode?.enabled ? "is-enabled" : "is-disabled"
                          }`}
                          onClick={() => navigateToMod(depName)}
                        >
                          <span className="rev-dot" aria-hidden="true" />
                          <span>{depName}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === "local" && (
        <div className="mod-detail-tab-panel ui-fade-enter">
          <div className="mod-detail-kv-grid">
            <div className="mod-detail-kv">
              <span className="kv-label">Mod ID</span>
              <div className="kv-value-row">
                <code title={node.name}>{node.name}</code>
                <button
                  type="button"
                  className="kv-copy-btn"
                  onClick={() => copyText(node.name, "id")}
                  title={_i18n.t("复制")}
                >
                  <Icon name={copiedKey === "id" ? "i-tick" : "copy"} />
                </button>
              </div>
            </div>

            <div className="mod-detail-kv">
              <span className="kv-label">{_i18n.t("当前版本")}</span>
              <div className="kv-value-row">
                <strong>v{node.version}</strong>
                {latestCatalogVersion &&
                  latestCatalogVersion !== node.version && (
                    <span className="detail-pill tone-warning">
                      {_i18n.t("最新")} v{latestCatalogVersion}
                    </span>
                  )}
              </div>
            </div>

            <div className="mod-detail-kv span-2">
              <span className="kv-label">{_i18n.t("本地文件")}</span>
              <div className="kv-value-row">
                <code title={node.file}>{node.file}</code>
                <span className="detail-pill tone-subtle">
                  {node.isDirectory ? _i18n.t("文件夹") : "ZIP"}
                </span>
                <button
                  type="button"
                  className="kv-copy-btn"
                  onClick={() => copyText(node.file, "file")}
                  title={_i18n.t("复制")}
                >
                  <Icon name={copiedKey === "file" ? "i-tick" : "copy"} />
                </button>
              </div>
            </div>

            <div className="mod-detail-kv">
              <span className="kv-label">{_i18n.t("文件大小")}</span>
              <strong>{formatDetailSize(node.size)}</strong>
            </div>

            <div className="mod-detail-kv">
              <span className="kv-label">{_i18n.t("上次修改")}</span>
              <strong>{modifiedText || "--"}</strong>
            </div>

            <div className="mod-detail-kv span-2">
              <span className="kv-label">{_i18n.t("备注名称")}</span>
              {editingRemark ? (
                <form
                  className="kv-remark-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    props.actions.setComment(node.name, remarkDraft.trim());
                    setEditingRemark(false);
                  }}
                >
                  <input
                    autoFocus
                    value={remarkDraft}
                    placeholder={meta?.submissionName || node.name}
                    onChange={(event) => setRemarkDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.stopPropagation();
                        setEditingRemark(false);
                      }
                    }}
                  />
                  <button type="submit" className="is-primary">
                    {_i18n.t("保存")}
                  </button>
                  <button type="button" onClick={() => setEditingRemark(false)}>
                    {_i18n.t("取消")}
                  </button>
                </form>
              ) : (
                <div className="kv-value-row">
                  <span className="kv-remark-value">
                    {comments[node.name] || (
                      <em className="kv-empty">{_i18n.t("未设置备注")}</em>
                    )}
                  </span>
                  <button
                    type="button"
                    className="kv-copy-btn"
                    onClick={() => {
                      setRemarkDraft(comments[node.name] || "");
                      setEditingRemark(true);
                    }}
                    title={_i18n.t("点击编辑备注")}
                  >
                    <Icon name="edit" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {hasDuplicates && (
            <section className="mod-detail-section mod-detail-dup-section">
              <div className="mod-detail-section-header">
                <span className="mod-detail-section-title">
                  <Icon name="warn" />
                  {_i18n.t("同名重复文件")}
                </span>
                <button
                  type="button"
                  className="detail-inline-btn"
                  onClick={() => props.actions.showDuplicates(node.name)}
                >
                  {_i18n.t("处理重复")}
                </button>
              </div>
              <div className="mod-detail-dup-list">
                {node.duplicateFiles.map((file) => (
                  <div
                    key={file.file}
                    className={`mod-detail-dup-row ${
                      file.enabled ? "is-enabled" : "is-disabled"
                    }`}
                  >
                    <span className="dup-status-dot" aria-hidden="true" />
                    <code title={file.file}>{file.file}</code>
                    <span className="dup-meta">v{file.version}</span>
                    <span className="dup-meta">
                      {formatDetailSize(file.size)}
                    </span>
                    <span
                      className={`detail-pill ${
                        file.enabled ? "tone-success" : "tone-subtle"
                      }`}
                    >
                      {file.enabled ? _i18n.t("已启用") : _i18n.t("已禁用")}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {activeTab === "credits" && (
        <div className="mod-detail-tab-panel ui-fade-enter">
          <ModCreditsPanel groups={creditGroups} />
        </div>
      )}
    </ModDetailShell>
  );
};

export const openManageModDetail = (options: OpenManageModDetailOptions) =>
  createPopup(() => <ManageModDetailContent {...options} />, {
    className: "mod-detail-overlay",
    backgroundMask: "rgba(8, 9, 12, 0.64)",
  });
