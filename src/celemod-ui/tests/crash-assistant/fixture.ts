import type { CrashAnalysis } from "../../src/components/CrashAssistant";

// Captured from a real EverestUltra 6486 crash report so the fixture replays the
// exact excerpt/stacktrace shape the crash assistant has to render.
export const fixtureAnalysis: CrashAnalysis = {
  fingerprint: "1:bb607e1a86c597bb",
  eventId: "bb607e1a86c597bb",
  crashIndex: 1,
  logModifiedAt: 1789922675283,
  sourceLog: "C:\\SteamLibrary\\steamapps\\common\\Celeste\\log.txt",
  reportPath:
    "C:\\Users\\mbcloud\\AppData\\Local\\CeleMod\\crash-reports\\CeleMod-Crash-1789922675283-1.txt",
  exception:
    "System.ArithmeticException: Function does not accept floating point Not-a-Number values.",
  summary: "可能是 Mod 代码抛出的异常",
  reasons: ["stacktrace 中出现了已安装 Mod 的程序集或命名空间。"],
  suggestions: [
    "检测到可疑 Mod 有更新，建议先更新后重试。",
    "优先更新或暂时禁用高置信度的可疑 Mod，再观察是否复现。",
  ],
  suspects: [
    {
      name: "Aqua",
      file: "Aqua.zip",
      installedVersion: "1.2.7",
      updateAvailable: false,
      confidence: 96,
      evidence:
        "at Hook<System.Void Celeste.Mod.Aqua.Core.PresentationHook::Engine_Update(On.Monocle.Engine+orig_Update,Monocle.Engine,Microsoft.Xna.Framework.GameTime)>(Engine , GameTime )",
      dependents: [
        {
          name: "SSC2026",
          optional: false,
        },
      ],
    },
    {
      name: "AurorasHelper",
      file: "AurorasHelper.zip",
      installedVersion: "0.12.6",
      latestVersion: "0.12.7",
      gameBananaFileId: 512345,
      updateAvailable: true,
      confidence: 96,
      evidence:
        "at Hook<System.Void Celeste.Mod.AurorasHelper.AurorasHelperModule::ModLevelUpdate(On.Celeste.Level+orig_Update,Celeste.Level)>(Level )",
      dependents: [
        {
          name: "CanvasContest",
          optional: false,
        },
        {
          name: "CrossoverCollab",
          optional: false,
        },
        {
          name: "ChineseNewYear2024Collab",
          optional: false,
        },
        {
          name: "P2PConlab",
          optional: false,
        },
        {
          name: "SSC2026",
          optional: false,
        },
      ],
    },
    {
      name: "BounceHelper",
      file: "BounceHelper.zip",
      installedVersion: "1.14.1",
      updateAvailable: false,
      confidence: 96,
      evidence:
        "at Hook<System.Void Celeste.Mod.BounceHelper.BounceHelperModule::modEngineUpdate(On.Monocle.Engine+orig_Update,Monocle.Engine,Microsoft.Xna.Framework.GameTime)>(Engine , GameTime )",
      dependents: [
        {
          name: "StrawberryJam2021",
          optional: false,
        },
        {
          name: "CanvasContest",
          optional: false,
        },
        {
          name: "GooberHelper",
          optional: true,
        },
        {
          name: "GravityHelper",
          optional: true,
        },
        {
          name: "LoungeMod",
          optional: false,
        },
        {
          name: "P2PConlab",
          optional: false,
        },
        {
          name: "MaxHelpingHand",
          optional: true,
        },
        {
          name: "SSC2026",
          optional: false,
        },
      ],
    },
    {
      name: "ChroniaHelper",
      file: "ChroniaHelper.zip",
      installedVersion: "1.53.13",
      latestVersion: "1.55.6",
      gameBananaFileId: 654321,
      updateAvailable: true,
      confidence: 96,
      evidence:
        "at Hook<System.Void ChroniaHelper.Cores.MapProcessor::OnLevelUpdate(On.Celeste.Level+orig_Update,Celeste.Level)>(Level )",
      dependents: [
        {
          name: "CanvasContest",
          optional: false,
        },
        {
          name: "CrossoverCollab",
          optional: false,
        },
        {
          name: "P2PConlab",
          optional: false,
        },
        {
          name: "SSC2026",
          optional: false,
        },
      ],
    },
    {
      name: "CommunalHelper",
      file: "CommunalHelper.zip",
      installedVersion: "1.25.5",
      updateAvailable: false,
      confidence: 96,
      evidence:
        "at Hook<System.Void Celeste.Mod.KyfexHelper.CommunalHelperCompat::cleanInfLength(On.Celeste.Level+orig_Update,Celeste.Level)>(Level )",
      dependents: [
        {
          name: "StrawberryJam2021",
          optional: false,
        },
        {
          name: "auspicioushelper",
          optional: true,
        },
        {
          name: "Banana Mountain",
          optional: false,
        },
        {
          name: "BlixelHelper",
          optional: false,
        },
        {
          name: "BrokemiaHelper",
          optional: true,
        },
        {
          name: "CanvasContest",
          optional: false,
        },
        {
          name: "ChroniaHelper",
          optional: true,
        },
        {
          name: "CrossoverCollab",
          optional: false,
        },
        {
          name: "FemtoHelper",
          optional: true,
        },
        {
          name: "Frozen Time",
          optional: false,
        },
        {
          name: "FurryHelper",
          optional: true,
        },
        {
          name: "GravityHelper",
          optional: true,
        },
        {
          name: "ChineseNewYear2024Collab",
          optional: false,
        },
        {
          name: "P2PConlab",
          optional: false,
        },
        {
          name: "MaxHelpingHand",
          optional: true,
        },
        {
          name: "NerdHelper",
          optional: true,
        },
        {
          name: "RainTools",
          optional: true,
        },
        {
          name: "SparkInTheMachine",
          optional: false,
        },
        {
          name: "SpirialisHelper",
          optional: true,
        },
        {
          name: "SSC2026",
          optional: false,
        },
        {
          name: "SSMQoLMod",
          optional: true,
        },
        {
          name: "WindHelper",
          optional: true,
        },
      ],
    },
    {
      name: "ConditionHelper",
      file: "ConditionHelper.zip",
      installedVersion: "1.0.0",
      updateAvailable: false,
      confidence: 96,
      evidence:
        "at Hook<System.Void Celeste.Mod.ConditionHelper.ConditionWatcher::Level_Update(On.Celeste.Level+orig_Update,Celeste.Level)>(Level )",
      dependents: [
        {
          name: "AchievementHelper",
          optional: false,
        },
        {
          name: "SSC2026",
          optional: false,
        },
      ],
    },
  ],
  everestVersion: 6486,
  isEverestUltra: true,
  excerpt:
    "(09/21/2026 00:44:24) [Everest] [Error] [crit-error-handler] >>>>>>>>>>>>>>> ENCOUNTERED A CRITICAL ERROR <<<<<<<<<<<<<<<\n--------------------------------\nSystem.ArithmeticException: Function does not accept floating point Not-a-Number values.\n   at System.Math.Sign(Single value)\n   at Celeste.MountainRenderer.EaseCamera(Int32 area, MountainCamera transform, Nullable`1 duration, Boolean nearTarget, Boolean targetRotate)\n   at Celeste.OuiTitleScreen.Enter(Oui from)+MoveNext()\n   at Monocle.Coroutine.orig_Update()\n   at Celeste.Mod.Aqua.Core.EntityListExtensions.EntityList_Update(orig_Update orig, EntityList self)\n   at Hook<System.Void Celeste.Mod.Aqua.Core.EntityListExtensions::EntityList_Update(On.Monocle.EntityList+orig_Update,Monocle.EntityList)>(EntityList )\n   at Celeste.Mod.KyfexHelper.InputSwapBlock.inputListeners(orig_Update orig, Scene self)\n   at Hook<System.Void Celeste.Mod.KyfexHelper.InputSwapBlock::inputListeners(On.Monocle.Scene+orig_Update,Monocle.Scene)>(Scene )\n   at Celeste.Mod.Aqua.Rendering.RenderHook.Scene_Update(orig_Update orig, Scene self)\n   at ChroniaHelper.Cores.MapProcessor.GlobalUpdate(orig_Update orig, Scene self)\n   at Celeste.Mod.AurorasHelper.AurorasHelperModule.ModLevelUpdate(orig_Update orig, Level level)\n   at Hook<System.Void Celeste.Mod.AurorasHelper.AurorasHelperModule::ModLevelUpdate(On.Celeste.Level+orig_Update,Celeste.Level)>(Level )\n   at Celeste.Mod.KyfexHelper.CommunalHelperCompat.cleanInfLength(orig_Update orig, Level self)\n   at Hook<System.Void Celeste.Mod.KyfexHelper.CommunalHelperCompat::cleanInfLength(On.Celeste.Level+orig_Update,Celeste.Level)>(Level )\n   at Celeste.Mod.ConditionHelper.ConditionWatcher.Level_Update(orig_Update orig, Level self)\n   at Hook<System.Void Celeste.Mod.ConditionHelper.ConditionWatcher::Level_Update(On.Celeste.Level+orig_Update,Celeste.Level)>(Level )\n   at Celeste.Mod.BounceHelper.BounceHelperModule.modEngineUpdate(orig_Update orig, Engine engine, GameTime gameTime)\n   at Hook<System.Void Celeste.Mod.BounceHelper.BounceHelperModule::modEngineUpdate(On.Monocle.Engine+orig_Update,Monocle.Engine,Microsoft.Xna.Framework.GameTime)>(Engine , GameTime )\n   at Celeste.Mod.Aqua.Core.PresentationHook.Engine_Update(orig_Update orig, Engine self, GameTime gameTime)\n   at Hook<System.Void Celeste.Mod.Aqua.Core.PresentationHook::Engine_Update(On.Monocle.Engine+orig_Update,Monocle.Engine,Microsoft.Xna.Framework.GameTime)>(Engine , GameTime )\n   at SyncProxy<System.Void Monocle.Engine:Update(Microsoft.Xna.Framework.GameTime)>(Engine )\n   at Monocle.Engine.RunWithLogging()\n(09/21/2026 00:44:24) [Everest] [Info] [crit-error-handler] Backed up log file to 'C:\\SteamLibrary\\steamapps\\common\\Celeste\\CrashLogs\\log_20260921_004424.txt'\n(09/21/2026 00:44:24) [Everest] [Info] [crit-error-handler] Created critical error handler for exception System.ArithmeticException: Function does not accept floating point Not-a-Number values.",
};

export const FIXTURE_GAME_PATH =
  "C:\\SteamLibrary\\steamapps\\common\\Celeste\\Celeste.exe";
