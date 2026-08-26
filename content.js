(() => {
  if (window.__GPT_TEXT_CORRECTOR_V11__) return;
  window.__GPT_TEXT_CORRECTOR_V11__ = true;

  let lastEditable = null;
  let lastInputStart = 0;
  let lastInputEnd = 0;
  let lastRange = null;
  let lastSelectedText = "";
  let busy = false;

  const isInput = (el) => {
    if (!el) return false;

    if (el.tagName === "TEXTAREA") return true;

    if (el.tagName === "INPUT") {
      return [
        "text",
        "search",
        "email",
        "url"
      ].includes((el.type || "").toLowerCase());
    }

    return false;
  };

  function findEditable(node) {
    if (!node) return null;

    if (node.nodeType === Node.TEXT_NODE) {
      node = node.parentElement;
    }

    if (!node) return null;

    if (
      isInput(node) ||
      node.isContentEditable ||
      node.getAttribute?.("contenteditable") === "true" ||
      node.getAttribute?.("role") === "textbox"
    ) {
      return node;
    }

    return (
      node.closest?.(
        [
          "textarea",
          'input[type="text"]',
          'input[type="search"]',
          'input[type="email"]',
          'input[type="url"]',
          '[contenteditable="true"]',
          '[contenteditable=""]',
          '[role="textbox"]'
        ].join(",")
      ) || null
    );
  }

  /*
   * Capture the user's current selection.
   *
   * IMPORTANT:
   * This function is used while the user is interacting with
   * the webpage. Once an action starts, the saved selection
   * becomes locked and is NOT replaced by the popup losing focus.
   */
  function captureSelection() {
    const active = findEditable(document.activeElement);

    /*
     * INPUT / TEXTAREA
     */
    if (active && isInput(active)) {
      const start = active.selectionStart ?? 0;
      const end = active.selectionEnd ?? 0;

      if (start !== end) {
        lastEditable = active;
        lastInputStart = start;
        lastInputEnd = end;
        lastSelectedText = active.value.substring(start, end);
        lastRange = null;

        return true;
      }
    }

    /*
     * CONTENTEDITABLE
     */
    const selection = window.getSelection();

    if (
      selection &&
      selection.rangeCount > 0 &&
      !selection.isCollapsed
    ) {
      const range = selection.getRangeAt(0);

      const editable = findEditable(
        range.commonAncestorContainer
      );

      if (editable) {
        lastEditable = editable;
        lastRange = range.cloneRange();
        lastSelectedText = range.toString();

        return true;
      }
    }

    return false;
  }

  /*
   * Continuously remember a valid selection.
   *
   * If selection becomes collapsed later, DO NOT erase the
   * previous valid selection. This is important because opening
   * the Chrome popup can change focus/selection state.
   */

  document.addEventListener(
    "selectionchange",
    () => {
      if (!busy) {
        const selection = window.getSelection();

        if (
          selection &&
          selection.rangeCount > 0 &&
          !selection.isCollapsed
        ) {
          captureSelection();
        }
      }
    },
    true
  );

  document.addEventListener(
    "mouseup",
    () => {
      if (!busy) {
        setTimeout(() => {
          captureSelection();
        }, 0);
      }
    },
    true
  );

  document.addEventListener(
    "keyup",
    () => {
      if (!busy) {
        setTimeout(() => {
          captureSelection();
        }, 0);
      }
    },
    true
  );

  /*
   * ------------------------------------------------------------
   * MESSAGE HANDLING
   * ------------------------------------------------------------
   */

  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {

      /*
       * Return the selection we already captured.
       *
       * DO NOT recapture here because the popup may already
       * have taken focus away from the page.
       */
      if (message?.type === "GPT_GET_SELECTION") {
        sendResponse({
          ok: true,
          hasSelection: !!lastSelectedText.trim()
        });

        return;
      }

      /*
       * Action requested.
       *
       * IMPORTANT:
       * We intentionally DO NOT call captureSelection().
       */
      if (message?.type === "GPT_DO_ACTION") {
        doAction(message.action || "correct")
          .then(sendResponse);

        return true;
      }
    }
  );

  /*
   * ------------------------------------------------------------
   * GPT ACTION
   * ------------------------------------------------------------
   */

  async function doAction(action) {
    if (busy) {
      return {
        ok: false,
        error: "Already working."
      };
    }

    /*
     * Only try to capture if we genuinely have no saved
     * selection.
     */
    if (!lastSelectedText.trim()) {
      captureSelection();
    }

    if (!lastSelectedText.trim()) {
      showToast("Select some text first.");

      return {
        ok: false,
        error: "Select some text first."
      };
    }

    /*
     * LOCK the selection.
     */
    busy = true;

    const originalText = lastSelectedText;

    showToast("Working…");

    return new Promise((resolve) => {

      chrome.runtime.sendMessage(
        {
          type: "GPT_CORRECT",
          text: originalText,
          action
        },
        (response) => {

          if (chrome.runtime.lastError) {
            busy = false;

            showToast("Could not reach GPT.");

            resolve({
              ok: false,
              error: chrome.runtime.lastError.message
            });

            return;
          }

          if (!response?.ok) {
            busy = false;

            showToast(
              response?.error || "GPT request failed."
            );

            resolve(
              response || {
                ok: false
              }
            );

            return;
          }

          try {
            replaceSelectedText(response.text);

            showToast("Done ✓");

            busy = false;

            resolve({
              ok: true
            });

          } catch (error) {
            console.error(
              "GPT replacement failed:",
              error
            );

            busy = false;

            showToast(
              error?.message ||
              "Could not replace the selection."
            );

            resolve({
              ok: false,
              error:
                error?.message ||
                "Could not replace the selection."
            });
          }
        }
      );
    });
  }

  /*
   * ------------------------------------------------------------
   * REPLACE INPUT / TEXTAREA
   * ------------------------------------------------------------
   */

  function replaceInput(text) {
    const input = lastEditable;

    input.focus();

    input.setSelectionRange(
      lastInputStart,
      lastInputEnd
    );

    input.setRangeText(
      text,
      lastInputStart,
      lastInputEnd,
      "end"
    );

    try {
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: text
        })
      );
    } catch {
      input.dispatchEvent(
        new Event("input", {
          bubbles: true
        })
      );
    }
  }

  /*
   * ------------------------------------------------------------
   * REPLACE CONTENTEDITABLE
   * ------------------------------------------------------------
   */

  function replaceContentEditable(text) {
    if (!lastRange) {
      throw new Error("Rich-text selection was lost.");
    }

    const editable = lastEditable;

    if (typeof editable.focus === "function") {
      editable.focus();
    }

    const selection = window.getSelection();

    if (!selection) {
      throw new Error("Selection is unavailable.");
    }

    /*
     * Restore the original selection.
     */
    selection.removeAllRanges();

    selection.addRange(
      lastRange.cloneRange()
    );

    /*
     * Use native browser editing.
     *
     * NEVER directly modify the DOM here.
     */
    let success = false;

    try {
      success = document.execCommand(
        "insertText",
        false,
        text
      );
    } catch {
      success = false;
    }

    if (!success) {
      throw new Error(
        "This editor does not support safe text replacement."
      );
    }
  }

  /*
   * ------------------------------------------------------------
   * REPLACE
   * ------------------------------------------------------------
   */

  function replaceSelectedText(text) {
    if (!lastEditable) {
      throw new Error("Editor not found.");
    }

    if (isInput(lastEditable)) {
      replaceInput(text);
    } else {
      replaceContentEditable(text);
    }

    clearSelection();
  }

  function clearSelection() {
    lastEditable = null;
    lastInputStart = 0;
    lastInputEnd = 0;
    lastRange = null;
    lastSelectedText = "";
  }

  /*
   * ------------------------------------------------------------
   * TOAST
   * ------------------------------------------------------------
   */

  function showToast(message) {
    let toast =
      document.getElementById("__gpttc_toast");

    if (!toast) {
      toast = document.createElement("div");

      toast.id = "__gpttc_toast";

      Object.assign(toast.style, {
        position: "fixed",
        right: "18px",
        bottom: "18px",
        zIndex: "2147483647",
        background: "#111",
        color: "#fff",
        padding: "9px 13px",
        borderRadius: "8px",
        font: "13px Arial,sans-serif",
        boxShadow:
          "0 4px 16px rgba(0,0,0,.25)",
        pointerEvents: "none"
      });

      document.documentElement.appendChild(toast);
    }

    toast.textContent = message;

    clearTimeout(toast._timer);

    toast._timer = setTimeout(() => {
      toast.remove();
    }, 2200);
  }
})();
