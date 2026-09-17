import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import "./theme.css";
import "./app.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
