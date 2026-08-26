(() => {
  if (window.__GPT_TEXT_CORRECTOR_V9__) return;
  window.__GPT_TEXT_CORRECTOR_V9__ = true;

  let lastEditable = null;
  let lastInputStart = 0;
  let lastInputEnd = 0;
  let lastRange = null;
  let lastSelectedText = "";
  let busy = false;

  const isInput = (e) =>
    !!e &&
    (
      e.tagName === "TEXTAREA" ||
      (
        e.tagName === "INPUT" &&
        ["text", "search", "email", "url"].includes(
          (e.type || "").toLowerCase()
        )
      )
    );

  function findEditable(n) {
    if (!n) return null;

    if (n.nodeType === Node.TEXT_NODE) {
      n = n.parentElement;
    }

    if (!n) return null;

    if (
      isInput(n) ||
      n.isContentEditable ||
      n.getAttribute?.("role") === "textbox"
    ) {
      return n;
    }

    return (
      n.closest?.(
        'textarea,input[type="text"],input[type="search"],input[type="email"],input[type="url"],[contenteditable="true"],[role="textbox"]'
      ) || null
    );
  }

  function capture() {
    const active = findEditable(document.activeElement);

    // INPUT / TEXTAREA
    if (active && isInput(active)) {
      const start = active.selectionStart ?? 0;
      const end = active.selectionEnd ?? 0;

      if (start !== end) {
        lastEditable = active;
        lastInputStart = start;
        lastInputEnd = end;
        lastSelectedText = active.value.substring(start, end);
        lastRange = null;
        return;
      }
    }

    // CONTENTEDITABLE / RICH TEXT
    const sel = window.getSelection();

    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      const ed = findEditable(range.commonAncestorContainer);

      if (ed) {
        lastEditable = ed;
        lastRange = range.cloneRange();
        lastSelectedText = lastRange.toString();
      }
    }
  }

  document.addEventListener(
    "selectionchange",
    () => setTimeout(capture, 0),
    true
  );

  document.addEventListener(
    "mouseup",
    () => setTimeout(capture, 0),
    true
  );

  document.addEventListener(
    "keyup",
    () => setTimeout(capture, 0),
    true
  );

  chrome.runtime.onMessage.addListener((m, s, send) => {
    if (m?.type === "GPT_GET_SELECTION") {
      capture();

      send({
        ok: true,
        hasSelection: !!lastSelectedText.trim()
      });

      return;
    }

    if (m?.type === "GPT_OPEN_ACTIONS") {
      showActions();

      send({
        ok: true
      });

      return;
    }

    if (m?.type === "GPT_DO_ACTION") {
      capture();

      doAction(m.action || "correct").then((r) => send(r));

      return true;
    }
  });

  async function doAction(action) {
    if (busy) {
      return {
        ok: false,
        error: "Already working."
      };
    }

    capture();

    if (!lastSelectedText.trim()) {
      showToast("Select some text first.");

      return {
        ok: false,
        error: "Select some text first."
      };
    }

    busy = true;
    showToast("Working…");

    const original = lastSelectedText;

    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "GPT_CORRECT",
          text: original,
          action
        },
        (resp) => {
          if (chrome.runtime.lastError) {
            busy = false;

            showToast("Could not reach GPT.");

            resolve({
              ok: false,
              error: chrome.runtime.lastError.message
            });

            return;
          }

          if (!resp?.ok) {
            busy = false;

            showToast(resp?.error || "GPT request failed.");

            resolve(
              resp || {
                ok: false
              }
            );

            return;
          }

          try {
            replace(resp.text);

            showToast("Done ✓");

            busy = false;

            resolve({
              ok: true
            });
          } catch (e) {
            busy = false;

            showToast(
              e?.message || "Could not replace the selection."
            );

            resolve({
              ok: false,
              error: e?.message || "Replacement failed."
            });
          }
        }
      );
    });
  }

  function replace(text) {
    if (!lastEditable) {
      throw new Error("Editor not found.");
    }

    /*
     * ============================================================
     * INPUT / TEXTAREA
     * ============================================================
     */

    if (isInput(lastEditable)) {
      const input = lastEditable;

      input.focus();

      input.setSelectionRange(
        lastInputStart,
        lastInputEnd
      );

      /*
       * setRangeText() performs the replacement through the
       * native input editing API instead of changing .value
       * manually.
       *
       * "end" places the caret after the corrected text.
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
      } catch {
        input.dispatchEvent(
          new Event("input", {
            bubbles: true
          })
        );
      }

      clear();

      return;
    }

    /*
     * ============================================================
     * CONTENTEDITABLE / RICH TEXT
     * ============================================================
     */

    if (!lastRange) {
      throw new Error("Selection was lost.");
    }

    const editable = lastEditable;

    editable.focus?.();

    const selection = window.getSelection();

    if (!selection) {
      throw new Error("Selection is unavailable.");
    }

    /*
     * Restore the exact selection that the user originally made.
     */
    selection.removeAllRanges();

    const range = lastRange.cloneRange();

    selection.addRange(range);

    /*
     * IMPORTANT:
     *
     * Do NOT use:
     *
     * range.deleteContents()
     * range.insertNode(...)
     *
     * as a fallback.
     *
     * Those operations directly modify the DOM and can break the
     * internal state of editors such as React, ProseMirror,
     * TipTap, Lexical, etc.
     *
     * insertText is much safer because it goes through the
     * browser's editing mechanism.
     */
    let inserted = false;

    try {
      inserted = document.execCommand(
        "insertText",
        false,
        text
      );
    } catch (e) {
      inserted = false;
    }

    /*
     * If the browser/editor refuses execCommand(), do NOT perform
     * direct DOM manipulation. It is better to report failure than
     * corrupt the editor's internal state.
     */
    if (!inserted) {
      throw new Error(
        "This editor does not support safe text replacement."
      );
    }

    clear();
  }

  function clear() {
    lastSelectedText = "";
    lastRange = null;
    lastInputStart = 0;
    lastInputEnd = 0;
    lastEditable = null;
  }

  function showToast(msg) {
    let t = document.getElementById("__gpttc_toast");

    if (!t) {
      t = document.createElement("div");

      t.id = "__gpttc_toast";

      Object.assign(t.style, {
        position: "fixed",
        right: "18px",
        bottom: "18px",
        zIndex: "2147483647",
        background: "#111",
        color: "#fff",
        padding: "9px 13px",
        borderRadius: "8px",
        font: "13px Arial,sans-serif",
        boxShadow: "0 4px 16px rgba(0,0,0,.25)"
      });

      document.documentElement.appendChild(t);
    }

    t.textContent = msg;

    clearTimeout(t._timer);

    t._timer = setTimeout(() => {
      t.remove();
    }, 2200);
  }

  function showActions() {
    capture();

    const old = document.getElementById("__gpttc_actions");

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
      boxShadow: "0 10px 35px rgba(0,0,0,.18)",
      font: "14px system-ui,sans-serif"
    });

    box.innerHTML = `
      <b>✨ GPT Text Corrector</b>
      <div style="color:#666;font-size:12px;margin:5px 0 10px">
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
    ].forEach(([a, label]) => {
      const b = document.createElement("button");

      b.textContent = label;

      Object.assign(b.style, {
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

      b.onclick = async () => {
        box.remove();

        await doAction(a);
      };

      box.appendChild(b);
    });

    document.documentElement.appendChild(box);

    setTimeout(() => {
      document.addEventListener(
        "mousedown",
        function close(e) {
          if (!box.contains(e.target)) {
            box.remove();

            document.removeEventListener(
              "mousedown",
              close
            );
          }
        },
        {
          once: true
        }
      );
    }, 0);
  }
})();
