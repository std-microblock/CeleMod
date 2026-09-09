import React from "react";
import { createRoot } from "react-dom/client";
import { AndroidKeyBindings } from "../../src/routes/AndroidKeyBindings";
import "../../src/index.scss";
document.documentElement.dataset.platform = "android";
createRoot(document.getElementById("root")!).render(<React.StrictMode><AndroidKeyBindings /></React.StrictMode>);
