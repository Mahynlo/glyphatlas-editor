import { useEffect, useRef, useState, useCallback } from 'react';
// @ts-ignore
import { OCR_ENGINE } from '../ocr-engine/src/config.js';
import OCRWorker from '../workers/ocr.worker.js?worker';

export type WorkerStatus = 'initializing' | 'ready' | 'error';

interface UseOcrWorkerResult {
    workerStatus: WorkerStatus;
    processPage: (args: {
        arrayBuffer: ArrayBuffer;
        pageIndex: number;
        isHighAccuracy: boolean;
    }) => void;
}

/**
 * Manages the PaddleOCR Web Worker lifecycle.
 * When engineIsNative === true the worker is never started and status stays 'ready'.
 */
export function useOcrWorker(
    onPageResult: (pageIndex: number, result: any) => void,
    onError: (err: any) => void,
): UseOcrWorkerResult {
    const engineIsNative = OCR_ENGINE === 'native';
    const [workerStatus, setWorkerStatus] = useState<WorkerStatus>(
        engineIsNative ? 'ready' : 'initializing'
    );
    const workerRef = useRef<Worker | null>(null);

    useEffect(() => {
        if (engineIsNative) return; // Native engine — no worker needed

        const worker = new OCRWorker();
        workerRef.current = worker;

        worker.onmessage = (e: MessageEvent) => {
            const { type, payload } = e.data;
            switch (type) {
                case 'READY':
                    setWorkerStatus('ready');
                    break;
                case 'RESULT':
                    onPageResult(payload.pageIndex, payload);
                    break;
                case 'ERROR':
                    console.error('[OCR Worker]', payload);
                    onError(payload);
                    setWorkerStatus('error');
                    break;
                default:
                    break;
            }
        };

        setWorkerStatus('initializing');
        worker.postMessage({ type: 'INIT', payload: {} });
        return () => { worker.terminate(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const processPage = useCallback((args: {
        arrayBuffer: ArrayBuffer;
        pageIndex: number;
        isHighAccuracy: boolean;
    }) => {
        if (!workerRef.current) return;
        const bufferCopy = args.arrayBuffer.slice(0);
        workerRef.current.postMessage({
            type: 'PROCESS_PAGE',
            payload: {
                pdfData: bufferCopy,
                pageIndex: args.pageIndex,
                mode: args.isHighAccuracy ? 'HIGH_ACCURACY' : 'PERFORMANCE',
            }
        }, [bufferCopy]);
    }, []);

    return { workerStatus, processPage };
}
