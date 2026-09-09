import React from "react";
import { createRoot } from "react-dom/client";
import { AndroidLogs } from "../../src/components/AndroidLogs";
import "../../src/index.scss";
import "../../src/routes/Settings.scss";
import "../../src/styles/android.scss";

document.documentElement.dataset.platform = "android";
createRoot(document.getElementById("root")!).render(<React.StrictMode>
  <main className="settings-page" style={{ width: "100%", maxWidth: 412, height: "100%", overflow: "auto" }}>
    <h1>日志查看测试</h1>
    <p>游戏：长日志；安装器：暂无日志；应用：模拟读取失败。切换来源可测试过期响应。</p>
    <div className="settings-card"><AndroidLogs /></div>
  </main>
</React.StrictMode>);
