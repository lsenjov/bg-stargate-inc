import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function App() {
  return <main>Stargate Inc. online play is being assembled.</main>;
}

const root = document.querySelector<HTMLDivElement>("#root");

if (!root) {
  throw new Error("Missing application root");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
