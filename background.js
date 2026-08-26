const DEFAULTS = {
  model: "gpt-4o-mini",
  defaultAction: "correct",
  language: "auto",
  preserveMeaning: true,
  preview: false
};


/* ============================================================
   SETTINGS
   ============================================================ */

async function settings() {
  const data = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...data };
}


/* ============================================================
   API KEY
   ============================================================ */

async function getKey() {
  const data = await chrome.storage.local.get("apiKey");

  /*
   * Convert to string and remove invisible / invalid characters.
   *
   * HTTP headers only accept ISO-8859-1-compatible characters.
   * OpenAI API keys themselves are ASCII, so removing accidental
   * Unicode characters here is safe.
   */

  let key = String(data.apiKey || "");

  key = key
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\r\n\t]/g, "")
    .replace(/[^\x00-\x7F]/g, "")
    .trim();

  return key;
}


/* ============================================================
   CONTEXT MENU
   ============================================================ */

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();

  await chrome.contextMenus.create({
    id: "gpt-root",
    title: "✨ GPT Text Corrector",
    contexts: ["selection"]
  });

  for (const [id, title] of [
    ["correct", "✨ Correct"],
    ["professional", "💼 Professional"],
    ["casual", "😊 Casual"],
    ["shorten", "✂️ Shorten"],
    ["improve", "🧠 Improve"],
    ["translate", "🌍 Translate"]
  ]) {
    await chrome.contextMenus.create({
      id,
      parentId: "gpt-root",
      title,
      contexts: ["selection"]
    });
  }
});


/* ============================================================
   CONTEXT MENU ACTION
   ============================================================ */

chrome.contextMenus.onClicked.addListener(
  async (info, tab) => {
    if (!tab?.id) return;

    const action = info.menuItemId;

    if (
      [
        "correct",
        "professional",
        "casual",
        "shorten",
        "improve",
        "translate"
      ].includes(action)
    ) {
      await ensureAndSend(
        tab.id,
        "GPT_DO_ACTION",
        { action }
      );
    }
  }
);


/* ============================================================
   KEYBOARD COMMANDS
   ============================================================ */

chrome.commands.onCommand.addListener(
  async (command) => {
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    const tab = tabs[0];

    if (!tab?.id) return;

    if (command === "correct-selection") {
      await ensureAndSend(
        tab.id,
        "GPT_DO_ACTION",
        {
          action: "correct"
        }
      );
    }

    if (command === "open-actions") {
      await ensureAndSend(
        tab.id,
        "GPT_OPEN_ACTIONS"
      );
    }
  }
);


/* ============================================================
   MESSAGE HANDLER
   ============================================================ */

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {

    /*
     * ----------------------------------------------------------
     * GET STATUS
     * ----------------------------------------------------------
     */

    if (message?.type === "GET_STATUS") {
      (async () => {
        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true
        });

        const tab = tabs[0];

        const key = await getKey();

        let selection = false;
        let available = false;

        if (tab?.id) {
          try {
            const result = await ensureAndSend(
              tab.id,
              "GPT_GET_SELECTION"
            );

            selection = !!result?.hasSelection;
            available = true;

          } catch {
            selection = false;
            available = false;
          }
        }

        sendResponse({
          hasKey: !!key,
          hasSelection: selection,
          available
        });
      })();

      return true;
    }


    /*
     * ----------------------------------------------------------
     * POPUP ACTION
     * ----------------------------------------------------------
     */

    if (message?.type === "POPUP_ACTION") {
      (async () => {
        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true
        });

        if (!tabs[0]?.id) {
          throw new Error("No active tab.");
        }

        const result = await ensureAndSend(
          tabs[0].id,
          "GPT_DO_ACTION",
          {
            action: message.action
          }
        );

        sendResponse(
          result || {
            ok: true
          }
        );

      })().catch((error) => {
        sendResponse({
          ok: false,
          error: friendly(error)
        });
      });

      return true;
    }


    /*
     * ----------------------------------------------------------
     * NATIVE RICH-TEXT REPLACEMENT
     * ----------------------------------------------------------
     */

    if (message?.type === "GPT_NATIVE_REPLACE") {
      (async () => {
        if (!sender?.tab?.id) {
          throw new Error("No active tab.");
        }

        await nativeReplace(
          sender.tab.id,
          String(message.text || "")
        );

        sendResponse({ ok: true });
      })().catch((error) => {
        sendResponse({
          ok: false,
          error: friendly(error)
        });
      });

      return true;
    }


    /*
     * ----------------------------------------------------------
     * GPT REQUEST
     * ----------------------------------------------------------
     */

    if (message?.type === "GPT_CORRECT") {
      runGPT(
        message.text,
        message.action,
        message.customPrompt
      )
        .then((text) => {
          sendResponse({
            ok: true,
            text
          });
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error.message
          });
        });

      return true;
    }
  }
);


/* ============================================================
   SEND MESSAGE TO CONTENT SCRIPT
   ============================================================ */

