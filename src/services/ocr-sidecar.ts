
import { Command } from '@tauri-apps/plugin-shell';
import { writeFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { tempDir, join } from '@tauri-apps/api/path';

// RUTA ABSOLUTA al script CLI (Ajustar si cambia la ubicación del proyecto)
// Nota: En producción esto debería estar empaquetado con 'binaries' en tauri.conf.json
const CLI_SCRIPT_PATH = 'c:/Users/malco/Documents/practicas_editor/OCR/ocr-engine/ocr-cli.js';

export interface OCRResult {
    results: any[];
    stats: {
        detectionTime: number;
        recognitionTime: number;
        totalTime: number;
        wordsFound: number;
        averageConfidence: number;
    };
    scanDimensions?: {
        width: number;
        height: number;
        dpi: number;
    };
}

export class OCRSidecar {
    /**
     * Procesa una página PDF usando el motor OCR nativo (Node.js Sidecar)
     * @param pdfBuffer ArrayBuffer del archivo PDF completo
     * @param pageIndex Índice de la página a procesar (0-based)
     */
    static async processPage(pdfBuffer: ArrayBuffer, pageIndex: number): Promise<OCRResult> {
        try {
            // 1. Escribir PDF a archivo temporal
            // Necesitamos un archivo físico para pasarlo al script de Node.js
            const tempPath = await tempDir();
            const tempFile = await join(tempPath, 'temp_ocr_input.pdf');

            await writeFile(tempFile, new Uint8Array(pdfBuffer));

            console.log(`[OCR Sidecar] Temp PDF written to: ${tempFile}`);
            console.log(`[OCR Sidecar] Executing CLI: ${CLI_SCRIPT_PATH} page=${pageIndex}`);

            // 2. Ejecutar Comando
            // 'node' debe estar en el PATH del sistema
            const command = Command.create('node', [
                CLI_SCRIPT_PATH,
                tempFile,
                pageIndex.toString()
            ]);

            const output = await command.execute();

            if (output.code !== 0) {
                console.error('[OCR Sidecar] Error Stderr:', output.stderr);
                throw new Error(`CLI exited with code ${output.code}: ${output.stderr}`);
            }

            console.log('[OCR Sidecar] Success. Output length:', output.stdout.length);

            // 3. Parsear Resultado
            const result = JSON.parse(output.stdout);

            if (result.error) {
                throw new Error(`CLI Error: ${result.error}`);
            }

            // Adaptar formato si es necesario para coincidir con lo que espera App.tsx
            // El CLI devuelve { totalElements, data: [...], ... } de ocr.js Reference
            // App.tsx espera { results: normalizedResults, stats: ... }

            // Reconstruir stats y structure
            // Reference detect() devuelve:
            // { totalElements, data: [{text, confidence, box...}], paragraphs... }

            // Necesitamos simular la estructura que esperaba App.tsx del Worker
            return this.adaptOutput(result);

        } catch (error) {
            console.error('[OCR Sidecar] Critical Error:', error);
            throw error;
        }
    }

    private static adaptOutput(cliResult: any): OCRResult {
        const { width, height, dpi } = cliResult.imageStats || { width: 0, height: 0, dpi: 200 };
        const rawData = cliResult.data || [];

        // Normalizar resultados (Pixel -> 0..1 Ratio)
        const normalizedResults = rawData.map((item: any) => {
            // item.box es [[x,y]...] (Quad)
            // Calcular bounding box [x,y,w,h]
            const xs = item.box.map((p: any) => p[0]);
            const ys = item.box.map((p: any) => p[1]);
            const xMin = Math.min(...xs);
            const yMin = Math.min(...ys);
            const xMax = Math.max(...xs);
            const yMax = Math.max(...ys);
            const wBox = xMax - xMin;
            const hBox = yMax - yMin;

            // Evitar división por cero
            const safeW = width || 1;
            const safeH = height || 1;

            return {
                text: item.text,
                confidence: item.confidence,
                // Normalized [x, y, w, h] (0..1)
                box: [
                    xMin / safeW,
                    yMin / safeH,
                    wBox / safeW,
                    hBox / safeH
                ],
                // Raw pixel rect for debugging if needed
                rect: [xMin, yMin, wBox, hBox]
            };
        });

        const stats = {
            detectionTime: 0,
            recognitionTime: 0,
            totalTime: 0,
            wordsFound: rawData.length,
            averageConfidence: rawData.length > 0
                ? rawData.reduce((acc: number, item: any) => acc + item.confidence, 0) / rawData.length
                : 0
        };

        return {
            results: normalizedResults,
            stats,
            scanDimensions: { width, height, dpi }
        };
    }
}
