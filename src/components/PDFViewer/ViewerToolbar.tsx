import React from 'react';

interface OCRProgress {
    current: number;
    total: number;
    status: string;
}

interface ViewerToolbarProps {
    ocrStatus: 'idle' | 'processing' | 'done' | 'error';
    ocrProgress: OCRProgress;
    ocrResultsCount: number;
    isPanelOpen: boolean;
    showOverlay: boolean;
    isHighAccuracy: boolean;
    workerStatus: 'initializing' | 'ready' | 'error';
    engineIsNative: boolean;
    onStartOCR: () => void;
    onTogglePanel: () => void;
    onToggleOverlay: (v: boolean) => void;
    onToggleHighAccuracy: (v: boolean) => void;
}

export const ViewerToolbar: React.FC<ViewerToolbarProps> = ({
    ocrStatus,
    ocrProgress,
    ocrResultsCount,
    isPanelOpen,
    showOverlay,
    isHighAccuracy,
    workerStatus,
    engineIsNative,
    onStartOCR,
    onTogglePanel,
    onToggleOverlay,
    onToggleHighAccuracy,
}) => {
    const isProcessing = ocrStatus === 'processing';
    const ocrDisabled =
        (engineIsNative ? false : workerStatus !== 'ready') || isProcessing;

    const progressPct =
        ocrProgress.total > 0
            ? Math.round((ocrProgress.current / ocrProgress.total) * 100)
            : 0;

    return (
        <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 20,
            background: 'rgba(30, 41, 59, 0.92)',
            backdropFilter: 'blur(8px)',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '0 12px',
            height: '44px',
            userSelect: 'none',
        }}>
            {/* OCR Trigger button */}
            <button
                onClick={onStartOCR}
                disabled={ocrDisabled}
                title={isProcessing ? ocrProgress.status : 'Ejecutar OCR en la página actual'}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '5px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: ocrDisabled ? 'not-allowed' : 'pointer',
                    fontSize: '12px',
                    fontWeight: 600,
                    letterSpacing: '0.02em',
                    transition: 'background 0.15s, opacity 0.15s',
                    opacity: ocrDisabled ? 0.5 : 1,
                    background: isProcessing
                        ? 'rgba(234,179,8,0.2)'
                        : ocrStatus === 'done'
                            ? 'rgba(34,197,94,0.2)'
                            : 'rgba(99,102,241,0.85)',
                    color: isProcessing
                        ? '#fde047'
                        : ocrStatus === 'done'
                            ? '#86efac'
                            : '#fff',
                    boxShadow: ocrStatus === 'idle' ? '0 1px 6px rgba(99,102,241,0.4)' : 'none',
                }}
            >
                <span style={{ fontSize: '14px' }}>
                    {isProcessing ? '⏳' : ocrStatus === 'done' ? '✓' : '🔍'}
                </span>
                {isProcessing
                    ? `OCR… ${progressPct}%`
                    : ocrStatus === 'done'
                        ? 'Re-OCR'
                        : 'OCR'}
            </button>

            {/* Progress bar — inline, only when processing */}
            {isProcessing && ocrProgress.total > 0 && (
                <div style={{
                    flex: 1,
                    maxWidth: '160px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                }}>
                    <div style={{
                        height: '4px',
                        background: 'rgba(255,255,255,0.12)',
                        borderRadius: '2px',
                        overflow: 'hidden',
                    }}>
                        <div style={{
                            height: '100%',
                            width: `${progressPct}%`,
                            background: 'linear-gradient(90deg, #818cf8, #6366f1)',
                            borderRadius: '2px',
                            transition: 'width 0.3s ease',
                        }} />
                    </div>
                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>
                        {ocrProgress.current}/{ocrProgress.total} pág.
                    </span>
                </div>
            )}

            {/* Separator */}
            <div style={{ width: '1px', height: '22px', background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />

            {/* Open panel button — only if there are results */}
            {ocrResultsCount > 0 && (
                <button
                    onClick={onTogglePanel}
                    title="Texto extraído (OCR)"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '5px 10px',
                        borderRadius: '6px',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: 500,
                        transition: 'background 0.15s',
                        background: isPanelOpen
                            ? 'rgba(99,102,241,0.35)'
                            : 'rgba(255,255,255,0.07)',
                        color: isPanelOpen ? '#a5b4fc' : 'rgba(255,255,255,0.7)',
                    }}
                >
                    <span style={{ fontSize: '13px' }}>📝</span>
                    Texto OCR
                </button>
            )}

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Worker status pill (only for paddle engine while initializing) */}
            {workerStatus === 'initializing' && (
                <span style={{
                    fontSize: '10px',
                    color: 'rgba(255,255,255,0.35)',
                    background: 'rgba(255,255,255,0.06)',
                    padding: '2px 8px',
                    borderRadius: '20px',
                    letterSpacing: '0.03em',
                }}>
                    Inicializando motor…
                </span>
            )}
            {workerStatus === 'error' && (
                <span style={{
                    fontSize: '10px',
                    color: '#fca5a5',
                    background: 'rgba(239,68,68,0.12)',
                    padding: '2px 8px',
                    borderRadius: '20px',
                }}>
                    Error del motor
                </span>
            )}

            {/* Toggles */}
            <label style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                fontSize: '11px', color: 'rgba(255,255,255,0.55)', cursor: 'pointer',
            }} title="Mostrar/ocultar cajas OCR en el PDF">
                <input
                    type="checkbox"
                    checked={showOverlay}
                    onChange={e => onToggleOverlay(e.target.checked)}
                    style={{ accentColor: '#818cf8', cursor: 'pointer' }}
                />
                Overlay
            </label>

            <label style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                fontSize: '11px', color: 'rgba(255,255,255,0.55)', cursor: 'pointer',
            }} title="Alta precisión: 300 DPI, más lento pero mejor para texto pequeño">
                <input
                    type="checkbox"
                    checked={isHighAccuracy}
                    onChange={e => onToggleHighAccuracy(e.target.checked)}
                    style={{ accentColor: '#818cf8', cursor: 'pointer' }}
                />
                Alta precisión
            </label>
        </div>
    );
};
