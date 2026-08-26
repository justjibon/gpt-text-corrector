(() => {
  if (window.__GPT_TEXT_CORRECTOR_V12__) return;
  window.__GPT_TEXT_CORRECTOR_V12__ = true;

  let savedEditable = null;
  let savedStart = 0;
  let savedEnd = 0;
  let savedText = "";
  let busy = false;

  /*
   * ============================================================
   * INPUT / TEXTAREA
   * ============================================================
   */

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


  /*
   * ============================================================
   * FIND EDITABLE
   * ============================================================
   */

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

    const editable = node.closest?.(
      [
        "textarea",
        'input[type="text"]',
        'input[type="search"]',
        'input[type="email"]',
        'input[type="url"]',
        '[contenteditable="true"]'
      ].join(",")
    );

    return editable || null;
  }


  /*
   * ============================================================
   * GET CURRENT SELECTION
   *
   * IMPORTANT:
   * No selectionchange listener.
   * No keyup listener.
   * No mouseup listener.
   *
   * The extension only checks the selection when explicitly
   * requested.
   * ============================================================
   */

  function getSelectionNow() {
    const active = findEditable(
      document.activeElement
    );

    /*
     * ----------------------------------------------------------
     * INPUT / TEXTAREA
     * ----------------------------------------------------------
     */

    if (active && isInput(active)) {
      const start =
        active.selectionStart ?? 0;

      const end =
        active.selectionEnd ?? 0;

      if (start !== end) {
        return {
          type: "input",
          editable: active,
          start,
          end,
          text: active.value.substring(
            start,
            end
          )
        };
      }
    }


    /*
     * ----------------------------------------------------------
     * CONTENTEDITABLE
     * ----------------------------------------------------------
     */

    const selection =
      window.getSelection();

    if (
      selection &&
      selection.rangeCount > 0 &&
      !selection.isCollapsed
    ) {
      const range =
        selection.getRangeAt(0);

      const editable =
        findEditable(
          range.commonAncestorContainer
        );

      const text =
        selection.toString();

      if (
        editable &&
        text.trim()
      ) {
        return {
          type: "rich",
          editable,
          text
        };
      }
    }

    return null;
  }


  /*
   * ============================================================
   * SAVE SELECTION
   * ============================================================
   */

  function saveSelection() {
    const current =
      getSelectionNow();

    if (!current) {
      return false;
    }


    /*
     * ----------------------------------------------------------
     * INPUT / TEXTAREA
     * ----------------------------------------------------------
     */

    if (current.type === "input") {
      savedEditable =
        current.editable;

      savedStart =
        current.start;

      savedEnd =
        current.end;

      savedText =
        current.text;

      return true;
    }


    /*
     * ----------------------------------------------------------
     * RICH TEXT
     *
     * We intentionally do NOT save a DOM Range.
     *
     * This prevents us from keeping a live Range inside
     * framework-controlled editors such as X/LinkedIn/Discord.
     * ----------------------------------------------------------
     */

    if (current.type === "rich") {
      savedEditable =
        current.editable;

      savedStart = 0;
      savedEnd = 0;
      savedText = current.text;

      return true;
    }

    return false;
  }


  /*
   * ============================================================
   * MESSAGE HANDLER
   * ============================================================
   */

  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {

      /*
       * --------------------------------------------------------
       * GET SELECTION
       * --------------------------------------------------------
       */

      if (
        message?.type ===
        "GPT_GET_SELECTION"
      ) {
        const ok =
          savedText.trim()
            ? true
            : saveSelection();

        sendResponse({
          ok: true,
          hasSelection:
            ok &&
            !!savedText.trim()
        });

        return;
      }


      /*
       * --------------------------------------------------------
       * OPEN ACTIONS
       * --------------------------------------------------------
       */

      if (
        message?.type ===
        "GPT_OPEN_ACTIONS"
      ) {
        saveSelection();

        showActions();

        sendResponse({
          ok: true
        });

        return;
      }


      /*
       * --------------------------------------------------------
       * DO ACTION
       * --------------------------------------------------------
       */

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
     * If there is no saved selection yet,
     * try once to get the current selection.
     */

    if (!savedText.trim()) {
      saveSelection();
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

    showToast("Working…");

    return new Promise(
      (resolve) => {

        chrome.runtime.sendMessage(
          {
            type: "GPT_CORRECT",
            text: original,
            action
          },
          (response) => {

            /*
             * --------------------------------------------------
             * CONNECTION ERROR
             * --------------------------------------------------
             */

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


            /*
             * --------------------------------------------------
             * GPT ERROR
             * --------------------------------------------------
             */

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


            /*
             * --------------------------------------------------
             * REPLACE
             * --------------------------------------------------
             */

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


  /*
   * ============================================================
   * REPLACE SELECTION
   * ============================================================
   */

  function replaceSelection(text) {
    if (!savedEditable) {
      throw new Error(
        "Editor not found."
      );
    }


    /*
     * ==========================================================
     * INPUT / TEXTAREA
     *
     * These are safe to replace.
     * ==========================================================
     */

    if (isInput(savedEditable)) {
      const input =
        savedEditable;

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


      /*
       * Notify React/Vue/etc.
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

      clearState();

      return;
    }


    /*
     * ==========================================================
     * RICH TEXT
     *
     * IMPORTANT:
     *
     * We intentionally do NOT modify rich-text editors yet.
     *
     * We do NOT use:
     *
     * - execCommand()
     * - Range.deleteContents()
     * - Range.insertNode()
     * - innerHTML
     * - fake keyboard events
     *
     * This prevents X/LinkedIn/Discord from becoming locked.
     * ==========================================================
     */

    throw new Error(
      "This rich-text editor cannot be safely replaced yet. Your original text is unchanged."
    );
  }


  /*
   * ============================================================
   * CLEAR STATE
   * ============================================================
   */

  function clearState() {
    savedEditable = null;
    savedStart = 0;
    savedEnd = 0;
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


  /*
   * ============================================================
   * ACTION MENU
   * ============================================================
   */

  function showActions() {
    /*
     * The selection was already captured before the menu
     * appeared.
     */

    const old =
      document.getElementById(
        "__gpttc_actions"
      );

    if (old) {
      old.remove();
    }


    /*
     * Create menu.
     */

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


    /*
     * Actions.
     */

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
     * Close when clicking outside.
     *
     * We do not prevent the site's normal editor behavior.
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
