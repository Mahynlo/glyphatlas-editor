import React from 'react';

interface OCRResult {
    pageIndex: number;
    results: any[];
    stats: any;
}

interface ActiveRedaction {
    term: string;
    count: number;
}

interface ResultsPanelProps {
    results: OCRResult[];
    isOpen: boolean;
    onClose: () => void;
    onRedact: (term: string) => void;
    activeRedactions?: ActiveRedaction[];
    onClearRedaction?: (term: string) => void;
}

export const ResultsPanel: React.FC<ResultsPanelProps> = ({
    results, isOpen, onClose, onRedact,
    activeRedactions = [], onClearRedaction
}) => {
    const [searchTerm, setSearchTerm] = React.useState("");

    if (!isOpen) return null;

    const getPageText = (result: OCRResult) => {
        if (!result || !result.results) return "";
        return result.results.map(r => r.text).join(' ');
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const handleRedactClick = () => {
        if (!searchTerm.trim()) return;
        onRedact(searchTerm.trim());
        setSearchTerm("");
    };

    return (
        <div style={{
            width: '350px',
            background: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}>
            {/* ── Header ─────────────────────────────────────────────── */}
            <div style={{
                padding: '12px 14px 10px',
                borderBottom: '1px solid #e5e7eb',
                background: '#f9fafb',
                display: 'flex',
                flexDirection: 'column',
                gap: '9px',
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                        <span style={{ fontSize: '14px' }}>📝</span>
                        <span style={{
                            fontSize: '13px',
                            fontWeight: 600,
                            color: '#111827',
                            letterSpacing: '0.01em'
                        }}>Texto extraído (OCR)</span>
                    </div>
                    <button
                        onClick={onClose}
                        title="Cerrar"
                        style={{
                            background: 'none',
                            border: 'none',
                            width: '26px',
                            height: '26px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#6b7280',
                            fontSize: '15px',
                            lineHeight: 1,
                            padding: 0,
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#e5e7eb')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                        ✕
                    </button>
                </div>

                {/* Search / Redact bar */}
                <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                        type="text"
                        placeholder="Palabra u oración a censurar..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleRedactClick(); }}
                        style={{
                            flex: 1,
                            padding: '5px 9px',
                            border: '1px solid #d1d5db',
                            borderRadius: '5px',
                            fontSize: '12px',
                            color: '#111827',
                            background: '#fff',
                            outline: 'none',
                            fontFamily: 'inherit',
                        }}
                    />
                    <button
                        onClick={handleRedactClick}
                        disabled={!searchTerm.trim()}
                        style={{
                            background: searchTerm.trim() ? '#dc2626' : '#f3f4f6',
                            color: searchTerm.trim() ? 'white' : '#9ca3af',
                            border: 'none',
                            borderRadius: '5px',
                            padding: '5px 11px',
                            fontSize: '12px',
                            fontWeight: 500,
                            cursor: searchTerm.trim() ? 'pointer' : 'not-allowed',
                            whiteSpace: 'nowrap',
                            fontFamily: 'inherit',
                        }}
                    >
                        ■ Censurar
                    </button>
                </div>

                {/* Active redaction chips */}
                {activeRedactions.length > 0 && (
                    <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '5px',
                        paddingTop: '2px',
                    }}>
                        {activeRedactions.map(({ term, count }) => (
                            <div
                                key={term}
                                title={`Haz clic en ✕ para quitar censura de "${term}"`}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    background: '#1f2937',
                                    color: '#f9fafb',
                                    borderRadius: '4px',
                                    padding: '2px 7px 2px 8px',
                                    fontSize: '11px',
                                    fontWeight: 500,
                                    maxWidth: '160px',
                                }}
                            >
                                <span style={{
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    maxWidth: '100px',
                                }} title={term}>"{term}"</span>
                                <span style={{ color: '#9ca3af', fontSize: '10px' }}>×{count}</span>
                                <button
                                    onClick={() => onClearRedaction?.(term)}
                                    title={`Quitar censura de "${term}"`}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        color: '#9ca3af',
                                        padding: '0 0 0 2px',
                                        fontSize: '11px',
                                        lineHeight: 1,
                                        display: 'flex',
                                        alignItems: 'center',
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                                    onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Content ────────────────────────────────────────────── */}
            <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
            }}>
                {results.length === 0 ? (
                    <div style={{
                        textAlign: 'center',
                        color: '#9ca3af',
                        marginTop: '50px',
                        fontSize: '13px',
                        lineHeight: 1.6,
                    }}>
                        <div style={{ fontSize: '30px', marginBottom: '10px', opacity: 0.35 }}>🔍</div>
                        Sin resultados.<br />Ejecuta el OCR para extraer texto.
                    </div>
                ) : (
                    results.map((res, idx) => res ? (
                        <div key={idx} style={{
                            border: '1px solid #e5e7eb',
                            borderRadius: '7px',
                            overflow: 'hidden',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                        }}>
                            {/* Page header row */}
                            <div style={{
                                padding: '7px 10px',
                                background: '#f3f4f6',
                                borderBottom: '1px solid #e5e7eb',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                            }}>
                                <span style={{
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    color: '#374151',
                                }}>
                                    Página {res.pageIndex + 1}
                                </span>
                                <button
                                    onClick={() => copyToClipboard(getPageText(res))}
                                    title="Copiar texto"
                                    style={{
                                        background: 'white',
                                        border: '1px solid #d1d5db',
                                        padding: '3px 8px',
                                        borderRadius: '4px',
                                        color: '#374151',
                                        cursor: 'pointer',
                                        fontSize: '11px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '3px',
                                        fontFamily: 'inherit',
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'white')}
                                >
                                    📋 Copiar
                                </button>
                            </div>

                            {/* Editable text area */}
                            <textarea
                                defaultValue={getPageText(res)}
                                style={{
                                    width: '100%',
                                    minHeight: '120px',
                                    border: 'none',
                                    padding: '10px',
                                    resize: 'vertical',
                                    fontSize: '12px',
                                    lineHeight: '1.65',
                                    color: '#1f2937',
                                    background: '#ffffff',
                                    outline: 'none',
                                    boxSizing: 'border-box',
                                    fontFamily: 'inherit',
                                    display: 'block',
                                }}
                            />

                            {/* Stats footer */}
                            {res.stats && (
                                <div style={{
                                    padding: '5px 10px',
                                    borderTop: '1px solid #f3f4f6',
                                    fontSize: '10.5px',
                                    color: '#9ca3af',
                                    display: 'flex',
                                    gap: '12px',
                                    background: '#fafafa',
                                }}>
                                    {res.stats.averageConfidence != null && (
                                        <span>Confianza: {(res.stats.averageConfidence * 100).toFixed(0)}%</span>
                                    )}
                                    {res.stats.wordsFound != null && (
                                        <span>Palabras: {res.stats.wordsFound}</span>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : null)
                )}
            </div>
        </div>
    );
};
