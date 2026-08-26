(() => {
  if (window.__GPT_TEXT_CORRECTOR_V11__) return;
  window.__GPT_TEXT_CORRECTOR_V11__ = true;

  let savedEditable = null;
  let savedInputStart = 0;
  let savedInputEnd = 0;
  let savedRange = null;
  let savedText = "";
  let busy = false;

  const isTextInput = (el) => {
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

  function findEditable(node) {
    if (!node) return null;

    if (node.nodeType === Node.TEXT_NODE) {
      node = node.parentElement;
    }

    if (!node) return null;

    if (
      isTextInput(node) ||
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
   * ============================================================
   * SAVE CURRENT SELECTION
   * ============================================================
   */

  function saveCurrentSelection() {
    const active = findEditable(document.activeElement);

    /*
     * ----------------------------
     * INPUT / TEXTAREA
     * ----------------------------
     */

    if (active && isTextInput(active)) {
      const start = active.selectionStart ?? 0;
      const end = active.selectionEnd ?? 0;

      if (start !== end) {
        savedEditable = active;
        savedInputStart = start;
        savedInputEnd = end;
        savedText = active.value.substring(start, end);
        savedRange = null;

        return true;
      }
    }

    /*
     * ----------------------------
     * CONTENTEDITABLE
     * ----------------------------
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
        savedEditable = editable;
        savedRange = range.cloneRange();
        savedText = range.toString();

        return !!savedText.trim();
      }
    }

    return false;
  }

  /*
   * ============================================================
   * SELECTION TRACKING
   *
   * We remember the LAST VALID selection.
   *
   * We deliberately do NOT erase it when the popup steals
   * focus or the browser collapses the selection.
   * ============================================================
   */

  document.addEventListener(
    "selectionchange",
    () => {
      if (busy) return;

      const selection = window.getSelection();

      if (
        selection &&
        selection.rangeCount > 0 &&
        !selection.isCollapsed
      ) {
        saveCurrentSelection();
      }
    },
    true
  );

  document.addEventListener(
    "mouseup",
    () => {
      if (busy) return;

      setTimeout(() => {
        saveCurrentSelection();
      }, 0);
    },
    true
  );

  /*
   * IMPORTANT:
   * Do not use keyup to recapture the selection.
   *
   * LinkedIn/X/Discord use keyboard events heavily and this can
   * interfere with their editor state.
   */

  /*
   * ============================================================
   * MESSAGE HANDLER
   * ============================================================
   */

  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {

      /*
       * ------------------------------------------
       * GET SELECTION
       *
       * DO NOT recapture here.
       * The popup may already have stolen focus.
       * ------------------------------------------
       */

      if (message?.type === "GPT_GET_SELECTION") {
        sendResponse({
          ok: true,
          hasSelection: !!savedText.trim()
        });

        return;
      }

      /*
       * ------------------------------------------
       * OPEN ACTIONS
       * ------------------------------------------
       */

      if (message?.type === "GPT_OPEN_ACTIONS") {
        showActions();

        sendResponse({
          ok: true
        });

        return;
      }

      /*
       * ------------------------------------------
       * DO ACTION
       *
       * DO NOT recapture here.
       * ------------------------------------------
       */

      if (message?.type === "GPT_DO_ACTION") {
        doAction(
          message.action || "correct"
        ).then(sendResponse);

        return true;
      }
    }
  );

  /*
   * ============================================================
   * GPT ACTION
   * ============================================================
   */

  async function doAction(action) {
    if (busy) {
      return {
        ok: false,
        error: "Already working."
      };
    }

    /*
     * We should normally already have a saved selection.
     *
     * Only attempt to find one if there genuinely isn't one.
     */
    if (!savedText.trim()) {
      saveCurrentSelection();
    }

    if (!savedText.trim()) {
      showToast("Select some text first.");

      return {
        ok: false,
        error: "Select some text first."
      };
    }

    /*
     * Freeze everything.
     */
    busy = true;

    const originalText = savedText;

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

            showToast(
              "Could not reach GPT."
            );

            resolve({
              ok: false,
              error:
                chrome.runtime.lastError.message
            });

            return;
          }

          if (!response?.ok) {
            busy = false;

            showToast(
              response?.error ||
              "GPT request failed."
            );

            resolve(
              response || {
                ok: false
              }
            );

            return;
          }

          try {
            replaceSavedSelection(
              response.text
            );

            showToast("Done ✓");

            busy = false;

            resolve({
              ok: true
            });

          } catch (error) {
            console.error(
              "GPT Text Corrector:",
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
   * ============================================================
   * REPLACE SAVED SELECTION
   * ============================================================
   */

  function replaceSavedSelection(text) {
    if (!savedEditable) {
      throw new Error(
        "Editor not found."
      );
    }

    /*
     * ==========================================================
     * INPUT / TEXTAREA
     * ==========================================================
     */

    if (isTextInput(savedEditable)) {
      const input = savedEditable;

      input.focus();

      input.setSelectionRange(
        savedInputStart,
        savedInputEnd
      );

      input.setRangeText(
        text,
        savedInputStart,
        savedInputEnd,
        "end"
      );

      /*
       * Notify React/Vue/etc.
       */
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

      clearSavedSelection();

      return;
    }

    /*
     * ==========================================================
     * CONTENTEDITABLE / RICH TEXT
     * ==========================================================
     */

    if (!savedRange) {
      throw new Error(
        "Rich-text selection was lost."
      );
    }

    const editor = savedEditable;

    /*
     * Return focus to the original editor.
     */
    if (typeof editor.focus === "function") {
      editor.focus();
    }

    const selection = window.getSelection();

    if (!selection) {
      throw new Error(
        "Browser selection unavailable."
      );
    }

    /*
     * Restore the exact saved Range.
     */
    selection.removeAllRanges();

    selection.addRange(
      savedRange.cloneRange()
    );

    /*
     * IMPORTANT:
     *
     * Do NOT use:
     *
     * range.deleteContents()
     * range.insertNode()
     *
     * Those directly mutate the editor DOM and can break
     * framework-managed editors.
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
        "insertText failed:",
        error
      );
    }

    if (!success) {
      throw new Error(
        "This editor does not support safe text replacement."
      );
    }

    clearSavedSelection();
  }

  /*
   * ============================================================
   * CLEAR
   * ============================================================
   */

  function clearSavedSelection() {
    savedEditable = null;
    savedInputStart = 0;
    savedInputEnd = 0;
    savedRange = null;
    savedText = "";
  }

  /*
   * ============================================================
   * TOAST
   * ============================================================
   */

  function showToast(message) {
    let toast =
      document.getElementById(
        "__gpttc_toast"
      );

    if (!toast) {
      toast = document.createElement("div");

      toast.id = "__gpttc_toast";

      Object.assign(
        toast.style,
        {
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
        }
      );

      document.documentElement.appendChild(
        toast
      );
    }

    toast.textContent = message;

    clearTimeout(toast._timer);

    toast._timer = setTimeout(() => {
      toast.remove();
    }, 2200);
  }

  /*
   * ============================================================
   * ACTION MENU
   * ============================================================
   */

  function showActions() {
    /*
     * Save BEFORE creating our UI.
     */
    saveCurrentSelection();

    const old =
      document.getElementById(
        "__gpttc_actions"
      );

    if (old) {
      old.remove();
    }

    const box =
      document.createElement("div");

    box.id =
      "__gpttc_actions";

    Object.assign(
      box.style,
      {
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
        font:
          "14px system-ui,sans-serif"
      }
    );

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
    ].forEach(
      ([action, label]) => {

        const button =
          document.createElement(
            "button"
          );

        button.textContent = label;

        Object.assign(
          button.style,
          {
            display: "block",
            width: "100%",
            padding: "9px",
            margin: "5px 0",
            border: "1px solid #eee",
            borderRadius: "8px",
            background: "#fafafa",
            textAlign: "left",
            cursor: "pointer"
          }
        );

        button.addEventListener(
          "click",
          async (event) => {

            event.preventDefault();
            event.stopPropagation();

            /*
             * DO NOT recapture after the popup/menu has taken
             * focus. The saved selection is the one we want.
             */
            box.remove();

            await doAction(action);
          }
        );

        box.appendChild(button);
      }
    );

    document.documentElement.appendChild(
      box
    );

    /*
     * Clicking outside closes the menu.
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
