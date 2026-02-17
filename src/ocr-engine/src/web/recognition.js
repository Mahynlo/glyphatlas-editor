// =============================================================================
// WEB RECOGNITION MODULE
// =============================================================================
// Modelo de reconocimiento de texto para navegador usando ONNX Runtime Web

import { ImageProcessor, FileLoader } from './utils.js';
import * as ort from 'onnxruntime-web';

/**
 * Modelo de reconocimiento de texto para navegador
 */
export class Recognition {
    #session;
    #dictionary;
    #config;

    constructor(session, dictionary, config) {
        this.#session = session;
        this.#dictionary = dictionary;
        this.#config = config;
    }

    /**
     * Crea una instancia del modelo de reconocimiento
     * @param {Object} options - Opciones de configuración
     * @param {string} options.language - Idioma ('latin', 'en', etc.)
     * @param {string} options.modelPath - Ruta al modelo ONNX
     * @param {string} options.dictPath - Ruta al diccionario
     */
    static async create(options = {}) {
        // ort imported directly

        const language = options.language || 'latin';
        const modelPath = options.modelPath || '/models/rec/latin_PP-OCRv5_mobile_rec.onnx';
        const dictPath = options.dictPath || '/models/rec/config.json';

        console.log(`[Web Recognition] Cargando modelo: ${modelPath}`);

        // Crear sesión ONNX - Intentar WebGPU, fallback a WASM
        // Crear sesión ONNX - FORZAR WebGPU para depuración
        const sessionOptions = {
            executionProviders: ['webgpu', 'wasm'],
            graphOptimizationLevel: 'all',
            executionMode: 'parallel',
            intraOpNumThreads: navigator.hardwareConcurrency || 4,
            interOpNumThreads: 0,
            logSeverityLevel: 0, // Verbose
            logVerbosityLevel: 0, // Verbose
            ...options.onnxOptions
        };

        let session;
        try {
            session = await ort.InferenceSession.create(modelPath, sessionOptions);
            if (options.debug) console.log(`[Web Recognition] Modelo cargado exitosamente`);
            if (options.debug) console.log(`[Web Recognition] Execution Provider: ${session.handler.backend.name}`);
        } catch (e) {
            console.error("[Web Recognition] FATAL: WebGPU init failed. Error details:", e);
            // Fallback manual si falla para que no rompa la app, pero queremos ver el log
            console.log("[Web Recognition] Trying fallback to WASM...");
            session = await ort.InferenceSession.create(modelPath, { executionProviders: ['wasm'] });
            if (options.debug) console.log(`[Web Recognition] Modelo cargado exitosamente con WASM`);
            if (options.debug) console.log(`[Web Recognition] Execution Provider: ${session.handler.backend.name}`);
        }

        // Cargar diccionario
        let dictionary;
        if (dictPath.endsWith('.json')) {
            const config = await FileLoader.loadJSON(dictPath);
            // El config.json tiene PostProcess.character_dict con los caracteres
            const chars = config.PostProcess?.character_dict || config.character || config.character_dict || config.dict || [];

            // IMPORTANT: Node reference appends ' ' (space) to the end.
            // Web uses 1-based indexing logic (0=blank), so we prepend 'blank'.
            // Matching Node: 
            // Node: index=1 -> chars[0].
            // Web: index=1 -> dict[1] -> chars[0]. (Correct)
            // Node: index=Last -> ' '.
            // Web: index=Last -> dict[Last] -> ' '. (Must add it)

            dictionary = ['blank', ...chars, ' '];

            dictionary = ['blank', ...chars, ' '];

        } else {
            const text = await FileLoader.loadText(dictPath);
            dictionary = ['blank', ...text.trim().split('\n'), ' '];
        }

        console.log(`[Web Recognition] Diccionario cargado: ${dictionary.length} caracteres`);

        const config = {
            IMAGE_HEIGHT: 48,
            IMAGE_WIDTH: 320,
            CONFIDENCE_THRESHOLD: 0.5
        };

        return new Recognition(session, dictionary, config);
    }

    /**
     * Reconoce texto en una imagen
     * @param {ImageData} imageData - Datos de imagen del canvas
     * @returns {Promise<Object>} Resultado con texto y confianza
     */
    async recognize(imageData) {
        const results = await this.recognizeBatch([imageData]);
        return results[0];
    }

    /**
     * Reconoce texto en un lote de imágenes
     * @param {ImageData[]} imageDatas - Array de imágenes
     * @returns {Promise<Array>} Array de resultados { text, confidence, inferenceTime }
     */
    async recognizeBatch(imageDatas) {
        if (imageDatas.length === 0) return [];

        const startTime = performance.now();
        const H = 48; // Fixed Height
        const results = [];

        try {
            // Revert: Sequential Execution to prevent WebGPU Hangs
            for (const img of imageDatas) {
                // Use Shared Canvas (Optimized)
                // Resize to Height 48, Variable Width
                const { data, dims } = ImageProcessor.imageDataToTensor(img, H, null);

                const tensor = new ort.Tensor('float32', data, dims);

                // Run inference
                const outputs = await this.#session.run({ x: tensor });

                // Post-process
                const result = this.#postprocess(outputs);
                results.push(result);
            }

            // Add timing info
            const totalTime = performance.now() - startTime;
            const timePerItem = totalTime / results.length;

            return results.map(r => ({ ...r, inferenceTime: timePerItem }));

        } catch (e) {
            console.error("Batch Execution Error:", e);
            throw e;
        }
    }

    /**
     * Postprocesa la salida del modelo
     * @param {Object} outputs - Salidas del modelo ONNX
     * @returns {Object} Texto reconocido y confianza
     */
    #postprocess(outputs) {
        // Obtener tensor de salida (nombre puede variar según el modelo)
        const outputName = Object.keys(outputs)[0];
        const output = outputs[outputName];

        // output.data es Float32Array con shape [batch, sequence_length, num_classes]
        const data = output.data;
        const dims = output.dims;  // [1, seq_len, num_classes]

        const seqLength = dims[1];
        const numClasses = dims[2];

        // Decodificar usando CTC greedy
        let text = '';
        let confidences = [];
        let lastChar = null;

        for (let t = 0; t < seqLength; t++) {
            // Encontrar clase con mayor probabilidad
            let maxProb = -Infinity;
            let maxIdx = 0;

            for (let c = 0; c < numClasses; c++) {
                const prob = data[t * numClasses + c];
                if (prob > maxProb) {
                    maxProb = prob;
                    maxIdx = c;
                }
            }

            // CTC: ignorar blank (0) y caracteres repetidos
            if (maxIdx !== 0 && maxIdx !== lastChar) {
                if (maxIdx < this.#dictionary.length) {
                    text += this.#dictionary[maxIdx];
                    confidences.push(maxProb);
                }
            }

            lastChar = maxIdx;
        }

        // Calcular confianza promedio
        const avgConfidence = confidences.length > 0
            ? confidences.reduce((a, b) => a + b, 0) / confidences.length
            : 0;

        return {
            text: text.trim(),
            confidence: avgConfidence
        };
    }
}
