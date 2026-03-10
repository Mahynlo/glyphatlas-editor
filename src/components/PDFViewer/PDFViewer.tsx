
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
    ocrResults?: any;
    redactions?: { [page: number]: any[] };
    onRemoveRedaction?: (pageIndex: number, boxIndex: number) => void;
    showOverlay?: boolean;
    scale: number;
    onTotalPages?: (total: number) => void;
}

export const PDFViewer = ({
    file,
    ocrResults,
    redactions,
    onRemoveRedaction,
    showOverlay = true,
    scale,
    onTotalPages
}: PDFViewerProps) => {
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
            onTotalPages?.(doc.numPages);

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

    // Handle Scroll Navigation (from Thumbnails and Navbar)
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
    }, [pages, scale]); // Re-observe if scale changes because elements might move

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* ── Pages ────────────────────────────────────────────────────── */}
            <div className="pdf-viewer-container" ref={containerRef} style={{
                flex: 1,
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
                                scale={scale}
                                ocrResult={ocrResults?.[pageNum - 1]}
                                redactedBoxes={redactions?.[pageNum - 1] || []}
                                onRemoveBox={(boxIdx) => onRemoveRedaction?.(pageNum - 1, boxIdx)}
                                showOverlay={showOverlay}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

const PDFPage = ({ id, pageNumber, pdfDoc, scale, ocrResult, redactedBoxes, onRemoveBox, showOverlay }: {
    id: string,
    pageNumber: number,
    pdfDoc: pdfjsLib.PDFDocumentProxy,
    scale: number,
    ocrResult: any,
    redactedBoxes: any[],
    onRemoveBox?: (index: number) => void,
    showOverlay?: boolean
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const textLayerRef = useRef<HTMLDivElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const renderTaskRef = useRef<any>(null);
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

    useEffect(() => {
        if (!pdfDoc || !pageNumber || !viewport) return;

        const renderTextLayer = async () => {
            try {
                const page = await pdfDoc.getPage(pageNumber);
                const textContent = await page.getTextContent();

                if (!textLayerRef.current) return;

                textLayerRef.current.innerHTML = '';
                textLayerRef.current.style.setProperty('--scale-factor', `${scale}`);

                // pdfjs-dist v4+ uses a TextLayer *class* (not the old renderTextLayer fn).
                // Cast to any because the .d.ts bundled with v5 may not expose TextLayer.
                const AnyPdfLib = pdfjsLib as any;
                if (AnyPdfLib.TextLayer) {
                    const layer = new AnyPdfLib.TextLayer({
                        textContentSource: textContent,
                        container: textLayerRef.current,
                        viewport: viewport,
                    });
                    await layer.render();
                } else {
                    // Fallback: manually place text spans at approximate positions.
                    // This makes text selectable even if the TextLayer class is unavailable.
                    const container = textLayerRef.current;
                    const { width, height } = container.getBoundingClientRect();
                    for (const item of (textContent as any).items) {
                        if (!item.str) continue;
                        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
                        const span = document.createElement('span');
                        span.textContent = item.str + (item.hasEOL ? '\n' : ' ');
                        // tx[4] = x position, tx[5] = y position in CSS coords
                        const x = tx[4];
                        const y = tx[5];
                        const fontSize = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
                        span.style.cssText = `position:absolute;left:${x}px;top:${y - fontSize}px;font-size:${fontSize}px;white-space:pre;transform-origin:0% 0%;`;
                        if (width && height) { // only add if we have dimensions
                            container.appendChild(span);
                        }
                    }
                }
            } catch (e) {
                console.error("Text layer render error:", e);
            }
        };

        renderTextLayer();
    }, [pdfDoc, pageNumber, viewport, scale]);

    return (
        <div id={id} ref={wrapperRef} className="pdf-page" style={{ position: 'relative', boxShadow: '0 2px 5px rgba(0,0,0,0.2)' }}>
            <style>{`
                .textLayer { pointer-events: none !important; }
                .textLayer > span, .textLayer > br { pointer-events: auto !important; }
            `}</style>

            <canvas key={`${pageNumber}-${scale}`} ref={canvasRef} />

            {/* OCR Overlay (Behind Native Text) */}
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

            {/* Native Text Layer (Top - for high fidelity selection) */}
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
                    // PDF.js requires this CSS variable for scaling
                    '--scale-factor': scale
                } as any}
            />

            {/* Redaction Layer */}
            {redactedBoxes && redactedBoxes.length > 0 && viewport && (
                <div className="redaction-layer" style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    zIndex: 50,
                    pointerEvents: 'none' // Container is transparent — only boxes capture events
                }}>
                    {redactedBoxes.map((box, idx) => (
                        <div
                            key={idx}
                            onClick={(e) => {
                                e.stopPropagation();
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
                                cursor: 'pointer',
                                pointerEvents: 'auto' // Each box is individually clickable
                            }}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};