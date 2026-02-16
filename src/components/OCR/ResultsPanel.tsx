import React from 'react';

interface OCRResult {
    pageIndex: number;
    results: any[]; // The generic OCR result object
    stats: any;
}

interface ResultsPanelProps {
    results: OCRResult[];
    isOpen: boolean;
    onClose: () => void;
}

export const ResultsPanel: React.FC<ResultsPanelProps> = ({ results, isOpen, onClose }) => {
    if (!isOpen) return null;

    // Helper to extract full text from a page result
    const getPageText = (result: OCRResult) => {
        if (!result || !result.results) return "";
        // Sort by reading order if not already sorted? 
        // The worker sends them sorted by default logic usually.
        // Simple join with newlines for blocks, spaces for lines?
        // Let's assume result.results is array of {text, box...}
        // A simple heuristic: if vertical distance is large -> newline. 
        // For now, simple space join, but detailed formatting can be improved.
        // Actually, let's look at the structure. It is likely a list of words/lines.
        // We'll just join with spaces for now, or newlines if we detect paragraphs.

        return result.results.map(r => r.text).join(' ');
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        // Could show toast here
    };

    return (
        <div className="results-panel" style={{
            width: '350px',
            background: '#fff',
            borderLeft: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            boxShadow: '-4px 0 15px rgba(0,0,0,0.05)',
            zIndex: 20
        }}>
            <div className="panel-header" style={{
                padding: '16px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: '#f8fafc'
            }}>
                <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#2d3748', margin: 0 }}>Extracted Text</h2>
                <button onClick={onClose} style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '20px',
                    color: '#a0aec0',
                    cursor: 'pointer'
                }}>&times;</button>
            </div>

            <div className="panel-content" style={{
                flex: 1,
                overflowY: 'auto',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
            }}>
                {results.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#a0aec0', marginTop: '40px', fontSize: '14px' }}>
                        No results yet. <br /> Start OCR to extract text.
                    </div>
                ) : (
                    results.map((res, idx) => (res ? (
                        <div key={idx} className="page-result" style={{
                            border: '1px solid #e2e8f0',
                            borderRadius: '8px',
                            background: '#fff',
                            overflow: 'hidden'
                        }}>
                            <div className="page-header" style={{
                                padding: '8px 12px',
                                background: '#edf2f7',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                fontSize: '12px',
                                fontWeight: 600,
                                color: '#4a5568'
                            }}>
                                <span>Page {res.pageIndex + 1}</span>
                                <button
                                    onClick={() => copyToClipboard(getPageText(res))}
                                    title="Copy Page Text"
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        color: '#4299e1',
                                        cursor: 'pointer',
                                        fontWeight: 600
                                    }}>
                                    Copy
                                </button>
                            </div>
                            <textarea
                                defaultValue={getPageText(res)}
                                style={{
                                    width: '100%',
                                    minHeight: '150px',
                                    border: 'none',
                                    padding: '12px',
                                    resize: 'vertical',
                                    fontSize: '13px',
                                    lineHeight: '1.6',
                                    color: '#2d3748',
                                    fontFamily: 'Segoe UI, Roboto, Helvetica, Arial, sans-serif',
                                    outline: 'none'
                                }}
                            />
                            <div className="page-stats" style={{
                                padding: '6px 12px',
                                borderTop: '1px solid #f7fafc',
                                fontSize: '11px',
                                color: '#a0aec0',
                                display: 'flex',
                                gap: '10px'
                            }}>
                                <span>Confidence: {(res.stats?.averageConfidence * 100).toFixed(0)}%</span>
                                <span>Words: {res.stats?.wordsFound}</span>
                            </div>
                        </div>
                    ) : null))
                )}
            </div>
        </div>
    );
};
