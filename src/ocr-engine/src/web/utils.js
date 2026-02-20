// =============================================================================
// WEB UTILITIES
// =============================================================================
// Utilidades para procesamiento de imágenes en el navegador usando Canvas API

/**
 * Clase para manejar imágenes en el navegador
 */
export class ImageProcessor {
    /**
     * Convierte ImageData a tensor normalizado para ONNX
     * @param {ImageData} imageData - Datos de imagen del canvas
     * @param {number} targetHeight - Altura objetivo
     * @param {number} targetWidth - Ancho objetivo
     * @returns {Object} Tensor data y dimensiones
     */
    /**
     * Cache shared canvases to avoid reallocation overhead (116+ regions = 232+ canvases avoided)
     */
    static #sharedCanvas = null;
    static #sharedCtx = null;
    static #sharedTempCanvas = null;
    static #sharedTempCtx = null;

    static getSharedCanvas(width, height) {
        if (!this.#sharedCanvas) {
            this.#sharedCanvas = new OffscreenCanvas(width, height);
            this.#sharedCtx = this.#sharedCanvas.getContext('2d', { willReadFrequently: true });
        } else {
            // Resize if needed (or just keep max size? Resizing is cheap enough for Offscreen)
            if (this.#sharedCanvas.width !== width || this.#sharedCanvas.height !== height) {
                this.#sharedCanvas.width = width;
                this.#sharedCanvas.height = height;
            }
        }
        return { canvas: this.#sharedCanvas, ctx: this.#sharedCtx };
    }

    static getSharedTempCanvas(width, height) {
        if (!this.#sharedTempCanvas) {
            this.#sharedTempCanvas = new OffscreenCanvas(width, height);
            this.#sharedTempCtx = this.#sharedTempCanvas.getContext('2d', { willReadFrequently: true });
        } else {
            if (this.#sharedTempCanvas.width !== width || this.#sharedTempCanvas.height !== height) {
                this.#sharedTempCanvas.width = width;
                this.#sharedTempCanvas.height = height;
            }
        }
        return { canvas: this.#sharedTempCanvas, ctx: this.#sharedTempCtx };
    }

    /**
     * Convierte ImageData a tensor normalizado para ONNX
     * @param {ImageData} imageData - Datos de imagen del canvas
     * @param {number} targetHeight - Altura objetivo
     * @param {number} targetWidth - Ancho objetivo
     * @returns {Object} Tensor data y dimensiones
     */
    // Shared Buffer for Recognition (Avoids GC)
    static #recSharedBuffer = null;

    static imageDataToTensor(imageData, targetHeight = 48, targetWidth = null) {
        // Variable Width Mode (Match Node.js behavior)
        let scaledWidth, scaledHeight;
        let finalWidth, finalHeight;
        let scale;

        if (!targetWidth) {
            scale = targetHeight / imageData.height;
            scaledWidth = Math.ceil(imageData.width * scale);
            scaledHeight = targetHeight;
            finalWidth = scaledWidth;
            finalHeight = targetHeight;
            if (finalWidth > 2048) finalWidth = 2048;
        } else {
            finalWidth = targetWidth;
            finalHeight = targetHeight;
            scale = Math.min(targetWidth / imageData.width, targetHeight / imageData.height);
            scaledWidth = Math.floor(imageData.width * scale);
            scaledHeight = Math.floor(imageData.height * scale);
        }

        // OPTIMIZATION: Use Shared Canvas
        const { canvas, ctx } = this.getSharedCanvas(finalWidth, finalHeight);

        // Temp Canvas for original image drawing
        const { canvas: tempCanvas, ctx: tempCtx } = this.getSharedTempCanvas(imageData.width, imageData.height);
        tempCtx.putImageData(imageData, 0, 0);

        const offsetX = Math.floor((finalWidth - scaledWidth) / 2);
        const offsetY = Math.floor((finalHeight - scaledHeight) / 2);

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, finalWidth, finalHeight);
        ctx.drawImage(tempCanvas, offsetX, offsetY, scaledWidth, scaledHeight);

        // Obtener datos redimensionados
        const resizedData = ctx.getImageData(0, 0, finalWidth, finalHeight);

        // Convertir a formato CHW (Channels, Height, Width) normalizado
        const requiredSize = 3 * finalHeight * finalWidth;

        // MEMORY OPTIMIZATION REVERTED: Shared Buffer caused accuracy regression (97% -> 83%).
        // Suspected issue: Data overwrites during async processing or batching.
        // Reverting to safe per-call allocation.
        const float32Data = new Float32Array(requiredSize);

        for (let i = 0; i < finalHeight * finalWidth; i++) {
            const r = resizedData.data[i * 4] / 255.0;
            const g = resizedData.data[i * 4 + 1] / 255.0;
            const b = resizedData.data[i * 4 + 2] / 255.0;

            // Normalization: (val - 0.5) / 0.5  =>  Range [-1, 1]
            // Standard for PaddleOCR Recognition models
            const normR = (r - 0.5) / 0.5;
            const normG = (g - 0.5) / 0.5;
            const normB = (b - 0.5) / 0.5;

            // BGR Order (Node Parity / OpenCV Standard)
            float32Data[i] = normB;
            float32Data[targetHeight * targetWidth + i] = normG;
            float32Data[2 * targetHeight * targetWidth + i] = normR;
        }

        return {
            data: float32Data,
            dims: [1, 3, finalHeight, finalWidth]
        };
    }


    /**
     * Recorta una región de la imagen
     * @param {ImageData} imageData - Imagen original
     * @param {number} x - Coordenada X
     * @param {number} y - Coordenada Y
     * @param {number} width - Ancho
     * @param {number} height - Alto
     * @returns {ImageData} Imagen recortada
     */
    static crop(imageData, x, y, width, height) {
        // Asegurar enteros
        x = Math.floor(x);
        y = Math.floor(y);
        width = Math.floor(width);
        height = Math.floor(height);

        // Crear canvas origen (OffscreenCanvas para Worker)
        const srcCanvas = new OffscreenCanvas(imageData.width, imageData.height);
        const srcCtx = srcCanvas.getContext('2d');
        srcCtx.putImageData(imageData, 0, 0);

        // Crear canvas destino
        const destCanvas = new OffscreenCanvas(width, height);
        const destCtx = destCanvas.getContext('2d');
        destCtx.imageSmoothingEnabled = true;
        destCtx.imageSmoothingQuality = 'high';

        // Dibujar región recortada
        destCtx.drawImage(
            srcCanvas,
            x, y, width, height, // Source rect
            0, 0, width, height  // Dest rect
        );

        return destCtx.getImageData(0, 0, width, height);
    }

    /**
     * Recorta y endereza una región basada en 4 puntos (Perspective/Rotation Correction)
     * Replaces Node's getRotateCropImage (OpenCV)
     * Optimized: Accepts reusable CanvasImageSource to avoid copying ImageData 100+ times.
     * @param {CanvasImageSource} imageSource - Fuente de imagen (Canvas, Bitmap, Image)
     * @param {number[][]} box - 4 Puntos [TL, TR, BR, BL]
     * @param {number} [paddingRatio=1.0] - Ratio de padding (1.0 = sin padding, 1.1 = 10% más)
     */
    static cropRotated(imageSource, box, paddingRatio = 1.0) {
        // 1. Calcular dimensiones y ángulo (Node logic)
        const [p0, p1, p2, p3] = box;

        const w1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        const w2 = Math.hypot(p2[0] - p3[0], p2[1] - p3[1]);
        const h1 = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
        const h2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);

        const width = Math.max(w1, w2) * paddingRatio;
        const height = Math.max(h1, h2) * paddingRatio;

        // Ángulo respecto a la horizontal (usamos borde superior)
        const angle = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);

