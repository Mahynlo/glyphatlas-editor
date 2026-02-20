import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "pdfjs-dist/web/pdf_viewer.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