async function ensureAndSend(
  tabId,
  type,
  payload = {}
) {

  /*
   * First try the content script already running
   * in the main page.
   */

  try {
    return await chrome.tabs.sendMessage(
      tabId,
      {
        type,
        ...payload
      }
    );

  } catch (firstError) {

    /*
     * If the content script isn't available, inject ONE
     * instance into the main page only.
     *
     * IMPORTANT:
     * allFrames is FALSE.
     */

    await chrome.scripting.executeScript({
      target: {
        tabId,
        allFrames: false
      },
      files: ["content.js"]
    });


    /*
     * Give content.js a moment to initialize.
     */

    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });


    /*
     * Try again.
     */

    return await chrome.tabs.sendMessage(
      tabId,
      {
        type,
        ...payload
      }
    );
  }
}


/* ============================================================
   NATIVE RICH-TEXT REPLACEMENT

   X / LinkedIn / Discord and similar editors keep internal
   state that can be broken by direct DOM changes or execCommand.

   Chrome's DevTools Protocol Input domain lets us send an actual
   Backspace key operation followed by text input to the focused
   page. The site's editor therefore receives its normal keyboard
   and input pipeline instead of us editing its DOM.
   ============================================================ */

async function nativeReplace(tabId, text) {
  if (!text) {
    throw new Error("GPT returned empty text.");
  }

  let attached = false;

  try {
    await chrome.debugger.attach(
      { tabId },
      "1.3"
    );

    attached = true;

    // Delete the currently selected text using the browser's
    // native Backspace editing path. The content script restores
    // the original selection before requesting this operation.
    await chrome.debugger.sendCommand(
      { tabId },
      "Input.dispatchKeyEvent",
      {
        type: "keyDown",
        key: "Backspace",
        code: "Backspace",
        windowsVirtualKeyCode: 8,
        nativeVirtualKeyCode: 8
      }
    );

    await chrome.debugger.sendCommand(
      { tabId },
      "Input.dispatchKeyEvent",
      {
        type: "keyUp",
        key: "Backspace",
        code: "Backspace",
        windowsVirtualKeyCode: 8,
        nativeVirtualKeyCode: 8
      }
    );

    // Insert the GPT result through the browser input pipeline.
    await chrome.debugger.sendCommand(
      { tabId },
      "Input.insertText",
      { text }
    );

  } finally {
    if (attached) {
      try {
        await chrome.debugger.detach({ tabId });
      } catch {}
    }
  }
}


/* ============================================================
   FRIENDLY ERROR MESSAGES
   ============================================================ */

function friendly(error) {
  const message = String(
    error?.message ||
    error ||
    ""
  );

  if (
    message.includes("Receiving end") ||
    message.includes("Could not establish connection")
  ) {
    return "Refresh this page once and try again.";
  }

  return (
    message ||
    "Could not connect to this page."
  );
}


/* ============================================================
   GPT ACTIONS
   ============================================================ */

const ACTIONS = {
  correct:
    "Correct grammar, spelling, punctuation, and unnatural phrasing.",

  professional:
    "Rewrite this to sound professional, polished, and natural.",

  casual:
    "Rewrite this to sound friendly, casual, and natural.",

  shorten:
    "Make this shorter while preserving the important meaning.",

  improve:
    "Improve clarity and flow while preserving the meaning and tone.",

  translate:
    "Translate this text to the user's target language. If no target language is provided, infer the most likely intended language from context."
};


/* ============================================================
   OPENAI REQUEST
   ============================================================ */

async function runGPT(
  text,
  action = "correct",
  customPrompt = ""
) {

  const key = await getKey();

  if (!key) {
    throw new Error(
      "Add your OpenAI API key in Settings."
    );
  }


  /*
   * Extra safety:
   * API keys should be ASCII.
   */

  if (/[^\x00-\x7F]/.test(key)) {
    throw new Error(
      "Your API key contains an invalid character. Please paste your API key again."
    );
  }


  const s = await settings();

  const instruction =
    customPrompt?.trim() ||
    ACTIONS[action] ||
    ACTIONS.correct;


  const lang =
    s.language === "auto"
      ? "Automatically detect the source language and preserve it unless the instruction requires translation."
      : `Write the result in ${s.language}.`;


  const preserve =
    s.preserveMeaning
      ? "Preserve the user's intended meaning. Do not invent facts."
      : "You may make reasonable wording changes.";


  const system =
    `You are a concise writing assistant. ` +
    `${instruction} ` +
    `${lang} ` +
    `${preserve} ` +
    `Return ONLY the final text. ` +
    `No explanation, no quotes around it.`;


  /* ==========================================================
     OPENAI API REQUEST
     ========================================================== */

  const response = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`
      },

      body: JSON.stringify({
        model: s.model,

        messages: [
          {
            role: "system",
            content: system
          },
          {
            role: "user",
            content: text
          }
        ],

        max_tokens: 1600,

        ...(s.model.startsWith("gpt-5")
          ? {}
          : {
              temperature: 0.2
            })
      })
    }
  );


  /* ==========================================================
     PROCESS RESPONSE
     ========================================================== */

  const raw = await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      "OpenAI returned an invalid response."
    );
  }


  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      `OpenAI API error (${response.status})`
    );
  }


  const output =
    data?.choices?.[0]?.message?.content?.trim();

  if (!output) {
    throw new Error(
      "OpenAI returned no text."
    );
  }


  return output;
}
