
import { useEffect, useRef, useState } from 'react';
// Force reload
import * as pdfjsLib from 'pdfjs-dist';
// Set worker (Vite 5+ compliant)
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
).toString();

import { OCRTextLayer } from '../OCR/OCRTextLayer';

interface PDFViewerProps {
    file: File | null;
    onPageRendered?: (pageIndex: number, scale: number, viewport: any) => void;
    ocrResults?: any;
    redactions?: { [page: number]: any[] }; // [NEW]
    onRemoveRedaction?: (pageIndex: number, boxIndex: number) => void; // [NEW]
    isOcrProcessing?: boolean;
    ocrProgress?: { current: number; total: number; status: string };
    onOcrTrigger?: () => void;
    showOverlay?: boolean; // [NEW]
}

export const PDFViewer = ({ file, ocrResults, redactions, onRemoveRedaction, showOverlay = true }: PDFViewerProps) => {
    const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
    const [pages, setPages] = useState<any[]>([]);
    const containerRef = useRef<HTMLDivElement>(null);

    // ... (useEffect loadPdf same as before)
    useEffect(() => {
        if (!file) return;

        const loadPdf = async () => {
            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument(arrayBuffer);
            const doc = await loadingTask.promise;
            setPdfDoc(doc);

            // For now, load first 5 pages to avoid memory kill in this demo
            const numPages = Math.min(doc.numPages, 5);
            const loadedPages = [];
            for (let i = 1; i <= numPages; i++) {
                loadedPages.push(i);
            }
            setPages(loadedPages);
        };

        loadPdf();
    }, [file]);

    // Handle Scroll Navigation (from Thumbnails)
    useEffect(() => {
        const handleScrollRequest = (e: CustomEvent) => {
            const pageIndex = e.detail.pageIndex;
            const pageElement = document.getElementById(`pdf-page-${pageIndex}`);
            if (pageElement) {
                pageElement.scrollIntoView({ behavior: 'smooth' });
            }
        };

        window.addEventListener('scroll-to-page' as any, handleScrollRequest as any);
        return () => {
            window.removeEventListener('scroll-to-page' as any, handleScrollRequest as any);
        };
    }, []);

    // Track which page is currently visible using IntersectionObserver
    useEffect(() => {
        if (!pages.length) return;

        const observer = new IntersectionObserver(
            (entries) => {
                // Find the entry with the highest intersection ratio
                const mostVisible = entries
                    .filter(e => e.isIntersecting)
                    .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

                if (mostVisible) {
                    const pageIndex = parseInt(
                        mostVisible.target.id.replace('pdf-page-', ''), 10
                    );
                    if (!isNaN(pageIndex)) {
                        window.dispatchEvent(
                            new CustomEvent('page-changed', { detail: { pageIndex } })
                        );
                    }
                }
            },
            { threshold: [0.3, 0.6] }
        );

        // Observe all page elements
        pages.forEach((_, i) => {
            const el = document.getElementById(`pdf-page-${i}`);
            if (el) observer.observe(el);
        });

        return () => observer.disconnect();
    }, [pages]);

    return (
        <div className="pdf-viewer-container" ref={containerRef} style={{
            height: '100%',
            overflow: 'auto',
            background: '#e5e5e5',
            padding: '20px',
            position: 'relative'
        }}>
            {file && !pdfDoc && <div>Loading PDF...</div>}

            {pdfDoc && (
                <div className="pages-list" style={{ display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center' }}>
                    {pages.map(pageNum => (
                        <PDFPage
                            key={pageNum}
                            id={`pdf-page-${pageNum - 1}`}
                            pageNumber={pageNum}
                            pdfDoc={pdfDoc}
                            ocrResult={ocrResults?.[pageNum - 1]}
                            redactedBoxes={redactions?.[pageNum - 1] || []}
                            onRemoveBox={(boxIdx) => onRemoveRedaction?.(pageNum - 1, boxIdx)}
                            showOverlay={showOverlay}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const PDFPage = ({ id, pageNumber, pdfDoc, ocrResult, redactedBoxes, onRemoveBox, showOverlay }: {
    id: string,
    pageNumber: number,
    pdfDoc: pdfjsLib.PDFDocumentProxy,
    ocrResult: any,
    redactedBoxes: any[],
    onRemoveBox?: (index: number) => void,
    showOverlay?: boolean // [NEW]
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const textLayerRef = useRef<HTMLDivElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const renderTaskRef = useRef<any>(null);
    const [scale] = useState(1.5);
    const [viewport, setViewport] = useState<any>(null);

    useEffect(() => {
        if (!pdfDoc || !canvasRef.current) return;

        const renderPage = async () => {
            try {
                const page = await pdfDoc.getPage(pageNumber);
                const newViewport = page.getViewport({ scale });
                setViewport(newViewport);

                const canvas = canvasRef.current;
                const context = canvas?.getContext('2d');

                if (canvas && context) {
                    canvas.height = newViewport.height;
                    canvas.width = newViewport.width;

                    const renderContext = {
                        canvasContext: context,
                        viewport: newViewport,
                        canvas: canvas,
                    };

                    if (renderTaskRef.current) {
                        try {
                            renderTaskRef.current.cancel();
                        } catch (e) { /* ignore */ }
                    }

                    renderTaskRef.current = page.render(renderContext);
                    await renderTaskRef.current.promise;
                }
            } catch (error: any) {
                if (error.name === 'RenderingCancelledException') {
                    return;
                }
                console.error("Render error:", error);
            }
        };

        renderPage();

        return () => {
            if (renderTaskRef.current) {
                try {
                    renderTaskRef.current.cancel();
                } catch (e) { /* ignore */ }
            }
        };
    }, [pdfDoc, pageNumber, scale]);

    return (
        <div id={id} ref={wrapperRef} className="pdf-page" style={{ position: 'relative', boxShadow: '0 2px 5px rgba(0,0,0,0.2)' }}>
            <canvas key={`${pageNumber}-${scale}`} ref={canvasRef} />

            {/* Native Text Layer */}
            <div
                ref={textLayerRef}
                className="textLayer"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    overflow: 'hidden',
                    lineHeight: '1.0',
                    '--scale-factor': scale
                } as any}
            />

            {/* OCR Overlay */}
            {ocrResult && viewport && (
                <OCRTextLayer
                    results={ocrResult.results}
                    width={viewport.width}
                    height={viewport.height}
                    nativeTextLayerRef={textLayerRef}
                    showDebug={showOverlay}
                    stats={ocrResult.stats}
                />
            )}

            {/* Redaction Layer */}
            {redactedBoxes && redactedBoxes.length > 0 && viewport && (
                <div className="redaction-layer" style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    // pointerEvents: 'none', // Removed global disable so children can be clicked
                    width: '100%',
                    height: '100%',
                    zIndex: 50 // On top of text
                }}>
                    {redactedBoxes.map((box, idx) => (
                        <div
                            key={idx}
                            onClick={(e) => {
                                e.stopPropagation(); // Prevent other clicks
                                if (confirm('Remove this redaction?')) {
                                    onRemoveBox?.(idx);
                                }
                            }}
                            title="Click to remove redaction"
                            style={{
                                position: 'absolute',
                                left: `${box[0] * 100}%`,
                                top: `${box[1] * 100}%`,
                                width: `${(box[2]) * 100}%`,
                                height: `${(box[3]) * 100}%`,
                                background: 'black',
                                opacity: 1,
                                cursor: 'pointer', // Suggest interaction
                                pointerEvents: 'auto' // Re-enable clicks
                            }}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};