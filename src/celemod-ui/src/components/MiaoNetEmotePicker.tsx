import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FaArrowLeft,
  FaCheck,
  FaImage,
  FaMagnifyingGlass,
  FaXmark,
} from "react-icons/fa6";

import _i18n from "src/i18n";
import { invokeCommand } from "../tauri/commands";
import { ProgressIndicator } from "./Progress";
import "./MiaoNetEmotePicker.scss";

type AtlasCategory = "i" | "p" | "g";

type AtlasCatalogEntry = {
  category: AtlasCategory;
  name: string;
  previewName: string;
  frames: string[];
};

export type MiaoNetAtlasPreview = {
  width: number;
  height: number;
  pixelsBase64: string;
};

type NamedAtlasPreview = MiaoNetAtlasPreview & { name: string };

type PickerTile = {
  key: string;
  label: string;
  previewName: string;
  catalogEntry: AtlasCatalogEntry;
  frameIndex?: number;
};

const CARD_SIZE = 136;
const CARD_GAP = 10;
const categoryOptions: ReadonlyArray<{
  value: AtlasCategory;
  label: string;
}> = [
  { value: "i", label: "GUI" },
  { value: "p", label: "角色立绘" },
  { value: "g", label: "游戏贴图" },
];

export const MiaoNetAtlasCanvas = ({
  preview,
}: {
  preview?: MiaoNetAtlasPreview;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !preview) return;
    const binary = window.atob(preview.pixelsBase64);
    const pixels = new Uint8ClampedArray(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      pixels[index] = binary.charCodeAt(index);
    }
    canvas.width = preview.width;
    canvas.height = preview.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, preview.width, preview.height);
    context.putImageData(
      new ImageData(pixels, preview.width, preview.height),
      0,
      0
    );
  }, [preview]);

  return preview ? (
    <canvas ref={canvasRef} aria-hidden="true" />
  ) : (
    <span className="miaonet-atlas-preview-placeholder">
      <FaImage />
    </span>
  );
};

const frameExpression = (
  entry: AtlasCatalogEntry,
  rangeStart: number,
  rangeEnd: number
) => {
  const start = Math.min(rangeStart, rangeEnd);
  const end = Math.max(rangeStart, rangeEnd);
  const selectedFrames = entry.frames.slice(start, end + 1);
  if (selectedFrames.length === entry.frames.length) {
    return `${entry.category}:${entry.name}`;
  }
  if (selectedFrames.length === 1) {
    return `${entry.category}:${selectedFrames[0]}`;
  }
  const suffixes = selectedFrames.map((frame) => frame.slice(entry.name.length));
  return `${entry.category}:${entry.name} ${suffixes.join(" ")}`;
};

