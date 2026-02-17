import * as ort from 'onnxruntime-web';
import { DEFAULT_CONFIG } from '../ocr-engine/src/config.js';

// -----------------------------------------------------------------------------
// CRITICAL: Configure WASM Paths BEFORE loading libraries
// -----------------------------------------------------------------------------

// 1. Configure ONNX Runtime
ort.env.wasm.wasmPaths = '/';

// 2. Configure MuPDF
// MuPDF WASM module looks for this global to override file location behavior.
// We force it to look at the root '/' because our worker is in 'assets/' but
// we copied 'mupdf-wasm.wasm' to 'public/' (served at root).
globalThis.$libmupdf_wasm_Module = {
    locateFile: (path) => {
        if (path.endsWith('.wasm')) {
            return '/' + path;
        }
        return path;
    }
};

// -----------------------------------------------------------------------------
// Worker State
// -----------------------------------------------------------------------------
let PdfConverterClass = null;
let OcrClass = null;
let pdfConverter = null;
let ocr = null;

// -----------------------------------------------------------------------------
// Message Queue for Sequential Processing (Crucial for WebGPU)
// -----------------------------------------------------------------------------
const messageQueue = [];
let isProcessing = false;

self.onmessage = (e) => {
    messageQueue.push(e.data);
    processQueue();
};

async function processQueue() {
    if (isProcessing || messageQueue.length === 0) return;

    isProcessing = true;
    const { type, payload } = messageQueue.shift();

    try {
        switch (type) {
            case 'INIT':
                await handleInit(payload);
                break;
            case 'PROCESS_PAGE':
                // Ensure resources are not busy
                await handleProcessPage(payload);
                break;
            case 'CLEANUP':
                await handleCleanup();
                break;
        }
    } catch (error) {
        self.postMessage({
            type: 'ERROR',
            payload: error.message || String(error)
        });
    } finally {
        isProcessing = false;
        // Process next item
        setTimeout(processQueue, 0);
    }
}

import cv from '@techstark/opencv-js';

// ... (previous imports)

async function handleInit(config) {
    try {
        self.postMessage({ type: 'STATUS', payload: 'Loading Libraries...' });

        // 1. Load OpenCV (Heavy)
        // Ensure this is loaded before others that might depend on it
        self.postMessage({ type: 'STATUS', payload: 'Initializing OpenCV...' });

        // Handle both default export as function or module with default
        // Initialize based on README pattern
        // The import might be a factory function, a promise, or the module instance itself.

        let cvInstance;
        if (cv instanceof Promise) {
            cvInstance = await cv;
            console.log("OpenCV loaded via Promise");
        } else if (typeof cv === 'function') {
            cvInstance = await cv();
            console.log("OpenCV loaded via Factory Function");
        } else {
            // It's the module instance (Emscripten / WASM already instantiated or pending)
            if (!cv.onRuntimeInitialized && cv.Mat) {
                // Already ready?
                cvInstance = cv;
                console.log("OpenCV already ready");
            } else {
                console.log("OpenCV loaded via onRuntimeInitialized");
                await new Promise((resolve) => {
                    // Check if already fired (no standard flag, but check Mat)
                    if (cv.Mat) return resolve();
                    cv.onRuntimeInitialized = () => {
                        console.log("OpenCV Runtime Initialized");
                        resolve();
                    };
                });
                cvInstance = cv;
            }
        }

        // Dynamically import libraries to ensure config is applied first
        if (!PdfConverterClass) {
            const pdfMod = await import('../ocr-engine/src/web/pdf-converter.js');
            PdfConverterClass = pdfMod.PdfConverter;
            // Also inject CV if PdfConverter needed it (it doesn't, but Utils does)
            const utilsMod = await import('../ocr-engine/src/web/utils.js');
            utilsMod.ImageProcessor.initOpenCV(cv);
        }

        if (!OcrClass) {
            const ocrMod = await import('../ocr-engine/src/web/ocr.js');
            OcrClass = ocrMod.Ocr;
        }

        self.postMessage({ type: 'STATUS', payload: 'Initializing MuPDF...' });
        pdfConverter = new PdfConverterClass();

        self.postMessage({ type: 'STATUS', payload: 'Loading OCR Models...' });
        // Initialize OCR engine
        // Pass 'cv' instance specifically to create
        ocr = await OcrClass.create(config || DEFAULT_CONFIG, cv); // Updated signature

        self.postMessage({ type: 'READY' });

    } catch (error) {
        console.error("Worker Init Failed:", error);
        throw new Error(`Initialization failed: ${error.message}`);
    }
}

