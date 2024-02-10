import { createPopup } from "./Popup";
import { callRemote, celemodVersion, compareVersion } from "../utils";
import "./SelfUpdate.scss"
import { Fragment, h } from "preact"
import { useState } from "preact/hooks";
import { ProgressIndicator } from "./Progress";

export interface UpdateInfo {
    version: string;
    info: string;
    auto_download: {
        name: string;
        url: string;
    }[];
    manual: {
        name: string;
        url: string;
    }[];
    force?: string;
}

export const getLatestUpdateInfo = async () => {
    return await fetch('https://ganbei-hot-update-1258625969.file.myqcloud.com/celemod/updateInfo.json?' + Date.now())
        .then(v => v.text())
        .then(v=>v.split('\n').filter(v=>!v.trim().startsWith("//")).join('\n'))
        .then(v => JSON.parse(v) as UpdateInfo)
}

export const checkUpdate = async () => {
    // @ts-ignore
    const currentVersion = celemodVersion.split('').filter(v => v === '.' || !isNaN(parseInt(v))).join('')
    const info = await getLatestUpdateInfo();
    const latestVersion = info.version.split('').filter(v => v === '.' || !isNaN(parseInt(v))).join('')

    const applyForce = compareVersion(currentVersion, info.force ?? '0.0.0') < 0;

    if (compareVersion(currentVersion, latestVersion) < 0) {
        createPopup(() => {
            const [updateProgress, setUpdateProgress] = useState<null | number>(null);
            const [failReason, setFailReason] = useState<string | null>(null);

            return <div className="update-prompt">
                <div className="title">Celemod 有更新</div>
                <div className="info">
                    <div className="vernum">{info.version}</div>
                    <div className="detail-text">更新详情</div>
                    <pre>
                        {info.info}
                    </pre>
                </div>

                {
                    updateProgress === null ? (<Fragment>
                        {applyForce && <div className="force">您的版本太低<br />如不更新<br />将无法继续使用</div>}
                        <div className="updateOptions">
                            <div>
                                <span style={{ opacity: 0.6, display: "inline-block" }}>手动更新 · </span>
                                {info.manual.map((v, i) => <span className="download" onClick={() => {
                                    callRemote('open_url', v.url);
                                }}>
                                    {v.name} {i !== info.manual.length - 1 && '·'}
                                </span>)}
                            </div>
                            <div>
                                <span style={{ opacity: 0.6, display: "inline-block" }}>一键更新 · </span>
                                {info.auto_download.map((v, i) => <span className="download" onClick={() => {
                                    setUpdateProgress(-1)
                                    callRemote('do_self_update', v.url, (state: string, data: any) => {
                                        if (state === 'downloading') {
                                            setUpdateProgress(data);
                                        } else if (state === 'failed') {
                                            setFailReason(data);
                                        }
                                    })
                                }}>
                                    {v.name} {i !== info.auto_download.length - 1 && '·'}
                                </span>)}
                            </div>
                        </div>
                    </Fragment>) : (<Fragment>
                        {failReason ? <div className="downloadFailed">
                            <div>更新失败</div>
                            <span>{failReason}</span>
                        </div> : <div className="downloadProgress">
                            <div>
                                <ProgressIndicator {
                                    ...(updateProgress === -1 ? {
                                        infinite: true,
                                        size: 50
                                    }: {
                                        value: updateProgress,
                                        max: 100,
                                        size: 50
                                    })
                                } />
                            </div>
                            <span>正在下载更新</span>
                        </div>}
                    </Fragment>)
                }
            </div>
        }, {
            cancelable: !applyForce,
        })
    }
}

// @ts-ignore expose api to window
window._checkUpdate = checkUpdate;