
import { Detection } from './detection.js';
import { Recognition } from './recognition.js';
import { ImageProcessor } from './utils.js';
import { DEFAULT_CONFIG } from '../config.js';

export class Ocr {
    #detection;
    #recognition;
    #config;

    constructor(detection, recognition, config) {
        this.#detection = detection;
        this.#recognition = recognition;
        this.#config = config || DEFAULT_CONFIG;
    }

    static async create(options = {}, cv) {
        const config = { ...DEFAULT_CONFIG, ...options };

        // Handle case mismatch: DEFAULT_CONFIG uses DETECTION/RECOGNITION (uppercase)
        // while constructor might expect lowercase if passing overrides.
        // We merged options into config, so config has the full set.
        // We prioritize explicit options.detection, then config.DETECTION.

        const detectionConfig = options.detection || config.DETECTION || {};
        const recognitionConfig = options.recognition || config.RECOGNITION || {};

        const detection = await Detection.create(detectionConfig, cv);
        const recognition = await Recognition.create(recognitionConfig);

        return new Ocr(detection, recognition, config);
    }

    async execute(imageData, options = {}) {
        const stats = {
            detectionTime: 0,
            recognitionTime: 0,
            totalTime: 0,
            wordsFound: 0,
            averageConfidence: 0
        };

        const startTotal = performance.now();

        // 1. Detection
        const { boxes, inferenceTime: detTime } = await this.#detection.detect(imageData, options);
        stats.detectionTime = detTime;

        if (boxes.length === 0) {
            return { results: [], stats };
        }

        // 2. Recognition
        return this.#runRecognition(imageData, boxes, stats, startTotal, options);
    }

    /**
     * Hybrid Execution: Detects text, filters out regions already covered by Native Text,
     * and recognizes the rest.
     * @param {ImageData} imageData 
     * @param {Array} nativeRects - Array of [x, y, w, h] in PIXELS
     * @param {Object} options 
     */
    async executeHybrid(imageData, nativeRects, options = {}) {
        const stats = {
            detectionTime: 0,
            recognitionTime: 0,
            totalTime: 0,
            wordsFound: 0,
            averageConfidence: 0
        };
        const startTotal = performance.now();

        // 1. Detection
        const { boxes, inferenceTime: detTime } = await this.#detection.detect(imageData, options);
        stats.detectionTime = detTime;

        if (boxes.length === 0) {
            return { results: [], stats };
        }

        // 2. Filter Boxes
        // boxes are [[x,y]...] in Pixels.
        // nativeRects are [x,y,w,h] in Pixels.

        const filteredBoxes = boxes.filter(box => {
            // Convert Box Quad to Rect [x,y,w,h] (Pixels)
            const xs = box.map(p => p[0]);
            const ys = box.map(p => p[1]);
            const xMin = Math.min(...xs);
            const yMin = Math.min(...ys);
            const xMax = Math.max(...xs);
            const yMax = Math.max(...ys);

            // Allow some padding?
            const detRect = { x: xMin, y: yMin, w: xMax - xMin, h: yMax - yMin };

            // Check against ALL native boxes
            // Native boxes are prioritized. If we overlap significantly, we assume it's native.
            // But be careful: Detection might find a word inside a paragraph.
            // Native boxes are usually lines or blocks.

            for (const natRectArr of nativeRects) {
                // natRectArr is [x, y, w, h] Pixels
                const natRect = {
                    x: natRectArr[0],
                    y: natRectArr[1],
                    w: natRectArr[2],
                    h: natRectArr[3]
                };

                if (this.#checkOverlap(detRect, natRect)) {
                    return false; // Exclude (it is native)
                }
            }
            return true; // Keep (it is image text)
        });

        // 3. Recognition on Remaining
        if (filteredBoxes.length === 0) {
            stats.totalTime = performance.now() - startTotal;
            return { results: [], stats };
        }

        console.log(`[OCR Hybrid] Filtered: Kept ${filteredBoxes.length} / ${boxes.length} boxes (Native overlap removed)`);

        return this.#runRecognition(imageData, filteredBoxes, stats, startTotal, options);
    }

