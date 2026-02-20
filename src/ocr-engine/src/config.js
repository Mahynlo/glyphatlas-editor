// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================
// Configuración por defecto para el motor OCR multilingüe

export const DEFAULT_CONFIG = {
    DETECTION: {
        MODEL_PATH: '/models/det/PP-OCRv5_mobile_det.onnx',

        // TUNED PARAMETERS (Node.js Benchmark Parity)
        THRESHOLD: 0.3,       // Sensitivity (Binarization)
        BOX_THRESHOLD: 0.6,   // Node.js Benchmark Parity (Was 0.3)
        MIN_BOX_SIZE: 3,
        MAX_BOX_SIZE: 2000,
        UNCLIP_RATIO: 2.0,    // Node.js Benchmark Parity (Was 2.0)

        BASE_SIZE: 32,

        // Default safe limit (Performance Mode)
        MAX_IMAGE_SIZE: 1536,

        // Mode Constants (consumed by Worker/App)
        MODES: {
            PERFORMANCE: {
                MAX_IMAGE_SIZE: 1536,
                RENDER_DPI: 200
            },
            HIGH_ACCURACY: {
                MAX_IMAGE_SIZE: 2176, // Optimized: 2560 -> 2176 (~30% faster, still > 2K)
                RENDER_DPI: 300,
                // New Optimizations - DISABLED BY DEFAULT due to regression (84% vs 97%)
                PREPROCESS: {
                    SHARPEN: true,
                    ADAPTIVE_THRESH: true
                },
                THRESHOLD: 0.3,       // Reverted to standard (0.3)
                BOX_THRESHOLD: 0.6    // Reverted to standard (0.6)
            }
        },

        ONNX_OPTIONS: {
            executionProviders: ['webgpu', 'wasm'],
            graphOptimizationLevel: /** @type {'all'} */ ('all'),
            enableCpuMemArena: true,
            enableMemPattern: true,
            executionMode: /** @type {'sequential'} */ ('sequential'), // Revert to sequential
            logSeverityLevel: /** @type {3} */ (3),
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
            executionProviders: ['webgpu', 'wasm'],
            graphOptimizationLevel: /** @type {'all'} */ ('all'),
            enableCpuMemArena: true,
            enableMemPattern: true,
            executionMode: /** @type {'sequential'} */ ('sequential'), // Revert to sequential
            logSeverityLevel: /** @type {3} */ (3),
            intraOpNumThreads: 0,
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