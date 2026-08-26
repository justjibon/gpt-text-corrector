(() => {
  if (window.__GPT_TEXT_CORRECTOR_V13__) return;
  window.__GPT_TEXT_CORRECTOR_V13__ = true;

  let savedEditable = null;
  let savedStart = 0;
  let savedEnd = 0;
  let savedRange = null;
  let savedText = "";
  let savedType = null;
  let busy = false;


  // ============================================================
  // BASIC HELPERS
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
  // CAPTURE CURRENT SELECTION
  //
  // IMPORTANT:
  // There are NO global selectionchange / keyup / mouseup
  // listeners.
  //
  // We only inspect the selection when the extension asks us.
  // ============================================================

  function captureSelection() {
    const active = findEditable(
      document.activeElement
    );


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
    // CONTENTEDITABLE / RICH TEXT
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


    /*
     * Save a clone of the actual Range.
     *
     * The range is NOT watched afterward.
     * We only use it when GPT returns.
     */

    savedEditable = editable;
    savedStart = 0;
    savedEnd = 0;
    savedRange = range.cloneRange();
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

      // --------------------------------------------------------
      // GET SELECTION
      // --------------------------------------------------------

      if (
        message?.type ===
        "GPT_GET_SELECTION"
      ) {
        const captured =
          captureSelection();

        sendResponse({
          ok: true,
          hasSelection:
            captured &&
            !!savedText.trim()
        });

        return;
      }


      // --------------------------------------------------------
      // OPEN ACTIONS
      // --------------------------------------------------------

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


      // --------------------------------------------------------
      // DO ACTION
      // --------------------------------------------------------

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


    /*
     * Usually the selection has already been captured by
     * GPT_GET_SELECTION / GPT_OPEN_ACTIONS.
     *
     * Only capture again if nothing was saved.
     */

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
          (response) => {

            // --------------------------------------------------
            // CONNECTION ERROR
            // --------------------------------------------------

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


            // --------------------------------------------------
            // GPT ERROR
            // --------------------------------------------------

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


            // --------------------------------------------------
            // REPLACE
            // --------------------------------------------------

            try {
              replaceSelection(
                response.text
              );

              showToast(
                "Done ✓"
              );

              busy = false;

              resolve({
                ok: true
              });

            } catch (error) {
              console.error(
                "GPT Text Corrector replacement error:",
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
  // REPLACE INPUT / TEXTAREA
  // ============================================================

  function replaceInput(text) {
    const input =
      savedEditable;

    if (!input || !isInput(input)) {
      throw new Error(
        "Input editor not found."
      );
    }


    input.focus();


    /*
     * Restore the exact original selection.
     */

    input.setSelectionRange(
      savedStart,
      savedEnd
    );


    /*
     * Native range replacement.
     */

    input.setRangeText(
      text,
      savedStart,
      savedEnd,
      "end"
    );


    /*
     * Notify the page/framework.
     */

    try {
      input.dispatchEvent(
        new InputEvent(
          "input",
          {
            bubbles: true,
            inputType:
              "insertText",
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
  // RESTORE RICH TEXT SELECTION
  // ============================================================

  function restoreRichSelection() {
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


    /*
     * Restore the original Range.
     */

    selection.removeAllRanges();

    selection.addRange(
      savedRange.cloneRange()
    );


    /*
     * Put focus back into the editor.
     */

    if (
      savedEditable &&
      typeof savedEditable.focus === "function"
    ) {
      savedEditable.focus();
    }


    /*
     * Some editors move focus when focus() is called.
     * Restore the range once more.
     */

    selection.removeAllRanges();

    selection.addRange(
      savedRange.cloneRange()
    );


    return selection;
  }


  // ============================================================
  // REPLACE RICH TEXT
  // ============================================================

  function replaceRichText(text) {
  if (!savedEditable) {
    throw new Error("Rich-text editor not found.");
  }

  if (!savedRange) {
    throw new Error("Original selection was lost.");
  }

  /*
   * IMPORTANT:
   * Do NOT use execCommand().
   * Do NOT modify the DOM.
   *
   * X / LinkedIn / Discord maintain their own editor state.
   * Direct DOM editing can make Backspace, Delete and Ctrl+X
   * stop working.
   */

  const selection = window.getSelection();

  if (!selection) {
    throw new Error("Browser selection is unavailable.");
  }

  /*
   * Restore focus only.
   * Do not modify the selected text.
   */

  try {
    savedEditable.focus();
  } catch {}

  clearSelectionState();

  throw new Error(
    "Rich-text replacement is temporarily disabled. Your original text is unchanged."
  );
}

    /*
     * Verify that the selected text still exists.
     *
     * This prevents us from accidentally replacing the wrong
     * text if the page changed while GPT was processing.
     */

    const currentText =
      selection.toString();

    if (
      savedText &&
      currentText !== savedText
    ) {
      throw new Error(
        "The selected text changed while GPT was working. Nothing was replaced."
      );
    }


    /*
     * ========================================================
     * IMPORTANT
     *
     * We use the browser's editing command here instead of
     * manually deleting/inserting DOM nodes.
     *
     * This is much safer for framework-controlled editors than:
     *
     *   range.deleteContents()
     *   range.insertNode()
     *
     * because those operations modify the DOM behind the
     * editor's internal state.
     * ========================================================
     */

    let success = false;

    try {
      success =
        document.execCommand(
          "insertText",
          false,
          text
        );
    } catch (error) {
      console.warn(
        "execCommand insertText failed:",
        error
      );
    }


    /*
     * Do NOT manually manipulate the DOM if execCommand fails.
     *
     * That is exactly what caused problems with framework
     * editors in previous versions.
     */

    if (!success) {
      throw new Error(
        "This rich-text editor does not allow safe text replacement."
      );
    }


    /*
     * The browser performed the edit.
     *
     * Do not dispatch a second fake input event here.
     * execCommand normally causes the browser's editing events.
     */

    clearSelectionState();
  }


  // ============================================================
  // REPLACE SELECTION
  // ============================================================

  function replaceSelection(text) {
    if (!savedEditable) {
      throw new Error(
        "Editor not found."
      );
    }


    if (savedType === "input") {
      replaceInput(text);
      return;
    }


    if (savedType === "rich") {
      replaceRichText(text);
      return;
    }


    throw new Error(
      "Unsupported editor."
    );
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


    /*
     * Close menu if the user clicks outside.
     */

    setTimeout(() => {

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

    }, 0);
  }

})();
