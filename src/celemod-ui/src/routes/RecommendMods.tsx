import type { CSSProperties } from "react";
import { useMemo, useRef, useState } from "react";
import _i18n, { useI18N } from "src/i18n";
import { useGlobalContext } from "../App";
import { Button } from "../components/Button";
import { enforceEverest } from "../components/EnforceEverestPage";
import { Icon } from "../components/Icon";
import { Mod, type ModInfo } from "../components/ModList";
import { _functionalMods, _skinMods } from "../resources/RecommendModData";
import {
  useAutoDisableNewMods,
  useGamePath,
  useInstalledMods,
} from "../states";
import { useDownloadStore } from "../stores/download";
import { callRemote } from "../utils";
import "./RecommendMods.scss";

type RecommendTab = "helpers" | "maps" | "skins";
type DownloadHandler = { download?: () => void };

const skinPreviewUrls: Record<string, string> = {
  "Niko - Oneshot":
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/251814/26rplplpwiyunncvkreunsnkxgfimsym.jpg",
  Hyperline:
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/14871/ex7ajagpiz73ukwhzevkgb5ynwfjgnwi.jpg",
  Trailine:
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/349341/l36wwsxmzjcuqsgblmiyoy4bwbw73egh.jpg",
  "Maddy Crown":
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/251794/ku5bvmso2sgmiqhc6atoouizidnnllnl.jpg",
  "clover madeline":
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/284804/c4gxzmy6gut3pmg7wdzrtt2kxzx5qvmh.jpg",
  "Flame's Sprite Recolor":
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/251810/hkloa6nrvxdemwwysjxlubgmppfggmic.jpg",
  Fabeline:
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/251796/n52gttekjsgl5wusy6jg45ocpte3bb5t.jpg",
  Bunneline:
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/289900/s2mo52hlgolx6ojvffpzg7jb56l3vje4.jpg",
  Cateline:
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/251793/5fcwic3rk7eiqhlj3tmhwfsfvtqyt4d7.jpg",
  "Kirby SkinMod":
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/326571/34lgrcdcor2ey4jvlmj3r44xwmblq56e.jpg",
  "Gomez skinmod (FEZ)":
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/327953/wxgumfwvxrqtra4qhg4gihthmbyzozx4.jpg",
  "Theo Mod":
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/251813/ea6ruan2ojm63powvrlfvrdrpkm5vhfu.jpg",
  "Tutorial Bird Skinmod":
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/251808/zkklr3voahwlmyaevhn5uvc5gt6sfzxw.jpg",
  "Cursed... things":
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/251780/udmbdtmfalrwr2wx7znukl3nweifxucr.jpg",
  "Playback Strawberries":
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/358189/o56ltxy6p2wcy7qppsrmwijq7jovai54.jpg",
  "uwu Kevins":
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/288581/22fccz5zcufl5ycfxy5rul3ilmhis3op.jpg",
  uwubumpers:
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/311891/kiqkymxyffabnsf5zfvlekm7w4qwob2u.jpg",
  "Cat Ear Binos":
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/251786/bo6msuxdb3ye7xhbpd2wqebqxzhnqbsm.jpg",
  "Replace Gold Flag With Star":
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/397520/jqa7ckn7ehqs25cxoacxn4pqmhye6vn3.jpg",
  Hateline:
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/396767/5g4zngcxkoxlybnrzar5by2jpmxgpc5j.jpg",
  "Picoline Figurine":
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/396162/ultg64uhur55gdgylahus6fvuk44gizz.jpg",
  TaffylinePart1:
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/395131/bduzmry2lrgjnktyxep6fz5wceqyikgb.jpg",
  TaffylinePart2:
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/395129/l5ndsa7xlnqfaojv2mxflwr3epyxgpff.jpg",
  "The Guy - IWBTJG":
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/394473/yzkgylhgpze4juc5dwrg3cjcippb6hzx.jpg",
  "Harold Madeline Skin":
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/393912/ww4we7b4ecrjdainnrxmyxvn7gos7ha3.jpg",
  "Funny Poses WIP":
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/393399/tfy762eb5qtc254icc2d7kkvcazys76o.jpg",
  PinkMadaline:
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/400833/mu7em7v2t5cnn4hy2pc7zr3qfyxcoqqk.jpg",
  "Annoying Dog SkinMod":
    "https://celeste.weg.fan/images/gamebanana-submissions/Mod/400124/f73i3un7pjrxjjwrwhiqoh3afrsnzzxp.jpg",
  Fox: "https://celeste.weg.fan/images/gamebanana-submissions/Mod/320696/ll53hdwjbd2ooycyrdwiwot2pxsgjx2f.jpg",
};

