
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
    ocrResults?: any; // Start with any, define type later
    isOcrProcessing?: boolean;
    ocrProgress?: { current: number; total: number; status: string };
    onOcrTrigger?: () => void;
}

// Unused props removed to satisfy linter
export const PDFViewer = ({ file, ocrResults }: PDFViewerProps) => {
    const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
    const [pages, setPages] = useState<any[]>([]);
    const containerRef = useRef<HTMLDivElement>(null);

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

    return (
        <div className="pdf-viewer-container" ref={containerRef} style={{
            height: '80vh',
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
                            pageNumber={pageNum}
                            pdfDoc={pdfDoc}
                            ocrResult={ocrResults?.[pageNum - 1]}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const PDFPage = ({ pageNumber, pdfDoc, ocrResult }: { pageNumber: number, pdfDoc: pdfjsLib.PDFDocumentProxy, ocrResult: any }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const textLayerRef = useRef<HTMLDivElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const renderTaskRef = useRef<any>(null); // internal render task tracking
    const [scale] = useState(1.5); // Fixed scale for now
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
                    // Reset canvas to ensure clean state
                    canvas.height = newViewport.height;
                    canvas.width = newViewport.width;

                    const renderContext = {
                        canvasContext: context,
                        viewport: newViewport,
                        canvas: canvas,
                    };

                    // Cancel previous render if any
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
        <div ref={wrapperRef} className="pdf-page" style={{ position: 'relative', boxShadow: '0 2px 5px rgba(0,0,0,0.2)' }}>
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

            {/* OCR Overlay - The "Text Layer Strategy" */}
            {ocrResult && viewport && (
                <OCRTextLayer
                    results={ocrResult.results}
                    width={viewport.width}
                    height={viewport.height}
                    nativeTextLayerRef={textLayerRef}
                    showDebug={true}
                    stats={ocrResult.stats}
                />
            )}
        </div>
    );
};
