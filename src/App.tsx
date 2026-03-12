import { useState, useEffect } from "react";
import "./App.css";
import { EmbedPDFViewer } from "./components/PDFViewer/EmbedPDFViewer";
import { invoke } from "@tauri-apps/api/core";

function App() {
    const [showOverlay, setShowOverlay] = useState(true);
    const [isHighAccuracy, setIsHighAccuracy] = useState(false);
    const [initialFilePath, setInitialFilePath] = useState<string | null>(null);

    useEffect(() => {
        // Obtenemos el archivo pasado como argumento en el arranque (e.g. doble clic en Windows)
        invoke<string | null>('get_startup_file')
            .then(path => {
                if (path) {
                    console.log("[App] Startup file received:", path);
                    setInitialFilePath(path);
                }
            })
            .catch(console.error);
    }, []);

    return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0f172a' }}>
            {/* ── Header ──────────────────────────────────────────────────────── */}
            <header style={{
                padding: '0 20px',
                height: '52px',
                background: '#1e293b',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
                zIndex: 30,
            }}>
                {/* Title */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <h1 style={{ margin: 0, fontSize: '16px', fontWeight: 700, letterSpacing: '0.02em' }}>
                        Tauri AI PDF OCR
                    </h1>
                    <span style={{
                        fontSize: '11px',
                        background: 'rgba(99,102,241,0.2)',
                        color: '#a5b4fc',
                        padding: '2px 8px',
                        borderRadius: '20px',
                        fontWeight: 500,
                    }}>v0.1.0</span>
                </div>

                {/* Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}
                        title="Mostrar/ocultar cajas OCR en el PDF">
                        <input
                            type="checkbox"
                            checked={showOverlay}
                            onChange={e => setShowOverlay(e.target.checked)}
                            style={{ accentColor: '#818cf8', cursor: 'pointer' }}
                        />
                        Overlay OCR
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}
                        title="Alta precisión: 300 DPI, más lento pero mejor para texto pequeño">
                        <input
                            type="checkbox"
                            checked={isHighAccuracy}
                            onChange={e => setIsHighAccuracy(e.target.checked)}
                            style={{ accentColor: '#818cf8', cursor: 'pointer' }}
                        />
                        Alta precisión
                    </label>

                </div>
            </header>

            {/* ── Viewer (fills rest of screen) ───────────────────────────────── */}
            <div style={{ flex: 1, overflow: 'hidden' }}>
                <EmbedPDFViewer
                    showOverlay={showOverlay}
                    isHighAccuracy={isHighAccuracy}
                    initialFilePath={initialFilePath}
                />
            </div>
        </div>
    );
}

export default App;
