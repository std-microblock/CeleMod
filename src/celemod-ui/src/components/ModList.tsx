import _i18n from 'src/i18n';
import { Fragment, h } from 'preact';
import './ModList.scss';
import { Mod as GBMod, getModFileId } from '../api/xmao';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Button } from './Button';
import { Icon } from './Icon';
import { GameSelector } from './GameSelector';
import { Awaitable, callRemote, displayDate, horizontalScrollMouseWheelHandler } from '../utils';

import { FixedSizeGrid, FixedSizeList } from 'react-window';
import InfiniteLoader from 'react-window-infinite-loader';
import { memo } from 'preact/compat';
import { Content } from '../api/wegfan';
import { Download } from '../context/download';
import { useAutoDisableNewMods } from '../states';
import { useGlobalContext } from '../App';
import { PopupContext, createPopup } from './Popup';
import { ProgressIndicator } from './Progress';
// @ts-ignore
import celemodIcon from '../resources/Celemod.png';

const processLargeNum = (num: number) => {
  if (num < 1000) return num.toString();
  if (num < 1000000) return (num / 1000).toFixed(1) + 'k';
  if (num < 1000000000) return (num / 1000000).toFixed(1) + 'm';
  return (num / 1000000000).toFixed(1) + 'b';
};

const BackgroundEle = memo(({ preview }: { preview: string }) => (
  <div className="bg">
    <img src={preview + '?w=340'} alt="" srcset="" />
  </div>
));

const GUTTER_SIZE = 10;

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
  externalUrl?: string;
}

export interface FileToDownload {
  name: string;
  url: string;
  id: string;
  size: string;
}

export interface ModInfo {
  name: string;
  downloadUrl: (() => Awaitable<string | FileToDownload[]>);
  previewUrl: string;
  author: string;
  other: string;
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
    const { download, modManage } = useGlobalContext();
    const [autoDisableNewMods] = useAutoDisableNewMods();
    const { mod } = props;
    const preview = mod.previewUrl;

    const [downloadTask, setDownloadTask] = useState<Download.TaskInfo | null>(
      null
    );

    return (
      <div
        onClick={props.onClick}
        class={`mod ${props.expanded && 'expanded'}`}
        key={mod.name}
      >
        <div className="operations">
          <Button
            onClick={async () => {
              if (downloadTask) return;

              const down = (name: string, fileid: string) => {
                setDownloadTask(
                  download.downloadMod(name, fileid, {
                    autoDisableNewMods,
                    onProgress: (task) => setDownloadTask({ ...task }),
                    onFailed: (task) => setDownloadTask({ ...task }),
                    onFinished: (task) => {
                      setDownloadTask({ ...task });
                      modManage.reloadMods();
                    },
                  })
                );
              };

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
                        width: 'min-content',
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
                    {downloads &&
                      downloads
                        .map((v) => {
                          console.log(downloads);
                          return (
                            <div
                              className="file"
                              onClick={() => {
                                down(v.name, parseInt(v.id) === -1 ? v.url : v.id);
                                popupCtx.hide();
                              }}
                            >
                              <div className="name">
                                <Icon name="save" />
                                {v.name}
                              </div>
                              <div className="info">
                                <span className="size">{v.size}</span>
                                <span className="id">{v.id}</span>
                              </div>
                              <div className="url">{v.url}</div>
                            </div>
                          );
                        })
                        .reduce((pre: any[], cur) => {
                          // group by 3
                          if (pre.length === 0) return [[cur]];
                          if (pre[pre.length - 1].length === 2)
                            return [...pre, [cur]];
                          pre[pre.length - 1].push(cur);
                          return pre;
                        }, [])
                        .map((v) => <div className="group">{v}</div>)}

                    <span>{error}</span>
                  </div>
                );
              });

              const downloadInfo = await mod.downloadUrl();

