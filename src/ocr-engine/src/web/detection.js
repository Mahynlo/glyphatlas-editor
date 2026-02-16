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
    async detect(imageData) {
        // Preprocesar imagen
        const { tensor, scale } = this.#preprocessImage(imageData);

        // Ejecutar inferencia
        const startTime = performance.now();
        const outputs = await this.#session.run({ x: tensor });
        const inferenceTime = performance.now() - startTime;

        console.log(`[Web Detection] Inferencia completada en ${inferenceTime.toFixed(2)}ms`);

        // Postprocesar resultados (OpenCV)
        const boxes = this.#postprocessOpenCV(outputs, scale, imageData.width, imageData.height);

        console.log(`[Web Detection] Detectadas ${boxes.length} regiones`);

        return { boxes, inferenceTime };
    }

    // ... preprocessImage defined below (unchanged) ...

    #preprocessImage(imageData) {
        const { width, height } = imageData;

        // Calcular escala para redimensionar
        const maxSize = this.#config.MAX_IMAGE_SIZE;
        const scale = Math.min(maxSize / width, maxSize / height, 1.0);
        const newWidth = Math.floor(width * scale / 32) * 32;
        const newHeight = Math.floor(height * scale / 32) * 32;

        const canvas = new OffscreenCanvas(newWidth, newHeight);
        const ctx = canvas.getContext('2d');
        const tempCanvas = new OffscreenCanvas(width, height);
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.putImageData(imageData, 0, 0);

        ctx.drawImage(tempCanvas, 0, 0, newWidth, newHeight);
        const resized = ctx.getImageData(0, 0, newWidth, newHeight);

        const tensorData = new Float32Array(3 * newHeight * newWidth);
        const mean = [0.485, 0.456, 0.406];
        const std = [0.229, 0.224, 0.225];

        for (let i = 0; i < newHeight * newWidth; i++) {
            const r = resized.data[i * 4] / 255.0;
            const g = resized.data[i * 4 + 1] / 255.0;
            const b = resized.data[i * 4 + 2] / 255.0;

            tensorData[i] = (r - mean[0]) / std[0];
            tensorData[newHeight * newWidth + i] = (g - mean[1]) / std[1];
            tensorData[2 * newHeight * newWidth + i] = (b - mean[2]) / std[2];
        }

        const tensor = new ort.Tensor('float32', tensorData, [1, 3, newHeight, newWidth]);

        return { tensor, scale };
    }

    /**
     * Postprocesa usando OpenCV (Matches Node.js Geometry)
     */
    #postprocessOpenCV(outputs, scale, originalWidth, originalHeight) {
        const cv = this.#cv;
        const outputName = Object.keys(outputs)[0];
        const output = outputs[outputName];
        const [batch, channels, height, width] = output.dims;
        const data = output.data;

        // 1. Crear Mat binaria
        // Es más eficiente manipular el buffer directamente si fuera posible, 
        // pero output.data es un Float32Array. 
        const binaryMat = new cv.Mat(height, width, cv.CV_8UC1);
        const binaryData = binaryMat.data;

        // Threshold manual optimizado loop
        for (let i = 0; i < height * width; i++) {
            binaryData[i] = data[i] > this.#config.BOX_THRESHOLD ? 255 : 0;
        }

        // 2. Dilatación (OpenCV)
        // Paridad con Node: cv.dilate
        const kernelSize = this.#config.DILATE_KERNEL;
        const M = cv.Mat.ones(kernelSize, kernelSize, cv.CV_8U);
        const dilated = new cv.Mat();
        cv.dilate(binaryMat, dilated, M, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());

        // 3. Encontrar Contornos
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        cv.findContours(dilated, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

        const boxes = [];
        const minSize = this.#config.MIN_BOX_SIZE;
        const minArea = this.#config.MIN_AREA;

        for (let i = 0; i < contours.size(); ++i) {
            const cnt = contours.get(i);

            // Filtrar por tamaño de contorno inicial (rápido)
            if (cnt.rows < minSize) { // cnt.rows is number of points
                cnt.delete();
                continue;
            }

            // 4. Paridad Geométrica: minAreaRect (Rectángulo Rotado)
            // Node usa esto para obtener la orientación perfecta del texto
            const rotatedRect = cv.minAreaRect(cnt);

            const w = rotatedRect.size.width;
            const h = rotatedRect.size.height;
            const area = w * h;

            if (w < minSize || h < minSize || area < minArea) {
                cnt.delete();
                continue;
            }

            // Validar Aspect Ratio
            const aspectRatio = Math.max(w, h) / Math.min(w, h);
            if (aspectRatio > 50) { // Relaxed to 50 for very long lines
                cnt.delete();
                continue;
            }

            // 5. Unclip (Expansion) usando Clipper
            // Convertimos rotatedRect a polígono
            // cv.RotatedRect.points retorna 4 vertices
            const vertices = cv.RotatedRect.points(rotatedRect);

            // Escalar al tamaño original Y Unclip
            const boxPoints = vertices.map(p => ({
                X: p.x / scale, // Escalar al original
                Y: p.y / scale
            }));

            const expandedBox = this.#unclipBox(boxPoints); // Usamos Clipper logic existente modificada

            boxes.push(expandedBox);
            cnt.delete();
        }

        // Cleanup
        binaryMat.delete();
        dilated.delete();
        M.delete();
        contours.delete();
        hierarchy.delete();

        return boxes;
    }

    // Helper para Clipper (Unclip)
    #unclipBox(boxPoints) {
        if (!this.#config.UNCLIP_RATIO || this.#config.UNCLIP_RATIO <= 1.0) {
            return boxPoints.map(p => [p.X, p.Y]);
        }

        // Clipper expansion logic (Reused but adapted for generic points)
        try {
            // Calcular área y perímetro de un polígono arbitrario (Shoelace formula)
            // ...o usar Clipper Area? El boxPoints proviene de minAreaRect, es convexo.

            // Simplificación: Unclip geométrico para rectángulo
            // Node usa ClipperOffset.
            const offset = new Clipper.ClipperOffset();
            offset.AddPath(boxPoints, Clipper.JoinType.jtRound, Clipper.EndType.etClosedPolygon);

            // Calcular delta (distance)
            // Area de rect rotado w*h
            // Perimeter 2(w+h)
            // distance = area * ratio / perimeter
            // Necesitamos w y h ORIGINALES (escalados).
            const p0 = boxPoints[0], p1 = boxPoints[1], p2 = boxPoints[2];
            const w = Math.hypot(p1.X - p0.X, p1.Y - p0.Y);
            const h = Math.hypot(p2.X - p1.X, p2.Y - p1.Y);
            const area = w * h;
            const perimeter = 2 * (w + h);

            const distance = (area * this.#config.UNCLIP_RATIO) / perimeter;

            const expanded = new Clipper.Paths();
            offset.Execute(expanded, distance);

            if (expanded.length > 0 && expanded[0].length > 0) {
                return expanded[0].map(pt => [pt.X, pt.Y]);
            }
        } catch (e) {
            console.warn("Unclip failed", e);
        }

        return boxPoints.map(p => [p.X, p.Y]);
    }

    /**
     * Obtiene la caja delimitadora de una región
     */
    #getBoundingBox(region, scale) {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const [x, y] of region) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }

        // Definir polígono inicial (Rectángulo)
        const box = [
            { X: minX, Y: minY },
            { X: maxX, Y: minY },
            { X: maxX, Y: maxY },
            { X: minX, Y: maxY }
        ];

        // 2. Aplicar Unclip (Expansión) usando Clipper
        if (this.#config.UNCLIP_RATIO && this.#config.UNCLIP_RATIO > 1.0) {
            try {
                // Calcular distancia de expansión
                const w = (maxX - minX);
                const h = (maxY - minY);
                const area = w * h;
                const perimeter = 2 * (w + h);

                if (perimeter > 0) {
                    const distance = (area * this.#config.UNCLIP_RATIO) / perimeter;

                    const offset = new Clipper.ClipperOffset();
                    offset.AddPath(box, Clipper.JoinType.jtRound, Clipper.EndType.etClosedPolygon);

                    const expanded = new Clipper.Paths();
                    offset.Execute(expanded, distance);

                    if (expanded.length > 0 && expanded[0].length > 0) {
                        const exPoly = expanded[0];

                        // Convertir de vuelta a min/max rect del polígono expandido
                        let eMinX = Infinity, eMinY = Infinity;
                        let eMaxX = -Infinity, eMaxY = -Infinity;

                        for (const pt of exPoly) {
                            eMinX = Math.min(eMinX, pt.X);
                            eMinY = Math.min(eMinY, pt.Y);
                            eMaxX = Math.max(eMaxX, pt.X);
                            eMaxY = Math.max(eMaxY, pt.Y);
                        }

                        // Escalar de vuelta coords originales
                        return [
                            [Math.floor(eMinX / scale), Math.floor(eMinY / scale)],
                            [Math.ceil(eMaxX / scale), Math.floor(eMinY / scale)],
                            [Math.ceil(eMaxX / scale), Math.ceil(eMaxY / scale)],
                            [Math.floor(eMinX / scale), Math.ceil(eMaxY / scale)]
                        ];
                    }
                }
            } catch (e) {
                console.warn("Clipper expansion failed, falling back to manual", e);
            }
        }

        // Fallback sin unclip use Clip logic
        minX = Math.floor(minX / scale);
        minY = Math.floor(minY / scale);
        maxX = Math.ceil(maxX / scale);
        maxY = Math.ceil(maxY / scale);

        return [
            [minX, minY],
            [maxX, minY],
            [maxX, maxY],
            [minX, maxY]
        ];
    }
}
