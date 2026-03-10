// =============================================================================
// NATIVE OCR BRIDGE — Main Thread only (Tauri IPC requires window context)
// =============================================================================
// This module calls the Rust `perform_native_ocr` Tauri command and normalizes
// its output to the SAME format that ocr.worker.js produces for PaddleOCR:
//
//   result.results[i] = {
//     text: string,
//     confidence: number,
//     box: [[tl_x,tl_y],[tr_x,tr_y],[br_x,br_y],[bl_x,bl_y]],  // 0..1 normalized
//     rect: [x, y, w, h]                                          // 0..1 normalized
//   }
//
// IMPORTANT: This file MUST be imported from the Main Thread (React component),
// NOT from inside a Web Worker. Tauri's invoke() uses window.__TAURI_IPC__
// which is not available in Worker threads.

import { invoke } from '@tauri-apps/api/core';

/**
 * Run Windows-native OCR on a single PDF page via the Rust Tauri backend.
 *
 * @param {string} pdfFilePath   Absolute path to the PDF file on disk.
 *                               Rust reads the file directly — no byte transfer over IPC.
 * @param {number} pageIndex     Zero-based page index.
 * @param {number} [dpi=200]     Render resolution. Use 200 (performance) or 300 (quality).
 *
 * @returns {Promise<{
 *   results: Array<{text: string, confidence: number, box: number[][], rect: number[]}>,
 *   stats:   {totalTime: number, mode: string, engine: string},
 *   scanDimensions: {width: number, height: number, dpi: number}
 * }>}
 */
export async function nativeOcrPage(pdfFilePath, pageIndex, dpi = 200) {
    const t0 = performance.now();

    /** @type {import('../../../types.d.ts').NativeOcrPageResult} */
    const nativeResult = await invoke('perform_native_ocr', {
        pdfPath: pdfFilePath,
        pageIndex,
        dpi,
    });

    const totalTime = performance.now() - t0;

    // Map the flat word list to the format already consumed by the frontend.
    // This way any code that uses ocr.worker.js results works without changes.
    const results = nativeResult.words.map(w => ({
        text: w.text,
        confidence: w.confidence,
        // OCRTextLayer.relativeToViewport expects box as [x, y, w, h] normalized.
        // `rect` is already in that format; box_quad is [[tl],[tr],[br],[bl]] which would break it.
        box: w.rect,
        // Keep box_quad available for any polygon-aware overlays in the future
        box_quad: w.box_quad,
    }));

    const avgConfidence = results.length > 0
        ? results.reduce((sum, w) => sum + w.confidence, 0) / results.length
        : 0;

    return {
        results,
        stats: {
            totalTime,
            mode: 'native_windows',
            engine: 'oneocr-rs',
            // Fields expected by ResultsPanel
            averageConfidence: avgConfidence,
            wordsFound: results.length,
        },
        scanDimensions: {
            width: nativeResult.image_width,
            height: nativeResult.image_height,
            dpi: nativeResult.dpi,
        },
        // Raw NativeOcrPageResult from Rust — used by the PDF exporter (save_pdf_with_ocr).
        // This preserves page_index, lines, and words with the exact shape the Tauri command expects.
        _raw: nativeResult,
    };
}
