import "./ui/styles.css";
import { createRoot } from "react-dom/client";
import App from "./ui/App";

createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
