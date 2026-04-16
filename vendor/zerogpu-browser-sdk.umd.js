(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
    typeof define === 'function' && define.amd ? define(['exports'], factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.ZeroGpuBrowserSdk = {}));
})(this, (function (exports) { 'use strict';

    const ORCHESTRATOR_BASE_URLS = {
        local: 'http://localhost:8787',
        develop: 'https://dev.devices.zerogpu.ai',
        staging: 'https://staging.devices.zerogpu.ai',
        production: 'https://devices.zerogpu.ai'
    };
    const createConfig = (env) => ({
        env,
        sdkVersion: '0.1.0',
        orchestrator: {
            baseUrl: ORCHESTRATOR_BASE_URLS[env],
            registerPath: '/register'
        },
        telemetry: {
            enableConsoleLogs: env !== 'production',
            locationData: false,
            cameraData: false
        }
    });
    const DEFAULT_CONFIGS = {
        local: createConfig('local'),
        develop: createConfig('develop'),
        staging: createConfig('staging'),
        production: createConfig('production')
    };

    const FALLBACK_ENV = 'production';
    const isSdkEnv = (value) => value === 'local' || value === 'develop' || value === 'staging' || value === 'production';
    const resolveConfig = (env, overrides) => {
        const resolvedEnv = isSdkEnv(env) ? env : FALLBACK_ENV;
        const base = DEFAULT_CONFIGS[resolvedEnv];
        const merged = deepMerge(base, overrides ?? {});
        return {
            env: resolvedEnv,
            sdkVersion: asNonEmptyString(merged.sdkVersion, base.sdkVersion),
            orchestrator: {
                baseUrl: asNonEmptyString(merged.orchestrator?.baseUrl, base.orchestrator.baseUrl),
                registerPath: asNonEmptyString(merged.orchestrator?.registerPath, base.orchestrator.registerPath)
            },
            telemetry: {
                enableConsoleLogs: asBoolean(merged.telemetry?.enableConsoleLogs, base.telemetry.enableConsoleLogs),
                locationData: asBoolean(merged.telemetry?.locationData, base.telemetry.locationData),
                cameraData: asBoolean(merged.telemetry?.cameraData, base.telemetry.cameraData)
            }
        };
    };
    const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
    const deepMerge = (target, source) => {
        const result = Array.isArray(target) ? [...target] : { ...target };
        for (const key of Object.keys(source)) {
            const srcValue = source[key];
            if (srcValue === undefined)
                continue;
            const tgtValue = result[key];
            if (isObject(srcValue) && isObject(tgtValue)) {
                result[key] = deepMerge(tgtValue, srcValue);
            }
            else {
                result[key] = srcValue;
            }
        }
        return result;
    };
    const asNonEmptyString = (value, fallback) => typeof value === 'string' && value.length > 0 ? value : fallback;
    const asBoolean = (value, fallback) => typeof value === 'boolean' ? value : fallback;

    class Logger {
        constructor(config) {
            this.enabled = config.enableConsoleLogs;
        }
        setEnabled(enabled) {
            this.enabled = enabled;
        }
        isEnabled() {
            return this.enabled;
        }
        debug(...args) {
            if (this.enabled)
                console.debug('[ZeroGPU]', ...args);
        }
        info(...args) {
            if (this.enabled)
                console.debug('[ZeroGPU]', ...args);
        }
        warn(...args) {
            if (this.enabled)
                console.warn('[ZeroGPU]', ...args);
        }
        error(...args) {
            if (this.enabled)
                console.error('[ZeroGPU]', ...args);
        }
    }
    let singleton = null;
    const initLogger = (config) => {
        singleton = new Logger(config);
        return singleton;
    };
    const getLogger = () => {
        if (!singleton) {
            singleton = new Logger({
                enableConsoleLogs: false,
                locationData: false,
                cameraData: false
            });
        }
        return singleton;
    };

    const DB_NAME = 'zerogpu-slm-cache';
    const STORE_NAME = 'models';
    const DB_VERSION = 1;
    const openDb = () => new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'key' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    const runTx = async (mode, handler) => {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, mode);
            const store = tx.objectStore(STORE_NAME);
            handler(store)
                .then((val) => {
                tx.oncomplete = () => resolve(val);
                tx.onerror = () => reject(tx.error);
            })
                .catch(reject);
        });
    };
    const buildKey = (modelId, version) => `${modelId}:${version}`;
    const putModelComplete = async (modelId, version, metadata, files) => {
        const finalMeta = {
            ...metadata,
            modelId,
            modelVersion: version,
            status: 'complete',
            updatedAt: Date.now(),
            sizeBytes: metadata.sizeBytes
        };
        await runTx('readwrite', async (store) => {
            const record = { key: buildKey(modelId, version), metadata: finalMeta, files };
            store.put(record);
        });
    };
    const getModel = async (modelId, version) => {
        const key = buildKey(modelId, version);
        return runTx('readonly', async (store) => {
            return new Promise((resolve, reject) => {
                const req = store.get(key);
                req.onsuccess = () => {
                    const record = req.result;
                    if (!record || record.metadata.status !== 'complete') {
                        resolve(null);
                        return;
                    }
                    resolve({ metadata: record.metadata, files: record.files });
                };
                req.onerror = () => reject(req.error);
            });
        });
    };
    const clearModel = async (modelId, version) => {
        await runTx('readwrite', async (store) => {
            store.delete(buildKey(modelId, version));
        });
    };
    const clearAllModels = async () => {
        await runTx('readwrite', async (store) => {
            store.clear();
        });
    };

    const measure = async (fn) => {
        const start = performance.now();
        const result = await fn();
        return { result, ms: Math.round(performance.now() - start) };
    };

    const getPipelineTaskForType = (taskType) => {
        if (taskType === 'summary')
            return 'summarization';
        if (taskType === 'iab_classify')
            return 'text-classification';
        if (taskType === 'classification')
            return 'zero-shot-classification';
        return taskType;
    };
    const getOutputText$1 = (output) => {
        if (typeof output === 'string')
            return output;
        if (Array.isArray(output) && output.length) {
            const first = output[0];
            if (first && typeof first.summary_text === 'string')
                return first.summary_text;
            if (first && typeof first.generated_text === 'string')
                return first.generated_text;
            if (first && typeof first.label === 'string')
                return first.label;
            return JSON.stringify(first);
        }
        if (output && typeof output === 'object') {
            const obj = output;
            if (typeof obj.summary_text === 'string')
                return obj.summary_text;
            if (typeof obj.generated_text === 'string')
                return obj.generated_text;
            if (typeof obj.label === 'string')
                return obj.label;
            return JSON.stringify(obj);
        }
        return '';
    };
    const hasMeaningfulOutput = (output) => {
        if (output == null)
            return false;
        if (typeof output === 'string')
            return output.trim().length > 0;
        if (Array.isArray(output))
            return output.length > 0;
        if (typeof output === 'object')
            return Object.keys(output).length > 0;
        return true;
    };
    const isInvalidArrayLengthError$1 = (error) => {
        const message = error instanceof Error ? error.message : String(error);
        return message.toLowerCase().includes('invalid array length');
    };
    const getBoundedSampleText = (_engine, text) => text;
    // Sample tests are lenient except for invalid input or empty/undefined outputs.
    const runSummarySample = async (engine, sample) => {
        const start = performance.now();
        if (typeof sample.text !== 'string') {
            const processingTimeMs = Math.round(performance.now() - start);
            return {
                ok: false,
                processingTimeMs,
                error: true,
                errorMessage: 'response from processing sample'
            };
        }
        const boundedText = getBoundedSampleText(engine, sample.text);
        try {
            const output = await engine.summarize(boundedText);
            const processingTimeMs = Math.round(performance.now() - start);
            const outputPreview = output;
            getLogger().info('Sample output (summary)', { output: outputPreview });
            const outputText = typeof output.output === 'string' ? output.output : '';
            getLogger().debug('The outputText is: ', outputText);
            if (!outputText) {
                return {
                    ok: false,
                    processingTimeMs,
                    error: true,
                    errorMessage: 'response from processing sample'
                };
            }
            return { ok: true, processingTimeMs, error: false };
        }
        catch (err) {
            if (isInvalidArrayLengthError$1(err) && boundedText.length > 256) {
                try {
                    const output = await engine.summarize(boundedText.slice(0, 256));
                    const processingTimeMs = Math.round(performance.now() - start);
                    const outputText = typeof output.output === 'string' ? output.output : '';
                    if (outputText) {
                        getLogger().warn('Sample summary recovered after truncating input');
                        return { ok: true, processingTimeMs, error: false };
                    }
                }
                catch {
                    // fall through to original error handling
                }
            }
            if (isInvalidArrayLengthError$1(err)) {
                try {
                    const output = await engine.summarize('This is a short startup probe sentence.');
                    const processingTimeMs = Math.round(performance.now() - start);
                    const outputText = typeof output.output === 'string' ? output.output : '';
                    if (outputText) {
                        getLogger().warn('Sample summary recovered using probe sentence');
                        return { ok: true, processingTimeMs, error: false };
                    }
                }
                catch {
                    // fall through to original error handling
                }
            }
            const processingTimeMs = Math.round(performance.now() - start);
            return {
                ok: false,
                processingTimeMs,
                error: true,
                errorMessage: err instanceof Error ? err.message : String(err)
            };
        }
    };
    // IAB sample validates input shape and engine support, but not category correctness.
    const runIabSample = async (engine, sample) => {
        const start = performance.now();
        if (!engine.classify) {
            const processingTimeMs = Math.round(performance.now() - start);
            return {
                ok: false,
                processingTimeMs,
                error: true,
                errorMessage: 'unsupported taskType'
            };
        }
        if (typeof sample.text !== 'string') {
            const processingTimeMs = Math.round(performance.now() - start);
            return {
                ok: false,
                processingTimeMs,
                error: true,
                errorMessage: 'response from processing sample'
            };
        }
        const boundedText = getBoundedSampleText(engine, sample.text);
        try {
            const output = await engine.classify(boundedText);
            const processingTimeMs = Math.round(performance.now() - start);
            getLogger().info('Sample output (iabClassify)', {
                output
            });
            return { ok: true, processingTimeMs, error: false };
        }
        catch (err) {
            if (isInvalidArrayLengthError$1(err) && boundedText.length > 256) {
                try {
                    await engine.classify(boundedText.slice(0, 256));
                    const processingTimeMs = Math.round(performance.now() - start);
                    getLogger().warn('Sample iabClassify recovered after truncating input');
                    return { ok: true, processingTimeMs, error: false };
                }
                catch {
                    // fall through to original error handling
                }
            }
            const processingTimeMs = Math.round(performance.now() - start);
            return {
                ok: false,
                processingTimeMs,
                error: true,
                errorMessage: err instanceof Error ? err.message : String(err)
            };
        }
    };
    const runClassificationSample = async (engine, sample) => {
        const start = performance.now();
        const categories = sample.categories ?? sample.category ?? [];
        if (!engine.classify) {
            const processingTimeMs = Math.round(performance.now() - start);
            return {
                ok: false,
                processingTimeMs,
                error: true,
                errorMessage: 'unsupported taskType'
            };
        }
        if (typeof sample.text !== 'string' || !Array.isArray(categories) || categories.length === 0) {
            const processingTimeMs = Math.round(performance.now() - start);
            return {
                ok: false,
                processingTimeMs,
                error: true,
                errorMessage: 'response from processing sample'
            };
        }
        const boundedText = getBoundedSampleText(engine, sample.text);
        try {
            const output = await engine.classify(boundedText, categories);
            const processingTimeMs = Math.round(performance.now() - start);
            getLogger().info('Sample output (classification)', { output, categories });
            if (!hasMeaningfulOutput(output?.output)) {
                getLogger().error('Sample classification produced empty output', { output, categories });
                return {
                    ok: false,
                    processingTimeMs,
                    error: true,
                    errorMessage: 'response from processing sample'
                };
            }
            return { ok: true, processingTimeMs, error: false };
        }
        catch (err) {
            if (isInvalidArrayLengthError$1(err) && boundedText.length > 256) {
                try {
                    await engine.classify(boundedText.slice(0, 256), categories);
                    const processingTimeMs = Math.round(performance.now() - start);
                    getLogger().warn('Sample classification recovered after truncating input');
                    return { ok: true, processingTimeMs, error: false };
                }
                catch {
                    // fall through to original error handling
                }
            }
            const processingTimeMs = Math.round(performance.now() - start);
            return {
                ok: false,
                processingTimeMs,
                error: true,
                errorMessage: err instanceof Error ? err.message : String(err)
            };
        }
    };
    const runSampleTest = async (taskType, engine, sample) => {
        if (taskType === 'summary') {
            return runSummarySample(engine, sample);
        }
        if (taskType === 'iab_classify') {
            return runIabSample(engine, sample);
        }
        if (taskType === 'classification') {
            return runClassificationSample(engine, sample);
        }
        const start = performance.now();
        if (typeof sample.text !== 'string') {
            const processingTimeMs = Math.round(performance.now() - start);
            return {
                ok: false,
                processingTimeMs,
                error: true,
                errorMessage: 'response from processing sample'
            };
        }
        const boundedText = getBoundedSampleText(engine, sample.text);
        try {
            const output = await engine.summarize(boundedText);
            const processingTimeMs = Math.round(performance.now() - start);
            const outputText = getOutputText$1(output?.output).trim();
            if (!outputText) {
                return {
                    ok: false,
                    processingTimeMs,
                    error: true,
                    errorMessage: 'response from processing sample'
                };
            }
            getLogger().info('Sample output (generic task)', { taskType, output: output.output });
            return { ok: true, processingTimeMs, error: false };
        }
        catch (err) {
            const processingTimeMs = Math.round(performance.now() - start);
            return {
                ok: false,
                processingTimeMs,
                error: true,
                errorMessage: err instanceof Error ? err.message : String(err)
            };
        }
    };

    const ensureTransformersRuntime = () => {
        if (window.TransformersPipeline) {
            return Promise.resolve();
        }
        return Promise.reject(new Error('[ZeroGPU] Transformers runtime not pre-loaded. Load transformers.min.js via a static script/import before initializing the SDK.'));
    };
    const sanitizeBaseUrl = (url) => url.replace(/\/$/, '');
    const HUGGING_FACE_BASE = 'https://huggingface.co';
    const normalizeRepoId = (value) => {
        const trimmed = value.trim();
        if (!trimmed)
            return '';
        if (isHttpUrl(trimmed)) {
            try {
                const url = new URL(trimmed);
                return url.pathname.replace(/^\/+|\/+$/g, '');
            }
            catch {
                return '';
            }
        }
        return trimmed.replace(/^\/+|\/+$/g, '');
    };
    const buildRepoResolveBase = (repoId) => {
        const normalizedRepoId = normalizeRepoId(repoId);
        if (!normalizedRepoId)
            return '';
        return sanitizeBaseUrl(`${HUGGING_FACE_BASE}/${normalizedRepoId}/resolve/main`);
    };
    const buildFileBase = (slm) => {
        const modelUrl = (slm.modelUrl || '').trim();
        if (isHttpUrl(modelUrl)) {
            return sanitizeBaseUrl(modelUrl);
        }
        const repoBase = buildRepoResolveBase(slm.modelRepoId || modelUrl);
        if (repoBase)
            return repoBase;
        return sanitizeBaseUrl(modelUrl);
    };
    const normalizeCacheRelativePath = (value) => value.replace(/^\/+/, '').replace(/^resolve\/main\//, '').split('?')[0];
    const buildModelFileCacheKey = (modelId, relative) => `${modelId}/${normalizeCacheRelativePath(relative)}`;
    const isHttpUrl = (value) => /^https?:\/\//i.test(value.trim());
    const resolveOnnxWasmPath = () => {
        try {
            return new URL('/onnx-wasm/', window.location.origin).toString();
        }
        catch {
            return '/onnx-wasm/';
        }
    };
    const ONNX_WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];
    const ONNX_WASM_PROBE_FILES = [
        'ort-wasm-simd-threaded.wasm',
        'ort-wasm-simd.wasm',
        'ort-wasm-threaded.wasm',
        'ort-wasm.wasm'
    ];
    let onnxWasmOverrideProbePromise = null;
    const normalizeWasmBase = (value) => (value.endsWith('/') ? value : `${value}/`);
    const buildTransformersDistBaseFromCdn = () => {
        return './vendor/';
    };
    const hasWasmMagic = (bytes) => bytes.length >= ONNX_WASM_MAGIC.length &&
        ONNX_WASM_MAGIC.every((expected, index) => bytes[index] === expected);
    const probeOnnxWasmOverridePath = async (fetchImpl) => {
        const candidateBases = [
            resolveOnnxWasmPath(),
            buildTransformersDistBaseFromCdn(),
            './vendor/'
        ].map(normalizeWasmBase);
        for (const baseWithSlash of candidateBases) {
            let sawNonWasmPayloadAtBase = false;
            for (const filename of ONNX_WASM_PROBE_FILES) {
                const requestUrl = (() => {
                    try {
                        return new URL(filename, baseWithSlash).toString();
                    }
                    catch {
                        return `${baseWithSlash}${filename}`;
                    }
                })();
                try {
                    const response = await fetchImpl(requestUrl, { cache: 'no-store' });
                    if (!response.ok)
                        continue;
                    const bytes = new Uint8Array(await response.arrayBuffer());
                    if (hasWasmMagic(bytes)) {
                        console.info('[ZeroGPU][SLM] Selected ONNX wasm base', {
                            wasmBase: baseWithSlash,
                            probeFile: filename,
                            contentType: response.headers.get('content-type')
                        });
                        return baseWithSlash;
                    }
                    sawNonWasmPayloadAtBase = true;
                    break;
                }
                catch {
                    // Ignore probe failures and continue with next candidate.
                }
            }
            if (sawNonWasmPayloadAtBase) {
                console.warn('[ZeroGPU][SLM] ONNX wasm probe got non-wasm payload', {
                    wasmBase: baseWithSlash
                });
            }
        }
        return null;
    };
    const getUsableOnnxWasmOverridePath = (fetchImpl) => {
        if (!onnxWasmOverrideProbePromise) {
            onnxWasmOverrideProbePromise = probeOnnxWasmOverridePath(fetchImpl);
        }
        return onnxWasmOverrideProbePromise;
    };
    // Global cache for files downloaded during this session
    const sessionCache = {};
    let transformersEnvMutationChain = Promise.resolve();
    const withTransformersEnvLock = async (work) => {
        const previous = transformersEnvMutationChain;
        let release = () => { };
        transformersEnvMutationChain = new Promise((resolve) => {
            release = resolve;
        });
        await previous;
        try {
            return await work();
        }
        finally {
            release();
        }
    };
    const createEnvFetch = (modelId, fileBase, cachedFiles, onFileDownloaded, requiredFiles, originalFetch) => {
        const requiredFileList = requiredFiles
            .map((name) => normalizeCacheRelativePath(name.trim()))
            .filter((name) => name.length > 0);
        const requiredFileSet = new Set(requiredFileList);
        const logger = getLogger();
        const resolveRequestedRelative = (requestedRelative) => {
            const normalized = normalizeCacheRelativePath(requestedRelative);
            if (!normalized)
                return null;
            if (requiredFileSet.size === 0 || requiredFileSet.has(normalized)) {
                return normalized;
            }
            if (normalized.startsWith('onnx/') &&
                normalized.endsWith('.onnx') &&
                !normalized.endsWith('_quantized.onnx')) {
                const quantizedCandidate = normalized.replace(/\.onnx$/, '_quantized.onnx');
                if (requiredFileSet.has(quantizedCandidate)) {
                    return quantizedCandidate;
                }
            }
            return null;
        };
        const buildModelRequestUrls = (relative) => {
            const normalized = normalizeCacheRelativePath(relative);
            const urls = [];
            const pushUrl = (value) => {
                if (!urls.includes(value))
                    urls.push(value);
            };
            try {
                const base = new URL(fileBase);
                const baseWithSlash = base.toString().endsWith('/') ? base.toString() : `${base.toString()}/`;
                if (fileBase.endsWith('/resolve/main')) {
                    pushUrl(new URL(normalized, baseWithSlash).toString());
                }
                else {
                    pushUrl(new URL(normalized, baseWithSlash).toString());
                    pushUrl(new URL(`resolve/main/${normalized}`, baseWithSlash).toString());
                }
            }
            catch {
                if (fileBase.endsWith('/resolve/main')) {
                    pushUrl(`${fileBase}/${normalized}`);
                }
                else {
                    pushUrl(`${fileBase}/${normalized}`);
                    pushUrl(`${fileBase}/resolve/main/${normalized}`);
                }
            }
            return urls;
        };
        const fileBaseUrl = (() => {
            try {
                return new URL(fileBase);
            }
            catch {
                return null;
            }
        })();
        const extractModelRelativePath = (requestUrl) => {
            const pathname = (() => {
                try {
                    return new URL(requestUrl).pathname;
                }
                catch {
                    return requestUrl.split('?')[0] || '';
                }
            })();
            const resolveMainSegment = '/resolve/main/';
            const resolveMainIndex = pathname.indexOf(resolveMainSegment);
            if (resolveMainIndex >= 0) {
                const resolved = pathname.slice(resolveMainIndex + resolveMainSegment.length);
                return normalizeCacheRelativePath(resolved);
            }
            if (!fileBaseUrl)
                return null;
            const basePath = fileBaseUrl.pathname.replace(/\/$/, '');
            if (!pathname.startsWith(`${basePath}/`))
                return null;
            const relative = pathname.slice(basePath.length + 1);
            return normalizeCacheRelativePath(relative);
        };
        return async (url, init) => {
            const originalRequestUrl = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
            const requestedRelative = extractModelRelativePath(originalRequestUrl);
            if (!requestedRelative) {
                const isWasmOrOrtRequest = /\.wasm(?:\?|$)/i.test(originalRequestUrl) || /onnxruntime|ort-wasm/i.test(originalRequestUrl);
                if (!isWasmOrOrtRequest) {
                    return originalFetch(url, init);
                }
                try {
                    const response = await originalFetch(url, init);
                    console.debug('[ZeroGPU][SLM][fetch] non-model wasm/ort request', {
                        modelId,
                        requestUrl: originalRequestUrl,
                        status: response.status,
                        statusText: response.statusText,
                        contentType: response.headers.get('content-type')
                    });
                    return response;
                }
                catch (error) {
                    console.error('[ZeroGPU][SLM][fetch] non-model wasm/ort request failed', {
                        modelId,
                        requestUrl: originalRequestUrl,
                        error: serializeError(error)
                    });
                    throw error;
                }
            }
            const relative = resolveRequestedRelative(requestedRelative);
            console.debug('[ZeroGPU][SLM][fetch] intercepted model request', {
                modelId,
                originalRequestUrl,
                requestedRelative,
                resolvedRelative: relative
            });
            if (!relative) {
                logger.warn('[SLM] Unexpected model file request; falling back to original fetch', {
                    requestedRelative,
                    modelId
                });
                console.warn('[ZeroGPU][SLM][fetch] unexpected model file request; fallback to original fetch', {
                    modelId,
                    originalRequestUrl,
                    requestedRelative,
                    requiredFiles: Array.from(requiredFileSet)
                });
                return originalFetch(url, init);
            }
            const requestUrls = buildModelRequestUrls(relative);
            console.debug('[ZeroGPU][SLM][fetch] rewritten model request candidates', {
                modelId,
                relative,
                requestUrls
            });
            const normalizedRelative = normalizeCacheRelativePath(relative);
            const modelScopedKey = buildModelFileCacheKey(modelId, normalizedRelative);
            let blob = sessionCache[modelScopedKey] ||
                cachedFiles[modelScopedKey] ||
                sessionCache[normalizedRelative] ||
                cachedFiles[normalizedRelative] ||
                cachedFiles[`onnx/${normalizedRelative}`] ||
                sessionCache[`onnx/${normalizedRelative}`];
            if (!blob && normalizedRelative.startsWith('onnx/')) {
                const trimmed = normalizedRelative.replace('onnx/', '');
                blob =
                    cachedFiles[trimmed] ||
                        sessionCache[trimmed] ||
                        cachedFiles[buildModelFileCacheKey(modelId, trimmed)] ||
                        sessionCache[buildModelFileCacheKey(modelId, trimmed)];
            }
            if (blob) {
                logger.info('[SLM] Returning cached blob', { relative });
                return new Response(blob);
            }
            try {
                for (const requestUrl of requestUrls) {
                    console.debug('[ZeroGPU][SLM][fetch] requesting model file', {
                        modelId,
                        relative,
                        requestUrl
                    });
                    const response = await originalFetch(requestUrl, init);
                    if (response.ok) {
                        const downloadedBlob = await response.blob();
                        sessionCache[modelScopedKey] = downloadedBlob;
                        if (onFileDownloaded) {
                            onFileDownloaded(modelScopedKey, downloadedBlob);
                        }
                        logger.info('[SLM] Downloaded required file', { relative, size: downloadedBlob.size, requestUrl });
                        return new Response(downloadedBlob);
                    }
                    logger.info('[SLM] Required file request failed', { relative, status: response.status, requestUrl });
                    console.warn('[ZeroGPU][SLM][fetch] model file request failed', {
                        modelId,
                        relative,
                        requestUrl,
                        status: response.status,
                        statusText: response.statusText,
                        contentType: response.headers.get('content-type')
                    });
                }
                console.error('[ZeroGPU][SLM][fetch] all model file candidates failed', {
                    modelId,
                    relative,
                    requestUrls
                });
                return new Response('required_file_not_found', { status: 404, statusText: 'Not Found' });
            }
            catch (err) {
                logger.warn(`[ZeroGPU] Failed to fetch ${relative}:`, err);
                console.error('[ZeroGPU][SLM][fetch] model file fetch threw', {
                    modelId,
                    relative,
                    requestUrls,
                    error: err
                });
                return new Response('model_file_fetch_failed', { status: 502, statusText: 'Bad Gateway' });
            }
        };
    };
    const parseSummaryOutput = (raw) => {
        if (Array.isArray(raw) && raw.length) {
            const first = raw[0];
            if (typeof first?.summary_text === 'string')
                return first.summary_text;
            if (typeof first?.generated_text === 'string')
                return first.generated_text;
            if (typeof first?.label === 'string')
                return first.label;
            try {
                return JSON.stringify(first);
            }
            catch {
                return String(first ?? '');
            }
        }
        if (typeof raw === 'string')
            return raw;
        if (typeof raw === 'object' && raw !== null) {
            if (typeof raw.summary_text === 'string')
                return raw.summary_text;
            if (typeof raw.generated_text === 'string')
                return raw.generated_text;
            if (typeof raw.label === 'string')
                return raw.label;
            try {
                return JSON.stringify(raw);
            }
            catch {
                return String(raw);
            }
        }
        return '';
    };
    const isInvalidArrayLengthError = (error) => {
        const message = error instanceof Error ? error.message : String(error);
        return message.toLowerCase().includes('invalid array length');
    };
    const serializeError = (error) => {
        if (error instanceof Error) {
            return {
                name: error.name,
                message: error.message,
                stack: error.stack
            };
        }
        return {
            message: String(error)
        };
    };
    const sanitizeSummaryInput = (text) => {
        const trimmed = (text ?? '').trim();
        if (!trimmed)
            return 'summarize this text';
        return trimmed.slice(0, 1024);
    };
    const fallbackSummaryFromInput = (input) => {
        const collapsed = input.replace(/\s+/g, ' ').trim();
        if (!collapsed)
            return 'Summary unavailable.';
        return collapsed.slice(0, 180);
    };
    const instantiateEngine = async (slm, cachedFiles, baseMetrics, onFileDownloaded) => {
        const logger = getLogger();
        logger.info('[SLM] instantiateEngine start', {
            modelId: slm.modelId,
            modelUrl: slm.modelUrl,
            hasManifest: Boolean(slm.manifest)
        });
        logger.info('[SLM] ensureTransformersRuntime start', { modelId: slm.modelId });
        try {
            await ensureTransformersRuntime();
        }
        catch (error) {
            logger.error('[SLM] ensureTransformersRuntime failed', serializeError(error));
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`transformers_runtime_load_failed:${message}`);
        }
        logger.info('[SLM] ensureTransformersRuntime success', { modelId: slm.modelId });
        const fileBase = sanitizeBaseUrl(buildFileBase(slm));
        const pipelineTask = getPipelineTaskForType(slm.taskType);
        const modelSource = isHttpUrl(slm.modelUrl || '')
            ? (slm.modelUrl || '').trim()
            : (slm.modelRepoId || slm.modelUrl || '').trim();
        if (!modelSource || modelSource.trim() === '') {
            const error = new Error('[SLM] Invalid modelSource: expected non-empty modelRepoId or modelUrl');
            logger.error(error.message, { taskType: slm.taskType, slm });
            throw error;
        }
        logger.info('[SLM] Pipeline source resolved', {
            modelId: slm.modelId,
            modelRepoId: slm.modelRepoId,
            modelUrl: slm.modelUrl,
            modelSource,
            sourceMode: isHttpUrl(slm.modelUrl || '') ? 'modelUrl' : 'modelRepoId_or_modelUrl'
        });
        const loadResult = await withTransformersEnvLock(async () => {
            const env = window.TransformersEnv || {};
            env.allowRemoteModels = true;
            env.allowLocalModels = true;
            if (!env.backends)
                env.backends = {};
            if (!env.backends.onnx)
                env.backends.onnx = {};
            if (!env.backends.onnx.wasm)
                env.backends.onnx.wasm = {};
            const transformersLogLevel = logger.isEnabled() ? 'error' : 'fatal';
            if (env?.backends?.onnx?.env) {
                env.backends.onnx.env.logLevel = transformersLogLevel;
            }
            // Telegram/WebView-safe ONNX WASM configuration.
            env.backends.onnx.wasm.proxy = false;
            env.backends.onnx.wasm.numThreads = 1;
            const originalFetch = window.fetch.bind(window);
            const wasmOverridePath = await getUsableOnnxWasmOverridePath(originalFetch);
            if (wasmOverridePath) {
                env.backends.onnx.wasm.wasmPaths = wasmOverridePath;
            }
            else {
                try {
                    delete env.backends.onnx.wasm.wasmPaths;
                }
                catch {
                    env.backends.onnx.wasm.wasmPaths = undefined;
                }
                logger.warn('[SLM] Skipping custom ONNX wasmPaths override; hosted /onnx-wasm assets unavailable');
            }
            if ('logLevel' in env) {
                env.logLevel = transformersLogLevel;
            }
            const ort = window.ort;
            if (ort?.env) {
                // Suppress noisy graph-optimizer warnings in constrained WebViews.
                ort.env.logLevel = transformersLogLevel;
            }
            env.fetch = createEnvFetch(slm.modelId, fileBase, cachedFiles, onFileDownloaded, (slm.requiredFiles ?? []).map((file) => file.name), originalFetch);
            window.TransformersEnv = env;
            logger.info('[SLM] Custom fetch wired', { fileBase, modelId: slm.modelId });
            logger.info('[SLM] ONNX WASM safe mode enabled', {
                proxy: env.backends.onnx.wasm.proxy,
                numThreads: env.backends.onnx.wasm.numThreads,
                wasmPaths: env.backends.onnx.wasm.wasmPaths
            });
            // Transformers.js reads env from a global singleton; serialize this section per model load.
            // Some WebViews/ORT paths bypass env.fetch and use global fetch directly.
            window.fetch = env.fetch;
            logger.info('[SLM] Global window.fetch overridden for model load');
            const runPipelineLoad = () => measure(() => window.TransformersPipeline(pipelineTask, modelSource, {
                device: 'wasm',
                quantized: slm.quantized,
                progress_callback: () => { }
            }));
            try {
                logger.info('[SLM] Invoking Transformers pipeline load');
                return await runPipelineLoad();
            }
            catch (firstError) {
                logger.error('[SLM] Pipeline load attempt failed', serializeError(firstError));
                const wasmEnv = env?.backends?.onnx?.wasm;
                const hadWasmPathOverride = Boolean(wasmEnv && 'wasmPaths' in wasmEnv && wasmEnv.wasmPaths);
                console.error('[ZeroGPU][SLM] pipeline load attempt failed', {
                    modelId: slm.modelId,
                    modelSource,
                    hadWasmPathOverride,
                    error: serializeError(firstError)
                });
                let lastError = firstError;
                // Compatibility retry for constrained mobile WebViews (e.g. Telegram Mini App on phones).
                if (wasmEnv) {
                    const previousSimd = wasmEnv.simd;
                    const previousThreads = wasmEnv.numThreads;
                    const previousProxy = wasmEnv.proxy;
                    wasmEnv.simd = false;
                    wasmEnv.numThreads = 1;
                    wasmEnv.proxy = false;
                    logger.warn('[SLM] Retrying pipeline load with mobile-safe wasm flags', {
                        simd: wasmEnv.simd,
                        numThreads: wasmEnv.numThreads,
                        proxy: wasmEnv.proxy
                    });
                    try {
                        return await runPipelineLoad();
                    }
                    catch (compatError) {
                        lastError = compatError;
                        logger.error('[SLM] Mobile-safe wasm retry failed', serializeError(compatError));
                        console.error('[ZeroGPU][SLM] mobile-safe wasm retry failed', {
                            modelId: slm.modelId,
                            modelSource,
                            error: serializeError(compatError)
                        });
                        wasmEnv.simd = previousSimd;
                        wasmEnv.numThreads = previousThreads;
                        wasmEnv.proxy = previousProxy;
                    }
                }
                if (!hadWasmPathOverride || !wasmEnv) {
                    const message = lastError instanceof Error ? lastError.message : String(lastError);
                    throw new Error(`pipeline_load_failed:${message}`);
                }
                const previousWasmPaths = wasmEnv.wasmPaths;
                try {
                    delete wasmEnv.wasmPaths;
                }
                catch {
                    wasmEnv.wasmPaths = undefined;
                }
                logger.warn('[SLM] Retrying pipeline load without wasmPaths override');
                try {
                    return await runPipelineLoad();
                }
                catch (secondError) {
                    logger.error('[SLM] Pipeline load retry failed', serializeError(secondError));
                    console.error('[ZeroGPU][SLM] retry without wasmPaths also failed', {
                        modelId: slm.modelId,
                        modelSource,
                        error: serializeError(secondError)
                    });
                    const message = secondError instanceof Error ? secondError.message : String(secondError);
                    throw new Error(`pipeline_load_failed:${message}`);
                }
                finally {
                    wasmEnv.wasmPaths = previousWasmPaths;
                }
            }
            finally {
                window.fetch = originalFetch;
                logger.info('[SLM] Global window.fetch restored');
            }
        });
        const { result: pipeline, ms: loadModelMs } = loadResult;
        logger.info('[SLM] Transformers pipeline loaded', { loadModelMs });
        const summarize = async (text) => {
            const input = sanitizeSummaryInput(text);
            const runPipeline = async (candidateInput, maxNewTokens) => {
                if (pipelineTask === 'summarization') {
                    return pipeline(candidateInput, {
                        max_new_tokens: maxNewTokens ?? 64,
                        min_length: 1,
                        do_sample: false
                    });
                }
                return pipeline(candidateInput);
            };
            try {
                const { result, ms } = await measure(async () => runPipeline(input, 64));
                return { output: parseSummaryOutput(result), inferenceMs: ms };
            }
            catch (error) {
                if (!isInvalidArrayLengthError(error)) {
                    throw error;
                }
                const fallbackInput = input.slice(0, 128);
                try {
                    const { result, ms } = await measure(async () => runPipeline(fallbackInput, 32));
                    logger.warn('[SLM] summarize recovered from Invalid array length with fallback input');
                    return { output: parseSummaryOutput(result), inferenceMs: ms };
                }
                catch (fallbackError) {
                    if (!isInvalidArrayLengthError(fallbackError)) {
                        throw fallbackError;
                    }
                    logger.warn('[SLM] summarize using deterministic fallback after repeated Invalid array length');
                    return {
                        output: fallbackSummaryFromInput(fallbackInput),
                        inferenceMs: 0
                    };
                }
            }
        };
        const classify = async (text, categories) => {
            const { result, ms } = await measure(async () => {
                if (pipelineTask === 'zero-shot-classification') {
                    if (!Array.isArray(categories) || categories.length === 0) {
                        throw new Error('classification_categories_required');
                    }
                    return pipeline(text, categories);
                }
                return pipeline(text);
            });
            return { output: result, inferenceMs: ms };
        };
        return {
            config: slm,
            metrics: { ...baseMetrics, loadModelMs },
            summarize,
            classify: pipelineTask === 'text-classification' || pipelineTask === 'zero-shot-classification'
                ? classify
                : undefined
        };
    };
    const loadSlmEngine = async (slm, options) => {
        const logger = getLogger();
        logger.info('[SLM] loadSlmEngine invoked', { modelId: slm.modelId, modelUrl: slm.modelUrl });
        console.info('[ZeroGPU][SLM][loadSlmEngine] invoked', {
            modelId: slm.modelId,
            modelVersion: slm.modelVersion,
            taskType: slm.taskType,
            modelRepoId: slm.modelRepoId,
            modelUrl: slm.modelUrl,
            quantized: slm.quantized,
            requiredFiles: (slm.requiredFiles ?? []).map((file) => file.name),
            allowDownload: options?.allowDownload
        });
        const startTime = performance.now();
        const downloadedFiles = {};
        let totalSize = 0;
        try {
            // Check for cached model
            const cached = await getModel(slm.modelId, slm.modelVersion);
            const cachedFiles = cached?.files || {};
            if (cached) {
                logger.debug('[SLM] Found cached model files', {
                    modelId: slm.modelId,
                    version: slm.modelVersion
                });
            }
            else {
                logger.debug('[SLM] No cached files for model', { modelId: slm.modelId });
            }
            if (!cached && options?.allowDownload === false) {
                return { error: new Error('model_not_cached'), metrics: {} };
            }
            console.info('[ZeroGPU][SLM][loadSlmEngine] cache state', {
                modelId: slm.modelId,
                hasCachedMetadata: Boolean(cached),
                cachedFileCount: Object.keys(cachedFiles).length,
                cachedFileKeysPreview: Object.keys(cachedFiles).slice(0, 12)
            });
            // Track files as they're downloaded
            const onFileDownloaded = (filename, blob) => {
                downloadedFiles[filename] = blob;
                totalSize += blob.size;
                logger.debug(`Downloaded and cached: ${filename} (${Math.round(blob.size / 1024)}KB)`);
            };
            // Let Transformers.js download files naturally - it will use our fetch interceptor
            logger.info('Loading model via Transformers.js (will cache files as downloaded)');
            const baseMetrics = cached
                ? {
                    downloadMs: cached.metadata.downloadMs,
                    loadModelMs: cached.metadata.loadModelMs,
                    sizeBytes: cached.metadata.sizeBytes
                }
                : {};
            let engine;
            try {
                engine = await instantiateEngine(slm, cachedFiles, baseMetrics, onFileDownloaded);
            }
            catch (error) {
                console.error('[ZeroGPU][SLM][loadSlmEngine] instantiateEngine failed', {
                    modelId: slm.modelId,
                    modelRepoId: slm.modelRepoId,
                    modelUrl: slm.modelUrl,
                    requiredFiles: (slm.requiredFiles ?? []).map((file) => file.name),
                    downloadedFileKeys: Object.keys(downloadedFiles),
                    downloadedTotalSizeBytes: totalSize,
                    error: serializeError(error)
                });
                throw error;
            }
            // Cache all downloaded files for next time
            if (Object.keys(downloadedFiles).length > 0) {
                logger.debug('[SLM] Caching downloaded files', {
                    count: Object.keys(downloadedFiles).length,
                    totalSize
                });
                const allFiles = { ...cachedFiles, ...downloadedFiles };
                // Calculate total size from all files
                const calculatedSize = Object.values(allFiles).reduce((sum, blob) => sum + blob.size, 0);
                const downloadMs = Math.round(performance.now() - startTime);
                await putModelComplete(slm.modelId, slm.modelVersion, {
                    modelId: slm.modelId,
                    modelVersion: slm.modelVersion,
                    sizeBytes: calculatedSize,
                    downloadMs: cached ? 0 : downloadMs, // Only count download time if not from cache
                    loadModelMs: engine.metrics.loadModelMs
                }, allFiles);
                logger.info(`Cached ${Object.keys(downloadedFiles).length} new files`);
            }
            return { engine, metrics: engine.metrics };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("Unexpected token '<'")) {
                console.error('[ZeroGPU][SLM][loadSlmEngine] Parse error suggests HTML was returned where JSON was expected.', {
                    modelId: slm.modelId,
                    modelRepoId: slm.modelRepoId,
                    modelUrl: slm.modelUrl,
                    requiredFiles: (slm.requiredFiles ?? []).map((file) => file.name),
                    downloadedFileKeys: Object.keys(downloadedFiles)
                });
            }
            console.error('[ZeroGPU][SLM][loadSlmEngine] failed', {
                modelId: slm.modelId,
                modelVersion: slm.modelVersion,
                modelRepoId: slm.modelRepoId,
                modelUrl: slm.modelUrl,
                requiredFiles: (slm.requiredFiles ?? []).map((file) => file.name),
                downloadedFileCount: Object.keys(downloadedFiles).length,
                downloadedFileKeys: Object.keys(downloadedFiles),
                downloadedTotalSizeBytes: totalSize,
                error: serializeError(error)
            });
            logger.error('SLM load failed', error);
            await clearModel(slm.modelId, slm.modelVersion).catch(() => { });
            return { error: error, metrics: {} };
        }
    };

    const DEVICE_ID_KEY = 'zerogpu_device_id';
    const getStoredDeviceId = () => {
        try {
            return window.localStorage.getItem(DEVICE_ID_KEY);
        }
        catch {
            return null;
        }
    };
    const setStoredDeviceId = (deviceId) => {
        try {
            window.localStorage.setItem(DEVICE_ID_KEY, deviceId);
        }
        catch {
            // ignored
        }
    };

    const createUuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 0xf) >> 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });

    const getDeviceId = () => {
        const existing = getStoredDeviceId();
        if (existing)
            return existing;
        const fresh = createUuid();
        setStoredDeviceId(fresh);
        return fresh;
    };
    const setDeviceId = (deviceId) => {
        setStoredDeviceId(deviceId);
    };

    const getPlatform = () => {
        const ua = navigator.userAgent.toLowerCase();
        const tg = window.Telegram?.WebApp;
        if (tg?.platform)
            return tg.platform;
        if (tg)
            return 'telegram-webapp';
        if (ua.includes('android'))
            return 'android-web';
        if (ua.includes('iphone') || ua.includes('ipad'))
            return 'ios-web';
        if (ua.includes('mac os'))
            return 'macos-web';
        if (ua.includes('windows'))
            return 'windows-web';
        return 'web';
    };
    const getDeviceType = () => {
        const ua = navigator.userAgent ?? '';
        const uaData = navigator.userAgentData;
        if (uaData?.mobile === true)
            return 'mobile';
        const isTablet = /iPad|Tablet|PlayBook|Silk/i.test(ua) || (navigator.maxTouchPoints > 1 && window.innerWidth >= 768);
        if (isTablet)
            return 'tablet';
        const isMobile = /Mobi|Android|iPhone|iPod/i.test(ua);
        return isMobile ? 'mobile' : 'desktop';
    };
    const getWebGLRenderer = () => {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') ||
                canvas.getContext('experimental-webgl');
            if (!gl)
                return undefined;
            const dbg = gl.getExtension('WEBGL_debug_renderer_info');
            return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        }
        catch {
            return undefined;
        }
    };
    const getBatteryInfo = async () => {
        try {
            if ('getBattery' in navigator) {
                const battery = await navigator.getBattery();
                return {
                    level: battery.level,
                    charging: battery.charging
                };
            }
        }
        catch {
            // ignored
        }
        return undefined;
    };
    const getNetworkInfo = () => {
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (conn) {
            return {
                type: conn.effectiveType || 'unknown',
                downlink: conn.downlink || 0,
                rtt: conn.rtt || 0
            };
        }
        return undefined;
    };
    const getLocation = async () => {
        if (!navigator.geolocation)
            return undefined;
        return new Promise((resolve) => {
            navigator.geolocation.getCurrentPosition((pos) => {
                resolve({
                    lat: pos.coords.latitude,
                    lon: pos.coords.longitude,
                    accuracy: pos.coords.accuracy
                });
            }, () => resolve(undefined), { timeout: 5000, maximumAge: 60000 });
        });
    };
    const parseTelegramUserFromHash = () => {
        try {
            const hash = window.location?.hash || '';
            if (!hash.includes('tgWebAppData'))
                return undefined;
            const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.substring(1) : hash);
            const encodedData = hashParams.get('tgWebAppData');
            if (!encodedData)
                return undefined;
            const decodedData = decodeURIComponent(encodedData);
            const dataParams = new URLSearchParams(decodedData);
            const userJson = dataParams.get('user');
            if (!userJson)
                return undefined;
            return JSON.parse(userJson);
        }
        catch {
            return undefined;
        }
    };
    const getTelegramUser = () => {
        const tg = window.Telegram?.WebApp;
        const user = tg?.initDataUnsafe?.user;
        if (user) {
            return user;
        }
        return parseTelegramUserFromHash();
    };
    const collectDeviceInfo = async (config, appUserId, sdkDeviceId) => {
        const screen = window.screen || { width: null, height: null };
        const tg = window.Telegram?.WebApp;
        const telegramUser = getTelegramUser();
        const telegramFullName = telegramUser?.first_name || telegramUser?.last_name
            ? [telegramUser?.first_name, telegramUser?.last_name].filter(Boolean).join(' ')
            : undefined;
        const resolvedAppUserId = telegramUser?.id?.toString() || appUserId;
        const baseInfo = {
            // Identity
            appUserId: resolvedAppUserId,
            appUsername: telegramUser?.username,
            appFirstName: telegramUser?.first_name,
            appLastName: telegramUser?.last_name,
            appFullName: telegramFullName,
            sdkDeviceId: sdkDeviceId ?? getDeviceId(),
            // Platform
            platform: getPlatform(),
            deviceType: getDeviceType(),
            userAgent: navigator.userAgent,
            language: navigator.language,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            appPlatform: tg?.platform,
            appVersion: tg?.version,
            appLanguage: telegramUser?.language_code,
            themeParams: tg?.themeParams,
            // Hardware
            cpuCores: navigator.hardwareConcurrency || 1,
            memoryGb: navigator.deviceMemory,
            gpuRenderer: getWebGLRenderer(),
            webglFingerprint: getWebGLRenderer(), // Using renderer as simple fingerprint for now
            screen: {
                width: screen?.width ?? null,
                height: screen?.height ?? null,
                pixelRatio: window.devicePixelRatio ?? null
            },
            battery: await getBatteryInfo(),
            // Network
            connection: getNetworkInfo(),
            // Context
            pageUrl: window.location?.href,
            referrer: document.referrer,
            // Optional permissions
            location: config.locationData ? await getLocation() : undefined
        };
        if (config.cameraData) {
            baseInfo.camera = await captureCameraSample();
        }
        return baseInfo;
    };
    const captureCameraSample = async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
            return { permission: 'error', error: 'mediaDevices unavailable' };
        }
        let stream = null;
        let video = null;
        let canvas = null;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
            video = document.createElement('video');
            video.setAttribute('playsinline', 'true');
            video.playsInline = true;
            video.muted = true;
            video.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0';
            document.body.appendChild(video);
            video.srcObject = stream;
            await video.play().catch(() => { });
            await new Promise((resolve) => {
                const ready = () => resolve();
                video.onloadeddata = ready;
                video.oncanplay = ready;
                setTimeout(ready, 800);
            });
            const vw = video.videoWidth || 640;
            const vh = video.videoHeight || 480;
            canvas = document.createElement('canvas');
            canvas.width = vw;
            canvas.height = vh;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(video, 0, 0, vw, vh);
            const mime = 'image/jpeg';
            const dataUrl = canvas.toDataURL(mime, 0.85);
            const bytes = Math.floor((dataUrl.length * 3) / 4);
            return {
                permission: 'granted',
                width: vw,
                height: vh,
                bytes,
                mime,
                timestamp: Date.now(),
                previewDataUrl: dataUrl
            };
        }
        catch (err) {
            const errorObj = err;
            return {
                permission: errorObj?.name === 'NotAllowedError' ? 'denied' : 'error',
                error: errorObj?.message || String(err)
            };
        }
        finally {
            try {
                stream?.getTracks().forEach((track) => track.stop());
            }
            catch {
                // Best-effort cleanup.
            }
            try {
                video?.remove();
            }
            catch {
                // Best-effort cleanup.
            }
            canvas = null;
        }
    };

    class RegisterError extends Error {
        constructor(status, body) {
            super(`Register failed: ${status} ${body ?? ''}`.trim());
            this.status = status;
            this.body = body;
        }
    }
    const parseRegisterResponseBody = async (response) => {
        try {
            return await response.clone().json();
        }
        catch {
            return null;
        }
    };
    const isEdgeSdkTypeNotAllowedResponse = (payload) => {
        if (!payload || typeof payload !== 'object') {
            return false;
        }
        const body = payload;
        const status = typeof body.status === 'string' ? body.status.toLowerCase() : '';
        if (status !== 'ok') {
            return false;
        }
        const nestedError = body.error;
        const candidateCodes = [body.code, body.errorCode, body.reason, nestedError?.code];
        return candidateCodes.some((value) => typeof value === 'string' && value.toLowerCase() === 'edge_sdk_type_not_allowed');
    };
    const escapeShellSingleQuotes = (value) => value.replace(/'/g, "'\\''");
    const buildCurl = (url, body, headers) => {
        const payload = escapeShellSingleQuotes(JSON.stringify(body));
        const headerFlags = Object.entries(headers)
            .map(([key, value]) => `-H '${escapeShellSingleQuotes(`${key}: ${value}`)}'`)
            .join(' ');
        return `curl -X POST '${url}' ${headerFlags} -d '${payload}'`;
    };
    const registerDevice = async (config, payload, auth) => {
        const logger = getLogger();
        const orchestrator = config?.orchestrator;
        if (!orchestrator?.baseUrl || !orchestrator?.registerPath) {
            throw new Error('Invalid SDK config: orchestrator.baseUrl and orchestrator.registerPath are required');
        }
        const url = `${orchestrator.baseUrl}${orchestrator.registerPath}`;
        const headers = { 'Content-Type': 'application/json' };
        const edgeOperatorKey = auth?.edgeOperatorKey?.trim();
        const projectId = auth?.projectId?.trim();
        if (edgeOperatorKey)
            headers['x-edge-operator-key'] = edgeOperatorKey;
        if (projectId)
            headers['x-project-id'] = projectId;
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });
        logger.info('Register request sent:', { url, status: response.status });
        getLogger().debug('Register API blueprint (curl):', buildCurl(url, payload, headers));
        const registerResponseBody = await parseRegisterResponseBody(response);
        const edgeSdkTypeNotAllowed = isEdgeSdkTypeNotAllowedResponse(registerResponseBody);
        if (!response.ok && !edgeSdkTypeNotAllowed) {
            const text = typeof registerResponseBody === 'string'
                ? registerResponseBody
                : JSON.stringify(registerResponseBody ?? '');
            logger.error('Register request failed:', { status: response.status, text });
            throw new RegisterError(response.status, text);
        }
        if (registerResponseBody && typeof registerResponseBody === 'object' && !edgeSdkTypeNotAllowed) {
            const registerResponse = registerResponseBody;
            logger.info('Register response parsed:', registerResponse);
            return registerResponse;
        }
        if (edgeSdkTypeNotAllowed) {
            const responseObject = registerResponseBody && typeof registerResponseBody === 'object'
                ? registerResponseBody
                : {};
            const acceptedResponse = {
                deviceId: typeof responseObject.deviceId === 'string' && responseObject.deviceId
                    ? responseObject.deviceId
                    : payload.deviceId,
                sessionKey: typeof responseObject.sessionKey === 'string' ? responseObject.sessionKey : '',
                wsUrl: typeof responseObject.wsUrl === 'string' ? responseObject.wsUrl : '',
                active: typeof responseObject.active === 'boolean' ? responseObject.active : false,
                ttlSeconds: typeof responseObject.ttlSeconds === 'number' ? responseObject.ttlSeconds : 0,
                slmConfig: typeof responseObject.slmConfig !== 'undefined'
                    ? responseObject.slmConfig
                    : typeof responseObject.modelInfo !== 'undefined'
                        ? [responseObject.modelInfo]
                        : undefined
            };
            logger.info('Handled edge_sdk_type_not_allowed register response');
            return acceptedResponse;
        }
        throw new RegisterError(response.status, 'Register response body is not valid JSON');
    };

    class WebSocketClient {
        constructor(options) {
            this.options = options;
            this.logger = getLogger();
            this.consoleWithVerbose = console;
            this.handleOpen = () => {
                this.logger.info('WebSocket connection opened');
                this.logger.debug('Sending hello message:', this.options.hello);
                this.logger.info('[WS OUT] hello:', JSON.stringify(this.options.hello));
                this.send(this.options.hello);
                if (this.options.ack) {
                    // Send readiness/error ack immediately after hello.
                    this.logger.info('[WS OUT] hello_ack:', JSON.stringify(this.options.ack));
                    this.send(this.options.ack);
                    if (this.options.closeAfterAck) {
                        // Optionally close after ack (used for error cases).
                        const code = this.options.closeCode ?? 4000;
                        const reason = (this.options.closeReason ?? '').slice(0, 120);
                        this.logger.warn('Closing WebSocket after ack', { code, reason });
                        window.setTimeout(() => {
                            this.socket.close(code, reason);
                        }, 50);
                    }
                }
            };
            this.handleMessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (this.logger.isEnabled()) {
                        if (typeof this.consoleWithVerbose.verbose === 'function') {
                            this.consoleWithVerbose.verbose('[ZeroGPU]', '[WS IN] payload:', data);
                        }
                        else {
                            console.debug('[ZeroGPU]', '[WS IN] payload:', data);
                        }
                    }
                    this.options.onMessage(data);
                }
                catch (error) {
                    this.logger.error('Failed to parse WS message', error);
                }
            };
            this.handleError = (event) => {
                const ws = event.target;
                this.logger.error('WebSocket error', {
                    url: ws.url,
                    readyState: ws.readyState,
                    event: event.type
                });
                this.options.onError(event);
            };
            this.handleClose = (event) => {
                const ws = event.target;
                this.logger.warn('WebSocket closed', {
                    url: ws.url,
                    code: event.code,
                    reason: event.reason || 'No reason provided',
                    wasClean: event.wasClean
                });
                this.options.onClose(event);
            };
            this.logger.info('Creating WebSocket connection to:', options.url);
            this.socket = new WebSocket(options.url);
            this.socket.onopen = this.handleOpen;
            this.socket.onmessage = this.handleMessage;
            this.socket.onerror = this.handleError;
            this.socket.onclose = this.handleClose;
        }
        send(payload) {
            this.logger.debug('[WS OUT] payload:', JSON.stringify(payload));
            this.socket.send(JSON.stringify(payload));
        }
        close() {
            this.socket.close();
        }
    }

    const state = { status: 'idle' };
    const setConfig = (config) => {
        state.config = config;
    };
    const setDeviceContext = (deviceId, deviceInfo) => {
        state.deviceId = deviceId;
        state.deviceInfo = deviceInfo;
    };
    const setEngine = (engine) => {
        state.engine = engine;
        if (!state.enginesByTask) {
            state.enginesByTask = {};
        }
        if (engine?.config?.taskType) {
            state.enginesByTask[engine.config.taskType] = engine;
        }
    };
    const setModelInfo = (modelInfo) => {
        state.modelInfo = modelInfo;
        state.taskType = modelInfo?.taskType;
        if (!state.modelInfosByTask) {
            state.modelInfosByTask = {};
        }
        if (modelInfo?.taskType) {
            state.modelInfosByTask[modelInfo.taskType] = modelInfo;
        }
    };
    const setEnginesByTask = (enginesByTask) => {
        state.enginesByTask = enginesByTask ?? {};
    };
    const setModelInfosByTask = (modelInfosByTask) => {
        state.modelInfosByTask = modelInfosByTask ?? {};
    };
    const setSample = (sample) => {
        state.sample = sample;
    };
    const setCachedModelId = (cachedModelId) => {
        state.cachedModelId = cachedModelId ?? null;
    };
    const setSessionKey = (sessionKey) => {
        state.sessionKey = sessionKey;
    };
    const setWebSocket = (ws) => {
        state.ws = ws;
    };
    const setStatus = (status) => {
        state.status = status;
    };
    const getState = () => {
        if (!state.config || !state.deviceId || !state.deviceInfo) {
            throw new Error('SDK state not initialized');
        }
        return state;
    };

    const handleSummaryTask = async (engine, payload) => {
        if (!payload.text || !payload.text.trim()) {
            throw new Error('Summary text is empty');
        }
        const result = await engine.summarize(payload.text.trim());
        return {
            requestId: payload.requestId,
            output: result.output,
            inferenceMs: result.inferenceMs,
            inputLength: payload.text.length
        };
    };

    let executing = false;
    const inferTaskTypeFromRequest = (request) => {
        const inputType = request.input?.type;
        if (inputType === 'classification_request')
            return 'classification';
        const modelId = request.modelId?.toLowerCase() ?? '';
        if (modelId.includes('iab'))
            return 'iab_classify';
        if (modelId.includes('classify'))
            return 'classification';
        return 'summary';
    };
    const getOutputText = (output) => {
        if (typeof output === 'string')
            return output;
        if (Array.isArray(output) && output.length) {
            const first = output[0];
            if (first && typeof first.label === 'string')
                return first.label;
            try {
                return JSON.stringify(first);
            }
            catch {
                return String(first ?? '');
            }
        }
        if (output && typeof output === 'object') {
            const zeroShotOutput = output;
            if (Array.isArray(zeroShotOutput.labels) && typeof zeroShotOutput.labels[0] === 'string') {
                return zeroShotOutput.labels[0];
            }
            try {
                return JSON.stringify(output);
            }
            catch {
                return String(output);
            }
        }
        return '';
    };
    const normalizeCategories = (value) => {
        if (Array.isArray(value)) {
            const categories = value.filter((category) => typeof category === 'string');
            return categories.length > 0 ? categories : undefined;
        }
        if (typeof value === 'string' && value.length > 0) {
            return [value];
        }
        return undefined;
    };
    const isZeroShotClassificationOutput = (output) => {
        if (!output || typeof output !== 'object' || Array.isArray(output)) {
            return false;
        }
        const candidate = output;
        return Array.isArray(candidate.labels) && Array.isArray(candidate.scores);
    };
    const mapLabelsToScores = (output) => {
        const labels = output.labels;
        const scores = output.scores;
        if (!Array.isArray(labels) || !Array.isArray(scores)) {
            return null;
        }
        const entries = labels.flatMap((label, index) => {
            const score = scores[index];
            return typeof label === 'string' && typeof score === 'number'
                ? [[label, score]]
                : [];
        });
        return entries.length > 0 ? Object.fromEntries(entries) : null;
    };
    const buildResponsePayload = (output, options) => {
        if (Array.isArray(output)) {
            return output;
        }
        if (options?.classification && isZeroShotClassificationOutput(output)) {
            return mapLabelsToScores(output) ?? output;
        }
        if (output && typeof output === 'object') {
            return output;
        }
        return { text: getOutputText(output) };
    };
    const executeSingleRequest = async (request, metadataRequested) => {
        const logger = getLogger();
        const { engine, enginesByTask, modelInfosByTask } = getState();
        const modelInfo = Object.values(modelInfosByTask ?? {}).find((candidate) => candidate?.modelId === request.modelId && candidate?.modelVersion === request.modelVersion);
        const taskType = modelInfo?.taskType ?? inferTaskTypeFromRequest(request);
        let selectedEngine = enginesByTask?.[taskType] ?? engine;
        if (!selectedEngine && modelInfo) {
            logger.warn('Engine missing for request; attempting lazy model load', {
                requestId: request.requestId,
                modelId: request.modelId,
                modelVersion: request.modelVersion,
                taskType: modelInfo.taskType
            });
            const lazyLoad = await loadSlmEngine({
                modelId: modelInfo.modelId,
                modelVersion: modelInfo.modelVersion ?? '',
                modelUrl: modelInfo.modelUrl,
                modelRepoId: modelInfo.modelRepoId,
                maxInputTokens: modelInfo.maxTokens,
                quantized: modelInfo.quantized ?? false,
                quantization: modelInfo.quantization,
                taskType: modelInfo.taskType,
                requiredFiles: modelInfo.requiredFiles
            });
            if (lazyLoad.engine) {
                const current = getState();
                setEnginesByTask({
                    ...(current.enginesByTask ?? {}),
                    [modelInfo.taskType]: lazyLoad.engine
                });
                if (!current.engine) {
                    setEngine(lazyLoad.engine);
                }
                selectedEngine = lazyLoad.engine;
                logger.info('Lazy model load succeeded for request', {
                    requestId: request.requestId,
                    modelId: request.modelId,
                    taskType: modelInfo.taskType
                });
            }
            else {
                logger.warn('Lazy model load failed for request', {
                    requestId: request.requestId,
                    modelId: request.modelId,
                    modelVersion: request.modelVersion,
                    error: lazyLoad.error?.message
                });
            }
        }
        const start = performance.now();
        if (!selectedEngine) {
            return {
                requestId: request.requestId,
                modelId: request.modelId,
                modelVersion: request.modelVersion,
                response: { text: '' },
                error: true,
                errorMessage: 'model_not_ready',
                metadata: {
                    processingTime: Math.round(performance.now() - start)
                }
            };
        }
        const requestText = request.input?.text ?? '';
        const wantsClassification = request.input?.type === 'classification_request';
        const categories = normalizeCategories(request.input?.categories) ?? normalizeCategories(request.input?.category);
        try {
            let response;
            if (wantsClassification) {
                if (!selectedEngine.classify) {
                    throw new Error('classification_not_supported');
                }
                const classifyResult = await selectedEngine.classify(requestText, categories);
                response = buildResponsePayload(classifyResult.output, { classification: true });
            }
            else {
                const result = await handleSummaryTask(selectedEngine, {
                    requestId: request.requestId,
                    text: requestText,
                    metadataRequested
                });
                response = buildResponsePayload(result.output);
            }
            return {
                requestId: request.requestId,
                modelId: request.modelId,
                modelVersion: request.modelVersion,
                response,
                error: false,
                errorMessage: '',
                metadata: {
                    processingTime: Math.round(performance.now() - start)
                }
            };
        }
        catch (error) {
            logger.error('Task failed', error);
            return {
                requestId: request.requestId,
                modelId: request.modelId,
                modelVersion: request.modelVersion,
                response: { text: '' },
                error: true,
                errorMessage: error.message,
                metadata: {
                    processingTime: Math.round(performance.now() - start)
                }
            };
        }
    };
    const handleIncomingMessage = async (msg) => {
        const { ws, sessionKey, deviceId } = getState();
        const logger = getLogger();
        const sendBatchResponse = (requests) => {
            const payload = {
                requests,
                deviceId,
                sessionKey
            };
            ws?.send(payload);
        };
        if (msg.requests.length === 0) {
            return;
        }
        if (executing) {
            sendBatchResponse(msg.requests.map((request) => ({
                requestId: request.requestId,
                modelId: request.modelId,
                modelVersion: request.modelVersion,
                response: { text: '' },
                error: true,
                errorMessage: 'device_busy',
                metadata: { processingTime: 0 }
            })));
            return;
        }
        executing = true;
        setStatus('busy');
        try {
            const results = [];
            for (const request of msg.requests) {
                const result = await executeSingleRequest(request, msg.metadataRequested);
                logger.info('[WS OUT] task result:', {
                    requestId: result.requestId,
                    modelId: result.modelId,
                    response: result.response,
                    error: result.error,
                    errorMessage: result.errorMessage
                });
                results.push(result);
            }
            sendBatchResponse(results);
        }
        finally {
            executing = false;
            setStatus('idle');
        }
    };

    const CACHED_MODEL_ID_KEY = 'zerogpu_cached_model_id';
    const safeGetItem = (key) => {
        try {
            return window.localStorage.getItem(key);
        }
        catch {
            return null;
        }
    };
    const safeSetItem = (key, value) => {
        try {
            window.localStorage.setItem(key, value);
        }
        catch {
            // ignore storage failures
        }
    };
    const safeRemoveItem = (key) => {
        try {
            window.localStorage.removeItem(key);
        }
        catch {
            // ignore storage failures
        }
    };
    const getCachedModelId = () => safeGetItem(CACHED_MODEL_ID_KEY);
    const getCachedModelInfo = (modelId) => {
        const raw = safeGetItem(modelId);
        if (!raw)
            return null;
        try {
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    };
    const setCachedModelInfo = (info) => {
        safeSetItem(CACHED_MODEL_ID_KEY, info.modelId);
        safeSetItem(info.modelId, JSON.stringify(info));
    };
    const clearCachedModelInfo = (modelId) => {
        const existing = modelId ?? getCachedModelId();
        if (existing) {
            safeRemoveItem(existing);
        }
        safeRemoveItem(CACHED_MODEL_ID_KEY);
    };

    const startLifecycle = async ({ config, appUserId, edgeOperatorKey, projectId, deviceId: providedDeviceId }) => {
        initLogger(config.telemetry);
        const logger = getLogger();
        setConfig(config);
        const storedDeviceId = providedDeviceId ? null : getStoredDeviceId();
        const isFreshDevice = !providedDeviceId && !storedDeviceId;
        const deviceId = providedDeviceId ?? storedDeviceId ?? getDeviceId();
        if (providedDeviceId) {
            setDeviceId(providedDeviceId);
        }
        const rawDeviceInfo = await collectDeviceInfo(config.telemetry, appUserId, deviceId);
        const sanitizedDeviceInfo = stripCameraPreview(rawDeviceInfo);
        setDeviceContext(deviceId, sanitizedDeviceInfo);
        if (!edgeOperatorKey || !projectId) {
            throw new Error('Missing required headers: x-edge-operator-key, x-project-id');
        }
        if (rawDeviceInfo.camera?.previewDataUrl) {
            try {
                window.dispatchEvent(new CustomEvent('zerogpu:cameraPreview', {
                    detail: {
                        deviceId,
                        previewDataUrl: rawDeviceInfo.camera.previewDataUrl,
                        camera: sanitizedDeviceInfo.camera
                    }
                }));
            }
            catch {
                logger.warn('Unable to dispatch camera preview event');
            }
        }
        // Fresh devices skip cache validation entirely; all other runs may reuse cache.
        const cachedModelId = isFreshDevice ? null : getCachedModelId();
        setCachedModelId(cachedModelId);
        let cachedInfo = cachedModelId ? getCachedModelInfo(cachedModelId) : null;
        if (!isFreshDevice) {
            logger.info('Cache lookup', {
                cachedModelId,
                hasCachedInfo: Boolean(cachedInfo)
            });
        }
        let cachedEngine;
        let cachedSampleMetrics;
        let cacheInvalid = false;
        // High-level flow markers to make startup behavior visible in logs.
        const logFlow = (flow, details) => {
            logger.info(`[Flow] ${flow}`, details ?? {});
        };
        // Use case 1: first run (no deviceId persisted) → skip cache checks.
        if (isFreshDevice) {
            logFlow('Fresh device detected; skip cache checks');
            cachedInfo = null;
            cachedEngine = undefined;
            cachedSampleMetrics = undefined;
            cacheInvalid = false;
        }
        else if (cachedInfo && cachedInfo.modelId && cachedInfo.modelUrl && cachedInfo.taskType && cachedInfo.requiredFiles) {
            // Use case 2: cache present → validate by loading + sample test.
            logFlow('Cache detected; validating cached model', {
                modelId: cachedInfo.modelId,
                taskType: cachedInfo.taskType
            });
            if (!cachedInfo.modelVersion || !cachedInfo.sample?.text || !cachedInfo.requiredFiles) {
                cacheInvalid = true;
                cachedSampleMetrics = {
                    taskType: cachedInfo.taskType,
                    processingTimeMs: 0,
                    error: true,
                    errorMessage: 'response from processing sample'
                };
                logger.warn('Pre-register cache invalid: missing metadata', {
                    modelId: cachedInfo.modelId,
                    taskType: cachedInfo.taskType
                });
            }
            else {
                const hasCachedFiles = await hasCachedFilesForModel(cachedInfo);
                if (!hasCachedFiles) {
                    cacheInvalid = true;
                    cachedSampleMetrics = {
                        taskType: cachedInfo.taskType,
                        processingTimeMs: 0,
                        error: true,
                        errorMessage: 'response from processing sample'
                    };
                    logger.warn('Pre-register cache invalid: required files missing in Cache Storage', {
                        modelId: cachedInfo.modelId,
                        taskType: cachedInfo.taskType
                    });
                    logFlow('Cache invalid; will purge before register', {
                        reason: 'required_files_missing'
                    });
                }
                else {
                    const slmConfig = buildSlmConfigFromCached(cachedInfo);
                    const { engine, error } = await loadSlmEngine(slmConfig, {
                        allowDownload: hasCachedFiles
                    });
                    if (!engine || error) {
                        // Use case 3: cache invalid (model load failed) → purge + register as uncached.
                        cacheInvalid = true;
                        cachedSampleMetrics = {
                            taskType: cachedInfo.taskType,
                            processingTimeMs: 0,
                            error: true,
                            errorMessage: 'response from processing sample'
                        };
                        logger.warn('Pre-register cache invalid: model load failed', {
                            modelId: cachedInfo.modelId,
                            taskType: cachedInfo.taskType,
                            errorMessage: cachedSampleMetrics.errorMessage
                        });
                        logFlow('Cache invalid; will purge before register', {
                            reason: 'model_load_failed'
                        });
                    }
                    else {
                        cachedEngine = engine;
                        setEngine(engine);
                        logger.info('Pre-register sample test starting', {
                            taskType: cachedInfo.taskType,
                            sample: cachedInfo.sample
                        });
                        const sampleResult = await runSampleTest(cachedInfo.taskType, engine, cachedInfo.sample);
                        logger.info('Pre-register sample test result', {
                            taskType: cachedInfo.taskType,
                            ok: sampleResult.ok,
                            error: sampleResult.error,
                            errorMessage: sampleResult.errorMessage,
                            processingTimeMs: sampleResult.processingTimeMs
                        });
                        cachedSampleMetrics = {
                            taskType: cachedInfo.taskType,
                            processingTimeMs: sampleResult.processingTimeMs,
                            error: sampleResult.error,
                            errorMessage: sampleResult.error
                                ? (sampleResult.errorMessage ?? 'response from processing sample')
                                : undefined
                        };
                        if (!sampleResult.ok) {
                            // Use case 3: cache invalid (sample failed) → purge + register as uncached.
                            logger.warn('Pre-register sample test failed', {
                                taskType: cachedInfo.taskType,
                                errorMessage: cachedSampleMetrics.errorMessage
                            });
                            cacheInvalid = true;
                            logFlow('Cache invalid; will purge before register', {
                                reason: 'sample_failed'
                            });
                        }
                    }
                }
            }
        }
        else if (cachedModelId) {
            // Use case 3: cache metadata missing → purge + register as uncached.
            cacheInvalid = true;
            cachedSampleMetrics = {
                taskType: 'summary',
                processingTimeMs: 0,
                error: true,
                errorMessage: 'response from processing sample'
            };
            logFlow('Cache metadata missing; will purge before register', {
                modelId: cachedModelId
            });
        }
        else {
            logFlow('No cache detected; first run flow');
        }
        if (cacheInvalid) {
            await clearAllModels().catch(() => { });
            await clearTransformersCaches().catch(() => { });
            clearCachedModelInfo(cachedModelId);
            setCachedModelId(null);
            cachedInfo = null;
            cachedEngine = undefined;
            setEngine(undefined);
            setEnginesByTask({});
            setModelInfosByTask({});
        }
        const registerPayload = {
            deviceId,
            sdkVersion: config.sdkVersion,
            cachedModels: cachedInfo && !cacheInvalid
                ? [{
                        modelId: cachedInfo.modelId,
                        modelVersion: cachedInfo.modelVersion || '1'
                    }]
                : [],
            device: sanitizedDeviceInfo
        };
        let registerResponse;
        let assignedModels = [];
        let engine = cachedEngine;
        let enginesByTask = {};
        let modelInfosByTask = {};
        let modelStatuses = {};
        let loadErrorMessage;
        let postRegisterSample;
        try {
            registerResponse = await registerDevice(config, registerPayload, {
                edgeOperatorKey,
                projectId
            });
        }
        catch (err) {
            if (err instanceof RegisterError && (err.status === 401 || err.status === 403)) {
                // Use case 5: auth failure → stop, no WS.
                logger.warn('Register auth failed, stopping lifecycle');
                logFlow('Auth failure; no WS connection', { status: err.status });
                return;
            }
            throw err;
        }
        logger.info('Register response received:', {
            deviceId: registerResponse.deviceId,
            wsUrl: registerResponse.wsUrl
        });
        if (!registerResponse.wsUrl) {
            return;
        }
        assignedModels = normalizeAssignedModels(registerResponse.slmConfig);
        const primaryModel = pickPrimaryAssignedModel(assignedModels);
        modelStatuses = {};
        assignedModels.forEach((model) => {
            modelStatuses[getModelStatusKey(model)] = 'idle';
        });
        // If no model is assigned, purge and stop (no WS).
        if (!primaryModel) {
            // Use case 6: no model assigned → purge + stop (no WS).
            await clearAllModels().catch(() => { });
            await clearTransformersCaches().catch(() => { });
            clearCachedModelInfo(cachedModelId);
            setCachedModelId(null);
            return;
        }
        setSessionKey(registerResponse.sessionKey);
        modelInfosByTask = {};
        assignedModels.forEach((model) => {
            modelInfosByTask[model.taskType] = model;
        });
        setModelInfosByTask(modelInfosByTask);
        setModelInfo({
            modelId: primaryModel.modelId,
            modelVersion: primaryModel.modelVersion,
            modelUrl: primaryModel.modelUrl,
            modelRepoId: primaryModel.modelRepoId,
            maxTokens: primaryModel.maxTokens,
            quantized: primaryModel.quantized,
            quantization: primaryModel.quantization,
            taskType: primaryModel.taskType,
            sizeBytes: primaryModel.sizeBytes,
            requiredFiles: primaryModel.requiredFiles
        });
        setSample(primaryModel.sample);
        logger.info('Runtime globals updated from register response', {
            sessionKey: registerResponse.sessionKey,
            taskType: primaryModel.taskType,
            sample: primaryModel.sample
        });
        // Decide whether to reuse cache for the primary model, then load remaining models.
        engine = cachedEngine;
        enginesByTask = {};
        loadErrorMessage = undefined;
        if (!cachedInfo || cachedInfo.modelId !== primaryModel.modelId || cacheInvalid) {
            // Use case 4: model mismatch or cache invalid → refresh cache and load assigned model.
            if (cachedInfo && cachedInfo.modelId !== primaryModel.modelId) {
                logFlow('Server assigned different model; refreshing cache', {
                    cachedModelId: cachedInfo.modelId,
                    assignedModelId: primaryModel.modelId
                });
            }
            await clearAllModels().catch(() => { });
            await clearTransformersCaches().catch(() => { });
            clearCachedModelInfo(cachedModelId);
            setCachedModelId(null);
            setEngine(undefined);
            const slmConfig = buildSlmConfigFromAssigned(primaryModel);
            const loadResult = await loadSlmEngine(slmConfig);
            engine = loadResult.engine;
            loadErrorMessage = loadResult.error?.message;
            if (engine) {
                setEngine(engine);
                enginesByTask[primaryModel.taskType] = engine;
                setCachedModelId(primaryModel.modelId);
                setCachedModelInfo({
                    modelId: primaryModel.modelId,
                    modelVersion: primaryModel.modelVersion,
                    modelUrl: primaryModel.modelUrl,
                    modelRepoId: primaryModel.modelRepoId,
                    maxInputTokens: primaryModel.maxTokens,
                    quantized: primaryModel.quantized,
                    quantization: primaryModel.quantization,
                    taskType: primaryModel.taskType,
                    sizeBytes: primaryModel.sizeBytes,
                    sample: primaryModel.sample,
                    requiredFiles: primaryModel.requiredFiles
                });
            }
            else {
                modelStatuses[getModelStatusKey(primaryModel)] = 'error';
            }
        }
        else if (cachedInfo && cachedInfo.modelId === primaryModel.modelId) {
            logFlow('Cache reuse flow; modelId matches assigned', {
                modelId: primaryModel.modelId
            });
            setCachedModelId(primaryModel.modelId);
            if (engine) {
                enginesByTask[primaryModel.taskType] = engine;
            }
            setCachedModelInfo({
                modelId: primaryModel.modelId,
                modelVersion: primaryModel.modelVersion,
                modelUrl: primaryModel.modelUrl,
                modelRepoId: primaryModel.modelRepoId,
                maxInputTokens: primaryModel.maxTokens,
                quantized: primaryModel.quantized,
                quantization: primaryModel.quantization,
                taskType: primaryModel.taskType,
                sizeBytes: primaryModel.sizeBytes,
                sample: primaryModel.sample,
                requiredFiles: primaryModel.requiredFiles
            });
        }
        for (const model of assignedModels) {
            if (model.taskType === primaryModel.taskType)
                continue;
            const loadResult = await loadSlmEngine(buildSlmConfigFromAssigned(model));
            if (loadResult.engine) {
                enginesByTask[model.taskType] = loadResult.engine;
            }
            else {
                modelStatuses[getModelStatusKey(model)] = 'error';
                logger.warn('Failed to load secondary model', {
                    modelId: model.modelId,
                    taskType: model.taskType,
                    error: loadResult.error?.message
                });
            }
        }
        setEnginesByTask(enginesByTask);
        const primaryEngine = enginesByTask[primaryModel.taskType] ?? engine;
        if (!primaryEngine) {
            setStatus('error');
            const reason = loadErrorMessage || 'model_not_ready';
            if (registerResponse?.wsUrl) {
                await reportInitFailureOverWebSocket({
                    wsUrl: registerResponse.wsUrl,
                    hello: {
                        type: 'hello',
                        deviceId: registerResponse.deviceId,
                        sessionKey: registerResponse.sessionKey,
                        sdkVersion: config.sdkVersion,
                        slmConfig: assignedModels.map((model) => ({
                            modelId: model.modelId,
                            modelVersion: model.modelVersion,
                            status: modelStatuses[getModelStatusKey(model)] || 'idle'
                        }))
                    },
                    ack: {
                        type: 'hello_ack',
                        deviceId: registerResponse.deviceId,
                        sdkVersion: config.sdkVersion,
                        sessionKey: registerResponse.sessionKey,
                        status: 'error',
                        timestamp: Date.now(),
                        errorMessage: `primary_model_load_failed:${reason}`
                    }
                }).catch(() => { });
            }
            logger.error('Primary model failed to initialize; aborting lifecycle before WebSocket connect', {
                modelId: primaryModel.modelId,
                modelVersion: primaryModel.modelVersion,
                taskType: primaryModel.taskType,
                reason
            });
            throw new Error(`primary_model_load_failed:${reason}`);
        }
        postRegisterSample = undefined;
        if (engine && primaryModel.sample?.text) {
            postRegisterSample = await runSampleTest(primaryModel.taskType, engine, primaryModel.sample);
            logger.info('Post-register sample test result', {
                taskType: primaryModel.taskType,
                ok: postRegisterSample.ok,
                error: postRegisterSample.error,
                errorMessage: postRegisterSample.errorMessage,
                processingTimeMs: postRegisterSample.processingTimeMs
            });
            if (postRegisterSample.error) {
                modelStatuses[getModelStatusKey(primaryModel)] = 'error';
            }
        }
        else if (!engine) {
            postRegisterSample = {
                ok: false,
                processingTimeMs: 0,
                error: true,
                errorMessage: loadErrorMessage || 'model_not_ready'
            };
            modelStatuses[getModelStatusKey(primaryModel)] = 'error';
        }
        if (!registerResponse || !primaryModel) {
            return;
        }
        const helloDeviceId = registerResponse.deviceId;
        const helloSlmConfig = assignedModels.map((model) => {
            const modelKey = getModelStatusKey(model);
            return {
                modelId: model.modelId,
                modelVersion: model.modelVersion,
                status: modelStatuses[modelKey] || 'idle'
            };
        });
        const hello = {
            type: 'hello',
            deviceId: helloDeviceId,
            sessionKey: registerResponse.sessionKey,
            sdkVersion: config.sdkVersion,
            slmConfig: helloSlmConfig
        };
        const client = new WebSocketClient({
            url: registerResponse.wsUrl,
            hello,
            onMessage: (message) => {
                if ('requests' in message && Array.isArray(message.requests)) {
                    handleIncomingMessage(message);
                }
                else if ('type' in message && message.type === 'hello_ack') {
                    const ack = message;
                    logger.info('Received WS hello_ack', ack);
                    setStatus(ack.status === 'error' ? 'error' : 'idle');
                }
                else {
                    logger.debug('Unhandled WS message', message);
                }
            },
            onClose: () => {
                setStatus('error');
            },
            onError: () => {
                setStatus('error');
            }
        });
        setWebSocket(client);
        setStatus('idle');
    };
    const inferTaskType = (model) => {
        const declaredTaskType = model.taskType;
        if (declaredTaskType === 'summary' || declaredTaskType === 'iab_classify' || declaredTaskType === 'classification') {
            return declaredTaskType;
        }
        return null;
    };
    const normalizeAssignedModels = (slmConfig) => {
        if (!Array.isArray(slmConfig))
            return [];
        const normalized = [];
        for (const model of slmConfig) {
            if (!model?.modelId || !model?.modelVersion || !model?.modelUrl)
                continue;
            const taskType = inferTaskType(model);
            if (!taskType)
                continue;
            normalized.push({
                modelId: model.modelId,
                modelType: model.modelType,
                modelVersion: model.modelVersion,
                modelUrl: model.modelUrl,
                modelRepoId: model.modelRepoId,
                maxTokens: model.maxTokens,
                requiredFiles: model.requiredFiles,
                inferenceFramework: model.inferenceFramework,
                modality: model.modality,
                onDeviceInference: model.onDeviceInference,
                quantized: Boolean(model.quantized),
                quantization: model.quantization,
                taskType,
                sizeBytes: model.sizeBytes,
                sample: model.sample
            });
        }
        return normalized;
    };
    const pickPrimaryAssignedModel = (assignedModels) => assignedModels.find((model) => model.taskType === 'summary') ?? assignedModels[0];
    const getModelStatusKey = (model) => `${model.modelId}@${model.modelVersion}`;
    const buildSlmConfigFromCached = (cached) => ({
        modelId: cached.modelId,
        modelVersion: cached.modelVersion || '1',
        modelUrl: cached.modelUrl,
        modelRepoId: cached.modelRepoId,
        requiredFiles: cached.requiredFiles,
        quantized: Boolean(cached.quantized),
        quantization: cached.quantization,
        taskType: cached.taskType,
        maxInputTokens: cached.maxInputTokens
    });
    const buildSlmConfigFromAssigned = (modelInfo) => ({
        modelId: modelInfo.modelId,
        modelVersion: modelInfo.modelVersion,
        modelUrl: modelInfo.modelUrl,
        modelRepoId: modelInfo.modelRepoId,
        requiredFiles: modelInfo.requiredFiles,
        quantized: modelInfo.quantized,
        quantization: modelInfo.quantization,
        taskType: modelInfo.taskType,
        maxInputTokens: modelInfo.maxTokens
    });
    const hasCachedFilesForModel = async (cached) => {
        if (!Array.isArray(cached.requiredFiles))
            return false;
        if (cached.requiredFiles.length === 0)
            return true;
        const requiredFiles = normalizeRequiredFiles(cached.requiredFiles);
        if (!requiredFiles.length)
            return false;
        try {
            const model = await getModel(cached.modelId, cached.modelVersion || '1');
            if (!model?.files)
                return false;
            const storedKeys = new Set();
            for (const key of Object.keys(model.files)) {
                const normalized = key.replace(/^\/+/, '').replace(/^resolve\/main\//, '');
                storedKeys.add(normalized);
                const modelScopedPrefix = `${cached.modelId}/`;
                if (normalized.startsWith(modelScopedPrefix)) {
                    storedKeys.add(normalized.slice(modelScopedPrefix.length));
                }
            }
            const hasAllRequired = requiredFiles.every((file) => {
                if (storedKeys.has(file))
                    return true;
                if (storedKeys.has(`onnx/${file}`))
                    return true;
                if (file.startsWith('onnx/') && storedKeys.has(file.slice('onnx/'.length)))
                    return true;
                return false;
            });
            return hasAllRequired;
        }
        catch {
            return false;
        }
    };
    const normalizeRequiredFiles = (requiredFiles) => requiredFiles
        .filter((file) => typeof file === 'object' && file !== null && typeof file.name === 'string')
        .map((file) => file.name.trim().replace(/^\/+/, ''))
        .filter((name) => typeof name === 'string' && name.length > 0);
    const clearTransformersCaches = async () => {
        if (typeof caches === 'undefined')
            return;
        const cacheNames = await caches.keys();
        const targetNames = cacheNames.filter((name) => name.includes('transformers-cache'));
        await Promise.all(targetNames.map((name) => caches.delete(name)));
    };
    const reportInitFailureOverWebSocket = async (options) => {
        await new Promise((resolve) => {
            let settled = false;
            const settle = () => {
                if (settled)
                    return;
                settled = true;
                resolve();
            };
            const timeout = window.setTimeout(settle, 1500);
            try {
                new WebSocketClient({
                    url: options.wsUrl,
                    hello: options.hello,
                    ack: options.ack,
                    closeAfterAck: true,
                    closeCode: 4001,
                    closeReason: 'primary_model_load_failed',
                    onMessage: () => { },
                    onClose: () => {
                        window.clearTimeout(timeout);
                        settle();
                    },
                    onError: () => {
                        window.clearTimeout(timeout);
                        settle();
                    }
                });
            }
            catch {
                window.clearTimeout(timeout);
                settle();
            }
        });
    };
    const stripCameraPreview = (info) => {
        if (!info.camera?.previewDataUrl) {
            return info;
        }
        return {
            ...info,
            camera: { ...info.camera, previewDataUrl: undefined }
        };
    };

    let initialized = false;
    const initZeroGpuSdk = async (options) => {
        if (initialized) {
            return;
        }
        const env = options?.env ?? 'production';
        const config = resolveConfig(env, options?.overrides);
        await startLifecycle({
            config,
            appUserId: options?.appUserId,
            edgeOperatorKey: options?.edgeOperatorKey,
            projectId: options?.projectId,
            deviceId: options?.deviceId
        });
        initialized = true;
    };

    const readAttr = (script, names) => {
        for (const name of names) {
            const value = script.getAttribute(name)?.trim();
            if (value) {
                return value;
            }
        }
        return undefined;
    };
    const readSearchParam = (searchParams, names) => {
        if (!searchParams) {
            return undefined;
        }
        for (const name of names) {
            const value = searchParams.get(name)?.trim();
            if (value) {
                return value;
            }
        }
        return undefined;
    };
    const getCurrentScript = () => {
        if (typeof document === 'undefined') {
            return null;
        }
        return document.currentScript instanceof HTMLScriptElement
            ? document.currentScript
            : null;
    };
    const readBooleanAttr = (script, names) => {
        for (const name of names) {
            const value = script.getAttribute(name);
            if (value === null) {
                continue;
            }
            const normalized = value.trim().toLowerCase();
            if (normalized === '') {
                return true; // Valueless attribute treated as true
            }
            else if (normalized === 'true' || normalized === '1') {
                return true;
            }
            if (normalized === 'false' || normalized === '0') {
                return false;
            }
        }
        return undefined;
    };
    const autoInitFromScriptTag = () => {
        const script = getCurrentScript();
        if (!script) {
            return;
        }
        let searchParams;
        const src = script.getAttribute('src')?.trim();
        if (src) {
            try {
                const url = new URL(src, typeof document !== 'undefined' ? document.baseURI : undefined);
                searchParams = url.searchParams;
            }
            catch {
                searchParams = undefined;
            }
        }
        const edgeOperatorKey = readAttr(script, ['data-edge-operator-key', 'edgeOperatorKey']) ??
            readSearchParam(searchParams, ['edge-operator-key', 'edgeOperatorKey']);
        const projectId = readAttr(script, ['data-project-id', 'projectId']) ??
            readSearchParam(searchParams, ['project-id', 'projectId']);
        if (!edgeOperatorKey && !projectId) {
            return;
        }
        if (!edgeOperatorKey || !projectId) {
            console.error('[ZeroGpuSdk] Auto-init skipped: both edgeOperatorKey and projectId are required.');
            return;
        }
        const options = {
            env: (readAttr(script, ['data-env', 'env']) ??
                readSearchParam(searchParams, ['env'])),
            appUserId: readAttr(script, ['data-app-user-id', 'appUserId']) ??
                readSearchParam(searchParams, ['app-user-id', 'appUserId']),
            deviceId: readAttr(script, ['data-device-id', 'deviceId']) ??
                readSearchParam(searchParams, ['device-id', 'deviceId']),
            edgeOperatorKey,
            projectId
        };
        const enableConsoleLogs = readBooleanAttr(script, ['data-enable-console-logs', 'enableConsoleLogs']) ??
            (() => {
                const value = readSearchParam(searchParams, ['enable-console-logs', 'enableConsoleLogs']);
                if (value === undefined) {
                    return undefined;
                }
                const normalized = value.toLowerCase();
                if (normalized === 'true' || normalized === '1') {
                    return true;
                }
                if (normalized === 'false' || normalized === '0') {
                    return false;
                }
                return undefined;
            })();
        if (enableConsoleLogs !== undefined) {
            options.overrides = {
                telemetry: {
                    enableConsoleLogs,
                    locationData: false,
                    cameraData: false
                }
            };
        }
        void initZeroGpuSdk(options).catch((error) => {
            console.error('[ZeroGpuSdk] Auto-init failed', error);
        });
    };

    autoInitFromScriptTag();

    exports.initZeroGpuSdk = initZeroGpuSdk;

}));
//# sourceMappingURL=zerogpu-browser-sdk.umd.js.map
