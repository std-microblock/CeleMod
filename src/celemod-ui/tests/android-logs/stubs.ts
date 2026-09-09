export default { t: (key: string) => key, currentLang: "zh-CN" };

let reads = 0;
export async function invoke(command: string, { source }: { source: string }) {
  if (command !== "android_read_log") throw new Error(`Unexpected command: ${command}`);
  const revision = ++reads;
  await new Promise(resolve => setTimeout(resolve, source === "game" ? 600 : 50));
  if (source === "app") throw new Error("模拟读取错误");
  return {
    content: source === "game" ? Array.from({ length: 1200 }, (_, i) => `[${i}] 游戏启动 / Mod 加载 <script>not HTML</script> ${"长路径/".repeat(12)}`).join("\n") + `\n日志末尾 #${revision}` : "",
    exists: source === "game",
    truncated: source === "game",
    size: source === "game" ? 524288 : 0,
    modifiedAt: source === "game" ? 1788879600000 : null,
  };
}