export const MiaoNetEmotePicker = ({
  gamePath,
  onSelect,
  onClose,
}: {
  gamePath: string;
  onSelect: (expression: string) => void;
  onClose: () => void;
}) => {
  const [catalog, setCatalog] = useState<AtlasCatalogEntry[]>([]);
  const [category, setCategory] = useState<AtlasCategory>("i");
  const [query, setQuery] = useState("");
  const [selectedGroup, setSelectedGroup] =
    useState<AtlasCatalogEntry | null>(null);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const [previews, setPreviews] = useState<
    Record<string, MiaoNetAtlasPreview>
  >({});
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [previewsLoading, setPreviewsLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [gridWidth, setGridWidth] = useState(700);
  const scrollRef = useRef<HTMLDivElement>(null);
  const previewRequest = useRef(0);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (selectedGroup) setSelectedGroup(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, selectedGroup]);

  useEffect(() => {
    let active = true;
    setCatalogLoading(true);
    setCatalogError("");
    void invokeCommand<AtlasCatalogEntry[]>("get_miaonet_atlas_catalog", {
      gamePath,
    })
      .then((entries) => {
        if (active) setCatalog(entries);
      })
      .catch((loadError) => {
        if (active) setCatalogError(String(loadError));
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });
    return () => {
      active = false;
    };
  }, [gamePath]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setGridWidth(entry.contentRect.width);
    });
    observer.observe(element);
    setGridWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return catalog.filter(
      (entry) =>
        entry.category === category &&
        (!normalizedQuery ||
          entry.name.toLocaleLowerCase().includes(normalizedQuery))
    );
  }, [catalog, category, query]);

  const tiles = useMemo<PickerTile[]>(() => {
    if (selectedGroup) {
      return selectedGroup.frames.map((frame, index) => ({
        key: frame,
        label: frame.slice(selectedGroup.name.length) || frame,
        previewName: frame,
        catalogEntry: selectedGroup,
        frameIndex: index,
      }));
    }
    return filteredEntries.map((entry) => ({
      key: `${entry.category}:${entry.name}`,
      label: entry.name,
      previewName: entry.previewName,
      catalogEntry: entry,
    }));
  }, [filteredEntries, selectedGroup]);

  const columns = Math.max(
    1,
    Math.floor((gridWidth + CARD_GAP) / (CARD_SIZE + CARD_GAP))
  );
  const rowCount = Math.ceil(tiles.length / columns);
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_SIZE + CARD_GAP,
    overscan: 3,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    rowVirtualizer.scrollToOffset(0);
  }, [category, columns, query, selectedGroup, rowVirtualizer]);

  const visibleTiles = virtualRows.flatMap((virtualRow) =>
    tiles.slice(
      virtualRow.index * columns,
      Math.min((virtualRow.index + 1) * columns, tiles.length)
    )
  );
  const visibleNamesKey = visibleTiles
    .map((tile) => tile.previewName)
    .join("\u0000");
  const previewCount = Object.keys(previews).length;
  const previewCategory = selectedGroup?.category ?? category;

  useEffect(() => {
    const missingNames = visibleTiles
      .map((tile) => tile.previewName)
      .filter((name) => !previews[`${previewCategory}:${name}`])
      .slice(0, 64);
    if (missingNames.length === 0) {
      setPreviewsLoading(false);
      return;
    }
    const request = ++previewRequest.current;
    const timer = window.setTimeout(() => {
      setPreviewsLoading(true);
      setPreviewError("");
      void invokeCommand<NamedAtlasPreview[]>("get_miaonet_atlas_previews", {
        gamePath,
        category: previewCategory,
        names: missingNames,
      })
        .then((loadedPreviews) => {
          if (request !== previewRequest.current) return;
          setPreviews((current) => ({
            ...current,
            ...Object.fromEntries(
              loadedPreviews.map((preview) => [
                `${previewCategory}:${preview.name}`,
                preview,
              ])
            ),
          }));
        })
        .catch((loadError) => {
          if (request === previewRequest.current) {
            setPreviewError(String(loadError));
          }
        })
        .finally(() => {
          if (request === previewRequest.current) setPreviewsLoading(false);
        });
    }, 90);
    return () => window.clearTimeout(timer);
  }, [gamePath, previewCategory, previewCount, visibleNamesKey]);

  const openFrameRange = (entry: AtlasCatalogEntry) => {
    if (entry.frames.length === 1) {
      onSelect(`${entry.category}:${entry.frames[0]}`);
      return;
    }
    setSelectedGroup(entry);
    setRangeStart(0);
    setRangeEnd(entry.frames.length - 1);
  };

  return (
    <section
        className="miaonet-atlas-picker"
        role="dialog"
        aria-modal="true"
        aria-label={_i18n.t("选择 Celeste 贴图")}
      >
        <header>
          <div className="miaonet-atlas-picker-title">
            {selectedGroup && (
              <button
                type="button"
                title={_i18n.t("返回贴图列表")}
                onClick={() => setSelectedGroup(null)}
              >
                <FaArrowLeft />
              </button>
            )}
            <div>
              <h2>
                {selectedGroup
                  ? _i18n.t("选择帧范围")
                  : _i18n.t("选择 Celeste 贴图")}
              </h2>
              {selectedGroup && <p>{selectedGroup.name}</p>}
            </div>
          </div>
          <button type="button" title={_i18n.t("关闭")} onClick={onClose}>
            <FaXmark />
          </button>
        </header>

        {selectedGroup ? (
          <div className="miaonet-atlas-range-toolbar">
            <label>
              <span>{_i18n.t("起始帧")}</span>
              <select
                value={rangeStart}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setRangeStart(next);
                  if (next > rangeEnd) setRangeEnd(next);
                }}
              >
                {selectedGroup.frames.map((frame, index) => (
                  <option value={index} key={frame}>
                    {frame.slice(selectedGroup.name.length) || frame}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{_i18n.t("结束帧")}</span>
              <select
                value={rangeEnd}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setRangeEnd(next);
                  if (next < rangeStart) setRangeStart(next);
                }}
              >
                {selectedGroup.frames.map((frame, index) => (
                  <option value={index} key={frame}>
                    {frame.slice(selectedGroup.name.length) || frame}
                  </option>
                ))}
              </select>
            </label>
            <span>
              {_i18n.t("已选择 {count} 帧", {
                count: Math.abs(rangeEnd - rangeStart) + 1,
              })}
            </span>
          </div>
        ) : (
          <div className="miaonet-atlas-picker-toolbar">
            <div className="miaonet-atlas-category-tabs">
              {categoryOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={category === option.value ? "active" : ""}
                  onClick={() => setCategory(option.value)}
                >
                  {_i18n.t(option.label)}
                </button>
              ))}
            </div>
            <label className="miaonet-atlas-search">
              <FaMagnifyingGlass />
              <input
                type="search"
                value={query}
                placeholder={_i18n.t("搜索贴图路径")}
                autoFocus
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
        )}

        <div className="miaonet-atlas-picker-status">
          <span>
            {selectedGroup
              ? _i18n.t("共 {count} 帧", { count: selectedGroup.frames.length })
              : _i18n.t("找到 {count} 种贴图", {
                  count: filteredEntries.length,
                })}
          </span>
          <span className={previewError ? "error" : ""}>
            {previewError || (previewsLoading && _i18n.t("正在加载预览…"))}
          </span>
        </div>

        <div className="miaonet-atlas-grid-scroll" ref={scrollRef}>
          {catalogLoading && (
            <div className="miaonet-atlas-empty">
              <ProgressIndicator infinite />
              {_i18n.t("正在读取 Celeste 图集…")}
            </div>
          )}
          {!catalogLoading && catalogError && (
            <div className="miaonet-atlas-empty error">{catalogError}</div>
          )}
          {!catalogLoading && !catalogError && tiles.length === 0 && (
            <div className="miaonet-atlas-empty">
              {_i18n.t("没有符合条件的贴图")}
            </div>
          )}
          {!catalogLoading && !catalogError && tiles.length > 0 && (
            <div
              className="miaonet-atlas-virtual-grid"
              style={{ height: rowVirtualizer.getTotalSize() }}
            >
              {virtualRows.map((virtualRow) => {
                const rowTiles = tiles.slice(
                  virtualRow.index * columns,
                  Math.min((virtualRow.index + 1) * columns, tiles.length)
                );
                return (
                  <div
                    className="miaonet-atlas-virtual-row"
                    key={virtualRow.key}
                    style={{
                      height: CARD_SIZE,
                      transform: `translateY(${virtualRow.start}px)`,
                      gridTemplateColumns: `repeat(${columns}, ${CARD_SIZE}px)`,
                    }}
                  >
                    {rowTiles.map((tile) => {
                      const frameSelected =
                        tile.frameIndex !== undefined &&
                        tile.frameIndex >= Math.min(rangeStart, rangeEnd) &&
                        tile.frameIndex <= Math.max(rangeStart, rangeEnd);
                      return (
                        <button
                          type="button"
                          className={`miaonet-atlas-square${
                            frameSelected ? " selected" : ""
                          }`}
                          key={tile.key}
                          title={tile.catalogEntry.name}
                          onClick={() => {
                            if (tile.frameIndex !== undefined) {
                              if (tile.frameIndex === rangeStart) {
                                setRangeStart(rangeEnd);
                              } else if (tile.frameIndex === rangeEnd) {
                                setRangeEnd(rangeStart);
                              } else if (tile.frameIndex < rangeStart) {
                                setRangeStart(tile.frameIndex);
                              } else if (tile.frameIndex > rangeEnd) {
                                setRangeEnd(tile.frameIndex);
                              }
                            } else {
                              openFrameRange(tile.catalogEntry);
                            }
                          }}
                        >
                          <span className="miaonet-atlas-square-preview">
                            <MiaoNetAtlasCanvas
                              preview={
                                previews[
                                  `${tile.catalogEntry.category}:${tile.previewName}`
                                ]
                              }
                            />
                          </span>
                          <span>{tile.label}</span>
                          {tile.catalogEntry.frames.length > 1 &&
                            tile.frameIndex === undefined && (
                              <small>
                                {_i18n.t("{count} 帧", {
                                  count: tile.catalogEntry.frames.length,
                                })}
                              </small>
                            )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {selectedGroup && (
          <footer className="miaonet-atlas-range-footer">
            <button type="button" onClick={() => setSelectedGroup(null)}>
              {_i18n.t("取消")}
            </button>
            <button
              type="button"
              className="primary"
              onClick={() =>
                onSelect(frameExpression(selectedGroup, rangeStart, rangeEnd))
              }
            >
              <FaCheck />
              {_i18n.t("使用所选帧")}
            </button>
          </footer>
        )}
    </section>
  );
};