              if (typeof downloadInfo === 'string') {
                ctx.hide();
                down(mod.name, downloadInfo);
              } else {
                if (downloadInfo.length === 1) {
                  ctx.hide();
                  down(downloadInfo[0].name, downloadInfo[0].id);
                } else if (downloadInfo.length === 0) {
                  ctx.setError(_i18n.t('文件列表为空'));
                } else {
                  ctx.setDownloads(downloadInfo);
                }
              }
            }}
          >
            {props.isInstalled ? (
              <Icon name="i-tick" />
            ) : downloadTask ? (
              downloadTask.state === 'pending' ? (
                `${downloadTask.progress}% (${downloadTask.subtasks.filter((v) => v.state !== 'Finished')
                  .length
                })`
              ) : downloadTask.state === 'failed' ? (
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
              onClick={async () => {
                createPopup(
                  () => {
                    const [data, setData] = useState<ModDetailInfo | null>(
                      null
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
                      refImages.current.addEventListener('mousewheel', horizontalScrollMouseWheelHandler());
                    }, [data]);

                    useEffect(() => {
                      if (!refContent.current) return;
                      refContent.current.innerHTML = '';
                      // strip all script execution from the description
                      const div = document.createElement('div');
                      div.innerHTML = data?.description ?? '';
                      // @ts-ignore
                      for (const script of div.querySelectorAll(
                        'script, iframe, style, link, meta'
                      ))
                        script.remove();
                      // @ts-ignore
                      for (const ele of div.querySelectorAll('*')) {
                        // remove all event listeners
                        for (const key in ele) {
                          if (key.startsWith('on')) {
                            ele[key] = null;
                          }
                        }
                      }
                      // @ts-ignore
                      for (const a of div.querySelectorAll('a')) {
                        const url = a.href || a.getAttribute('href');
                        a.href = '#';
                        a.onclick = (e: any) => {
                          e.preventDefault();
                          e.stopPropagation();
                          callRemote('open_url', url);
                        };
                      }
                      // @ts-ignore
                      for (const img of div.querySelectorAll('img'))
                        img.style.maxWidth = '300px';

                      refContent.current.appendChild(div);
                    }, [data]);

                    if (!data)
                      return (
                        <div
                          style={{
                            width: 'min-content',
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
                        {data.externalUrl && (
                          <div
                            className="openExternal"
                            onClick={() => {
                              callRemote('open_url', data.externalUrl);
                            }}
                          >
                            <Icon name="external" />
                          </div>
                        )}

                        <h2>{mod.name}</h2>
                        <div className="info">
                          Mod ·{' '}
                          {data.lastUpdate
                            ? displayDate(data.lastUpdate) + ' ·'
                            : ''}
                          {mod.author}
                        </div>
                        {data.authors &&
                          data.authors.join(' ') !== mod.author && (
                            <Fragment>
                              <div className="credits-title">Credits</div>
                              <div className="info credits">
                                {data.authors.join(' / ')}
                              </div>
                            </Fragment>
                          )}
                        {data.images && (
                          <div className="images" ref={refImages}>
                            {data.images.map((v) => (
                              <img
                                src={v + '?h=160'}
                                alt=""
                                srcset=""
                                onClick={() =>
                                  createPopup(() => (
                                    <div className="image-view">
                                      <img src={v} alt="" srcset="" />
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
                    backgroundMask: '#131313',
                  }
                );
              }}
            >
              <Icon name="opts-h" />
            </Button>
          )}
        </div>

        <div className="info">
          <div className="name">{mod.name}</div>
          <div className="author">{mod.author}</div>
          <div className="other">{mod.other}</div>
        </div>

        <BackgroundEle preview={preview} />
      </div>
    );
  }
);
export const ModList = (props: {
  mods: Content[];
  onLoadMore?: any;
  haveMore?: boolean;
  modFolder: string;
  loading?: boolean;
  allowUpScroll: boolean;
}) => {
  const [loading, setLoading] = useState(true);

  const [installedModIDs, setInstalledModIDs] = useState<string[] | null>(null);

  useEffect(() => {
    callRemote('get_installed_mod_ids', props.modFolder, (ids: string) => {
      setInstalledModIDs(ids.split('\n'));
    });
  }, [props.modFolder]);

  useEffect(() => {
    setLoading(props.loading ?? false);
  }, [props.loading]);

  if (installedModIDs === null)
    return (
      <div
        class="loader"
        style={{
          position: 'fixed',
          bottom: 200,
          height: 24,
          left: 200,
          right: 200,
        }}
      >
        <div class="bar"></div>
      </div>
    );

  const refList: any = useRef(null);

  const getVisibleRange = () => {
    if (!refList.current) return { start: 0, end: 0, colWidth: 1 };
    const padding = 40;
    const childHeight =
      refList.current.children[1].getBoundingClientRect().height +
      GUTTER_SIZE * 2;
    const start = Math.floor(
      (refList.current.scrollTop - padding) / childHeight
    );
    const end = Math.ceil(
      (refList.current.scrollTop + refList.current.offsetHeight - padding * 2) /
      childHeight
    );
    const colWidth = Math.floor((refList.current?.offsetWidth || 0) / 340);
    return { start, end, colWidth };
  };

  useEffect(() => {
    if (refList.current) {
      refList.current.vlist.slidingWindowSize = 10;
      let reachedOnce = false;
      let scrollLocked = false;
      refList.current.scrollTop = 40;
      refList.current.addEventListener('mousewheel', (e: any) => {
        e.preventDefault();
        e.stopPropagation();

        const scrollTo = (v: any) => {
          refList.current.scrollTo(v);
        };

        const target = refList.current.scrollTop + e.deltaY * 1.6;
        // console.log(target)
        const topPaddingDownTop = 40;
        const list = document.querySelector('.mod-list') as any;
        const bottomPaddingUpTop =
          list.scrollTop +
          list.lastElementChild.offsetTop -
          list.offsetHeight -
          80;
        if (scrollLocked) return;
        if (target < 40) {
          if (!props.allowUpScroll) {
            scrollTo({
              top: 40,
              behavior: 'smooth',
            });
            return;
          }
          // reach top padding
          if (reachedOnce) {
            scrollTo({
              top: target,
              behavior: 'smooth',
            });

            if (target < 0) {
              scrollLocked = true;
              setTimeout(() => {
                props.onLoadMore?.('up').then(() => {
                  scrollLocked = false;
                });
              }, 300);
              scrollTo({
                top: target,
                behavior: 'smooth',
              });
            }
          } else {
            scrollTo({
              top: topPaddingDownTop,
              behavior: 'smooth',
            });

            if (props.haveMore)
              reachedOnce = true;
          }
        } else if (
          target >
          refList.current.scrollHeight - refList.current.offsetHeight - 40
        ) {
          // reach bottom padding
          if (reachedOnce) {
            if (target > refList.current.offsetHeight) {
              if (!scrollLocked) {
                scrollLocked = true;
                setTimeout(() => {
                  props.onLoadMore?.('down').then(() => {
                    scrollLocked = false;
                  });
                }, 300);
                scrollTo({
                  top: target,
                  behavior: 'smooth',
                });
              }
            } else {
              scrollTo({
                top: target,
                behavior: 'smooth',
              });
            }
          } else {
            console.log('To', bottomPaddingUpTop);
            scrollTo({
              top: bottomPaddingUpTop,
              behavior: 'smooth',
            });
            if (props.haveMore)
              reachedOnce = true;
          }
        } else {
          scrollTo({
            top: target,
            behavior: 'smooth',
          });
          reachedOnce = false;
        }
      });
    }
  }, [props.onLoadMore, props.haveMore]);

  const formatSize = (size: number) => {
    const i = size === 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024));
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    return `${(size / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  };

  const [visible, setVisible] = useState(getVisibleRange());

  useEffect(() => {
    const onScroll = () => {
      const range = getVisibleRange();
      const c = refList.current.children;
      for (let i = 0; i < c.length; i++) {
        const line = Math.floor(i / range.colWidth);
        if (line < range.start || line > range.end) {
          const v = c[i];
          const im = v.querySelector('img');
          // im && (im.src = "")
        }
      }
      setVisible(range);
    };
    refList.current.addEventListener('scroll', onScroll);

    setTimeout(onScroll, 10);

    return () => {
      refList.current.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <div>
      <div className="mod-list" ref={refList}>
        {<div className="padding"></div>}
        {props.mods.map((mod2, index) => {
          const mod = useMemo(() => {
            const res = {
              name: mod2.name,
              downloadUrl: () => {
                const dedup = new Set();
                if (!mod2.gameBananaId) return mod2.files[0].url
                return Promise.resolve(
                  mod2.files
                    .filter((v) => {
                      if (v.mods.length === 0) return false;
                      if (dedup.has(v.mods[0].id)) return false;
                      dedup.add(v.mods[0].id);
                      return true;
                    })
                    .map(
                      (v) =>
                      ({
                        id: v.gameBananaId.toString(),
                        name: `${v.description.includes(v.mods[0].version)
                          ? ''
                          : v.mods[0].version + '-'
                          }${v.description}-${v.mods[0].name}`,
                        size: formatSize(v.size),
                        url: v.url,
                      } as FileToDownload)
                    )
                );
              },
              previewUrl: mod2?.screenshots?.[0]?.url ?? celemodIcon,
              author: mod2.submitter,
              isInstalled: installedModIDs.includes(
                mod2.gameBananaId?.toString()
              ),
              other: `${mod2.likes} 🥰 · ${processLargeNum(
                mod2.views
              )} 👀 · ${processLargeNum(mod2.downloads)} 💾`,
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
                  externalUrl: mod2.pageUrl,
                }),
            };

            return res;
          }, [mod2]);
          if (!mod) return (<div></div>) as any;

          const line = Math.floor(index / visible.colWidth);
          const col = index % visible.colWidth;
          const visibleStart = visible.start;
          const visibleEnd = visible.end;

          const isVisible = true; //line >= visibleStart && line <= visibleEnd;

          return (
            <div
              style={{
                margin: GUTTER_SIZE,
                boxSizing: 'border-box',
              }}
            >
              <div
                style={{
                  width: 330,
                  height: 220,
                }}
              >
                {isVisible && (
                  <Mod
                    mod={mod}
                    modFolder={props.modFolder}
                    isInstalled={mod.isInstalled}
                  />
                )}
              </div>
            </div>
          ) as any;
        })}
        <div className="padding"></div>
      </div>

      {loading && (
        <div
          class="loader"
          style={{
            position: 'fixed',
            bottom: 0,
            height: 24,
            zIndex: 999,
          }}
        >
          <div class="bar"></div>
        </div>
      )}

      {<div className="padding"></div>}
    </div>
  );
};
