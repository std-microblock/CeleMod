import _i18n from "src/i18n";
import { createPopup } from "./Popup";
import { callRemote, compareVersion } from "../utils";
import "./SelfUpdate.scss";
import { useState } from "react";
import { ProgressIndicator } from "./Progress";
import { getLatestUpdateInfo } from "../api/updateInfo";

export const checkUpdate = async () => {
  const currentVersion = (await callRemote<string>("celemod_version"))
    .split("")
    .filter((v) => v === "." || !isNaN(parseInt(v)))
    .join("");
  const info = await getLatestUpdateInfo();
  const latestVersion = info.version
    .split("")
    .filter((v) => v === "." || !isNaN(parseInt(v)))
    .join("");

  const applyForce = compareVersion(currentVersion, info.force ?? "0.0.0") < 0;

  if (compareVersion(currentVersion, latestVersion) < 0) {
    createPopup(
      () => {
        const [updateProgress, setUpdateProgress] = useState<null | number>(
          null
        );
        const [failReason, setFailReason] = useState<string | null>(null);

        return (
          <div className="update-prompt">
            <div className="title">{_i18n.t("Celemod 有更新")}</div>
            <div className="info">
              <div className="vernum">{info.version}</div>
              <div className="detail-text">{_i18n.t("更新详情")}</div>
              <pre>{info.info}</pre>
            </div>

            <div className="update-footer">
              {updateProgress === null ? (
                <>
                  {applyForce && (
                    <div className="force">
                      {_i18n.t("您的版本太低")}
                      <br />
                      {_i18n.t("如不更新")}
                      <br />
                      {_i18n.t("将无法继续使用")}
                    </div>
                  )}
                  <div className="updateOptions">
                    <div>
                      <span style={{ opacity: 0.6, display: "inline-block" }}>
                        {_i18n.t("手动更新 ·")}
                      </span>
                      {info.manual.map((v, i) => (
                        <span
                          className="download"
                          onClick={() => {
                            callRemote("open_url", v.url);
                          }}
                        >
                          {v.name} {i !== info.manual.length - 1 && "·"}
                        </span>
                      ))}
                    </div>
                    <div>
                      <span style={{ opacity: 0.6, display: "inline-block" }}>
                        {_i18n.t("一键更新 ·")}
                      </span>
                      {info.auto_download.map((v, i) => (
                        <span
                          className="download"
                          onClick={() => {
                            setUpdateProgress(-1);
                            callRemote(
                              "do_self_update",
                              v.url,
                              (state: string, data: unknown) => {
                                if (
                                  state === "downloading" &&
                                  typeof data === "number"
                                ) {
                                  setUpdateProgress(data);
                                } else if (state === "failed") {
                                  setFailReason(
                                    typeof data === "string"
                                      ? data
                                      : String(data)
                                  );
                                }
                              }
                            );
                          }}
                        >
                          {v.name} {i !== info.auto_download.length - 1 && "·"}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              ) : failReason ? (
                <div className="downloadFailed">
                  <div>{_i18n.t("更新失败")}</div>
                  <span>{failReason}</span>
                </div>
              ) : (
                <div className="downloadProgress">
                  <ProgressIndicator
                    {...(updateProgress === -1
                      ? {
                          infinite: true,
                          size: 50,
                        }
                      : {
                          value: updateProgress,
                          max: 100,
                          size: 50,
                        })}
                  />
                  <span>{_i18n.t("正在下载更新")}</span>
                </div>
              )}
            </div>
          </div>
        );
      },
      {
        cancelable: !applyForce,
      }
    );
  }
};

// @ts-ignore expose api to window
window._checkUpdate = checkUpdate;