        const cx = (p0[0] + p2[0]) / 2;
        const cy = (p0[1] + p2[1]) / 2;

        const destCanvas = new OffscreenCanvas(width, height);
        const destCtx = destCanvas.getContext('2d');
        destCtx.imageSmoothingEnabled = true;
        destCtx.imageSmoothingQuality = 'high';

        destCtx.translate(width / 2, height / 2);
        destCtx.rotate(-angle);
        destCtx.translate(-cx, -cy);

        destCtx.drawImage(imageSource, 0, 0);

        return destCtx.getImageData(0, 0, width, height);
    }

    /**
     * @type {any} Instancia de OpenCV cargada
     */
    static #cv = null;

    static initOpenCV(cvInstance) {
        this.#cv = cvInstance;
    }

    /**
     * Recorte de perspectiva usando OpenCV (Paridad exacta con Node.js)
     * @param {ImageData|HTMLImageElement|OffscreenCanvas} imageSource 
     * @param {number[][]} box 4 puntos
     * @param {number} [paddingRatio=1.0]
     */
    static cropPerspective(imageSource, box, paddingRatio = 1.0) {
        if (!this.#cv) throw new Error("OpenCV not initialized");
        const cv = this.#cv;

        // 1. Convertir imagen a Mat
        let srcMat;
        try {
            // Si es ImageData, usar matFromImageData (más rápido si existe, sino wrapper)
            if (imageSource instanceof ImageData) {
                srcMat = cv.matFromImageData(imageSource);
            } else {
                // Para Canvas/Image, leer a través de un canvas temporal si es necesario
                // Ojo: cv.imread requiere un elemento DOM ID normalmnete.
                // Mejor usar un canvas temporal para obtener ImageData si no lo es.
                let data = imageSource;
                if (!(data instanceof ImageData)) {
                    const w = imageSource.width;
                    const h = imageSource.height;
                    const tCan = new OffscreenCanvas(w, h);
                    const tCtx = tCan.getContext('2d');
                    tCtx.drawImage(imageSource, 0, 0);
                    data = tCtx.getImageData(0, 0, w, h);
                }
                srcMat = cv.matFromImageData(data);
            }

            // 2. Ordenar puntos (TL, TR, BR, BL)
            // CRITICAL: cv.minAreaRect does NOT guarantee order.
            // If we don't sort, we might twist the image (e.g. TL becomes BR), 
            // causing mirror/upside-down text that fails recognition.
            const [p0, p1, p2, p3] = this.orderPoints(box);

            const w1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
            const w2 = Math.hypot(p2[0] - p3[0], p2[1] - p3[1]);
            const h1 = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
            const h2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);

            const dstWidth = Math.max(w1, w2) * paddingRatio;
            const dstHeight = Math.max(h1, h2) * paddingRatio;

            // 3. Matriz de transformación de perspectiva
            // Puntos origen (Float32) - ORDERED
            const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
                p0[0], p0[1],
                p1[0], p1[1],
                p2[0], p2[1],
                p3[0], p3[1]
            ]);

            // Puntos destino (Rectángulo perfecto centrado con padding)
            // Si hay padding, desplazamos el origen
            // Sin padding: [0,0], [w,0], [w,h], [0,h]
            // Con padding: Centrar el contenido.
            // PaddingRatio 1.1 significa 10% más grande.
            // Para simplificar y match Node, simplemente escalamos la caja destino.

            // Node logic usually maps corners to corners. 
            // If we want padding, we map box corners to INSET points in the dest image.
            const PAD_X = (dstWidth - (dstWidth / paddingRatio)) / 2;
            const PAD_Y = (dstHeight - (dstHeight / paddingRatio)) / 2;

            const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
                PAD_X, PAD_Y,
                dstWidth - PAD_X, PAD_Y,
                dstWidth - PAD_X, dstHeight - PAD_Y,
                PAD_X, dstHeight - PAD_Y
            ]);

            const M = cv.getPerspectiveTransform(srcTri, dstTri);
            const dstMat = new cv.Mat();
            const dsize = new cv.Size(dstWidth, dstHeight);

            // 4. Warp
            cv.warpPerspective(srcMat, dstMat, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 255));

            // 5. Convertir vuelta a ImageData
            const imgData = new ImageData(new Uint8ClampedArray(dstMat.data), dstMat.cols, dstMat.rows);

            // Cleanup
            srcMat.delete();
            dstMat.delete();
            srcTri.delete();
            dstTri.delete();
            M.delete();

            return imgData;

        } catch (e) {
            if (srcMat) srcMat.delete();
            console.error("OpenCV Crop Error", e);
            throw e;
        }
    }

    /**
     * Ordena coordenadas en [TL, TR, BR, BL]
     * @param {number[][]} pts - Array de 4 puntos [[x,y]...]
     */
    static orderPoints(pts) {
        // Sort by X
        const xSorted = pts.sort((a, b) => a[0] - b[0]);

        // Grab left-most and right-most pairs
        const leftMost = xSorted.slice(0, 2);
        const rightMost = xSorted.slice(2, 4);

        // Sort left-most by Y => TL, BL? 
        // Note: Canvas Y is down.
        // TL = min Y of leftMost
        // BL = max Y of leftMost
        leftMost.sort((a, b) => a[1] - b[1]);
        const [tl, bl] = leftMost;

        // Sort right-most by Y
        // TR = min Y of rightMost
        // BR = max Y of rightMost
        // Careful: Euclidean distance logic is better but this is fast and works for rects.
        // Let's use Euclidean/Sum diff for robustness if needed, 
        // but for rotated rects from minAreaRect, this X-split usually works unless angle is near 90.

        // Better robust method (Sum/Diff):
        // TL: min(x+y) ? No.
        // Let's stick to the classic Python pyimagesearch implementation.
        // 1. Sort by Y (top vs bottom) doesn't work for 45 deg.

        // Robust Method:
        // 1. Sort by X
        // 2. Left set (2 pts), Right set (2 pts)
        // 3. Sort Left set by Y: Top-Left, Bottom-Left
        // 4. Sort Right set by Y: Top-Right, Bottom-Right
        // Wait, D-Euclidean from BR?

        // Implementation "PyImageSearch":
        // rect = np.zeros((4, 2), dtype = "float32")
        // s = pts.sum(axis = 1) -> TL is min(sum), BR is max(sum)
        // diff = np.diff(pts, axis = 1) -> TR is min(diff), BL is max(diff) (y-x)

        const result = [null, null, null, null];

        const sums = pts.map(p => p[0] + p[1]);
        const diffs = pts.map(p => p[1] - p[0]);

        const minSum = Math.min(...sums);
        const maxSum = Math.max(...sums);
        const minDiff = Math.min(...diffs);
        const maxDiff = Math.max(...diffs);

        result[0] = pts.find(p => (p[0] + p[1]) === minSum); // TL
        result[2] = pts.find(p => (p[0] + p[1]) === maxSum); // BR
        result[1] = pts.find(p => (p[1] - p[0]) === minDiff); // TR
        result[3] = pts.find(p => (p[1] - p[0]) === maxDiff); // BL

        // Fallback if duplicates (perfect square axis aligned?)
        if (!result[0]) result[0] = pts[0];
        if (!result[1]) result[1] = pts[1];
        if (!result[2]) result[2] = pts[2];
        if (!result[3]) result[3] = pts[3];

        return result;
    }

    /**
     * Aplica un filtro de nitidez (Sharpening) usando un kernel Laplaciano.
     * Mejora la detección de texto en PDFs escaneados o borrosos.
     * @param {ImageData} imageData 
     * @returns {ImageData}
     */
    static applySharpening(imageData) {
        const w = imageData.width;
        const h = imageData.height;
        const src = imageData.data;
        const output = new ImageData(w, h);
        const dst = output.data;

        // Kernel Laplaciano (3x3) - Standard Sharpen
        //  0 -1  0
        // -1  5 -1
        //  0 -1  0
        const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];

        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = (y * w + x) * 4;
                let r = 0, g = 0, b = 0;

                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        const kIdx = ((y + ky) * w + (x + kx)) * 4;
                        const weight = kernel[(ky + 1) * 3 + (kx + 1)];
                        r += src[kIdx] * weight;
                        g += src[kIdx + 1] * weight;
                        b += src[kIdx + 2] * weight;
                    }
                }

                dst[idx] = Math.min(255, Math.max(0, r));
                dst[idx + 1] = Math.min(255, Math.max(0, g));
                dst[idx + 2] = Math.min(255, Math.max(0, b));
                dst[idx + 3] = 255;
            }
        }
        return output;
    }

    /**
     * Aplica Adaptive Thresholding para mejorar contraste local.
     * Útil para eliminar fondos grises o ruido.
     * @param {ImageData} imageData 
     * @returns {ImageData}
     */
    static applyAdaptiveThreshold(imageData) {
        // Simple implementation: Contrast Stretching or Local?
        // Let's implement a verified Contrast Stretch first which is faster in JS.
        // True Adaptive Threshold (Sauvola/Niblack) is slow in pure JS loops.
        // We'll use a local enhancement logic similar to the reference repo:
        // "Math.pow((gray - 50) / 130, 1.2) * 255" equivalent.

        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            // Grayscale
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;

            let enhanced;
            // Adaptive logic inspired by reference
            if (gray < 50) {
                enhanced = 0; // Black text
            } else if (gray < 200) {
                // Stretch midtones
                enhanced = Math.pow((gray - 50) / 150, 1.2) * 255;
            } else {
                enhanced = 255; // White background
            }

            enhanced = Math.min(255, Math.max(0, enhanced));

            data[i] = enhanced;
            data[i + 1] = enhanced;
            data[i + 2] = enhanced;
        }
        return imageData;
    }

    /**
     * Carga una imagen desde un archivo
     * @param {File} file - Archivo de imagen
     * @returns {Promise<ImageData>} ImageData del canvas
     */
    static async loadImageFromFile(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const imageData = ctx.getImageData(0, 0, img.width, img.height);
                resolve(imageData);
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    }
}

/**
 * Utilidades para carga de archivos
 */
export class FileLoader {
    /**
     * Carga un archivo de texto
     * @param {string} url - URL del archivo
     * @returns {Promise<string>} Contenido del archivo
     */
    static async loadText(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load ${url}: ${response.statusText}`);
        }
        return await response.text();
    }

    /**
     * Carga un archivo JSON
     * @param {string} url - URL del archivo
     * @returns {Promise<any>} Datos JSON
     */
    static async loadJSON(url) {
        const text = await this.loadText(url);
        return JSON.parse(text);
    }
}
