import { h, render } from "preact";
import App from "./App";
import "./index.scss";
import "./i2.css";
import "./platform/window";

render(<App />, document.getElementById("root")! as any);