    #checkOverlap(rect1, rect2) {
        // Intersection
        const x_left = Math.max(rect1.x, rect2.x);
        const y_top = Math.max(rect1.y, rect2.y);
        const x_right = Math.min(rect1.x + rect1.w, rect2.x + rect2.w);
        const y_bottom = Math.min(rect1.y + rect1.h, rect2.y + rect2.h); // coords are top-left based? Yes.

        if (x_right < x_left || y_bottom < y_top) {
            return false; // No intersection
        }

        const intersectionArea = (x_right - x_left) * (y_bottom - y_top);
        const area1 = rect1.w * rect1.h;
        // const area2 = rect2.w * rect2.h;

        // If Intersection covers > 50% of the Detected Box (rect1), assume it's the same content.
        return (intersectionArea / area1) > 0.5;
    }

    async #runRecognition(imageData, boxes, stats, startTotal, options) {
        // 2. Sort Boxes (Y-major, then X)
        const sortedBoxes = this.#sortBoxes(boxes);

        // OPTIMIZATION: Convert ImageData to OffscreenCanvas ONCE
        const masterSource = new OffscreenCanvas(imageData.width, imageData.height);
        const masterCtx = masterSource.getContext('2d');
        masterCtx.putImageData(imageData, 0, 0);

        // 3. Recognition
        const results = [];
        let totalConf = 0;

        // Batch Inference for stability
        // Reverted to 4 due to Parallel stability issues
        const BATCH_SIZE = 4;
        const queue = [...sortedBoxes];

        while (queue.length > 0) {
            const batchBoxes = queue.splice(0, BATCH_SIZE);
            const batchImages = [];
            const validBatchIndices = []; // Map images back to boxes

            // Prepare Batch
            for (let i = 0; i < batchBoxes.length; i++) {
                const box = batchBoxes[i];

                // USE OPENCV Perspective Crop
                // This replaces cropRotated.
                // Padding 1.1 (10%) included.

                try {
                    const cropped = ImageProcessor.cropPerspective(imageData, box, 1.1);
                    batchImages.push(cropped);
                    validBatchIndices.push(i);
                } catch (e) {
                    console.warn("Crop failed for box", box, e);
                }
            }

            if (batchImages.length > 0) {
                try {
                    const batchResults = await this.#recognition.recognizeBatch(batchImages);
                    stats.recognitionTime += batchResults.reduce((acc, r) => acc + r.inferenceTime, 0);

                    for (let k = 0; k < batchResults.length; k++) {
                        const res = batchResults[k];
                        const boxIdx = validBatchIndices[k];
                        const box = batchBoxes[boxIdx];

                        // Recalculate helper rect
                        const xMin = Math.min(box[0][0], box[3][0]);
                        const yMin = Math.min(box[0][1], box[1][1]);
                        const w = Math.max(box[1][0], box[2][0]) - xMin;
                        const h = Math.max(box[2][1], box[3][1]) - yMin;

                        if (res.text && res.confidence > (options.confidenceThreshold || 0.5)) {
                            results.push({
                                text: res.text,
                                confidence: res.confidence,
                                box: box,
                                rect: [xMin, yMin, w, h]
                            });
                            totalConf += res.confidence;
                        } else {
                            // console.warn(`[OCR] Low confidence/Empty: "${res.text}" (${res.confidence.toFixed(2)}) - Threshold: ${options.confidenceThreshold || 0.5}`);
                        }
                    }
                } catch (e) {
                    console.error("Batch processing error", e);
                }
            }
        }

        stats.wordsFound = results.length;
        stats.averageConfidence = results.length > 0 ? totalConf / results.length : 0;
        stats.totalTime = performance.now() - startTotal;

        return { results, stats };
    }

    /**
     * Sort boxes by reading order (Top-Bottom, Left-Right)
     */
    #sortBoxes(boxes) {
        return boxes.sort((a, b) => {
            const yA = Math.min(a[0][1], a[1][1]);
            const yB = Math.min(b[0][1], b[1][1]);

            // Tolerance for same line = 10 pixels (approx)
            if (Math.abs(yA - yB) < 10) {
                const xA = Math.min(a[0][0], a[3][0]);
                const xB = Math.min(b[0][0], b[3][0]);
                return xA - xB;
            }
            return yA - yB;
        });
    }
}
