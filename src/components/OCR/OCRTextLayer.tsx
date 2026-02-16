
import { useEffect, useMemo } from 'react';
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
}

export const OCRTextLayer = ({ results, width, height, showDebug = false, nativeTextLayerRef, stats }: OCRTextLayerProps) => {
    // Conflict Resolution: Hide native text layer when OCR layer is active
    useEffect(() => {
        if (nativeTextLayerRef?.current) {
            // Option 1: Hide completely
            // nativeTextLayerRef.current.style.display = 'none';
            // Option 2: Disable pointer events (better if we want to keep it visible but unselectable)
            // But we want to avoid double selection.
            // If OCR results exist, we assume they are better or supplementary for this page.

            // Current Strategy: If we have results, hide native layer to rely on OCR text
            if (results && results.length > 0) {
                nativeTextLayerRef.current.style.visibility = 'hidden';
                nativeTextLayerRef.current.style.pointerEvents = 'none';
            } else {
                nativeTextLayerRef.current.style.visibility = 'visible';
                nativeTextLayerRef.current.style.pointerEvents = 'auto';
            }
        }

        return () => {
            // Cleanup: Restore native layer
            if (nativeTextLayerRef?.current) {
                nativeTextLayerRef.current.style.visibility = 'visible';
                nativeTextLayerRef.current.style.pointerEvents = 'auto';
            }
        };
    }, [results, nativeTextLayerRef]);

    // Memoize text items to avoid re-rendering
    const textItems = useMemo(() => {
        return results.map((item, index) => {
            // item.box is [x, y, w, h] normalized
            // Convert to pixels for positioning
            const coords = CoordinateConverter.relativeToViewport(item.box, width, height);

            // PDF.js TextLayer style:
            // Use transform: scale to fit text exactly into width
            // We need to support font resizing.
            // A simple approximation is using a base font size and scaling.

            // Heuristic for font size: Height of the box * 0.8 (approx)
            const fontSize = coords.height * 0.85;

            return (
                <div
                    key={index}
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
                        transformOrigin: '0 0',
                        // Improve text selection feel
                        color: showDebug ? 'rgba(255, 0, 0, 0.5)' : 'transparent',
                        // color: 'rgba(0,0,0,1)', // Debug visible text
                        overflow: 'hidden',
                        fontFamily: 'sans-serif',
                        // Scaling to fit width exactly if needed
                        // transform: `scaleX(${coords.width / (textLength estimator)})` -> hard to estimate
                    }}
                    title={showDebug ? `Conf: ${item.confidence.toFixed(2)}` : undefined}
                >
                    {item.text}
                </div>
            );
        });
    }, [results, width, height, showDebug]);

    // Debug boxes
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
