// =============================================================================
// WEB DETECTION MODULE
// =============================================================================
// Modelo de detección de texto para navegador usando ONNX Runtime Web
// Post-procesamiento con JavaScript puro (sin OpenCV)

import { FileLoader } from './utils.js';
import * as ort from 'onnxruntime-web';
import Clipper from 'js-clipper';

/**
 * Modelo de detección de regiones de texto para navegador
 */
export class Detection {
    #cv; // OpenCV Instance
    #session;
    #config;

    constructor(session, config, cv) {
        this.#session = session;
        this.#config = config;
        this.#cv = cv;
    }

    static sharedTensorData = null;

    /**
     * Crea una instancia del modelo de detección
     */
    static async create(options = {}, cv) {
        if (!cv) throw new Error("OpenCV instance required for Detection");

        // ort imported directly

        const modelPath = options.modelPath || '/models/det/PP-OCRv5_mobile_det.onnx';

        console.log(`[Web Detection] Cargando modelo: ${modelPath}`);

        const session = await ort.InferenceSession.create(modelPath, {
            executionProviders: ['webgpu', 'wasm'],
            graphOptimizationLevel: 'all'
        });

        console.log('[Web Detection] Modelo cargado exitosamente');

        const config = {
            THRESHOLD: options.THRESHOLD || 0.3,
            BOX_THRESHOLD: options.BOX_THRESHOLD || 0.5,
            MIN_BOX_SIZE: options.MIN_BOX_SIZE || 3,
            MIN_AREA: options.MIN_AREA || 20,
            UNCLIP_RATIO: options.UNCLIP_RATIO || 1.6,
            MAX_IMAGE_SIZE: options.MAX_IMAGE_SIZE || 1024,
            DILATE_KERNEL: options.DILATE_KERNEL || 3
        };

        return new Detection(session, config, cv);
    }

    /**
     * Detecta regiones de texto en una imagen
     * @param {ImageData} imageData - Datos de imagen del canvas
     * @returns {Promise<Array>} Array de regiones detectadas con coordenadas
     */
    async detect(imageData, options = {}) {
        // Preprocesar imagen
        const { tensor, scale, padding } = this.#preprocessImage(imageData, options);

        // Ejecutar inferencia
        const startTime = performance.now();
        const outputs = await this.#session.run({ x: tensor });
        const inferenceTime = performance.now() - startTime;

        console.log(`[Web Detection] Inferencia completada en ${inferenceTime.toFixed(2)}ms`);

        // Postprocesar resultados (OpenCV)
        const boxes = this.#postprocessOpenCV(outputs, scale, padding, imageData.width, imageData.height);

        console.log(`[Web Detection] Detectadas ${boxes.length} regiones`);

        return { boxes, inferenceTime };
    }

    // ... preprocessImage defined below (unchanged) ...

    #preprocessImage(imageData, options = {}) {
        const { width, height } = imageData;

        // 1. Calculate Target Size (Multiple of 32)
        // CRITICAL: Allow override to support High DPI without downscaling (The "Technical Trap")
        const maxSize = options.MAX_IMAGE_SIZE || this.#config.MAX_IMAGE_SIZE;

        // Calculate scale to fit WITHIN maxSize (Letterbox logic)
        // Node parity: maintains aspect ratio, adds padding.
        const scale = Math.min(maxSize / width, maxSize / height);

        // Target dimensions (tensor size)
        // In Node, they resize to fit, then pad to multiple of 32? 
        // Or they resize to multiple of 32 directly?
        // Node logic:
        // width = Math.max(Math.ceil(width / 32) * 32, 32);
        // height = Math.max(Math.ceil(height / 32) * 32, 32);

        // Let's stick to standard DBNet/Paddle logic:
        // Resize image so long side is maxSize.
        // Pad to multiple of 32.

        const scaledWidth = Math.round(width * scale);
        const scaledHeight = Math.round(height * scale);

        const targetWidth = Math.max(Math.ceil(scaledWidth / 32) * 32, 32);
        const targetHeight = Math.max(Math.ceil(scaledHeight / 32) * 32, 32);

        // 2. Create Letterbox Canvas
        const canvas = new OffscreenCanvas(targetWidth, targetHeight);
        const ctx = canvas.getContext('2d');

