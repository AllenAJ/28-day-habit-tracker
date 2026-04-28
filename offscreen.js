import { pipeline, env as transformersEnv } from './vendor/transformers.min.js';

const DEFAULT_SDK_CONFIG = {
  edgeOperatorKey: "zgpu-sdk-15246973c1b0b8f74b9f95c6a11b9489684ba03268cc2fbd90cfa9a38c03311a",
  projectId: "22e05ad5-348d-45c1-ac83-6482646f103a",
  env: "production",
};

const sdkDebugState = {
  status: "idle",
  initialized: false,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastErrorMessage: "",
  env: DEFAULT_SDK_CONFIG.env,
};

function loadTransformersRuntime() {
  if (window.TransformersPipeline) return;

  if (typeof pipeline !== "function" || !transformersEnv) {
    throw new Error("transformers module missing pipeline/env exports");
  }

  transformersEnv.allowLocalModels = true;
  transformersEnv.allowRemoteModels = true;

  const wasmDir = chrome.runtime.getURL("vendor/");
  if (transformersEnv?.backends?.onnx?.wasm) {
    transformersEnv.backends.onnx.wasm.wasmPaths = wasmDir;
  }
  if (transformersEnv?.backends?.onnx?.env) {
    transformersEnv.backends.onnx.env.logLevel = "warning";
  }
  if ("logLevel" in transformersEnv) {
    transformersEnv.logLevel = "warning";
  }

  window.TransformersPipeline = pipeline;
  window.TransformersEnv = transformersEnv;
  console.log("[offscreen] Transformers runtime loaded from local bundle.");
}

async function initSdk(configOverride) {
  const config = configOverride || DEFAULT_SDK_CONFIG;

  sdkDebugState.status = "initializing";
  sdkDebugState.lastAttemptAt = new Date().toISOString();
  sdkDebugState.env = config.env;

  try {
    loadTransformersRuntime();

    const sdkGlobal = window.ZeroGpuBrowserSdk || window.ZeroGpuSdk;
    if (!sdkGlobal || typeof sdkGlobal.initZeroGpuSdk !== "function") {
      sdkDebugState.status = "error";
      sdkDebugState.initialized = false;
      sdkDebugState.lastErrorAt = new Date().toISOString();
      sdkDebugState.lastErrorMessage = "SDK global not found on window after script load.";
      console.error("[offscreen] SDK global not found on window after script load.");
      return;
    }

    await sdkGlobal.initZeroGpuSdk({
      env: config.env,
      edgeOperatorKey: config.edgeOperatorKey,
      projectId: config.projectId,
      overrides: {
        telemetry: {
          enableConsoleLogs: true,
        },
      },
    });
    sdkDebugState.status = "running";
    sdkDebugState.initialized = true;
    sdkDebugState.lastSuccessAt = new Date().toISOString();
    sdkDebugState.lastErrorMessage = "";
    console.log("[offscreen] ZeroGPU SDK initialized successfully.");
  } catch (error) {
    sdkDebugState.status = "error";
    sdkDebugState.initialized = false;
    sdkDebugState.lastErrorAt = new Date().toISOString();
    sdkDebugState.lastErrorMessage = error && error.message ? error.message : String(error);
    console.error("[offscreen] ZeroGPU SDK init failed:", error);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "zerogpu:getStatus") {
    sendResponse({ ok: true, state: sdkDebugState });
    return;
  }

  if (message.type === "zerogpu:forceInit") {
    void initSdk(message.config || null)
      .then(() => sendResponse({ ok: true, state: sdkDebugState }))
      .catch((error) =>
        sendResponse({
          ok: false,
          state: sdkDebugState,
          error: error && error.message ? error.message : String(error),
        })
      );
    return true;
  }
});

void initSdk();
