import { useState, useRef, useEffect } from "react";
import "./App.css";
import { PDFViewer } from "./components/PDFViewer/PDFViewer";
import { OCRButton } from "./components/OCR/OCRButton";
import { ProgressBar } from "./components/OCR/ProgressBar";
import { ResultsPanel } from "./components/OCR/ResultsPanel";
import OCRWorker from './workers/ocr.worker.js?worker';

interface OCRProgress {
    current: number;
    total: number;
    status: string;
}

function App() {
    const [file, setFile] = useState<File | null>(null);
    const [workerStatus, setWorkerStatus] = useState<'initializing' | 'ready' | 'error'>('initializing');
    const [ocrStatus, setOcrStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle');
    const [ocrProgress, setOcrProgress] = useState<OCRProgress>({ current: 0, total: 0, status: '' });
    const [ocrResults, setOcrResults] = useState<any[]>([]);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [isHighAccuracy, setIsHighAccuracy] = useState(false);
    const [showOverlay, setShowOverlay] = useState(true); // [NEW]

    const [redactions, setRedactions] = useState<{ [page: number]: any[] }>({});

    const workerRef = useRef<Worker | null>(null);

    useEffect(() => {
        const worker = new OCRWorker();
        workerRef.current = worker;

        worker.onmessage = (e) => {
            const { type, payload } = e.data;

            switch (type) {
                case 'STATUS':
                    console.log('[OCR Worker Status]', payload);
                    break;
                case 'READY':
                    console.log('[OCR Worker] Ready');
                    setWorkerStatus('ready');
                    break;
                case 'RESULT':
                    setOcrResults(prev => {
                        const newResults = [...prev];
                        newResults[payload.pageIndex] = payload;
                        return newResults;
                    });
                    setOcrProgress(prev => ({ ...prev, current: prev.current + 1 }));
                    break;
                case 'ERROR':
                    console.error('[OCR Worker Error]', payload);
                    setOcrStatus('error');
                    if (workerStatus === 'initializing') {
                        setWorkerStatus('error');
                    }
                    break;
                default:
                    break;
            }
        };

        setWorkerStatus('initializing');
        worker.postMessage({ type: 'INIT', payload: {} });

        return () => {
            worker.terminate();
        };
    }, []);

    useEffect(() => {
        if (ocrStatus === 'processing' && ocrProgress.total > 0 && ocrProgress.current >= ocrProgress.total) {
            setOcrStatus('done');
            setIsPanelOpen(true);
        }
    }, [ocrProgress, ocrStatus]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setOcrResults([]);
            setOcrStatus('idle');
            setRedactions({});
            setIsPanelOpen(false);
        }
    };

    const startOCR = async () => {
        if (!file || !workerRef.current || workerStatus !== 'ready') return;

        setOcrStatus('processing');
        setOcrResults([]);
        setRedactions({});
        setIsPanelOpen(false);

        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
            'pdfjs-dist/build/pdf.worker.min.mjs',
            import.meta.url
        ).toString();

        const arrayBuffer = await file.arrayBuffer();
        const doc = await pdfjsLib.getDocument(arrayBuffer.slice(0)).promise;
        const numPages = Math.min(doc.numPages, 5);

        setOcrProgress({ current: 0, total: numPages, status: 'Starting...' });

        for (let i = 0; i < numPages; i++) {
            setOcrProgress(prev => ({ ...prev, status: `Processing page ${i + 1}/${numPages}` }));

            const bufferCopy = arrayBuffer.slice(0);

            workerRef.current.postMessage({
                type: 'PROCESS_PAGE',
                payload: {
                    pdfData: bufferCopy,
                    pageIndex: i,
                    mode: isHighAccuracy ? 'HIGH_ACCURACY' : 'PERFORMANCE'
                }
            }, [bufferCopy]);
        }
    };

    const handleRedact = (term: string) => {
        if (!term) return;
        const lowerTerm = term.toLowerCase();

        const newRedactions: { [page: number]: any[] } = {};

        ocrResults.forEach(pageRes => {
            if (!pageRes || !pageRes.results) return;

            const pageMatches = pageRes.results.filter((item: any) =>
                item.text && item.text.toLowerCase().includes(lowerTerm)
            );

            if (pageMatches.length > 0) {
                const existing = redactions[pageRes.pageIndex] || [];
                const newBoxes = pageMatches.map((m: any) => m.box);
                newRedactions[pageRes.pageIndex] = [...existing, ...newBoxes];
            }
        });

        if (Object.keys(newRedactions).length > 0) {
            setRedactions(prev => {
                const updated = { ...prev };
                Object.keys(newRedactions).forEach(key => {
                    const pKey = Number(key);
                    updated[pKey] = newRedactions[pKey];
                });
                return updated;
            });
            alert(`Redacted ${Object.values(newRedactions).reduce((acc, arr) => acc + arr.length, 0)} occurrences.`);
        } else {
            alert("No matches found.");
        }
    };

    const handleRemoveRedaction = (pageIndex: number, boxIndex: number) => {
        setRedactions(prev => {
            const pageRedactions = prev[pageIndex];
            if (!pageRedactions) return prev;

            const newPageRedactions = pageRedactions.filter((_, idx) => idx !== boxIndex);
            return { ...prev, [pageIndex]: newPageRedactions };
        });
    };

    return (
        <div className="app-container" style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <header style={{
                padding: '0 20px',
                height: '60px',
                background: '#2d3748',
                color: 'white',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                zIndex: 30
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Tauri AI PDF Editor</h1>
                    <span style={{ fontSize: '12px', background: '#4a5568', padding: '2px 6px', borderRadius: '4px' }}>v0.1.0 (WebGPU)</span>
                </div>

                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                    {workerStatus === 'initializing' && <span style={{ fontSize: '0.8rem', color: '#cbd5e0' }}>Initializing Engine...</span>}
                    {workerStatus === 'error' && <span style={{ fontSize: '0.8rem', color: '#fc8181' }}>Engine Error</span>}

                    <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', cursor: 'pointer', marginRight: '10px' }} title="Show OCR bounding boxes and text overlay on the PDF.">
                        <input
                            type="checkbox"
                            checked={showOverlay}
                            onChange={(e) => setShowOverlay(e.target.checked)}
                        />
                        Show Overlay
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', cursor: 'pointer', marginRight: '10px' }} title="High Accuracy uses 300 DPI and higher resolution detection. Slower but better for small text.">
                        <input
                            type="checkbox"
                            checked={isHighAccuracy}
                            onChange={(e) => setIsHighAccuracy(e.target.checked)}
                        />
                        High Accuracy
                    </label>

                    <label style={{
                        background: '#4a5568',
                        padding: '6px 12px',
                        borderRadius: '4px',
                        fontSize: '13px',
                        cursor: 'pointer',
                        transition: 'background 0.2s'
                    }}>
                        {file ? 'Change PDF' : 'Open PDF'}
                        <input type="file" accept="application/pdf" onChange={handleFileChange} style={{ display: 'none' }} />
                    </label>

                    {file && (
                        <button
                            onClick={() => setIsPanelOpen(!isPanelOpen)}
                            style={{
                                background: isPanelOpen ? '#3182ce' : 'transparent',
                                border: '1px solid #4a5568',
                                color: 'white',
                                padding: '6px 12px',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '13px'
                            }}
                        >
                            {isPanelOpen ? 'Hide Text' : 'Show Text'}
                        </button>
                    )}
                </div>
            </header>

            <ProgressBar
                current={ocrProgress.current}
                total={ocrProgress.total}
                statusText={ocrProgress.status}
                isActive={ocrStatus === 'processing'}
            />

            <div className="main-content" style={{
                flex: 1,
                display: 'flex',
                overflow: 'hidden',
                position: 'relative',
                background: '#edf2f7'
            }}>
                <div style={{
                    flex: 1,
                    position: 'relative',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column'
                }}>
                    {file ? (
                        <PDFViewer
                            file={file}
                            ocrResults={ocrResults}
                            redactions={redactions}
                            onRemoveRedaction={handleRemoveRedaction} // [NEW]
                        />
                    ) : (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100%',
                            color: '#718096',
                            flexDirection: 'column',
                            gap: '15px'
                        }}>
                            <div style={{ fontSize: '48px' }}>📄</div>
                            <p style={{ fontSize: '18px', fontWeight: 500 }}>Open a PDF document to begin editing</p>
                        </div>
                    )}
                </div>

                {file && (
                    <div style={{
                        width: isPanelOpen ? '350px' : '0px',
                        transition: 'width 0.3s ease-in-out',
                        overflow: 'hidden',
                        borderLeft: isPanelOpen ? '1px solid #cbd5e0' : 'none'
                    }}>
                        <ResultsPanel
                            results={ocrResults}
                            isOpen={isPanelOpen}
                            onClose={() => setIsPanelOpen(false)}
                            onRedact={handleRedact}
                        />
                    </div>
                )}
            </div>

            <OCRButton
                onClick={startOCR}
                status={ocrStatus}
                disabled={!file || workerStatus !== 'ready' || ocrStatus === 'processing'}
            />
        </div>
    );
}

export default App;
