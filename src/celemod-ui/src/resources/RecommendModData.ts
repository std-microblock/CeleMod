import _i18n from 'src/i18n';
export const _functionalMods = () =>
  [
    {
      name: 'Collab Lobby UI',
      description: _i18n.t('在大地图中按 M 显示 Collab 地图选择器'),
      download_url:
        'https://celeste.weg.fan/api/v2/download/mods/CollabLobbyUI',
    },
    {
      name: 'MiaoCelesteNet',
      description: _i18n.t('群服联机'),
      download_url:
        'https://celeste.weg.fan/api/v2/download/mods/Miao.CelesteNet.Client',
      visible: (lang) => lang === 'zh-CN',
    },
    {
      name: _i18n.t('CelesteNet'),
      description: _i18n.t('Multiplayer support'),
      download_url:
        'https://celeste.weg.fan/api/v2/download/mods/CelesteNet.Client',
      visible: (lang) => lang !== 'zh-CN',
    },
    {
      name: _i18n.t('蔚蓝Mod中国镜像'),
      description: _i18n.t('在境内可以正常使用游戏内的下载和更新'),
      download_url: 'https://celeste.weg.fan/api/v2/download/mods/ChinaMirror',
      visible: (lang) => lang === 'zh-CN',
    },
    {
      name: _i18n.t('Extended Variant Mode（拓展异变）'),
      description: _i18n.t('提供比异变更多的改变游戏画面、内容、玩法的选项'),
      download_url:
        'https://celeste.weg.fan/api/v2/download/mods/ExtendedVariantMode',
    },
    {
      name: _i18n.t('Speedrun Tool（速通辅助工具）'),
      description: _i18n.t(
        '实时存档读档（SL）、调试地图和传送、速通计时器、一键望远镜等'
      ),
      download_url: 'https://celeste.weg.fan/api/v2/download/mods/SpeedrunTool',
    },
    {
      name: 'CelesteTAS',
      description: _i18n.t('用于编写TAS，也可以显示碰撞箱、数值面板等'),
      download_url: 'https://celeste.weg.fan/api/v2/download/mods/CelesteTAS',
    },
    {
      name: 'Celeste Randomizer',
      description: _i18n.t('生成随机地图，可用于联机'),
      download_url: 'https://celeste.weg.fan/api/v2/download/mods/Randomizer',
    },
    {
      name: 'Randomizer Chinese Lang Pack',
      description: _i18n.t('随机地图菜单中文翻译'),
      download_url:
        'https://celeste.weg.fan/api/v2/download/mods/RandomizerChineseLangPack',
    },
    {
      name: 'Helper Test Map Hider',
      description: _i18n.t('隐藏helper的测试地图'),
      download_url:
        'https://celeste.weg.fan/api/v2/download/mods/HelperTestMapHider',
    },
    {
      name: 'DeathTracker',
      description: _i18n.t('实时显示死亡次数'),
      download_url: 'https://celeste.weg.fan/api/v2/download/mods/DeathTracker',
    },
    {
      name: 'Death Markers',
      description: _i18n.t('标记每次死亡的位置'),
      download_url: 'https://celeste.weg.fan/api/v2/download/mods/DeathMarkers',
    },
    {
      name: 'Celeste Input History',
      description: _i18n.t('显示按键输入历史'),
      download_url: 'https://celeste.weg.fan/api/v2/download/mods/InputHistory',
    },
    {
      name: 'Stamina Meter',
      description: _i18n.t('显示体力条'),
      download_url: 'https://celeste.weg.fan/api/v2/download/mods/StaminaMeter',
    },
    {
      name: 'Strawberry Tool',
      description: _i18n.t('指示附近的收集品、将身后的草莓变透明'),
      download_url:
        'https://celeste.weg.fan/api/v2/download/mods/StrawberryTool',
    },
    {
      name: "notnot's I Hate Blueberries",
      description: _i18n.t('已收集的草莓不变蓝'),
      download_url:
        'https://celeste.weg.fan/api/v2/download/mods/notnot%27s%20I%20Hate%20Blueberries',
      exclude_from_download_all: true,
    },
    {
      name: 'Infinite Backups',
      description: _i18n.t('提供更多、更完整的存档备份'),
      download_url:
        'https://celeste.weg.fan/api/v2/download/mods/InfiniteBackups',
    },
    {
      name: 'Mouse Controls',
      description: _i18n.t('鼠标操控'),
      download_url:
        'https://celeste.weg.fan/api/v2/download/mods/MouseControls',
    },
    {
      name: 'Better Refill Gems',
      description: _i18n.t('给一次性水晶加上红色边框'),
      download_url:
        'https://celeste.weg.fan/api/v2/download/mods/BetterRefillGems',
      exclude_from_download_all: true,
    },
    {
      name: 'Better Ice Walls',
      description: _i18n.t('优化冰墙显示，具有减小贴图厚度等多种选项'),
      download_url:
        'https://celeste.weg.fan/api/v2/download/mods/BetterIceWalls',
      exclude_from_download_all: true,
    },
    {
      name: 'Better Move Blocks',
      description: _i18n.t('给移动块加上白色边框，避免因为背景太黑了看不到'),
      download_url:
        'https://celeste.weg.fan/api/v2/download/mods/Better%20Move%20Blocks',
      exclude_from_download_all: true,
    },
  ].filter((v) => v);

