"use strict";

(() => {
  const fields = document.querySelector("#qrFields");
  if (!fields) return;

  const style = document.createElement("style");
  style.textContent = `
    .sensitive-input {
      display: flex;
      gap: 8px;
      align-items: stretch;
    }
    .sensitive-input input { min-width: 0; flex: 1; }
    .sensitive-input .btn { flex: 0 0 auto; }
    .sensitive-hint { margin: 6px 0 0; }
  `;
  document.head.appendChild(style);

  function addPasswordControls(input) {
    if (input.dataset.passwordControls === "true") return;
    input.dataset.passwordControls = "true";
    input.type = "password";
    input.autocomplete = "new-password";
    input.setAttribute("autocomplete", "new-password");

    const wrapper = document.createElement("div");
    wrapper.className = "sensitive-input";
    input.replaceWith(wrapper);
    wrapper.appendChild(input);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn ghost";
    toggle.textContent = "Show";
    toggle.setAttribute("aria-label", "Show Wi-Fi password");
    toggle.setAttribute("aria-pressed", "false");
    toggle.addEventListener("click", () => {
      const visible = input.type === "text";
      input.type = visible ? "password" : "text";
      toggle.textContent = visible ? "Show" : "Hide";
      toggle.setAttribute("aria-label", `${visible ? "Show" : "Hide"} Wi-Fi password`);
      toggle.setAttribute("aria-pressed", String(!visible));
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    });
    wrapper.appendChild(toggle);

    const hint = document.createElement("p");
    hint.id = "wifiPasswordPrivacy";
    hint.className = "hint sensitive-hint";
    hint.textContent = "Encoded locally. Anyone who can scan the QR can read this password.";
    wrapper.insertAdjacentElement("afterend", hint);
    input.setAttribute("aria-describedby", hint.id);
  }

  function hardenField(field) {
    if (field.dataset.privacyHardened === "true") return;
    field.dataset.privacyHardened = "true";
    field.autocomplete = field.id === "f_pass" ? "new-password" : "off";
    field.setAttribute("autocomplete", field.autocomplete);
    field.setAttribute("autocapitalize", "none");
    field.setAttribute("autocorrect", "off");
    field.spellcheck = false;
    if (field.id === "f_pass") addPasswordControls(field);
  }

  function hardenFields() {
    fields.querySelectorAll("input,textarea").forEach(hardenField);
  }

  function clearSensitiveQrState() {
    const password = document.querySelector("#f_pass");
    if (!password) return false;

    password.value = "";
    password.type = "password";
    globalThis.CodeBenchUi?.invalidateQrRenderState?.();
    if (typeof qr !== "undefined") qr = null;
    if (typeof _printSVG !== "undefined") _printSVG = null;

    document.querySelector("#qrHost")?.replaceChildren();
    document.querySelector(".print-scale")?.replaceChildren();
    document.querySelector("#printRoot")?.replaceChildren();
    document.querySelector("#printModal")?.classList.remove("show");

    const testStatus = document.querySelector("#qrTestStatus");
    if (testStatus) {
      testStatus.dataset.state = "idle";
      testStatus.innerHTML = "<b>Not tested</b><span>The Wi-Fi password was cleared.</span>";
    }
    return true;
  }

  new MutationObserver(hardenFields).observe(fields, { childList: true, subtree: true });
  hardenFields();

  let clearedForPageExit = false;
  window.addEventListener("pagehide", () => {
    clearedForPageExit = clearSensitiveQrState();
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted || !clearedForPageExit) return;
    clearedForPageExit = false;
    if (typeof renderQR === "function") renderQR();
  });
})();
