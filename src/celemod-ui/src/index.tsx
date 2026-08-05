import { createRoot } from 'react-dom/client';
import App from "./App";
import "./index.scss";
import "./i2.css";
import { initializeWindowChrome } from './tauri/window';

initializeWindowChrome();

createRoot(document.getElementById('root')!).render(<App />);