export const _skinMods = () => [
  {
    name: 'Niko - Oneshot',
    description: _i18n.t('Oneshot Niko 皮肤'),
    download_url:
      'https://celeste.weg.fan/api/v2/download/mods/Niko_-_Celeste_Skin-Helper',
  },
  {
    name: 'Hyperline',
    description: _i18n.t('自定义头发颜色和长度'),
    download_url: 'https://celeste.weg.fan/api/v2/download/mods/Hyperline',
  },
  {
    name: 'Trailine',
    description: _i18n.t('剪影拖尾'),
    download_url: 'https://celeste.weg.fan/api/v2/download/mods/Trailine',
  },
  {
    name: 'Maddy Crown',
    description: _i18n.t('金草莓皇冠皮肤'),
    download_url: 'https://celeste.weg.fan/api/v2/download/mods/MaddyCrown',
  },
  {
    name: 'clover madeline',
    description: _i18n.t('绿色衬衫皮肤'),
    download_url:
      'https://celeste.weg.fan/api/v2/download/mods/Clover%20Madeline%20SMH',
  },
  {
    name: "Flame's Sprite Recolor",
    description: _i18n.t('红色背心皮肤'),
    download_url:
      'https://celeste.weg.fan/api/v2/download/mods/FlamespriteSkinModHelper',
  },
  {
    name: 'Fabeline',
    description: _i18n.t('彩虹头、双马尾皮肤'),
    download_url: 'https://celeste.weg.fan/api/v2/download/mods/RainbowMod',
  },
  {
    name: 'Bunneline',
    description: _i18n.t('兔耳皮肤'),
    download_url: 'https://celeste.weg.fan/api/v2/download/mods/Bunneline',
  },
  {
    name: 'Cateline',
    description: _i18n.t('猫德琳皮肤'),
    download_url: 'https://celeste.weg.fan/api/v2/download/mods/Cateline',
  },
  {
    name: 'Kirby SkinMod',
    description: _i18n.t('星之卡比皮肤'),
    download_url: 'https://celeste.weg.fan/api/v2/download/mods/Kirby%20skin',
  },
  {
    name: 'Gomez skinmod (FEZ)',
    description: _i18n.t('FEZ Gomez 皮肤'),
    download_url: 'https://celeste.weg.fan/api/v2/download/mods/FEZ_Gomez',
  },
  {
    name: 'Theo Mod',
    description: _i18n.t('Theo 皮肤'),
    download_url: 'https://celeste.weg.fan/api/v2/download/mods/TheoModv2',
  },
  {
    name: 'Tutorial Bird Skinmod',
    description: _i18n.t('将玛德琳和蓝鸟互换'),
    download_url: 'https://celeste.weg.fan/api/v2/download/mods/Birdeline',
  },
  {
    name: 'Cursed... things',
    description: _i18n.t('将玛德琳和水母互换'),
    download_url: 'https://celeste.weg.fan/api/v2/download/mods/cursedthings',
  },
  {
    name: 'Playback Strawberries',
    description: _i18n.t('【草莓】纯色皮肤'),
    download_url:
      'https://celeste.weg.fan/api/v2/download/mods/PlaybackStrawberries',
  },
  {
    name: 'uwu Kevins',
    description: _i18n.t('【Kevin】UwU 皮肤'),
    download_url: 'https://celeste.weg.fan/api/v2/download/mods/uwuKevins',
  },
  {
    name: 'uwubumpers',
    description: _i18n.t('【弹球】UwU 皮肤'),
    download_url: 'https://celeste.weg.fan/api/v2/download/mods/UwUbumpers',
  },
  {
    name: 'Cat Ear Binos',
    description: _i18n.t('【望远镜】猫耳皮肤'),
    download_url: 'https://celeste.weg.fan/api/v2/download/mods/Cat%20Binos',
  },
  {
    name: 'Replace Gold Flag With Star',
    description: _i18n.t('用星星代替金旗'),
    download_url:
      'https://celeste.weg.fan/api/v2/download/mods/ReplaceGoldFlagWithStar',
  },
  {
    name: 'Hateline',
    description: _i18n.t('Hateline'),
    download_url: 'https://celeste.weg.fan/api/v2/download/mods/Hateline',
  },
  {
    name: 'Picoline Figurine',
    description: _i18n.t('微型小雕像'),
    download_url:
      'https://celeste.weg.fan/api/v2/download/mods/PicolineFigurine',
  },
  {
    name: 'TaffylinePart1',
    description: _i18n.t('Taffyline Part1'),
    download_url: 'https://celeste.weg.fan/api/v2/download/mods/TaffylinePart1',
  },
  {
    name: 'TaffylinePart2',
    description: _i18n.t('Taffyline Part2'),
    download_url: 'https://celeste.weg.fan/api/v2/download/mods/TaffylinePart2',
  },
  {
    name: 'The Guy - IWBTJG',
    description: 'The Guy - IWBTJG',
    download_url:
      'https://celeste.weg.fan/api/v2/download/gamebanana-files/844056',
  },
  {
    name: 'Harold Madeline Skin',
    description: _i18n.t('Harold Madeline Skin'),
    download_url:
      'https://celeste.weg.fan/api/v2/download/gamebanana-files/846449',
  },
  {
    name: 'Funny Poses WIP',
    description: _i18n.t('有趣的姿势'),
    download_url:
      'https://celeste.weg.fan/api/v2/download/gamebanana-files/841273',
  },
  {
    name: 'PinkMadaline',
    description: _i18n.t('粉红玛德琳'),
    download_url:
      'https://celeste.weg.fan/api/v2/download/gamebanana-files/861301',
  },
  {
    name: 'Annoying Dog SkinMod',
    description: _i18n.t('神烦的狗'),
    download_url:
      'https://celeste.weg.fan/api/v2/download/gamebanana-files/859480',
  },
  {
    name: 'Fox',
    description: _i18n.t('狐狸'),
    download_url:
      'https://celeste.weg.fan/api/v2/download/gamebanana-files/857866',
  },
];

