(() => {
  if (window.__GPT_TEXT_CORRECTOR_V17__) return;
  window.__GPT_TEXT_CORRECTOR_V17__ = true;

  let savedEditable = null;
  let savedStart = 0;
  let savedEnd = 0;
  let savedRange = null;
  let savedText = "";
  let savedType = null;
  let busy = false;

  // ============================================================
  // EDITOR DETECTION
  // ============================================================

  function isInput(el) {
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
      ].includes(
        (el.type || "").toLowerCase()
      );
    }

    return false;
  }

  function findEditable(node) {
    if (!node) return null;

    if (node.nodeType === Node.TEXT_NODE) {
      node = node.parentElement;
    }

    if (!node) return null;

    if (isInput(node)) {
      return node;
    }

    if (node.isContentEditable) {
      return node;
    }

    const closest = node.closest?.(
      [
        "textarea",
        'input[type="text"]',
        'input[type="search"]',
        'input[type="email"]',
        'input[type="url"]',
        '[contenteditable="true"]',
        '[role="textbox"]'
      ].join(",")
    );

    return closest || null;
  }


  // ============================================================
  // CAPTURE SELECTION
  // ============================================================

  function captureSelection() {
    const active =
      findEditable(document.activeElement);

    // ----------------------------------------------------------
    // INPUT / TEXTAREA
    // ----------------------------------------------------------

    if (active && isInput(active)) {
      const start =
        typeof active.selectionStart === "number"
          ? active.selectionStart
          : 0;

      const end =
        typeof active.selectionEnd === "number"
          ? active.selectionEnd
          : 0;

      if (start !== end) {
        const text =
          active.value.substring(
            start,
            end
          );

        if (text.trim()) {
          savedEditable = active;
          savedStart = start;
          savedEnd = end;
          savedRange = null;
          savedText = text;
          savedType = "input";

          return true;
        }
      }
    }


    // ----------------------------------------------------------
    // RICH TEXT
    // ----------------------------------------------------------

    const selection =
      window.getSelection();

    if (
      !selection ||
      selection.rangeCount === 0 ||
      selection.isCollapsed
    ) {
      return false;
    }

    const range =
      selection.getRangeAt(0);

    const editable =
      findEditable(
        range.commonAncestorContainer
      );

    if (!editable) {
      return false;
    }

    const text =
      selection.toString();

    if (!text.trim()) {
      return false;
    }

    savedEditable = editable;
    savedRange =
      range.cloneRange();

    savedStart = 0;
    savedEnd = 0;
    savedText = text;
    savedType = "rich";

    return true;
  }


  // ============================================================
  // CLEAR
  // ============================================================

  function clearSelectionState() {
    savedEditable = null;
    savedStart = 0;
    savedEnd = 0;
    savedRange = null;
    savedText = "";
    savedType = null;
  }


  // ============================================================
  // MESSAGE HANDLER
  // ============================================================

  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {

      if (
        message?.type ===
        "GPT_GET_SELECTION"
      ) {
        const ok =
          captureSelection();

        sendResponse({
          ok: true,
          hasSelection:
            ok &&
            !!savedText.trim()
        });

        return;
      }


      if (
        message?.type ===
        "GPT_OPEN_ACTIONS"
      ) {
        captureSelection();

        showActions();

        sendResponse({
          ok: true,
          hasSelection:
            !!savedText.trim()
        });

        return;
      }


      if (
        message?.type ===
        "GPT_DO_ACTION"
      ) {
        doAction(
          message.action || "correct"
        ).then(sendResponse);

        return true;
      }
    }
  );


  // ============================================================
  // GPT ACTION
  // ============================================================

  async function doAction(action) {
    if (busy) {
      return {
        ok: false,
        error: "Already working."
      };
    }

    if (!savedText.trim()) {
      captureSelection();
    }

    if (!savedText.trim()) {
      showToast(
        "Select some text first."
      );

      return {
        ok: false,
        error:
          "Select some text first."
      };
    }

    busy = true;

    const original =
      savedText;

    showToast(
      "Working…"
    );

    return new Promise(
      (resolve) => {

        chrome.runtime.sendMessage(
          {
            type: "GPT_CORRECT",
            text: original,
            action
          },
          async (response) => {

            if (
              chrome.runtime.lastError
            ) {
              busy = false;

              showToast(
                "Could not reach GPT."
              );

              resolve({
                ok: false,
                error:
                  chrome.runtime
                    .lastError
                    .message
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
              await copyCorrectedText(
                response.text
              );

              showToast(
                "Copied ✓ Press Ctrl+V to replace"
              );

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
      }
    );
  }


  // ============================================================
  // INPUT / TEXTAREA REPLACEMENT
  // ============================================================

  function replaceInput(text) {
    const input =
      savedEditable;

    if (
      !input ||
      !isInput(input)
    ) {
      throw new Error(
        "Input editor not found."
      );
    }

    input.focus();

    input.setSelectionRange(
      savedStart,
      savedEnd
    );

    input.setRangeText(
      text,
      savedStart,
      savedEnd,
      "end"
    );

    try {
      input.dispatchEvent(
        new InputEvent(
          "input",
          {
            bubbles: true,
            inputType:
              "insertReplacementText",
            data: text
          }
        )
      );
    } catch {
      input.dispatchEvent(
        new Event(
          "input",
          {
            bubbles: true
          }
        )
      );
    }

    input.dispatchEvent(
      new Event(
        "change",
        {
          bubbles: true
        }
      )
    );

    clearSelectionState();
  }


  // ============================================================
  // RESTORE RICH-TEXT SELECTION
  // ============================================================

  function restoreRange() {
    if (!savedRange) {
      throw new Error(
        "Original selection was lost."
      );
    }

    const selection =
      window.getSelection();

    if (!selection) {
      throw new Error(
        "Browser selection is unavailable."
      );
    }

    selection.removeAllRanges();

    selection.addRange(
      savedRange.cloneRange()
    );

    return selection;
  }


  // ============================================================
  // COPY GPT RESULT WITHOUT TOUCHING THE EDITOR
  //
  // We intentionally do NOT modify X / LinkedIn / Discord DOM.
  // The corrected text is copied to the system clipboard and the
  // user's original selection remains selected, so Ctrl+V replaces
  // it through the site's own native editing pipeline.
  // ============================================================

  async function copyCorrectedText(text) {
    if (!savedEditable) {
      throw new Error(
        "Editor not found."
      );
    }

    if (!text) {
      throw new Error(
        "GPT returned empty text."
      );
    }

    // Restore the exact original selection before copying.
    if (savedType === "rich" && savedRange) {
      const selection = window.getSelection();

      if (!selection) {
        throw new Error(
          "Browser selection is unavailable."
        );
      }

      try {
        savedEditable.focus();
      } catch {}

      selection.removeAllRanges();
      selection.addRange(
        savedRange.cloneRange()
      );

      const currentText =
        selection.toString();

      if (
        savedText &&
        currentText !== savedText
      ) {
        throw new Error(
          "The selected text changed while GPT was working. Nothing was copied."
        );
      }
    }

    if (savedType === "input") {
      savedEditable.focus();
      savedEditable.setSelectionRange(
        savedStart,
        savedEnd
      );
    }

    // Preferred modern clipboard API.
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (clipboardError) {
      console.warn(
        "GPT Text Corrector clipboard API failed; using fallback.",
        clipboardError
      );
    }

    // Fallback for pages that block navigator.clipboard.
    // This temporary textarea is never inserted into the target editor.
    const helper = document.createElement("textarea");

    helper.value = text;

    Object.assign(
      helper.style,
      {
        position: "fixed",
        left: "-10000px",
        top: "-10000px",
        width: "1px",
        height: "1px",
        opacity: "0",
        pointerEvents: "none"
      }
    );

    document.documentElement.appendChild(helper);

    try {
      helper.focus();
      helper.select();

      const copied =
        document.execCommand("copy");

      if (!copied) {
        throw new Error(
          "Clipboard access was denied by this page."
        );
      }
    } finally {
      helper.remove();

      // Restore the user's original editor selection.
      if (savedType === "rich" && savedRange) {
        try {
          savedEditable.focus();
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(
            savedRange.cloneRange()
          );
        } catch {}
      } else if (savedType === "input") {
        try {
          savedEditable.focus();
          savedEditable.setSelectionRange(
            savedStart,
            savedEnd
          );
        } catch {}
      }
    }
  }


  // ============================================================
  // REPLACE SELECTION

  // ============================================================

  async function replaceSelection(text) {
    await copyCorrectedText(text);
  }


  // ============================================================
  // TOAST
  // ============================================================

  function showToast(message) {
    let toast =
      document.getElementById(
        "__gpttc_toast"
      );

    if (!toast) {
      toast =
        document.createElement(
          "div"
        );

      toast.id =
        "__gpttc_toast";

      Object.assign(
        toast.style,
        {
          position: "fixed",
          right: "18px",
          bottom: "18px",
          zIndex:
            "2147483647",
          background:
            "#111",
          color:
            "#fff",
          padding:
            "9px 13px",
          borderRadius:
            "8px",
          font:
            "13px Arial,sans-serif",
          boxShadow:
            "0 4px 16px rgba(0,0,0,.25)",
          pointerEvents:
            "none"
        }
      );

      document.documentElement
        .appendChild(toast);
    }

    toast.textContent =
      message;

    clearTimeout(
      toast._timer
    );

    toast._timer =
      setTimeout(
        () => {
          toast.remove();
        },
        2200
      );
  }


  // ============================================================
  // ACTION MENU
  // ============================================================

  function showActions() {
    const old =
      document.getElementById(
        "__gpttc_actions"
      );

    if (old) {
      old.remove();
    }

    const box =
      document.createElement(
        "div"
      );

    box.id =
      "__gpttc_actions";

    Object.assign(
      box.style,
      {
        position: "fixed",
        top: "70px",
        right: "18px",
        zIndex:
          "2147483647",
        width: "280px",
        background:
          "#fff",
        border:
          "1px solid #ddd",
        borderRadius:
          "12px",
        padding:
          "12px",
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


    const actions = [
      ["correct", "✨ Correct"],
      ["professional", "💼 Professional"],
      ["casual", "😊 Casual"],
      ["shorten", "✂️ Shorten"],
      ["improve", "🧠 Improve"],
      ["translate", "🌍 Translate"]
    ];


    actions.forEach(
      ([action, label]) => {

        const button =
          document.createElement(
            "button"
          );

        button.type =
          "button";

        button.textContent =
          label;

        Object.assign(
          button.style,
          {
            display:
              "block",
            width:
              "100%",
            padding:
              "9px",
            margin:
              "5px 0",
            border:
              "1px solid #eee",
            borderRadius:
              "8px",
            background:
              "#fafafa",
            textAlign:
              "left",
            cursor:
              "pointer"
          }
        );


        button.addEventListener(
          "click",
          async (event) => {

            event.preventDefault();

            event.stopPropagation();

            box.remove();

            await doAction(
              action
            );
          }
        );


        box.appendChild(
          button
        );
      }
    );


    document.documentElement
      .appendChild(box);


    setTimeout(
      () => {

        const close =
          (event) => {

            if (
              !box.contains(
                event.target
              )
            ) {
              box.remove();

              document.removeEventListener(
                "mousedown",
                close,
                true
              );
            }
          };


        document.addEventListener(
          "mousedown",
          close,
          true
        );

      },
      0
    );
  }

})();
