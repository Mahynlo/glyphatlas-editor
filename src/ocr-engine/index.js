// =============================================================================
// MAIN ENTRY POINT
// =============================================================================
// Punto de entrada principal que exporta todas las funcionalidades del OCR modular

// Importar configuración
export { DEFAULT_CONFIG } from './src/config.js';

// Importar funciones de agrupamiento de texto
export {
    calculateDistance,
    groupTextElements,
    createParagraph
} from './src/text-grouping.js';

// Importar clases utilitarias
export {
    FileUtils,
    ImageRaw,
    ModelBase
} from './src/node/utils.js';

// Importar helpers de OpenCV
export {
    cvImread,
    cvImshow,
    getMiniBoxes,
    boxPoints,
    polygonPolygonArea,
    polygonPolygonLength,
    orderPointsClockwise,
    linalgNorm,
    getRotateCropImage,
    unclip
} from './src/opencv-helpers.js';

// Importar modelos
export { Detection } from './src/web/detection.js';
export { Recognition } from './src/web/recognition.js';

// Importar clase principal OCR
export { Ocr } from './src/web/ocr.js';
export { Ocr as default } from './src/web/ocr.js';

// Re-exportar tipos de ONNX para conveniencia
export { InferenceSession, Tensor } from 'onnxruntime-web';

// Exportar PdfConverter
export { PdfConverter } from './src/web/pdf-converter.js';