const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const DEFAULT_SDK_STATE = {
  status: "idle",
  initialized: false,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastErrorMessage: "",
  env: "production",
};

let creatingOffscreen = null;

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  });

  if (existingContexts.length > 0) {
    return;
  }

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ["WORKERS"],
    justification: "Run ZeroGPU Browser SDK which requires window/DOM context.",
  });

  await creatingOffscreen;
  creatingOffscreen = null;
}

async function hasOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  });
  return existingContexts.length > 0;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "zerogpu:getStatus") {
    void hasOffscreenDocument()
      .then((exists) => {
        if (!exists) {
          sendResponse({ ok: true, state: DEFAULT_SDK_STATE });
          return;
        }
        return chrome.runtime.sendMessage(message).then((response) => sendResponse(response));
      })
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : String(error),
        })
      );
    return true;
  }

  if (message.type === "zerogpu:forceInit") {
    void ensureOffscreenDocument()
      .then(() => chrome.runtime.sendMessage(message))
      .then((response) => sendResponse(response))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : String(error),
        })
      );
    return true;
  }

  if (message.type === "zerogpu:disable") {
    void hasOffscreenDocument()
      .then(async (exists) => {
        if (exists) {
          await chrome.offscreen.closeDocument();
        }
        sendResponse({ ok: true });
      })
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : String(error),
        })
      );
    return true;
  }
});
