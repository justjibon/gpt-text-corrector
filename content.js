(() => {
  if (window.__GPT_TEXT_CORRECTOR_V10__) return;
  window.__GPT_TEXT_CORRECTOR_V10__ = true;

  let lastEditable = null;
  let lastInputStart = 0;
  let lastInputEnd = 0;
  let lastRange = null;
  let lastSelectedText = "";
  let busy = false;

  /*
   * ------------------------------------------------------------
   * INPUT / TEXTAREA DETECTION
   * ------------------------------------------------------------
   */

  const isInput = (el) => {
    if (!el) return false;

    if (el.tagName === "TEXTAREA") {
      return true;
    }

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

  /*
   * ------------------------------------------------------------
   * FIND EDITABLE ELEMENT
   * ------------------------------------------------------------
   */

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
   * ------------------------------------------------------------
   * CAPTURE SELECTION
   *
   * IMPORTANT:
   * Once GPT processing starts, we DO NOT call capture()
   * again. This prevents the website from replacing our saved
   * selection while the GPT request is running.
   * ------------------------------------------------------------
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
     * CONTENTEDITABLE / RICH TEXT
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
   * Keep selection information updated while the user is
   * selecting text.
   *
   * During GPT processing we intentionally stop updating it.
   */

  document.addEventListener(
    "selectionchange",
    () => {
      if (!busy) {
        captureSelection();
      }
    },
    true
  );

  document.addEventListener(
    "mouseup",
    () => {
      if (!busy) {
        setTimeout(captureSelection, 0);
      }
    },
    true
  );

  document.addEventListener(
    "keyup",
    () => {
      if (!busy) {
        setTimeout(captureSelection, 0);
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
       * Get current selection
       */
      if (message?.type === "GPT_GET_SELECTION") {
        captureSelection();

        sendResponse({
          ok: true,
          hasSelection: !!lastSelectedText.trim()
        });

        return;
      }

      /*
       * Open action menu
       */
      if (message?.type === "GPT_OPEN_ACTIONS") {
        showActions();

        sendResponse({
          ok: true
        });

        return;
      }

      /*
       * Execute GPT action
       */
      if (message?.type === "GPT_DO_ACTION") {
        /*
         * Capture BEFORE starting the request.
         *
         * Do NOT call captureSelection() again after the
         * GPT request begins.
         */
        captureSelection();

        doAction(message.action || "correct")
          .then((result) => {
            sendResponse(result);
          });

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
     * Make absolutely sure we have a selection before locking it.
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
     * Freeze selection from this point forward.
     */
    busy = true;

    showToast("Working…");

    const originalText = lastSelectedText;

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
            busy = false;

            console.error(
              "GPT Text Corrector replacement error:",
              error
            );

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
   * REPLACE SELECTED TEXT
   * ------------------------------------------------------------
   */

  function replaceSelectedText(text) {
    if (!lastEditable) {
      throw new Error("Editor not found.");
    }

    /*
     * ==========================================================
     * INPUT / TEXTAREA
     * ==========================================================
     */

    if (isInput(lastEditable)) {
      const input = lastEditable;

      input.focus();

      /*
       * Restore original selection.
       */
      input.setSelectionRange(
        lastInputStart,
        lastInputEnd
      );

      /*
       * Native replacement.
       *
       * This is preferable to:
       *
       * input.value = ...
       *
       * because setRangeText() integrates with the native
       * text-control editing behavior.
       */
      input.setRangeText(
        text,
        lastInputStart,
        lastInputEnd,
        "end"
      );

      /*
       * Notify frameworks such as React/Vue/etc.
       */
      try {
        input.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: text
          })
        );
      } catch (error) {
        input.dispatchEvent(
          new Event("input", {
            bubbles: true
          })
        );
      }

      clearSelectionState();

      return;
    }

    /*
     * ==========================================================
     * CONTENTEDITABLE / RICH TEXT
     * ==========================================================
     */

    if (!lastRange) {
      throw new Error("Selection was lost.");
    }

    const editable = lastEditable;

    /*
     * Focus the original editor.
     */
    if (typeof editable.focus === "function") {
      editable.focus();
    }

    const selection = window.getSelection();

    if (!selection) {
      throw new Error("Browser selection is unavailable.");
    }

    /*
     * Restore the exact Range captured before GPT processing.
     */
    selection.removeAllRanges();

    const restoredRange = lastRange.cloneRange();

    selection.addRange(restoredRange);

    /*
     * ----------------------------------------------------------
     * NATIVE EDITING
     * ----------------------------------------------------------
     *
     * This is the critical part.
     *
     * We intentionally DO NOT do:
     *
     * range.deleteContents()
     * range.insertNode(...)
     *
     * Those operations directly modify the DOM and can cause
     * React/contenteditable editors to lose their internal
     * editing state.
     *
     * execCommand("insertText") asks the browser/editor to
     * perform an actual text-editing operation.
     */

    let success = false;

    try {
      success = document.execCommand(
        "insertText",
        false,
        text
      );
    } catch (error) {
      console.warn(
        "execCommand insertText failed:",
        error
      );
      success = false;
    }

    /*
     * NEVER fall back to direct DOM manipulation.
     *
     * If the editor refuses the native operation, report an
     * error rather than corrupting the editor.
     */
    if (!success) {
      throw new Error(
        "This editor does not allow safe text replacement."
      );
    }

    /*
     * The browser should have moved the caret to the end of
     * the inserted text.
     *
     * Do not manually modify the DOM or create another Range.
     */

    clearSelectionState();
  }

  /*
   * ------------------------------------------------------------
   * CLEAR SAVED SELECTION
   * ------------------------------------------------------------
   */

  function clearSelectionState() {
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
          "0 4px 16px rgba(0,0,0,.25)"
      });

      document.documentElement.appendChild(toast);
    }

    toast.textContent = message;

    clearTimeout(toast._timer);

    toast._timer = setTimeout(() => {
      toast.remove();
    }, 2200);
  }

  /*
   * ------------------------------------------------------------
   * ACTION MENU
   * ------------------------------------------------------------
   */

  function showActions() {
    /*
     * Capture the user's selection BEFORE creating the menu.
     */
    captureSelection();

    const old =
      document.getElementById("__gpttc_actions");

    if (old) {
      old.remove();
    }

    const box = document.createElement("div");

    box.id = "__gpttc_actions";

    Object.assign(box.style, {
      position: "fixed",
      top: "70px",
      right: "18px",
      zIndex: "2147483647",
      width: "280px",
      background: "#fff",
      border: "1px solid #ddd",
      borderRadius: "12px",
      padding: "12px",
      boxShadow:
        "0 10px 35px rgba(0,0,0,.18)",
      font: "14px system-ui,sans-serif"
    });

    box.innerHTML = `
      <b>✨ GPT Text Corrector</b>

      <div
        style="
          color:#666;
          font-size:12px;
          margin:5px 0 10px
        "
      >
        Choose an action for your selected text
      </div>
    `;

    [
      ["correct", "✨ Correct"],
      ["professional", "💼 Professional"],
      ["casual", "😊 Casual"],
      ["shorten", "✂️ Shorten"],
      ["improve", "🧠 Improve"],
      ["translate", "🌍 Translate"]
    ].forEach(([action, label]) => {

      const button =
        document.createElement("button");

      button.textContent = label;

      Object.assign(button.style, {
        display: "block",
        width: "100%",
        padding: "9px",
        margin: "5px 0",
        border: "1px solid #eee",
        borderRadius: "8px",
        background: "#fafafa",
        textAlign: "left",
        cursor: "pointer"
      });

      button.addEventListener(
        "click",
        async (event) => {

          event.preventDefault();
          event.stopPropagation();

          /*
           * Remove menu first.
           *
           * IMPORTANT:
           * We DO NOT call captureSelection() here.
           *
           * The selection captured before opening this menu
           * must remain frozen.
           */
          box.remove();

          await doAction(action);
        }
      );

      box.appendChild(button);
    });

    document.documentElement.appendChild(box);

    /*
     * Close menu when clicking outside.
     *
     * Do not alter the saved selection.
     */
    setTimeout(() => {
      const closeMenu = (event) => {
        if (!box.contains(event.target)) {
          box.remove();

          document.removeEventListener(
            "mousedown",
            closeMenu,
            true
          );
        }
      };

      document.addEventListener(
        "mousedown",
        closeMenu,
        true
      );
    }, 0);
  }
})();