        // Fill black (Padding)
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, targetWidth, targetHeight);

        // Draw Centered (or Top-Left? Node: seems to just resize. Sharp 'contain' centers by default)
        // We will Center it to match typical 'contain' behavior.
        const paddingX = Math.round((targetWidth - scaledWidth) / 2);
        const paddingY = Math.round((targetHeight - scaledHeight) / 2);

        const tempCanvas = new OffscreenCanvas(width, height);
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.putImageData(imageData, 0, 0);

        ctx.drawImage(tempCanvas, 0, 0, width, height, paddingX, paddingY, scaledWidth, scaledHeight);

        const resized = ctx.getImageData(0, 0, targetWidth, targetHeight);

        // 3. Normalize & BGR Conversion
        // OPTIMIZATION: Use Shared Buffer to avoid GC of 60MB+ arrays
        const requiredSize = 3 * targetHeight * targetWidth;

        if (!Detection.sharedTensorData || Detection.sharedTensorData.length < requiredSize) {
            // console.debug(`[Web Detection] Allocating new Tensor Buffer: ${(requiredSize * 4 / 1024 / 1024).toFixed(2)} MB`);
            Detection.sharedTensorData = new Float32Array(requiredSize);
        }

        const tensorData = Detection.sharedTensorData.subarray(0, requiredSize);
        const mean = [0.485, 0.456, 0.406];
        const std = [0.229, 0.224, 0.225];

        for (let i = 0; i < targetHeight * targetWidth; i++) {
            const r = resized.data[i * 4] / 255.0;
            const g = resized.data[i * 4 + 1] / 255.0;
            const b = resized.data[i * 4 + 2] / 255.0;

            // Normalize
            const normR = (r - mean[0]) / std[0]; // R
            const normG = (g - mean[1]) / std[1]; // G
            const normB = (b - mean[2]) / std[2]; // B

            // BGR Order (Node Parity)
            // Channel 0 = B, Channel 1 = G, Channel 2 = R
            tensorData[i] = normB;
            tensorData[targetHeight * targetWidth + i] = normG;
            tensorData[2 * targetHeight * targetWidth + i] = normR;
        }

        const tensor = new ort.Tensor('float32', tensorData, [1, 3, targetHeight, targetWidth]);

        // Return padding info for coordinate recovery
        return {
            tensor,
            scale,
            padding: { x: paddingX, y: paddingY }
        };
    }

    /**
     * Postprocesa usando OpenCV (Matches Node.js Geometry)
     */
    #postprocessOpenCV(outputs, scale, padding, originalWidth, originalHeight) {
        const cv = this.#cv;
        const outputName = Object.keys(outputs)[0];
        const output = outputs[outputName];
        const [batch, channels, height, width] = output.dims;
        const data = output.data;

        // 1. Crear Mat binaria
        const binaryMat = new cv.Mat(height, width, cv.CV_8UC1);
        const binaryData = binaryMat.data;

        // Threshold manual optimizado loop
        for (let i = 0; i < height * width; i++) {
            // CRITICAL FIX: Use THRESHOLD (0.3) for binarization map
            binaryData[i] = data[i] > this.#config.THRESHOLD ? 255 : 0;
        }

        // 2. No Dilation (Node Parity)
        const dilated = binaryMat;

        // 3. Encontrar Contornos
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        cv.findContours(dilated, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

        const boxes = [];
        const minSize = this.#config.MIN_BOX_SIZE;
        // Node doesn't check MIN_AREA in the loop usually, just sside
        // But we kept MIN_AREA in config. Let's rely on sside (min side) primarily like Node.

        for (let i = 0; i < contours.size(); ++i) {
            const cnt = contours.get(i);

            // Node Logic: getMiniBoxes -> sside check -> unclip -> sside check

            // 4. Paridad Geométrica: getMiniBoxes (Custom Sort)
            const resultObj = this.#getMiniBoxes(cnt);
            const { points, sside } = resultObj;

            // Filter 1 (Node Parity)
            if (sside < minSize) {
                cnt.delete();
                continue;
            }

            // 5. Unclip (Expansion)
            // Node passes RAW points to unclip.
            // We pass RAW points (from binary map) to unclip.
            const clipBox = this.#unclip(points, this.#config.UNCLIP_RATIO);

            // 6. Filter 2 (Node Parity: sside < minSize + 2)
            // Need to recalc sside of expanded box. 
            // Since we don't have cv.minAreaRect on purely JS points easily without CV Mat,
            // we can estimate or skip. Node does:
            // "const boxMap = cv.matFromArray(clipBox.length / 2, 1, cv.CV_32SC2, clipBox); const resultObj = getMiniBoxes(boxMap);"
            // Creating Mat per loop might be slow in JS/WASM?
            // Let's implement full parity.

            // To create Mat from points:
            const flatPoints = clipBox.flat(); // [x,y, x,y...]
            const boxMap = cv.matFromArray(flatPoints.length / 2, 1, cv.CV_32SC2, flatPoints);
            const resultObjExpanded = this.#getMiniBoxes(boxMap);
            boxMap.delete();

            if (resultObjExpanded.sside < minSize + 2) {
                cnt.delete();
                continue;
            }

            // 7. Coordinate Recovery
            const expandedPoints = resultObjExpanded.points; // Sorted

            // Recover from Padding/Scale
            const finalBox = expandedPoints.map(p => {
                const xRaw = p[0] - padding.x;
                const yRaw = p[1] - padding.y;
                return [
                    xRaw / scale,
                    yRaw / scale
                ];
            });

            // Make sure it's 4 points
            if (finalBox.length === 4) {
                boxes.push(finalBox);
            }

            cnt.delete();
        }

        // Cleanup
        binaryMat.delete();
        contours.delete();
        hierarchy.delete();

        return boxes;
    }

    // -------------------------------------------------------------------------
    // GEOMETRY HELPERS (Node.js Parity)
    // -------------------------------------------------------------------------

    #getMiniBoxes(contour) {
        const cv = this.#cv;
        const boundingBox = cv.minAreaRect(contour);
        // Note: boxPoints returns [ [x,y], ... ]
        const points = this.#boxPoints(boundingBox).sort((a, b) => a[0] - b[0]);

        let index_1 = 0, index_4 = 1;
        if (points[1][1] > points[0][1]) {
            index_1 = 0; index_4 = 1;
        } else {
            index_1 = 1; index_4 = 0;
        }

        let index_2 = 2, index_3 = 3;
        if (points[3][1] > points[2][1]) {
            index_2 = 2; index_3 = 3;
        } else {
            index_2 = 3; index_3 = 2;
        }

        const box = [points[index_1], points[index_2], points[index_3], points[index_4]];

        // sside is min side
        const w = boundingBox.size.width;
        const h = boundingBox.size.height;
        return { points: box, sside: Math.min(w, h) };
    }

    #boxPoints(rotatedRect) {
        // Manual calculation matches Node's opencv-helpers.js
        const angle = rotatedRect.angle * Math.PI / 180.0;
        const b = Math.cos(angle) * 0.5;
        const a = Math.sin(angle) * 0.5;
        const center = rotatedRect.center;
        const size = rotatedRect.size;

        const p0 = [center.x - a * size.height - b * size.width, center.y + b * size.height - a * size.width];
        const p1 = [center.x + a * size.height - b * size.width, center.y - b * size.height - a * size.width];
        const p2 = [center.x + a * size.height + b * size.width, center.y - b * size.height + a * size.width];
        const p3 = [center.x - a * size.height + b * size.width, center.y + b * size.height + a * size.width];

        return [p0, p1, p2, p3];
    }

    #unclip(box, unclip_ratio) {
        // Area of polygon
        const area = Math.abs(this.#polygonArea(box));
        const length = this.#polygonLength(box);
        const distance = (area * unclip_ratio) / length;

        // JS-Clipper logic
        const tmpArr = box.map(item => ({ X: item[0], Y: item[1] }));
        const offset = new Clipper.ClipperOffset();
        offset.AddPath(tmpArr, Clipper.JoinType.jtRound, Clipper.EndType.etClosedPolygon);

        const expanded = new Clipper.Paths();
        offset.Execute(expanded, distance);

        if (expanded.length > 0 && expanded[0].length > 0) {
            return expanded[0].map(item => [item.X, item.Y]);
        }
        return box;
    }

    #polygonArea(polygon) {
        let area = 0;
        for (let i = 0; i < polygon.length; i++) {
            const j = (i + 1) % polygon.length;
            area += polygon[i][0] * polygon[j][1] - polygon[j][0] * polygon[i][1];
        }
        return area / 2.0;
    }

    #polygonLength(polygon) {
        let length = 0;
        for (let i = 0; i < polygon.length; i++) {
            const j = (i + 1) % polygon.length;
            length += Math.hypot(polygon[j][0] - polygon[i][0], polygon[j][1] - polygon[i][1]);
        }
        return length;
    }
}