export const _mapMods = () => [
  {
    name: _i18n.t('StrawberryJam Collab （草莓酱）'),
    description: _i18n.t(
      '全蔚蓝最大的地图集，涵盖多个难度，美术优秀，地图有趣，适合新手和老玩家'
    ),
    download_url:
      'https://celeste.weg.fan/api/v2/download/mods/StrawberryJam2021',
  },
  {
    name: _i18n.t('Spring Collab （春游）'),
    description: _i18n.t('另一个大型地图集，与草莓酱相比较简单'),
    download_url:
      'https://celeste.weg.fan/api/v2/download/mods/SpringCollab2020',
  },
  {
    name: _i18n.t('Gallery Collab（画游）'),
    description: _i18n.t(
      '中国玩家制作的地图集，地图较少，美术精美，适合新手和老玩家'
    ),
    download_url:
      'https://celeste.weg.fan/api/v2/download/mods/ChineseNewYear2024Collab',
  },
  {
    name: _i18n.t('Winter Collab （冬游）'),
    description: _i18n.t('另一个大型地图集，与草莓酱相比较简单'),
    download_url:
      'https://celeste.weg.fan/api/v2/download/mods/WinterCollab2021',
  },
  {
    name: 'the road less travelled',
    description: _i18n.t('独立地图，酱一难度，比较宁静，官图A面过后可打'),
    download_url:
      'https://celeste.weg.fan/api/v2/download/mods/the%20road%20less%20travelled',
  },
  {
    name: 'glyph',
    description: _i18n.t('独立地图，酱二红难度，老图，要求'),
    download_url: 'https://celeste.weg.fan/api/v2/download/mods/glyph',
  },
];

/*
into the jungle 官
gate to the stars
far away
glyph
*/
