// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================
// Configuración por defecto para el motor OCR multilingüe

export const DEFAULT_CONFIG = {
    DETECTION: {
        MODEL_PATH: '/models/det/PP-OCRv5_mobile_det.onnx',
        THRESHOLD: 0.3,
        THRESHOLD: 0.3,
        BOX_THRESHOLD: 0.4, // Lowered to 0.4 to detect more regions (parity tuning)
        MIN_BOX_SIZE: 3,
        MAX_BOX_SIZE: 2000,
        UNCLIP_RATIO: 1.85, // Slightly tighter to avoid noise merging
        BASE_SIZE: 32,
        MAX_IMAGE_SIZE: 1536,   // High Def (Multiple of 32). Compromise 1440 vs 1600.
        ONNX_OPTIONS: {
            executionProviders: ['webgpu', 'wasm'], // Prioritize WebGPU
            graphOptimizationLevel: /** @type {'all'} */ ('all'),
            enableCpuMemArena: true,
            enableMemPattern: true,
            executionMode: /** @type {'parallel'} */ ('parallel'),
            logSeverityLevel: /** @type {1} */ (1), // Verbose logging to verify Backend
        }
    },
    RECOGNITION: {
        LANGUAGES: {
            latin: {
                MODEL: '/models/rec/latin_PP-OCRv5_mobile_rec.onnx',
                DICT: '/models/rec/config.json',  // Contiene character_dict
                NAME: 'Latin (PP-OCRv5)'
            },
            latinv3: {
                MODEL: '/models/latin_PP-OCRv3_rec_infer.onnx',
                DICT: '/models/latin_dict.txt',
                NAME: 'Latin (PP-OCRv3)'
            },
            en: {
                MODEL: '/models/en_PP-OCRv4_rec_infer.onnx',
                DICT: '/models/en_dict.txt',
                NAME: 'English'
            },
            ch: {
                MODEL: '/models/ch_PP-OCRv4_rec_infer.onnx',
                DICT: '/models/ch_dict.txt',
                NAME: 'Chinese'
            },
            ja: {
                MODEL: '/models/japan_PP-OCRv3_rec_infer.onnx',
                DICT: '/models/japan_dict.txt',
                NAME: 'Japanese'
            },
            ko: {
                MODEL: '/models/ch_PP-OCRv4_rec_infer.onnx',
                DICT: '/models/korean_dict.txt',
                NAME: 'Korean'
            }
        },
        DEFAULT_LANGUAGE: 'latin',  // Usar PP-OCRv5 por defecto
        IMAGE_HEIGHT: 48,  // PP-OCRv5: altura 48
        IMAGE_WIDTH: 320,  // PP-OCRv5: ancho 320
        CONFIDENCE_THRESHOLD: 0.5,
        REMOVE_DUPLICATE_CHARS: true,
        IGNORED_TOKENS: [0],
        ONNX_OPTIONS: {
            executionProviders: ['wasm'], // Reference: WASM preferred
            graphOptimizationLevel: /** @type {'all'} */ ('all'),
            enableCpuMemArena: true,  // Optimización para CPU
            enableMemPattern: true,   // Optimización para CPU
            executionMode: /** @type {'parallel'} */ ('parallel'),
            logSeverityLevel: /** @type {1} */ (1), // Verbose logging to verify Backend
            intraOpNumThreads: 0,  // Usar todos los cores disponibles
            interOpNumThreads: 0,
        }
    },
    GROUPING: {
        VERTICAL_THRESHOLD_RATIO: 1.2,
        HORIZONTAL_THRESHOLD_RATIO: 2.5,
        MIN_OVERLAP_RATIO: 0.3,
        MAX_VERTICAL_OFFSET_RATIO: 0.5,
    }
};