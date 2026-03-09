
import React, { useEffect, useMemo } from 'react';
import { CoordinateConverter } from '../../utils/coordinates';

interface OCRResultItem {
    text: string;
    confidence: number;
    box: number[]; // [x, y, w, h] normalized 0..1
}

interface OCRTextLayerProps {
    results: OCRResultItem[];
    width: number; // Viewport width in pixels
    height: number; // Viewport height in pixels
    showDebug?: boolean;
    stats?: {
        totalTime: number;
        detectionTime: number;
        recognitionTime: number;
    };
    nativeTextLayerRef?: React.RefObject<HTMLDivElement | null>;
    isNativeMode?: boolean;
    nativeItems?: any[]; // [NEW]
    viewport?: any; // [NEW] pdfjs Viewport object
}

export const OCRTextLayer = ({ results, width, height, showDebug = false, nativeTextLayerRef, stats, isNativeMode = false, nativeItems = [], viewport }: OCRTextLayerProps) => {
    // Conflict Resolution: Native layer is ALWAYS visible
    useEffect(() => {
        if (nativeTextLayerRef?.current) {
            nativeTextLayerRef.current.style.visibility = 'visible';
            nativeTextLayerRef.current.style.pointerEvents = 'auto'; // Native text is always selectable if present
        }
    }, [nativeTextLayerRef]);

    // Check if an OCR box overlaps with ANY native text item
    const isOverlappingNative = (ocrBox: number[]) => {
        if (!nativeItems || nativeItems.length === 0 || !viewport) return false;

        // OCR Box to Viewport Rect [x, y, w, h] in pixels
        // ocrBox is [x, y, w, h] normalized
        const ocrX = ocrBox[0] * width;
        const ocrY = ocrBox[1] * height;
        const ocrW = ocrBox[2] * width;
        const ocrH = ocrBox[3] * height;

        // Iterate native items to check intersection
        // Optimization: Use a spatial index if slow, but for single page ~50-100 items it's fine.
        for (const item of nativeItems) {
            // item.transform is [scaleX, skewY, skewX, scaleY, x, y] (PDF coords)
            // item.width, item.height (sometimes unscaled or needing calc)
            // Robust way: Use viewport.convertToViewportRectangle

            // Native item bbox in PDF coords: [x, y, x+w, y+h]
            // Note: PDF y increases upwards usually, but viewport handles transform.
            const tx = item.transform;
            const x = tx[4];
            const y = tx[5];
            const w = item.width;
            const h = item.height || 10; // Fallback height

            // Convert [x, y, x+w, y+h]
            // Note: pdf.js rect is [minX, minY, maxX, maxY]
            const nativeRect = [x, y, x + w, y + h];
            const viewRect = viewport.convertToViewportRectangle(nativeRect);
            // viewRect is [x1, y1, x2, y2] in browser pixels

            // Standardize to [minX, minY, maxX, maxY]
            const vx = Math.min(viewRect[0], viewRect[2]);
            const vy = Math.min(viewRect[1], viewRect[3]);
            const vw = Math.abs(viewRect[2] - viewRect[0]);
            const vh = Math.abs(viewRect[3] - viewRect[1]);

            // Check AABB Intersection
            if (
                ocrX < vx + vw &&
                ocrX + ocrW > vx &&
                ocrY < vy + vh &&
                ocrY + ocrH > vy
            ) {
                // Significant overlap?
                // Let's assume ANY overlap means "this is the same text".
                return true;
            }
        }
        return false;
    };

    const textItems = useMemo(() => {
        // Create a temporary context for measuring text
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        return results.map((item, index) => {
            // Check if this specific item overlaps with native text
            const hasNativeOverlap = isOverlappingNative(item.box);

            // IF OVERLAP: Do NOT render text overlay. User selects native text.
            if (hasNativeOverlap) return null;

            // IF NO OVERLAP: Render text overlay (it's an image/scanned part).
            const coords = CoordinateConverter.relativeToViewport(item.box, width, height);
            const fontSize = coords.height * 0.85;

            let scaleX = 1;
            if (context) {
                context.font = `${fontSize}px sans-serif`;
                const textMetrics = context.measureText(item.text);
                const textWidth = textMetrics.width;
                if (textWidth > 0) scaleX = coords.width / textWidth;
            }

            return (
                <React.Fragment key={index}>
                    <div
                        style={{
                            position: 'absolute',
                            left: `${coords.left}px`,
                            top: `${coords.top}px`,
                            width: `${coords.width}px`,
                            height: `${coords.height}px`,
                            fontSize: `${fontSize}px`,
                            lineHeight: 1,
                            whiteSpace: 'nowrap',
                            cursor: 'text',
                            transformOrigin: 'left top',
                            transform: `scaleX(${scaleX})`,
                            color: showDebug ? 'rgba(255, 0, 0, 0.6)' : 'transparent',
                            overflow: 'visible',
                            fontFamily: 'sans-serif',
                            zIndex: 5,
                            pointerEvents: 'auto',
                            userSelect: 'text'
                        }}
                        title={showDebug ? `Conf: ${item.confidence.toFixed(2)}` : undefined}
                    >
                        {item.text}
                    </div>
                    {/* Hidden space placed just after each word so that when the user
                        selects and copies across multiple words, the browser includes
                        a space character between them ("Word1 Word2" not "Word1Word2"). */}
                    <span
                        aria-hidden="true"
                        style={{
                            position: 'absolute',
                            left: `${coords.left + coords.width}px`,
                            top: `${coords.top}px`,
                            fontSize: `${fontSize}px`,
                            color: 'transparent',
                            userSelect: 'text',
                            pointerEvents: 'none',
                            whiteSpace: 'pre',
                        }}
                    >
                        {' '}
                    </span>
                </React.Fragment>
            );
        });
    }, [results, width, height, showDebug, isNativeMode, nativeItems, viewport]);

    // Debug boxes (Only render if showDebug is true)
    const debugBoxes = useMemo(() => {
        if (!showDebug) return null;
        return results.map((item, index) => {
            const coords = CoordinateConverter.relativeToViewport(item.box, width, height);
            return (
                <div
                    key={`box-${index}`}
                    style={{
                        position: 'absolute',
                        left: `${coords.left}px`,
                        top: `${coords.top}px`,
                        width: `${coords.width}px`,
                        height: `${coords.height}px`,
                        border: '1px solid blue',
                        pointerEvents: 'none'
                    }}
                />
            );
        });
    }, [results, width, height, showDebug]);

    return (
        <div
            className="ocr-text-layer"
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: `${width}px`,
                height: `${height}px`,
                zIndex: 10,
                pointerEvents: 'none' // Container doesn't block, children do
            }}
        >
            {/* Wrapper for text items enabling pointer events */}
            <div style={{ width: '100%', height: '100%', pointerEvents: 'auto' }}>
                {textItems}
            </div>
            {debugBoxes}

            {/* Stats Overlay */}
            {stats && (
                <div style={{
                    position: 'absolute',
                    top: 5,
                    right: 5,
                    background: 'rgba(0,0,0,0.7)',
                    color: '#00ff00',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '10px',
                    fontFamily: 'monospace',
                    pointerEvents: 'none',
                    zIndex: 20
                }}>
                    OCR: {Math.round(stats.totalTime)}ms (Det: {Math.round(stats.detectionTime)}ms, Rec: {Math.round(stats.recognitionTime)}ms)
                </div>
            )}
        </div>
    );
};
