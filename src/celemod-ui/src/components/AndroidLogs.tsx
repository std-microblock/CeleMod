import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import i18n from "../i18n";
import { Icon } from "./Icon";
import "./AndroidLogs.scss";

type LogSource = "game" | "installer" | "app";
type LogSnapshot = {
  content: string;
  exists: boolean;
  truncated: boolean;
  size: number;
  modifiedAt: number | null;
};

const sources: { id: LogSource; title: string; hint: string }[] = [
  {
    id: "game",
    title: "游戏运行",
    hint: "启动游戏后会生成日志，下次启动时覆盖。",
  },
  {
    id: "installer",
    title: "Everest 安装",
    hint: "运行 Everest 安装器后会生成日志，下次安装时覆盖。",
  },
  {
    id: "app",
    title: "CeleMod 应用",
    hint: "记录本次 CeleMod 启动后的运行信息。",
  },
];

export function AndroidLogs() {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLPreElement>(null);
  const request = useRef(0);
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<LogSource>("game");
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<LogSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    const id = ++request.current;
    setLoading(true);
    setSnapshot(null);
    setError("");
    setCopyStatus("");
    invoke<LogSnapshot>("android_read_log", { source })
      .then((value) => {
        if (active && id === request.current) setSnapshot(value);
      })
      .catch((reason) => {
        if (active && id === request.current) setError(String(reason));
      })
      .finally(() => {
        if (active && id === request.current) setLoading(false);
      });
    return () => {
      active = false;
      request.current++;
    };
  }, [open, source, revision]);

  useLayoutEffect(() => {
    if (content.current)
      content.current.scrollTop = content.current.scrollHeight;
  }, [snapshot]);

  function close() {
    request.current++;
    dialog.current?.close();
    setOpen(false);
  }

  async function copy() {
    if (!snapshot?.content) return;
    const id = request.current;
    try {
      await navigator.clipboard.writeText(snapshot.content);
      if (id === request.current) setCopyStatus(i18n.t("已复制显示的日志"));
    } catch {
      if (id === request.current)
        setCopyStatus(i18n.t("复制失败，请长按日志选择文本。"));
    }
  }

  return (
    <>
      <div className="theme-setting android-logs-entry">
        <div className="setting-description">
          <strong>{i18n.t("运行日志")}</strong>
          <small>
            {i18n.t(
              "查看游戏、Everest 安装和 CeleMod 应用日志，便于排查问题。",
            )}
          </small>
        </div>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-controls="android-logs"
          onClick={() => {
            setSnapshot(null);
            setError("");
            setCopyStatus("");
            setLoading(true);
            dialog.current?.showModal();
            setOpen(true);
          }}
        >
          <Icon name="file" /> {i18n.t("查看日志")}
        </button>
      </div>
      <dialog
        ref={dialog}
        id="android-logs"
        className="android-log-sheet"
        aria-labelledby="android-logs-title"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
        onClose={() => {
          request.current++;
          setOpen(false);
        }}
      >
        <header>
          <h2 id="android-logs-title">{i18n.t("运行日志")}</h2>
          <button type="button" aria-label={i18n.t("关闭")} onClick={close}>
            <Icon name="i-cross" />
          </button>
        </header>
        <div className="android-log-toolbar">
          <label>
            {i18n.t("日志来源")}
            <select
              value={source}
              onChange={(event) => {
                request.current++;
                setSnapshot(null);
                setLoading(true);
                setError("");
                setCopyStatus("");
                setSource(event.target.value as LogSource);
              }}
            >
              {sources.map((item) => (
                <option key={item.id} value={item.id}>
                  {i18n.t(item.title)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              request.current++;
              setSnapshot(null);
              setLoading(true);
              setCopyStatus("");
              setRevision((value) => value + 1);
            }}
          >
            {i18n.t("刷新")}
          </button>
          <button
            type="button"
            disabled={loading || !snapshot?.content}
            onClick={() => void copy()}
          >
            {i18n.t("复制日志")}
          </button>
        </div>
        <div className="android-log-info">
          <p>{i18n.t(sources.find((item) => item.id === source)!.hint)}</p>
          {snapshot?.modifiedAt != null && (
            <p>
              {i18n.t("更新时间")}：
              {new Date(snapshot.modifiedAt).toLocaleString(i18n.currentLang)} ·{" "}
              {(snapshot.size / 1024).toFixed(1)} KiB
            </p>
          )}
          {snapshot?.truncated && (
            <p>
              {i18n.t("日志较大，仅显示末尾 256 KiB；复制也仅包含显示部分。")}
            </p>
          )}
        </div>
        {loading ? (
          <p className="android-log-placeholder" role="status">
            {i18n.t("正在读取日志…")}
          </p>
        ) : error ? (
          <p className="android-log-placeholder" role="alert">
            {i18n.t("读取日志失败")}：{error}
          </p>
        ) : snapshot?.content ? (
          <pre
            ref={content}
            className="android-log-content"
            tabIndex={0}
            aria-label={i18n.t("日志内容")}
          >
            {snapshot.content}
          </pre>
        ) : (
          <p className="android-log-placeholder" role="status">
            {i18n.t(snapshot?.exists ? "日志文件为空" : "暂无日志")}
          </p>
        )}
        <footer>
          <span role="status">
            {copyStatus || i18n.t("日志可能包含路径等个人信息，分享前请检查。")}
          </span>
          <button
            type="button"
            disabled={!snapshot?.content}
            onClick={() => {
              if (content.current)
                content.current.scrollTop = content.current.scrollHeight;
            }}
          >
            {i18n.t("跳到底部")}
          </button>
        </footer>
      </dialog>
    </>
  );
}
