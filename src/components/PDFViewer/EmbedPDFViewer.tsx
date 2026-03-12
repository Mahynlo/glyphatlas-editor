import { useEffect, useRef, useState, forwardRef, useImperativeHandle, useCallback } from 'react';
import PdfViewer from '@embedpdf/react-pdf-viewer';
import {
    mapOcrToAnnotations,
    mapOcrToGeometryAndChars,
    getRectsForCharRange,
    type OcrPageData
} from '../../utils/pspdfkit-utils';
import { ViewerOCRPanel } from './ViewerOCRPanel';
import { useOcrWorker } from '../../hooks/useOcrWorker';
// @ts-ignore
import { OCR_ENGINE } from '../../ocr-engine/src/config.js';
// @ts-ignore
import { nativeOcrPage } from '../../ocr-engine/src/web/native-ocr-bridge.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type RedactionMode = 'mask' | 'redact';

interface OcrPageResult {
    pageIndex: number;
    results: any[];
    stats?: any;
}

interface OcrProgress {
    current: number;
    total: number;
    status: string;
}

/** Per-document OCR state */
interface DocOcrState {
    status: 'idle' | 'processing' | 'done' | 'error';
    results: OcrPageResult[];
    progress: OcrProgress;
    filePath: string | null;
    activeRedactions: { term: string; count: number; mode: RedactionMode }[];
    syncedPages: Set<number>;
    ocrData: Map<number, OcrPageData>;
    /** True if the PDF already has a native text layer (detected via Rust pdfium on open). */
    hasNativeText: boolean;
}

const makeEmptyDocState = (filePath: string | null = null): DocOcrState => ({
    status: 'idle',
    results: [],
    progress: { current: 0, total: 0, status: '' },
    filePath,
    activeRedactions: [],
    syncedPages: new Set(),
    ocrData: new Map(),
    hasNativeText: false,
});

interface EmbedPDFViewerProps {
    showOverlay?: boolean;
    isHighAccuracy?: boolean;
    initialFilePath?: string | null;
}

