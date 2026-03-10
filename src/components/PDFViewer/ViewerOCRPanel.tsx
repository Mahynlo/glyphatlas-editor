import React, { useState } from 'react';
import type { RedactionMode } from './EmbedPDFViewer';

interface OcrResult {
    pageIndex: number;
    results: any[];
    stats?: any;
}

interface ActiveRedaction {
    term: string;
    count: number;
    mode: RedactionMode;
}

interface ViewerOCRPanelProps {
    results: OcrResult[];
    isOpen: boolean;
    onClose: () => void;
    onRedact: (term: string, mode: RedactionMode) => void;
    activeRedactions: ActiveRedaction[];
    onClearRedaction: (term: string, mode: RedactionMode) => void;
    onConfirmRedactions: () => void;
    redactionMode: RedactionMode;
    onRedactionModeChange: (mode: RedactionMode) => void;
}

export const ViewerOCRPanel: React.FC<ViewerOCRPanelProps> = ({
    results,
    isOpen,
    onClose,
    onRedact,
    activeRedactions,
    onClearRedaction,
    onConfirmRedactions,
    redactionMode,
    onRedactionModeChange,
}) => {
    const [searchTerm, setSearchTerm] = useState('');

    const getPageText = (result: OcrResult) =>
        result?.results?.map((r: any) => r.text).join(' ') ?? '';

    const copyToClipboard = (text: string) =>
        navigator.clipboard.writeText(text).catch(console.error);

    const handleApply = () => {
        const trimmed = searchTerm.trim();
        if (!trimmed) return;
        onRedact(trimmed, redactionMode);
        setSearchTerm('');
    };

    const burnRedactions = activeRedactions.filter(r => r.mode === 'redact');
    const maskRedactions = activeRedactions.filter(r => r.mode === 'mask');

    return (
        <div style={{
            width: isOpen ? '340px' : '0px',
            minWidth: isOpen ? '340px' : '0px',
            transition: 'width 0.3s ease, min-width 0.3s ease',
            overflow: 'hidden',
            borderLeft: isOpen ? '1px solid rgba(255,255,255,0.08)' : 'none',
            background: '#1e293b',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            flexShrink: 0,
        }}>
            {isOpen && (
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    color: '#e2e8f0',
                }}>
                    {/* ── Header ─────────────────────────────────────────── */}
                    <div style={{
                        padding: '12px 14px 10px',
                        borderBottom: '1px solid rgba(255,255,255,0.07)',
                        background: 'rgba(255,255,255,0.03)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                        flexShrink: 0,
                    }}>
                        {/* Title row */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                                <span style={{ fontSize: '14px' }}>📝</span>
                                <span style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>
                                    Texto extraído (OCR)
                                </span>
                            </div>
                            <button
                                onClick={onClose}
                                style={{
                                    background: 'none', border: 'none', width: '26px', height: '26px',
                                    borderRadius: '5px', cursor: 'pointer', display: 'flex',
                                    alignItems: 'center', justifyContent: 'center', color: '#64748b',
                                    fontSize: '15px', padding: 0,
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#94a3b8'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#64748b'; }}
                            >✕</button>
                        </div>

                        {/* ── Redaction mode toggle ─────────────────────── */}
                        <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.2)', borderRadius: '7px', padding: '3px' }}>
                            {([
                                { mode: 'mask' as RedactionMode, label: '⬛ Máscara', title: 'Coloca un recuadro negro — oculta visualmente, no elimina del PDF' },
                                { mode: 'redact' as RedactionMode, label: '✂ Redactar', title: 'Marcado pendiente — se elimina permanentemente del PDF al confirmar' },
                            ]).map(opt => (
                                <button
                                    key={opt.mode}
                                    onClick={() => onRedactionModeChange(opt.mode)}
                                    title={opt.title}
                                    style={{
                                        flex: 1,
                                        padding: '5px 8px',
                                        borderRadius: '5px',
                                        border: 'none',
                                        cursor: 'pointer',
                                        fontSize: '11px',
                                        fontWeight: redactionMode === opt.mode ? 700 : 500,
                                        background: redactionMode === opt.mode
                                            ? (opt.mode === 'redact' ? 'rgba(239,68,68,0.3)' : 'rgba(99,102,241,0.3)')
                                            : 'transparent',
                                        color: redactionMode === opt.mode
                                            ? (opt.mode === 'redact' ? '#fca5a5' : '#a5b4fc')
                                            : '#64748b',
                                        transition: 'background 0.15s, color 0.15s',
                                    }}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>

                        {/* Mode description */}
                        <div style={{ fontSize: '10px', color: '#475569', lineHeight: 1.4, padding: '0 2px' }}>
                            {redactionMode === 'mask'
                                ? '⬛ Máscara visual — reversible. El contenido sigue en el PDF.'
                                : '✂ Redacción permanente — marcas pendientes. Confirma para eliminar del PDF.'}
                        </div>

                        {/* Input + Apply */}
                        <div style={{ display: 'flex', gap: '6px' }}>
                            <input
                                type="text"
                                placeholder="Palabra u oración a censurar…"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleApply(); }}
                                style={{
                                    flex: 1, padding: '6px 10px',
                                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
                                    fontSize: '12px', color: '#e2e8f0',
                                    background: 'rgba(255,255,255,0.05)', outline: 'none', fontFamily: 'inherit',
                                }}
                                onFocus={e => e.currentTarget.style.borderColor = 'rgba(99,102,241,0.6)'}
                                onBlur={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'}
                            />
                            <button
                                onClick={handleApply}
                                disabled={!searchTerm.trim()}
                                style={{
                                    background: searchTerm.trim()
                                        ? (redactionMode === 'redact' ? 'rgba(239,68,68,0.8)' : 'rgba(99,102,241,0.8)')
                                        : 'rgba(255,255,255,0.05)',
                                    color: searchTerm.trim() ? '#fff' : '#475569',
                                    border: 'none', borderRadius: '6px', padding: '6px 12px',
                                    fontSize: '12px', fontWeight: 600,
                                    cursor: searchTerm.trim() ? 'pointer' : 'not-allowed',
                                    whiteSpace: 'nowrap', fontFamily: 'inherit', transition: 'background 0.15s',
                                }}
                            >
                                Aplicar
                            </button>
                        </div>

                        {/* Active redaction chips — mask */}
                        {maskRedactions.length > 0 && (
                            <div>
                                <div style={{ fontSize: '10px', color: '#475569', marginBottom: '4px' }}>Máscaras activas:</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                    {maskRedactions.map(({ term, count }) => (
                                        <RedactionChip
                                            key={`mask-${term}`}
                                            term={term} count={count}
                                            color="rgba(99,102,241,0.15)" borderColor="rgba(99,102,241,0.3)" textColor="#a5b4fc"
                                            onClear={() => onClearRedaction(term, 'mask')}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Active redaction chips — burn */}
                        {burnRedactions.length > 0 && (
                            <div>
                                <div style={{ fontSize: '10px', color: '#ef4444', marginBottom: '4px' }}>Redacciones pendientes (permanentes):</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                    {burnRedactions.map(({ term, count }) => (
                                        <RedactionChip
                                            key={`redact-${term}`}
                                            term={term} count={count}
                                            color="rgba(239,68,68,0.15)" borderColor="rgba(239,68,68,0.35)" textColor="#fca5a5"
                                            onClear={() => onClearRedaction(term, 'redact')}
                                        />
                                    ))}
                                </div>

                                {/* Confirm all button — only show when there are burn redactions */}
                                <button
                                    onClick={onConfirmRedactions}
                                    style={{
                                        width: '100%',
                                        marginTop: '8px',
                                        padding: '7px 12px',
                                        background: 'rgba(239,68,68,0.85)',
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: '6px',
                                        fontSize: '12px',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '6px',
                                        letterSpacing: '0.02em',
                                        transition: 'background 0.15s',
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(220,38,38,1)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(239,68,68,0.85)'}
                                    title="Aplica las redacciones permanentes y descarga el PDF limpio"
                                >
                                    ✂ Confirmar y descargar PDF redactado
                                </button>
                            </div>
                        )}
                    </div>

                    {/* ── Content ─────────────────────────────────────────── */}
                    <div style={{
                        flex: 1, overflowY: 'auto', padding: '10px 12px',
                        display: 'flex', flexDirection: 'column', gap: '10px',
                    }}>
                        {results.length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#475569', marginTop: '50px', fontSize: '13px', lineHeight: 1.6 }}>
                                <div style={{ fontSize: '30px', marginBottom: '10px', opacity: 0.3 }}>🔍</div>
                                Sin resultados.<br />Ejecuta el OCR para extraer texto.
                            </div>
                        ) : (
                            results.map((res, idx) => res ? (
                                <div key={idx} style={{
                                    border: '1px solid rgba(255,255,255,0.07)',
                                    borderRadius: '8px', overflow: 'hidden',
                                    background: 'rgba(255,255,255,0.03)',
                                }}>
                                    <div style={{
                                        padding: '7px 10px', background: 'rgba(255,255,255,0.05)',
                                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    }}>
                                        <span style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>
                                            Página {res.pageIndex + 1}
                                        </span>
                                        <button
                                            onClick={() => copyToClipboard(getPageText(res))}
                                            title="Copiar texto"
                                            style={{
                                                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                                                padding: '3px 8px', borderRadius: '5px', color: '#94a3b8',
                                                cursor: 'pointer', fontSize: '11px',
                                                display: 'flex', alignItems: 'center', gap: '3px', fontFamily: 'inherit',
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                                        >📋 Copiar</button>
                                    </div>
                                    <textarea
                                        defaultValue={getPageText(res)}
                                        rows={5}
                                        style={{
                                            width: '100%', minHeight: '100px', border: 'none',
                                            padding: '10px', resize: 'vertical', fontSize: '12px',
                                            lineHeight: '1.65', color: '#cbd5e1', background: 'transparent',
                                            outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', display: 'block',
                                        }}
                                    />
                                    {res.stats && (
                                        <div style={{
                                            padding: '5px 10px', borderTop: '1px solid rgba(255,255,255,0.05)',
                                            fontSize: '10.5px', color: '#475569', display: 'flex', gap: '12px',
                                        }}>
                                            {res.stats.averageConfidence != null && <span>Confianza: {(res.stats.averageConfidence * 100).toFixed(0)}%</span>}
                                            {res.stats.wordsFound != null && <span>Palabras: {res.stats.wordsFound}</span>}
                                        </div>
                                    )}
                                </div>
                            ) : null)
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

// ── Reusable chip ──────────────────────────────────────────────────────────────
const RedactionChip: React.FC<{
    term: string; count: number;
    color: string; borderColor: string; textColor: string;
    onClear: () => void;
}> = ({ term, count, color, borderColor, textColor, onClear }) => (
    <div style={{
        display: 'flex', alignItems: 'center', gap: '4px',
        background: color, border: `1px solid ${borderColor}`,
        color: textColor, borderRadius: '5px', padding: '2px 7px 2px 8px',
        fontSize: '11px', fontWeight: 500, maxWidth: '160px',
    }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '90px' }} title={term}>
            "{term}"
        </span>
        <span style={{ opacity: 0.7, fontSize: '10px' }}>×{count}</span>
        <button
            onClick={onClear}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: textColor, padding: '0 0 0 2px', fontSize: '11px', lineHeight: 1, display: 'flex', alignItems: 'center', opacity: 0.7 }}
            onMouseEnter={e => e.currentTarget.style.opacity = '1'}
            onMouseLeave={e => e.currentTarget.style.opacity = '0.7'}
        >✕</button>
    </div>
);
