import React from "react";
import { createRoot } from "react-dom/client";
import { Multiplayer } from "../../src/routes/Multiplayer";
import "../../src/index.scss";
import "./shell.scss";

document.documentElement.dataset.mobileLayout = "";
document.documentElement.dataset.platform = "android";
createRoot(document.getElementById("root")!).render(<React.StrictMode>
  <div className="app-frame"><div className="app-shell">
    <main className="app-content"><Multiplayer /></main>
    <nav className="mobile-navigation" aria-label="底部导航">
      {["主页", "搜索", "管理", "下载", "更多"].map(text => <button key={text} className="mobile-nav-button">{text}</button>)}
    </nav>
  </div></div>
</React.StrictMode>);