async function handleProcessPage(payload) {
    // Destructure mode from payload (default to PERFORMANCE)
    const { pdfData, pageIndex, mode = 'PERFORMANCE', forceOCR = false } = payload; // Added forceOCR

    if (!pdfConverter || !ocr) {
        throw new Error('Worker not initialized');
    }

    try {
        self.postMessage({ type: 'STATUS', payload: `Processing Page ${pageIndex + 1} (${mode})...` });

        // Select Config based on Mode
        // Default to Performance if mode is invalid
        const modeConfig = DEFAULT_CONFIG.DETECTION.MODES[mode] || DEFAULT_CONFIG.DETECTION.MODES.PERFORMANCE;
        const targetDPI = modeConfig.RENDER_DPI;
        const maxImageSize = modeConfig.MAX_IMAGE_SIZE;

        // 1. Load PDF Document (if needed)
        await pdfConverter.loadDocument(pdfData);

        // HYBRID INTELLIGENCE
        // Check for Native Text first
        let nativeData = null;
        try {
            if (!forceOCR) {
                nativeData = pdfConverter.getStructuredText(pageIndex);
            }
        } catch (e) {
            console.warn("Native text extraction failed, falling back to OCR", e);
        }

        const isNativeTextStart = nativeData && nativeData.textBlocks && nativeData.textBlocks.length > 0;

        // Threshold: A few chars might be page numbers. We want substantial text.
        // Let's count approximate chars.
        let charCount = 0;
        if (isNativeTextStart) {
            // simplified count
            charCount = nativeData.textBlocks.length * 10; // avg
        }

        const USE_NATIVE = isNativeTextStart && charCount > 50;
        const USE_HYBRID = USE_NATIVE && nativeData.imageBlocks && nativeData.imageBlocks.length > 0;

        console.log(`[OCR Worker] Native Check: Count=${charCount}, USE_NATIVE=${USE_NATIVE}`);
        if (USE_NATIVE) {
            console.log(`[OCR Worker] Hybrid Check: ImageBlocks=${nativeData && nativeData.imageBlocks ? nativeData.imageBlocks.length : 0}, USE_HYBRID=${USE_HYBRID}`);
        }

        let finalResults = [];
        let finalStats = {};
        let finalImageData = null;

        // MODE 1: NATIVE / HYBRID
        if (USE_NATIVE) {
            self.postMessage({
                type: 'STATUS',
                payload: USE_HYBRID ? 'HYBRID_MODE' : 'NATIVE_MODE'
            });

            // To be consistent, we should render the page image for the UI display.
            const renderDpi = targetDPI; // Use the configured DPI
            const imageData = pdfConverter.getPageImage(pageIndex, renderDpi);
            const W = imageData.width;
            const H = imageData.height;
            finalImageData = imageData;

            const nativeResults = [];
            // Map text blocks
            // Note: detailed mapping requires line/span iteration.
            // If getStructuredText return coarse blocks, the UI highlight will be coarse.
            // Good enough for Phase 1.

            // TODO: Map nativeData.textBlocks to results
            // For now, we assume simple mapping just to prove flow.
            // Real mapping needs iterating `lines` inside blocks.
            if (nativeData && nativeData.textBlocks) {
                for (const textBlock of nativeData.textBlocks) {
                    // Structure: { type: "text", bbox: {x,y,w,h}, lines: [ { text: "...", ... } ] }

                    // Aggregate text from lines
                    let blockText = "";
                    if (textBlock.lines) {
                        for (const line of textBlock.lines) {
                            // JSON shows 'text' is directly on line object
                            if (line.text) {
                                blockText += line.text + " ";
                            } else if (line.spans) {
                                // Fallback just in case
                                for (const span of line.spans) {
                                    blockText += span.text + " ";
                                }
                            }
                        }
                    }

                    if (blockText.trim().length > 0) {
                        const bbox = textBlock.bbox; // {x, y, w, h} Points

                        // Convert Points -> Pixels
                        // Scale = targetDPI / 72
                        const s = targetDPI / 72;
                        const x = bbox.x * s;
                        const y = bbox.y * s;
                        const w = bbox.w * s;
                        const h = bbox.h * s;

                        // Normalize 0..1
                        // box is Quad: TL, TR, BR, BL
                        nativeResults.push({
                            text: blockText.trim(),
                            confidence: 1.0,
                            box: [
                                [x / W, y / H],
                                [(x + w) / W, y / H],
                                [(x + w) / W, (y + h) / H],
                                [x / W, (y + h) / H]
                            ],
                            rect: [x, y, w, h] // Pixels
                        });
                    }
                }
            }

            // VISUAL HYBRID STRATEGY:
            // 1. We have Native Text in 'nativeResults'.
            // 2. We Run OCR Detection on the FULL PAGE (Visual).
            // 3. We filter out any OCR Box that overlaps with 'nativeResults'.
            // 4. We recognize the remnants (Text in Images / Handwritten).

            // Collect Native Boxes for filtering (Pixels)
            const nativeRects = nativeResults.map(r => r.rect);

            // Execute Hybrid
            // Note: executeHybrid will return ONLY the additional (image) results.
            const { results: hybridResults, stats: hybridStats } = await ocr.executeHybrid(finalImageData, nativeRects, {
                MAX_IMAGE_SIZE: maxImageSize
            });

            // Merge Results
            if (hybridResults.length > 0) {
                // Remap hybrid results (which are already in Pixels for 'rect', but 'box' is Pixels too)
                // Wait, executeHybrid returns results in same format as execute.
                // .box is [[x,y]..] Pixels (relative to finalImageData).
                // .rect is [x,y,w,h] Pixels.

                // We need to ensure we don't double normalize later?
                // The loop below handles 'rect' -> 'box' (normalized).
                // So we just push them to finalResults.

                nativeResults.push(...hybridResults);
                console.log(`[OCR Worker] Hybrid Added ${hybridResults.length} new regions.`);
            }

            finalResults = nativeResults;
            finalStats = { totalTime: hybridStats.totalTime, mode: 'visual_hybrid', extraRegions: hybridResults.length };
        } else {
            // MODE 2: SCANNED (Classic)
            const imageData = pdfConverter.getPageImage(pageIndex, targetDPI);
            finalImageData = imageData;

            // Run OCR
            const { results, stats } = await ocr.execute(imageData, {
                MAX_IMAGE_SIZE: maxImageSize
            });
            finalResults = results;
            finalStats = stats;
        }

        // 4. Clean up PDF resources for this page
        pdfConverter.destroy();

        // 5. Normalize Coordinates (Pixels -> 0..1)
        // Note: If USE_NATIVE, our logic above constructed 'rect' in pixels and 'box' normalized.
        // But the loop below expects 'rect' (pixels) -> 'box' (normalized).
        // If we already have accurate normalized box in finalResults, we should preserve it?
        // OR we just re-normalize from 'rect' to be safe and consistent.

        const validatedResults = finalResults.map(item => {
            // Re-calc normalized from rect (Pixels) using finalImageData dimensions
            // logic same as before but using finalImageData

            let x, y, w, h;
            if (item.rect) {
                [x, y, w, h] = item.rect;
            } else if (item.box) {
                const xs = item.box.map(p => p[0]);
                const ys = item.box.map(p => p[1]);
                x = Math.min(...xs);
                y = Math.min(...ys);
                w = Math.max(...xs) - x;
                h = Math.max(...ys) - y;
            }

            return {
                ...item,
                box: [
                    x / finalImageData.width,
                    y / finalImageData.height,
                    w / finalImageData.width,
                    h / finalImageData.height
                ]
            };
        });

        // 5. Send Results
        self.postMessage({
            type: 'RESULT',
            payload: {
                pageIndex,
                scanDimensions: {
                    width: finalImageData.width,
                    height: finalImageData.height,
                    dpi: targetDPI
                },
                stats: finalStats,
                results: validatedResults
            }
        });

    } catch (error) {
        console.error("Page Process Failed:", error);
        throw error;
    }
}

async function handleCleanup() {
    if (pdfConverter) {
        pdfConverter.destroy();
    }
    // Ocr cleanup if needed (session release)
}
