import React, { useEffect, useState, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Define Props
interface ThumbnailSidebarProps {
    file: File | null;
    onPageClick: (pageIndex: number) => void;
    currentPage: number;
    pdfDoc?: pdfjsLib.PDFDocumentProxy | null; // Optional if passed from parent
}

export const ThumbnailSidebar: React.FC<ThumbnailSidebarProps> = ({ file, onPageClick, currentPage, pdfDoc: parentPdfDoc }) => {
    const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
    const [numPages, setNumPages] = useState(0);

    // Load PDF if not provided by parent (Self-contained mode)
    // Ideally, parent passes the doc to share memory.
    useEffect(() => {
        if (parentPdfDoc) {
            setPdfDoc(parentPdfDoc);
            setNumPages(parentPdfDoc.numPages);
            return;
        }

        if (!file) return;

        const loadPdf = async () => {
            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument(arrayBuffer);
            const doc = await loadingTask.promise;
            setPdfDoc(doc);
            setNumPages(doc.numPages);
        };
        loadPdf();
    }, [file, parentPdfDoc]);

    return (
        <div className="thumbnail-sidebar" style={{
            width: '200px',
            background: '#2d3748', // Dark sidebar like standard PDF viewers
            borderRight: '1px solid #4a5568',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            overflowY: 'auto',
            padding: '16px 10px',
            gap: '16px'
        }}>
            <h3 style={{ color: '#cbd5e0', fontSize: '13px', margin: '0 0 10px 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pages</h3>

            {pdfDoc && Array.from({ length: Math.min(numPages, 20) }, (_, i) => ( // Limitation for demo performance
                <Thumbnail
                    key={i}
                    pageIndex={i}
                    pdfDoc={pdfDoc}
                    isActive={currentPage === i}
                    onClick={() => onPageClick(i)}
                />
            ))}
        </div>
    );
};

const Thumbnail = ({ pageIndex, pdfDoc, isActive, onClick }: { pageIndex: number, pdfDoc: pdfjsLib.PDFDocumentProxy, isActive: boolean, onClick: () => void }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const renderTaskRef = useRef<any>(null);

    useEffect(() => {
        if (!pdfDoc || !canvasRef.current) return;

        const renderThumbnail = async () => {
            // Cancel previous render
            if (renderTaskRef.current) {
                try {
                    renderTaskRef.current.cancel();
                } catch (e) { /* ignore */ }
            }

            try {
                const page = await pdfDoc.getPage(pageIndex + 1);
                // Scale 0.2 is usually good for thumbnails (approx 150px width for A4)
                const viewport = page.getViewport({ scale: 0.2 });
                const canvas = canvasRef.current;

                if (canvas) {
                    const context = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;

                    if (context) {
                        const renderContext = {
                            canvasContext: context,
                            viewport: viewport,
                            canvas: canvas,
                        };
                        renderTaskRef.current = page.render(renderContext);
                        await renderTaskRef.current.promise;
                    }
                }
            } catch (e: any) {
                if (e.name !== 'RenderingCancelledException') {
                    console.error("Thumbnail render error:", e);
                }
            }
        };

        renderThumbnail();

        return () => {
            if (renderTaskRef.current) {
                try {
                    renderTaskRef.current.cancel();
                } catch (e) { /* ignore */ }
            }
        };
    }, [pdfDoc, pageIndex]);

    return (
        <div
            onClick={onClick}
            style={{
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px'
            }}
        >
            <div style={{
                border: isActive ? '2px solid #63b3ed' : '2px solid transparent',
                borderRadius: '4px',
                padding: '2px',
                background: isActive ? 'rgba(99, 179, 237, 0.2)' : 'transparent',
                transition: 'all 0.2s'
            }}>
                <canvas
                    ref={canvasRef}
                    style={{
                        display: 'block',
                        background: 'white',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
                    }}
                />
            </div>
            <span style={{ color: isActive ? '#63b3ed' : '#a0aec0', fontSize: '11px' }}>
                {pageIndex + 1}
            </span>
        </div>
    );
};