const modNameFromUrl = (url: string) => {
  const match = url.match(/\/mods\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : "";
};

const resolveDownloadSource = (url: string) =>
  new Promise<string>((resolve) => {
    const modName = modNameFromUrl(url);
    if (!modName) {
      resolve(url);
      return;
    }

    callRemote("get_mod_update", modName, (data) => {
      if (!data) {
        resolve(url);
        return;
      }

      try {
        const [gbFileId] = JSON.parse(data);
        resolve(parseInt(gbFileId, 10) === -1 ? url : String(gbFileId));
      } catch {
        resolve(url);
      }
    });
  });

const recommendedMaps = () => [
  {
    name: _i18n.t("草莓酱"),
    installName: "StrawberryJam2021",
    alias: _i18n.t("酱游 / Strawberry Jam"),
    previewUrl:
      "https://celeste.weg.fan/images/gamebanana-submissions/Mod/424541/nflspkyjli2daixuzl634zn44cp3xj4s.jpg",
    downloadUrl:
      "https://celeste.weg.fan/api/v2/download/mods/StrawberryJam2021",
    meta: "~ 2 GiB · 2023-02",
    recommendations: [
      _i18n.t("最为经典的地图集，于 2023 年推出"),
      _i18n.t("质量极高，每张图都有自己的特色；背景音乐与环境制作精良"),
      _i18n.t(
        "分为五个难度（即酱一至酱五），从刚入门的新手到千小时的老鸟都可以打~"
      ),
    ],
  },
  {
    name: _i18n.t("画游"),
    installName: "ChineseNewYear2024Collab",
    alias: "2024CNY / Gallery Collab",
    previewUrl:
      "https://celeste.weg.fan/images/gamebanana-submissions/Mod/494348/5624pdfoj3giacb2lhmq7efgvky32q3h.jpg",
    downloadUrl:
      "https://celeste.weg.fan/api/v2/download/mods/ChineseNewYear2024Collab",
    meta: "~ 400 MiB · 2024-03",
    recommendations: [
      _i18n.t("包含超过20张地图和一个极其漂亮的大厅"),
      _i18n.t("涵盖酱一至酱五所有难度，数种与众不同的新机制等待玩家去探索"),
      _i18n.t(
        "国人原创图，国风浓厚，难度偏高，美术优美，音乐好听，非常推荐安装尝试"
      ),
    ],
  },
  {
    name: _i18n.t("春游"),
    installName: "SpringCollab2020",
    alias: "Spring Collab 2020",
    previewUrl:
      "https://celeste.weg.fan/images/gamebanana-submissions/Mod/150813/yrozsex23djhgnr4iw74sw37zc363k2f.jpg",
    downloadUrl:
      "https://celeste.weg.fan/api/v2/download/mods/SpringCollab2020",
    meta: "~ 560 MiB · 2020-09",
    recommendations: [
      _i18n.t("包含80+地图，5个章节，数十种新机制"),
      _i18n.t(
        "Spring Collab 有 5 个大厅供您探索，里面装满了社区制作的地图。地图的难度从早期的原版内容到一些现存最难的 Celeste 地图均有覆盖"
      ),
      _i18n.t("老牌地图，比草莓酱简单，还行"),
    ],
  },
  {
    name: "LPL Collab",
    installName: "lplCollab2022",
    alias: _i18n.t("LPL Collab 2022 / 乐屁乐"),
    previewUrl:
      "https://celeste.weg.fan/images/gamebanana-submissions/Mod/455644/v542gepsh6vojzgw7o7loq4lfuuzhpkz.jpg",
    downloadUrl: "https://celeste.weg.fan/api/v2/download/mods/lplCollab2022",
    meta: "~ 145 MiB · 2023-07",
    recommendations: [
      _i18n.t("中文社区制作的欢乐向梗图合集，历时一年完成"),
      _i18n.t("包含 25+ 张地图、1 个章节和一张心侧"),
      _i18n.t("风格无厘且充满社区梗，适合想轻松体验奇思妙想的玩家"),
    ],
  },
  {
    name: "Crossover Collab",
    installName: "CrossoverCollab",
    alias: _i18n.t("跨界联动合集"),
    previewUrl:
      "https://celeste.weg.fan/images/gamebanana-submissions/Mod/637482/lb3pfgrmkh3lzg5nmro6btfzf5iofi3q.jpg",
    downloadUrl: "https://celeste.weg.fan/api/v2/download/mods/CrossoverCollab",
    meta: "~ 580 MiB · 2025-12",
    recommendations: [
      _i18n.t("将众多游戏世界融入 Celeste，包含 20+ 张地图与额外内容"),
      _i18n.t("拥有 1000+ 个可玩房间、大量自定义机制和 200+ 个收集品"),
      _i18n.t("五档难度共用一个大厅，新机制均有教程，适合不同水平的玩家"),
    ],
  },
  {
    name: "P2P Collab",
    installName: "P2PConlab",
    alias: "P2P Conlab 2025 / LPL2",
    previewUrl:
      "https://celeste.weg.fan/images/gamebanana-submissions/Mod/585371/aa35nvomfrntde5ssge7mysetnv4h3lf.jpg",
    downloadUrl: "https://celeste.weg.fan/api/v2/download/mods/P2PConlab",
    meta: "~ 475 MiB · 2025-04",
    recommendations: [
      _i18n.t("来自中文社区的 LPL 续作，也被称为 LPL2"),
      _i18n.t("包含 40+ 张地图，以网站垃圾清理和拯救奥什罗为故事主线"),
      _i18n.t("整体轻松娱乐，部分地图可能包含恐怖或不宜内容"),
    ],
  },
  {
    name: _i18n.t("孤行路远"),
    installName: "the road less travelled",
    alias: "the road less travelled",
    previewUrl:
      "https://celeste.weg.fan/images/gamebanana-submissions/Mod/340102/7weg4up2byat4qaqgyhvpgrpnnwif3ed.jpg",
    downloadUrl:
      "https://celeste.weg.fan/api/v2/download/mods/the%20road%20less%20travelled",
    meta: "~ 50 MiB · 2021-12",
    recommendations: [
      _i18n.t("单图，美术和音乐都很好"),
      _i18n.t(
        "MB 自己很喜欢的一张图，有 20-30 面，感觉很平和（中文名是自己翻译的）"
      ),
      _i18n.t("A 面难度在 5A - 6A，B面/C面有一些技巧，难度在 7B 的样子"),
    ],
  },
];

const HelperModRow = ({
  name,
  downloadUrl,
  description,
  installed,
  handler,
  autoDisableNewMods,
}: {
  name: string;
  downloadUrl: string;
  description: string;
  installed: boolean;
  handler: DownloadHandler;
  autoDisableNewMods: boolean;
}) => {
  const ctx = useGlobalContext();
  const downloadMod = useDownloadStore((store) => store.downloadMod);
  const [installedLocally, setInstalledLocally] = useState(installed);
  const installName = modNameFromUrl(downloadUrl) || name;
  const task = useDownloadStore(
    (store) =>
      Object.values(store.tasks).find((item) => item.ownerId === installName) ??
      store.tasks[installName]
  );
  const downloadActive = task?.state === "pending" && !task.canceled;
  const progress = Math.max(0, Math.min(100, Number(task?.progress ?? 0)));
  const isInstalled = installed || installedLocally;

  const startDownload = async () => {
    if (isInstalled || downloadActive) return;
    if (task) {
      if ((task.state === "failed" || task.canceled) && task.source) {
        downloadMod(task.name, task.source, {
          force: true,
          autoDisableNewMods,
          ownerId: installName,
          onFinished: () => {
            setInstalledLocally(true);
            ctx.modManage.reloadMods();
          },
        });
      }
      return;
    }

    const source = await resolveDownloadSource(downloadUrl);
    downloadMod(installName, source, {
      autoDisableNewMods,
      ownerId: installName,
      onFinished: () => {
        setInstalledLocally(true);
        ctx.modManage.reloadMods();
      },
    });
  };

  handler.download = () => {
    void startDownload();
  };

  return (
    <div className="helper-mod-row">
      <div className="helper-mod-info">
        <div className="helper-mod-name">{name}</div>
        <div className="helper-mod-description">{description}</div>
      </div>
      <Button
        className="recommended-download-button"
        disabled={isInstalled}
        title={
          isInstalled
            ? _i18n.t("已安装")
            : downloadActive
            ? `${Math.round(progress)}%`
            : _i18n.t("下载")
        }
        aria-label={
          isInstalled
            ? _i18n.t("已安装")
            : downloadActive
            ? `${Math.round(progress)}%`
            : _i18n.t("下载")
        }
        onClick={() => {
          void startDownload();
        }}
      >
        {isInstalled ? (
          <Icon name="i-tick" />
        ) : task ? (
          downloadActive ? (
            <span
              className="recommended-download-progress"
              style={{ "--download-progress": `${progress}%` } as CSSProperties}
            >
              <span>{task.subtasks.length}</span>
            </span>
          ) : task.state === "failed" || task.canceled ? (
            <Icon name="i-cross" />
          ) : (
            <Icon name="i-tick" />
          )
        ) : (
          <Icon name="download" />
        )}
      </Button>
    </div>
  );
};

export const RecommendMods = () => {
  useI18N();
  const [tab, setTab] = useState<RecommendTab>("helpers");
  const { installedMods } = useInstalledMods();
  const [autoDisableNewMods] = useAutoDisableNewMods();
  const [gamePath] = useGamePath();
  const functionalMods = _functionalMods();
  const skinMods = _skinMods();
  const mapMods = recommendedMaps();
  const visibleFunctionalMods = functionalMods.filter(
    (mod) => !mod.visible || mod.visible(_i18n.currentLang)
  );
  const handlers = useRef<Record<string, DownloadHandler>>({});
  const installedNames = useMemo(
    () => new Set(installedMods.map((mod) => mod.name)),
    [installedMods]
  );
  const modsFolder = `${gamePath}/Mods`;
  const noEverest = enforceEverest();

  if (noEverest) return noEverest;

  const isInstalled = (url: string, explicitName?: string) =>
    installedNames.has(explicitName ?? modNameFromUrl(url));

  const makeCardInfo = (
    name: string,
    downloadUrl: string,
    previewUrl: string,
    author: string,
    other: string,
    category: string,
    downloadKey?: string
  ): ModInfo => ({
    name,
    downloadKey: downloadKey ?? (modNameFromUrl(downloadUrl) || name),
    downloadUrl: () => resolveDownloadSource(downloadUrl),
    previewUrl,
    author,
    other,
    category,
  });

  return (
    <div className="recommend-mods-page">
      <header className="recommend-header">
        <div>
          <h1>{_i18n.t("推荐的模组")}</h1>
          <p>{_i18n.t("这里将会列出一些推荐安装的模组及其简介，请按需安装")}</p>
        </div>
        {tab === "helpers" && (
          <Button
            className="download-recommended-button"
            onClick={() => {
              visibleFunctionalMods
                .filter((mod) => !isInstalled(mod.download_url))
                .filter((mod) => !mod.exclude_from_download_all)
                .forEach((mod) => handlers.current[mod.name]?.download?.());
            }}
          >
            <Icon name="download" />
            {_i18n.t("下载推荐")}
          </Button>
        )}
      </header>

      <div
        className="recommend-tabs"
        role="tablist"
        aria-label={_i18n.t("推荐模组")}
      >
        {(
          [
            ["helpers", _i18n.t("辅助模组"), "i-asterisk"],
            ["maps", _i18n.t("地图"), "image"],
            ["skins", _i18n.t("皮肤"), "heart"],
          ] as const
        ).map(([name, label, icon]) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            className={tab === name ? "selected" : ""}
            onClick={() => setTab(name)}
          >
            <Icon name={icon} />
            {_i18n.t(label)}
          </button>
        ))}
      </div>

      <div className="recommend-tab-content">
        {tab === "helpers" && (
          <div className="helper-mod-list" role="tabpanel">
            {visibleFunctionalMods.map((mod) => (
              <HelperModRow
                key={mod.name}
                name={mod.name}
                downloadUrl={mod.download_url}
                description={mod.description}
                installed={isInstalled(mod.download_url)}
                handler={(handlers.current[mod.name] ??= {})}
                autoDisableNewMods={autoDisableNewMods}
              />
            ))}
          </div>
        )}

        {tab === "maps" && (
          <div className="recommended-map-list" role="tabpanel">
            {mapMods.map((map) => (
              <article className="recommended-map-row" key={map.installName}>
                <div className="recommended-map-card">
                  <Mod
                    mod={makeCardInfo(
                      map.name,
                      map.downloadUrl,
                      map.previewUrl,
                      map.alias,
                      map.meta,
                      _i18n.t("地图"),
                      map.installName
                    )}
                    modFolder={modsFolder}
                    isInstalled={isInstalled(map.downloadUrl, map.installName)}
                  />
                </div>
                <div className="recommended-map-description">
                  <div className="recommendation-label">
                    <Icon name="flag" />
                    {_i18n.t("推荐理由")}
                  </div>
                  <h2>{map.name}</h2>
                  <div className="map-alias">{map.alias}</div>
                  {map.recommendations.map((description) => (
                    <p key={description}>{description}</p>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}

        {tab === "skins" && (
          <div className="recommended-skin-grid" role="tabpanel">
            {skinMods.map((mod) => (
              <Mod
                key={mod.name}
                mod={makeCardInfo(
                  mod.name,
                  mod.download_url,
                  skinPreviewUrls[mod.name],
                  mod.description,
                  _i18n.t("皮肤"),
                  _i18n.t("皮肤")
                )}
                modFolder={modsFolder}
                isInstalled={isInstalled(mod.download_url)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