export interface EmbedPDFViewerHandle {
    // kept for compatibility — not used internally now
    redact: (term: string) => number;
    clearRedactions: (term?: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export const EmbedPDFViewer = forwardRef<EmbedPDFViewerHandle, EmbedPDFViewerProps>((
    { showOverlay = true, isHighAccuracy = false },
    ref
) => {
    const [registry, setRegistry] = useState<any>(null);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [activeDocId, setActiveDocId] = useState<string | null>(null);
    const [redactionMode, setRedactionMode] = useState<RedactionMode>('mask');

    // Map<docId, DocOcrState> — we keep a ref for the stable reference needed
    // in callbacks, and a counter to force re-renders when the map mutates.
    const docsRef = useRef<Map<string, DocOcrState>>(new Map());
    const [, forceUpdate] = useState(0);
    const bump = useCallback(() => forceUpdate(n => n + 1), []);

    const registryRef = useRef<any>(null);
    const showOverlayRef = useRef(showOverlay);
    const isHighAccuracyRef = useRef(isHighAccuracy);
    useEffect(() => { showOverlayRef.current = showOverlay; }, [showOverlay]);
    useEffect(() => { isHighAccuracyRef.current = isHighAccuracy; }, [isHighAccuracy]);

    // ── Active doc helpers ────────────────────────────────────────────────────
    const getDoc = useCallback((docId: string | null): DocOcrState | null => {
        if (!docId) return null;
        return docsRef.current.get(docId) ?? null;
    }, []);

    const mutateDoc = useCallback((docId: string, updater: (s: DocOcrState) => Partial<DocOcrState>) => {
        const prev = docsRef.current.get(docId);
        if (!prev) return;
        docsRef.current.set(docId, { ...prev, ...updater(prev) });
        bump();
    }, [bump]);

    const activeState = getDoc(activeDocId);

    // ── OCR Worker (Paddle) ───────────────────────────────────────────────────
    // Worker result callback is stable via useCallback; docId is captured at call time.
    // We use a ref to know which docId is currently being processed.
    const processingDocRef = useRef<string | null>(null);

    const handleWorkerPageResult = useCallback((pageIndex: number, result: any) => {
        const docId = processingDocRef.current;
        if (!docId) return;
        docsRef.current.get(docId)?.results.splice(pageIndex, 1, { pageIndex, ...result });
        mutateDoc(docId, s => ({
            results: [...s.results],
            progress: { ...s.progress, current: s.progress.current + 1 },
        }));
    }, [mutateDoc]);

    const handleWorkerError = useCallback((err: any) => {
        const docId = processingDocRef.current;
        if (docId) mutateDoc(docId, () => ({ status: 'error' }));
        console.error('[OCR Worker]', err);
    }, [mutateDoc]);

    const { workerStatus, processPage } = useOcrWorker(handleWorkerPageResult, handleWorkerError);

    // ── OCR progress → done when all pages finish ─────────────────────────────
    useEffect(() => {
        if (!activeDocId) return;
        const s = docsRef.current.get(activeDocId);
        if (!s) return;
        if (s.status === 'processing' && s.progress.total > 0 && s.progress.current >= s.progress.total) {
            mutateDoc(activeDocId, () => ({ status: 'done' }));
            setIsPanelOpen(true);
        }
    }, [activeDocId, activeState?.progress.current, activeState?.progress.total, activeState?.status, mutateDoc]);

    // ── Engine overrides ──────────────────────────────────────────────────────
    const patchEngine = useCallback((engine: any) => {
        if (!engine) return;

        const makeResolvedTask = (value: any): any => ({
            wait(onSuccess: any) { onSuccess(value); return this; },
            abort() { },
            toPromise() { return Promise.resolve(value); },
            onProgress(_cb: any) { return this; }
        });
        const makeWrappedTask = (original: any, transform: (v: any) => any): any => ({
            wait(onSuccess: any, onError?: any) { original.wait((v: any) => onSuccess(transform(v)), onError); return this; },
            abort() { original.abort?.(); },
            toPromise() { return original.toPromise().then(transform); },
            onProgress(cb: any) { original.onProgress?.(cb); return this; }
        });

        if (!(engine as any).__origGetTextSlices && engine.getTextSlices) {
            const orig = engine.getTextSlices.bind(engine);
            (engine as any).__origGetTextSlices = orig;
            engine.getTextSlices = (doc: any, slices: any[]) => {
                // Find which docId owns this PdfDocumentObject
                const docId = doc?.id ?? null;
                const store = docId ? docsRef.current.get(docId)?.ocrData : null;
                if (store && slices.length > 0 && slices.every((s: any) => store.has(s.pageIndex))) {
                    const texts = slices.map((s: any) => {
                        const data = store.get(s.pageIndex);
                        if (!data) return '';
                        return data.chars.slice(s.charIndex, s.charIndex + s.charCount).join('').trimEnd();
                    });
                    return makeResolvedTask(texts);
                }
                return orig(doc, slices);
            };
        }

        if (!(engine as any).__origSearchAllPages && engine.searchAllPages) {
            const orig = engine.searchAllPages.bind(engine);
            (engine as any).__origSearchAllPages = orig;
            engine.searchAllPages = (doc: any, keyword: string, options?: any) => {
                const nativeTask = orig(doc, keyword, options);
                const docId = doc?.id ?? null;
                const store = docId ? docsRef.current.get(docId)?.ocrData : null;
                if (!store || store.size === 0) return nativeTask;

                const lo = keyword.toLowerCase();
                const hits: any[] = [];
                store.forEach((data, pageIndex) => {
                    const text = data.chars.join('');
                    let pos = text.toLowerCase().indexOf(lo);
                    while (pos !== -1) {
                        const rects = getRectsForCharRange(data.geo, pos, keyword.length);
                        if (rects.length > 0) {
                            hits.push({
                                pageIndex, charIndex: pos, charCount: keyword.length, rects,
                                context: {
                                    before: text.slice(Math.max(0, pos - 20), pos),
                                    match: text.slice(pos, pos + keyword.length),
                                    after: text.slice(pos + keyword.length, Math.min(text.length, pos + keyword.length + 20)),
                                    truncatedLeft: pos > 20,
                                    truncatedRight: (pos + keyword.length + 20) < text.length
                                }
                            });
                        }
                        pos = text.toLowerCase().indexOf(lo, pos + 1);
                    }
                });

                if (hits.length === 0) return nativeTask;
                return makeWrappedTask(nativeTask, (native: any) => {
                    const combined = [...(native?.results ?? []), ...hits].sort((a, b) =>
                        a.pageIndex !== b.pageIndex ? a.pageIndex - b.pageIndex : a.charIndex - b.charIndex
                    );
                    return { results: combined, total: combined.length };
                });
            };
        }

        // ── Override getPageGeometry ─────────────────────────────────────────────
        // EmbedPDF's SelectionPlugin calls engine.getPageGeometry(doc, pageIndex)
        // to get the glyph run layout for pointer hit-testing + text selection.
        // We return our OCR geometry here when available so the user can select
        // OCR-detected text just like native PDF text.
        if (!(engine as any).__origGetPageGeometry && engine.getPageGeometry) {
            const orig = engine.getPageGeometry.bind(engine);
            (engine as any).__origGetPageGeometry = orig;
            engine.getPageGeometry = (doc: any, pageIndex: number) => {
                const docId = doc?.id ?? null;
                const store = docId ? docsRef.current.get(docId)?.ocrData : null;
                const ocrPage = store?.get(pageIndex);
                if (ocrPage) {
                    return makeResolvedTask(ocrPage.geo);
                }
                return orig(doc, pageIndex);
            };
        }
    }, []);


    // ── handleReady ───────────────────────────────────────────────────────────
    const handleReady = useCallback((r: any) => {
        setRegistry(r);
        registryRef.current = r;

        patchEngine(r.getEngine());

        const dm = r.getPlugin('document-manager')?.provides();
        if (!dm) return;

        // ── Track documents ─────────────────────────────────────────────────
        dm.onDocumentOpened(async (docState: any) => {
            const docId = docState.documentId ?? docState.id;
            if (!docId) return;
            console.log('[EmbedPDF] Document opened:', docId);
            if (!docsRef.current.has(docId)) {
                docsRef.current.set(docId, makeEmptyDocState(null));
            }
            setActiveDocId(prev => {
                const currentActive = prev ?? dm.getActiveDocumentId();
                return currentActive ?? docId;
            });
            bump();

            // ── Detect native text layer (async, non-blocking) ────────────────
            // Get the file path for this document from the document manager.
            // If the PDF already has a text layer, we can skip auto-OCR.
            try {
                const doc = dm.getDocument(docId);
                const filePath: string | undefined = doc?.filePath ?? doc?.source?.path ?? doc?.name;
                if (filePath && filePath.endsWith('.pdf')) {
                    const { invoke } = await import('@tauri-apps/api/core');
                    const hasText: boolean = await invoke('check_pdf_has_text', { path: filePath });
                    if (hasText) {
                        mutateDoc(docId, () => ({ hasNativeText: true }));
                        console.log('[EmbedPDF] PDF already has native text layer:', filePath);
                    }
                }
            } catch (_e) {
                // Non-critical — silently ignore (Tauri may not be available in dev)
            }
        });

        dm.onDocumentClosed((docId: string) => {
            docsRef.current.delete(docId);
            // If the closed doc was active, pick the next available
            setActiveDocId(prev => {
                if (prev !== docId) return prev;
                return dm.getActiveDocumentId() ?? null;
            });
            bump();
        });

        dm.onActiveDocumentChanged((evt: any) => {
            console.log('[EmbedPDF] Active doc changed:', evt.currentDocumentId);
            setActiveDocId(evt.currentDocumentId);
        });

        // Initial active doc (viewer may already have a doc if config.src was set)
        const initDocId = dm.getActiveDocumentId();
        if (initDocId) {
            console.log('[EmbedPDF] Initial active doc:', initDocId);
            setActiveDocId(initDocId);
            if (!docsRef.current.has(initDocId)) {
                docsRef.current.set(initDocId, makeEmptyDocState(null));
                bump();
            }
        }

        // Copy-to-clipboard
        const selCap = r.getPlugin('selection')?.provides();
        if (selCap) {
            selCap.onCopyToClipboard(({ text }: any) => {
                if (text) navigator.clipboard.writeText(text).catch(console.error);
            });
        }

        // ── Intercept native download button ─────────────────────────────────
        // EmbedPDF's toolbar download button emits a downloadRequest$ event.
        // We intercept here and embed the OCR text layer via Rust (pdfium Tr3)
        // before saving, so the output PDF is selectable in ANY viewer.
        const exportPlugin = r.getPlugin('export') as any;
        if (exportPlugin?.onRequest) {
            exportPlugin.onRequest(async ({ documentId }: { documentId: string }) => {
                const exportCap = r.getPlugin('export')?.provides();
                if (!exportCap) return;
                try {
                    // 1. Get current PDF bytes (includes committed redactions)
                    const buffer: ArrayBuffer = await exportCap.forDocument(documentId).saveAsCopy().toPromise();

                    try {
                        const { save } = await import('@tauri-apps/plugin-dialog');
                        const { invoke } = await import('@tauri-apps/api/core');

                        // 2. Write bytes to a temp file (Rust embed_ocr_and_save reads from path)
                        const tempPath: string = await invoke('write_temp_pdf', {
                            bytes: Array.from(new Uint8Array(buffer)),
                        });

                        // 3. Open native save dialog
                        const savePath = await save({
                            defaultPath: 'documento.pdf',
                            filters: [{ name: 'PDF', extensions: ['pdf'] }],
                        });
                        if (!savePath) return; // user cancelled

                        // 4. Serialize OCR data for this document (page → [{text, rect}])
                        const docState = docsRef.current.get(documentId);
                        const ocrData: Record<number, Array<{ text: string; rect: [number, number, number, number] }>> = {};
                        if (docState?.results) {
                            for (const pageResult of docState.results) {
                                if (pageResult?.results?.length) {
                                    ocrData[pageResult.pageIndex] = pageResult.results.map((item: any) => ({
                                        text: item.text,
                                        rect: item.box as [number, number, number, number],
                                    }));
                                }
                            }
                        }

                        const hasOcrData = Object.keys(ocrData).length > 0;

                        if (hasOcrData) {
                            // 5a. OCR data present → embed invisible text layer via Rust (pdfium Tr3)
                            await invoke('embed_ocr_and_save', {
                                sourcePath: tempPath,
                                outputPath: savePath,
                                ocrData,
                            });
                            console.log('[EmbedPDF] PDF guardado con capa OCR embebida:', savePath);
                        } else {
                            // 5b. No OCR data → just write the bytes directly
                            const { writeFile } = await import('@tauri-apps/plugin-fs');
                            await writeFile(savePath, new Uint8Array(buffer));
                            console.log('[EmbedPDF] PDF guardado (sin OCR):', savePath);
                        }
                    } catch (_tauriErr) {
                        // Fallback: browser blob download (dev/web mode)
                        console.warn('[EmbedPDF] Tauri unavailable, usando descarga browser:', _tauriErr);
                        const blob = new Blob([buffer], { type: 'application/pdf' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'documento.pdf';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    }
                } catch (err) {
                    console.error('[EmbedPDF] Download interception failed:', err);
                }
            });
        }

    }, [patchEngine, bump]);

    // ── Start OCR for active document ──────────────────────────────────────────
    const startOCR = useCallback(async () => {
        const reg = registryRef.current;
        if (!reg) return;

        // Get the current active document directly from the plugin
        // (state may lag a render behind, so we query the plugin directly)
        const dm = reg.getPlugin('document-manager')?.provides();
        const docId = activeDocId ?? dm?.getActiveDocumentId() ?? null;

        console.log('[OCR] startOCR called, docId =', docId, 'activeDocId state =', activeDocId);
        if (!docId || !reg) return;

        const pdfDoc = dm?.getActiveDocument();
        if (!pdfDoc) return;

        const docState = docsRef.current.get(docId);
        if (!docState) return;

        if (OCR_ENGINE === 'paddle' && workerStatus !== 'ready') return;


        mutateDoc(docId, () => ({
            status: 'processing',
            results: [],
            progress: { current: 0, total: 0, status: 'Iniciando…' },
            activeRedactions: [],
            syncedPages: new Set(),
            ocrData: new Map(),
        }));

        processingDocRef.current = docId;

        // ── Get PDF bytes from EmbedPDF's export plugin ───────────────────────
        // Works for ALL docs regardless of how they were opened.
        let arrayBuffer: ArrayBuffer | null = null;
        try {
            const exportCap = reg.getPlugin('export')?.provides();
            if (exportCap) {
                arrayBuffer = await exportCap.forDocument(docId).saveAsCopy().toPromise();
            }
        } catch (_) {/* ignore */ }

        if (!arrayBuffer) {
            console.error('[OCR] Could not obtain PDF bytes');
            mutateDoc(docId, () => ({ status: 'error' }));
            return;
        }

        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
            'pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url
        ).toString();

        const pdfJsDoc = await pdfjsLib.getDocument(arrayBuffer.slice(0)).promise;
        const numPages = Math.min(pdfJsDoc.numPages, 20);

        mutateDoc(docId, () => ({
            progress: { current: 0, total: numPages, status: 'Iniciando…' }
        }));

        const dpi = isHighAccuracyRef.current ? 800 : 400;

        // For Rust-based PaddleOCR engine: write bytes to a temp file that the Rust side can read
        let tempFilePath: string | null = null;
        if (OCR_ENGINE === 'paddle') {
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                const bytes = Array.from(new Uint8Array(arrayBuffer));
                tempFilePath = await invoke<string>('write_temp_pdf', { bytes });
            } catch (err) {
                console.error('[OCR] Could not write temp PDF:', err);
                mutateDoc(docId, () => ({ status: 'error' }));
                return;
            }
        }

        for (let i = 0; i < numPages; i++) {
            mutateDoc(docId, s => ({
                progress: { ...s.progress, status: `Página ${i + 1}/${numPages}` }
            }));

            if (OCR_ENGINE === 'paddle' && tempFilePath) {
                try {
                    const result = await nativeOcrPage(tempFilePath, i, dpi);
                    const s = docsRef.current.get(docId)!;
                    const newResults = [...s.results];
                    newResults[i] = { pageIndex: i, ...result };
                    docsRef.current.set(docId, {
                        ...s,
                        results: newResults,
                        progress: { ...s.progress, current: s.progress.current + 1 },
                    });
                    bump();
                } catch (err) {
                    console.error(`[OCR Native] Page ${i} failed:`, err);
                    mutateDoc(docId, () => ({ status: 'error' }));
                }
            } else {
                processPage({ arrayBuffer, pageIndex: i, isHighAccuracy: isHighAccuracyRef.current });
            }
        }

        if (OCR_ENGINE === 'paddle') {
            mutateDoc(docId, () => ({ status: 'done' }));
            setIsPanelOpen(true);
        }
    }, [activeDocId, workerStatus, mutateDoc, processPage, bump]);

    // ── Sync OCR results → annotations + geometry (when results change) ───────
    useEffect(() => {
        if (!registry || !activeDocId) return;
        const state = docsRef.current.get(activeDocId);
        if (!state || state.results.length === 0) return;

        const annotationCap = registry.getPlugin('annotation')?.provides();
        const dm = registry.getPlugin('document-manager')?.provides();
        if (!annotationCap || !dm) return;
        const doc = dm.getDocument(activeDocId);
        if (!doc) return;

        // Use per-document annotation scope
        const annScope = annotationCap.forDocument
            ? annotationCap.forDocument(activeDocId)
            : annotationCap;

        state.results.forEach((pageResult) => {
            if (!pageResult?.results || state.syncedPages.has(pageResult.pageIndex)) return;
            const page = doc.pages[pageResult.pageIndex];
            if (!page) return;

            try {
                // ── Build geometry & chars (feeds engine override AND selection plugin store) ──
                const { geo, chars } = mapOcrToGeometryAndChars(pageResult.results, {
                    width: page.size.width, height: page.size.height
                });
                state.ocrData.set(pageResult.pageIndex, { geo, chars });

                // Proactively push geometry into the SelectionPlugin's Redux store.
                // The action CACHE_PAGE_GEOMETRY is defined in the plugin's reducer.
                // BasePlugin exposes a public dispatch() method that we use here.
                // This is needed because EmbedPDF only lazy-loads geometry when a page
                // is first interacted with, and may have cached empty geometry already.
                const selPlugin = registry.getPlugin('selection') as any;
                if (selPlugin?.dispatch) {
                    selPlugin.dispatch({
                        type: 'SELECTION/CACHE_PAGE_GEOMETRY',
                        payload: { documentId: activeDocId, page: pageResult.pageIndex, geo }
                    });
                }

                // ── Import visual OCR annotation boxes ──
                const annotations = mapOcrToAnnotations(pageResult.results, pageResult.pageIndex, {
                    width: page.size.width, height: page.size.height
                });
                if (annotations.length > 0) {
                    const items = annotations.map(ann => ({
                        annotation: {
                            ...ann,
                            flags: showOverlayRef.current
                                ? [...(ann.flags || [])]
                                : [...(ann.flags || []), 'hidden']
                        }
                    }));
                    try {
                        annScope.importAnnotations(items);
                    } catch (e) {
                        console.warn('[EmbedPDF] importAnnotations failed:', e);
                    }
                }

                state.syncedPages.add(pageResult.pageIndex);
                console.log(`[OCR] Synced page ${pageResult.pageIndex}: ${annotations.length} boxes, ${geo.runs.length} text runs`);
            } catch (err) {
                console.error(`[EmbedPDF] Sync page ${pageResult.pageIndex} failed:`, err);
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [registry, activeDocId, activeState?.results.length]);



    // ── Overlay toggle ─────────────────────────────────────────────────────────
    useEffect(() => {
        if (!registry || !activeDocId) return;
        const annotationCap = registry.getPlugin('annotation')?.provides();
        if (!annotationCap) return;
        const docState = annotationCap.getState();
        if (!docState?.byUid) return;

        const patches: any[] = [];
        Object.values(docState.byUid).forEach((ta: any) => {
            const ann = ta.object;
            if (ann.custom?.type === 'ocr-detection') {
                const isHidden = (ann.flags || []).includes('hidden');
                const shouldHide = !showOverlay;
                if (isHidden !== shouldHide) {
                    const base = (ann.flags || []).filter((f: string) => f !== 'hidden');
                    patches.push({ pageIndex: ann.pageIndex, id: ann.id, patch: { flags: shouldHide ? [...base, 'hidden'] : base } });
                }
            }
        });
        if (patches.length > 0) annotationCap.updateAnnotations(patches);
    }, [registry, activeDocId, showOverlay]);

    // ── Redact helpers ─────────────────────────────────────────────────────────
    const handleRedact = useCallback((term: string, mode: RedactionMode) => {
        const docId = activeDocId;
        const reg = registryRef.current;
        if (!docId || !reg || !term.trim()) return;

        const dm = reg.getPlugin('document-manager')?.provides();
        const doc = dm?.getDocument(docId);
        if (!doc) return;

        const state = docsRef.current.get(docId);
        if (!state) return;

        const lo = term.trim().toLowerCase();
        const ts = Date.now();
        let count = 0;

        if (mode === 'mask') {
            // ── Mode A: visual black square annotation ──────────────────────
            const annotationCap = reg.getPlugin('annotation')?.provides();
            if (!annotationCap) return;
            const items: any[] = [];

            state.results.forEach((pageRes) => {
                const words: any[] = pageRes?.results ?? [];
                const page = doc.pages[pageRes.pageIndex];
                if (!words.length || !page) return;
                const { width, height } = page.size;

                const wordRanges: { start: number; end: number; idx: number }[] = [];
                let charPos = 0;
                const parts: string[] = [];
                words.forEach((w: any, i: number) => {
                    const t = (w.text ?? '').toLowerCase();
                    wordRanges.push({ start: charPos, end: charPos + t.length, idx: i });
                    parts.push(t);
                    charPos += t.length + 1;
                });
                const fullText = parts.join(' ');

                let pos = fullText.indexOf(lo);
                while (pos !== -1) {
                    const matchEnd = pos + lo.length;
                    wordRanges.filter(wr => wr.start < matchEnd && wr.end > pos).forEach(wr => {
                        const item = words[wr.idx];
                        if (!item?.box) return;
                        const [bx, by, bw, bh] = item.box;
                        items.push({
                            annotation: {
                                id: `redact-mask-${pageRes.pageIndex}-${wr.idx}-${ts}-${count}`,
                                type: 5,
                                pageIndex: pageRes.pageIndex,
                                rect: { origin: { x: bx * width, y: by * height }, size: { width: bw * width, height: bh * height } },
                                color: '#000000',
                                strokeColor: 'transparent',
                                strokeWidth: 0,
                                opacity: 1,
                                flags: ['readOnly', 'locked', 'lockedContents'],
                                custom: { type: 'user-redaction', term, mode: 'mask' }
                            }
                        });
                        count++;
                    });
                    pos = fullText.indexOf(lo, pos + 1);
                }
            });

            if (items.length > 0) annotationCap.importAnnotations(items);
        } else {
            // ── Mode B: native EmbedPDF redaction (pending, then commitAllPending) ──
            const redactionCap = reg.getPlugin('redaction')?.provides();
            if (!redactionCap) {
                console.warn('[EmbedPDF] Redaction plugin not available — falling back to mask');
                handleRedact(term, 'mask');
                return;
            }

            const pendingItems: any[] = [];
            state.results.forEach((pageRes) => {
                const words: any[] = pageRes?.results ?? [];
                const page = doc.pages[pageRes.pageIndex];
                if (!words.length || !page) return;
                const { width, height } = page.size;

                const wordRanges: { start: number; end: number; idx: number }[] = [];
                let charPos = 0;
                const parts: string[] = [];
                words.forEach((w: any, i: number) => {
                    const t = (w.text ?? '').toLowerCase();
                    wordRanges.push({ start: charPos, end: charPos + t.length, idx: i });
                    parts.push(t);
                    charPos += t.length + 1;
                });
                const fullText = parts.join(' ');

                let pos = fullText.indexOf(lo);
                while (pos !== -1) {
                    const matchEnd = pos + lo.length;
                    wordRanges.filter(wr => wr.start < matchEnd && wr.end > pos).forEach(wr => {
                        const item = words[wr.idx];
                        if (!item?.box) return;
                        const [bx, by, bw, bh] = item.box;
                        pendingItems.push({
                            id: `redact-burn-${pageRes.pageIndex}-${wr.idx}-${ts}-${count}`,
                            page: pageRes.pageIndex,
                            kind: 'area',
                            rect: { origin: { x: bx * width, y: by * height }, size: { width: bw * width, height: bh * height } },
                            markColor: '#ff0000',
                            redactionColor: '#000000',
                            source: 'legacy',
                        });
                        count++;
                    });
                    pos = fullText.indexOf(lo, pos + 1);
                }
            });

            if (pendingItems.length > 0) redactionCap.forDocument(docId).addPending(pendingItems);
        }

        if (count > 0) {
            mutateDoc(docId, s => {
                const exists = s.activeRedactions.find(r => r.term === term && r.mode === mode);
                return {
                    activeRedactions: exists
                        ? s.activeRedactions.map(r => r.term === term ? { ...r, count: r.count + count } : r)
                        : [...s.activeRedactions, { term, count, mode }]
                };
            });
        }
    }, [activeDocId, mutateDoc]);

    const handleClearRedaction = useCallback((term: string, mode: RedactionMode) => {
        const docId = activeDocId;
        const reg = registryRef.current;
        if (!docId || !reg) return;

        if (mode === 'mask') {
            const annotationCap = reg.getPlugin('annotation')?.provides();
            if (!annotationCap) return;
            const docState = annotationCap.getState();
            if (!docState?.byUid) return;
            const toDelete: Array<{ pageIndex: number; id: string }> = [];
            Object.values(docState.byUid).forEach((ta: any) => {
                const ann = ta.object;
                if (ann.custom?.type === 'user-redaction' && ann.custom.term === term) {
                    toDelete.push({ pageIndex: ann.pageIndex, id: ann.id });
                }
            });
            if (toDelete.length > 0) annotationCap.deleteAnnotations(toDelete);
        } else {
            // For redact mode, clear all pending — EmbedPDF doesn't support filtering by term
            // (we clear all pending for the doc; user can re-apply others)
            const redactionCap = reg.getPlugin('redaction')?.provides();
            redactionCap?.forDocument(docId).clearPending();
        }

        mutateDoc(docId, s => ({
            activeRedactions: s.activeRedactions.filter(r => !(r.term === term && (r as any).mode === mode))
        }));
    }, [activeDocId, mutateDoc]);

    const handleConfirmRedactions = useCallback(async () => {
        const docId = activeDocId;
        const reg = registryRef.current;
        if (!docId || !reg) return;
        const redactionCap = reg.getPlugin('redaction')?.provides();
        const exportCap = reg.getPlugin('export')?.provides();
        if (!redactionCap || !exportCap) {
            console.warn('[EmbedPDF] redaction or export plugin not available');
            return;
        }

        try {
            // 1. Commit all pending redactions (permanently removes content from the PDF)
            await redactionCap.forDocument(docId).commitAllPending().toPromise();

            // 2. Get the updated PDF bytes from the export plugin
            const buffer: ArrayBuffer = await exportCap.forDocument(docId).saveAsCopy().toPromise();

            // 3. In Tauri, use the native save dialog to write the file to disk
            try {
                const { save } = await import('@tauri-apps/plugin-dialog');

                const savePath = await save({
                    defaultPath: 'documento_redactado.pdf',
                    filters: [{ name: 'PDF', extensions: ['pdf'] }],
                });

                if (savePath) {
                    // Write bytes via Tauri fs plugin
                    const { writeFile } = await import('@tauri-apps/plugin-fs');
                    await writeFile(savePath, new Uint8Array(buffer));
                    console.log('[EmbedPDF] PDF redactado guardado en:', savePath);
                }
            } catch (_tauriErr) {
                // Fallback: browser-style download (works in dev/web mode)
                console.warn('[EmbedPDF] Tauri save failed, falling back to browser download:', _tauriErr);
                const blob = new Blob([buffer], { type: 'application/pdf' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'documento_redactado.pdf';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }

            // 4. Remove 'redact' chips from the panel
            mutateDoc(docId, s => ({
                activeRedactions: s.activeRedactions.filter(r => r.mode !== 'redact')
            }));
        } catch (err) {
            console.error('[EmbedPDF] commitAllPending failed:', err);
            alert('Error al confirmar las redacciones: ' + String(err));
        }
    }, [activeDocId, mutateDoc]);


    // ── Scroll navigation ──────────────────────────────────────────────────────
    useEffect(() => {
        const handleScrollRequest = (e: CustomEvent) => {
            if (!registry) return;
            const scrollCapability = registry.getPlugin('scroll')?.provides();
            if (scrollCapability) scrollCapability.scrollToPage({ pageNumber: e.detail.pageIndex + 1 });
        };
        window.addEventListener('scroll-to-page' as any, handleScrollRequest as any);
        return () => window.removeEventListener('scroll-to-page' as any, handleScrollRequest as any);
    }, [registry]);

    // ── Imperative handle (kept for external compat) ───────────────────────────
    useImperativeHandle(ref, () => ({
        redact: (term: string) => { handleRedact(term, 'mask'); return 0; },
        clearRedactions: (term?: string) => {
            if (term) handleClearRedaction(term, 'mask');
        },
    }), [handleRedact, handleClearRedaction]);

    // ── Render ─────────────────────────────────────────────────────────────────
    const isProcessing = activeState?.status === 'processing';
    const ocrStatus = activeState?.status ?? 'idle';
    const ocrProgress = activeState?.progress ?? { current: 0, total: 0, status: '' };
    const ocrResults = activeState?.results ?? [];
    const activeRedactions = activeState?.activeRedactions ?? [];
    const hasNativeText = activeState?.hasNativeText ?? false;
    const progressPct = ocrProgress.total > 0 ? Math.round((ocrProgress.current / ocrProgress.total) * 100) : 0;

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
            {/* EmbedPDF viewer — no initial src — documents opened via its own UI */}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                <PdfViewer
                    config={{ theme: { preference: 'dark' } }}
                    onReady={handleReady}
                    style={{ width: '100%', height: '100%' }}
                />

                {/* ── OCR floating buttons over EmbedPDF toolbar ── */}
                <div style={{
                    position: 'absolute',
                    top: '7px',
                    right: '210px',
                    zIndex: 100,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    pointerEvents: 'all',
                }}>
                    {/* Progress bar (while processing) */}
                    {isProcessing && ocrProgress.total > 0 && (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            background: 'rgba(15,23,42,0.85)', backdropFilter: 'blur(6px)',
                            borderRadius: '6px', padding: '4px 10px',
                            border: '1px solid rgba(99,102,241,0.3)',
                        }}>
                            <div style={{ width: '70px', height: '3px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${progressPct}%`, background: 'linear-gradient(90deg,#818cf8,#6366f1)', borderRadius: '2px', transition: 'width 0.3s ease' }} />
                            </div>
                            <span style={{ fontSize: '11px', color: '#a5b4fc', whiteSpace: 'nowrap' }}>{ocrProgress.current}/{ocrProgress.total}</span>
                        </div>
                    )}

                    {/* Native text badge — shown when PDF already has extractable text */}
                    {hasNativeText && ocrStatus === 'idle' && (
                        <div
                            title="Este PDF ya tiene una capa de texto. El OCR puede no ser necesario."
                            style={{
                                display: 'flex', alignItems: 'center', gap: '4px',
                                padding: '4px 9px', borderRadius: '6px',
                                background: 'rgba(34,197,94,0.15)',
                                border: '1px solid rgba(34,197,94,0.35)',
                                color: '#86efac', fontSize: '11px', fontWeight: 600,
                                backdropFilter: 'blur(6px)', whiteSpace: 'nowrap',
                            }}
                        >
                            <span style={{ fontSize: '12px' }}>📄</span>
                            Con texto
                        </div>
                    )}

                    {/* OCR button */}
                    <button
                        onClick={startOCR}
                        disabled={isProcessing || (!activeDocId) || (OCR_ENGINE === 'paddle' && workerStatus !== 'ready')}
                        title={isProcessing ? ocrProgress.status : 'Ejecutar OCR en el documento activo'}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '5px',
                            padding: '5px 11px', borderRadius: '6px', border: 'none',
                            cursor: isProcessing || !activeDocId ? 'not-allowed' : 'pointer',
                            fontSize: '12px', fontWeight: 600, letterSpacing: '0.02em',
                            opacity: (isProcessing || !activeDocId || (OCR_ENGINE === 'paddle' && workerStatus !== 'ready')) ? 0.55 : 1,
                            background: isProcessing ? 'rgba(234,179,8,0.2)' : ocrStatus === 'done' ? 'rgba(34,197,94,0.25)' : 'rgba(99,102,241,0.9)',
                            color: isProcessing ? '#fde047' : ocrStatus === 'done' ? '#86efac' : '#fff',
                            boxShadow: ocrStatus === 'idle' ? '0 1px 8px rgba(99,102,241,0.45)' : 'none',
                            backdropFilter: 'blur(6px)', transition: 'background 0.15s, opacity 0.15s',
                        }}
                    >
                        <span style={{ fontSize: '13px' }}>{isProcessing ? '⏳' : ocrStatus === 'done' ? '✓' : '🔍'}</span>
                        {isProcessing ? `OCR… ${progressPct}%` : ocrStatus === 'done' ? 'Re-OCR' : 'OCR'}
                    </button>

                    {/* Panel toggle button */}
                    {ocrResults.length > 0 && (
                        <button
                            onClick={() => setIsPanelOpen(p => !p)}
                            title="Texto extraído (OCR)"
                            style={{
                                display: 'flex', alignItems: 'center', gap: '5px',
                                padding: '5px 10px', borderRadius: '6px',
                                border: isPanelOpen ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.1)',
                                cursor: 'pointer', fontSize: '12px', fontWeight: 500,
                                background: isPanelOpen ? 'rgba(99,102,241,0.3)' : 'rgba(15,23,42,0.75)',
                                color: isPanelOpen ? '#a5b4fc' : 'rgba(255,255,255,0.7)',
                                backdropFilter: 'blur(6px)', transition: 'background 0.15s, border 0.15s',
                            }}
                        >
                            <span style={{ fontSize: '13px' }}>📝</span>
                            Texto OCR
                        </button>
                    )}

                </div>
            </div>


            {/* OCR Results panel */}
            <ViewerOCRPanel
                results={ocrResults}
                isOpen={isPanelOpen}
                onClose={() => setIsPanelOpen(false)}
                onRedact={(term, mode) => handleRedact(term, mode)}
                activeRedactions={activeRedactions}
                onClearRedaction={(term, mode) => handleClearRedaction(term, mode)}
                onConfirmRedactions={handleConfirmRedactions}
                redactionMode={redactionMode}
                onRedactionModeChange={setRedactionMode}
            />
        </div>
    );
});

EmbedPDFViewer.displayName = 'EmbedPDFViewer';
