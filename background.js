const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "zerogpu:getStatus" || message.type === "zerogpu:forceInit") {
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
});

chrome.runtime.onInstalled.addListener(() => {
  void ensureOffscreenDocument();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureOffscreenDocument();
});

void ensureOffscreenDocument();
