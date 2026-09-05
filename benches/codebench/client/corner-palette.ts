"use strict";

(() => {
  const configs = [
    {
      id: "qCornerSq",
      kind: "frame",
      choices: [
        ["rounded", "Soft square"],
        ["dots", "Dots"],
        ["classy", "Classy"],
        ["classy-rounded", "Classy round"],
      ],
    },
    {
      id: "qCornerDot",
      kind: "center",
      choices: [
        ["rounded", "Rounded"],
        ["dots", "Dots"],
        ["extra-rounded", "Extra round"],
        ["classy", "Classy"],
        ["classy-rounded", "Classy round"],
      ],
    },
  ];

  function frameIcon(type) {
    const outerRadius = type === "rounded" ? 5 : type === "dots" ? 12 : type === "classy-rounded" ? 9 : 2;
    const rotate = type === "classy" ? 6 : type === "classy-rounded" ? -6 : 0;
    return `<svg viewBox="0 0 60 60" aria-hidden="true"><g transform="rotate(${rotate} 30 30)">`
      + `<rect x="8" y="8" width="44" height="44" rx="${outerRadius}" fill="currentColor"/>`
      + `<rect x="16" y="16" width="28" height="28" rx="${Math.max(0, outerRadius - 2)}" fill="var(--paper,#fff)"/>`
      + '<rect x="24" y="24" width="12" height="12" rx="3" fill="currentColor"/></g></svg>';
  }

  function centerIcon(type) {
    const radius = type === "dots" || type === "extra-rounded" ? 9 : type === "rounded" || type === "classy-rounded" ? 5 : 1;
    const rotate = type === "classy" ? 10 : type === "classy-rounded" ? -10 : 0;
    return `<svg viewBox="0 0 60 60" aria-hidden="true"><rect x="7" y="7" width="46" height="46" rx="7" fill="none" stroke="currentColor" stroke-width="6"/>`
      + `<rect x="21" y="21" width="18" height="18" rx="${radius}" transform="rotate(${rotate} 30 30)" fill="currentColor"/></svg>`;
  }

  configs.forEach(({ id, kind, choices }) => {
    const select = document.querySelector(`#${id}`);
    if (!select) return;
    const grid = select.parentElement?.querySelector(".qr-style-grid") || select.nextElementSibling;
    if (!grid?.classList.contains("qr-style-grid")) return;

    choices.forEach(([value, label]) => {
      if (!select.querySelector(`option[value="${value}"]`)) select.add(new Option(label, value));
      if (grid.querySelector(`[data-value="${value}"]`)) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "qr-style-choice";
      button.dataset.value = value;
      button.title = label;
      button.setAttribute("aria-label", label);
      button.innerHTML = (kind === "frame" ? frameIcon(value) : centerIcon(value)) + `<span>${label}</span>`;
      button.onclick = () => {
        select.value = value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        grid.querySelectorAll("button").forEach((choice) => {
          choice.setAttribute("aria-pressed", String(choice.dataset.value === value));
        });
      };
      grid.appendChild(button);
    });
  });
})();
