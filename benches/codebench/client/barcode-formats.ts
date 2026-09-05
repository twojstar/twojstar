"use strict";

(() => {
  const select = document.querySelector("#bType");
  if (!select) return;

  const groups = [
    ["More 2D / stacked", [
      ["rectangularmicroqrcode", "rMQR"],
      ["datamatrixrectangular", "Data Matrix Rectangular"],
      ["datamatrixrectangularextension", "Data Matrix DMRE"],
      ["micropdf417", "MicroPDF417"],
      ["pdf417compact", "Compact PDF417"],
      ["azteccodecompact", "Compact Aztec"],
      ["aztecrune", "Aztec Rune"],
      ["dotcode", "DotCode"],
      ["hanxin", "Han Xin Code"],
      ["codablockf", "Codablock F"],
      ["code16k", "Code 16K"],
    ]],
    ["GS1 / retail", [
      ["databaromni", "GS1 DataBar Omni"],
      ["databarlimited", "GS1 DataBar Limited"],
      ["databarexpanded", "GS1 DataBar Expanded"],
      ["gs1dlqrcode", "GS1 Digital Link QR"],
      ["gs1dldatamatrix", "GS1 Digital Link Data Matrix"],
    ]],
  ];

  groups.forEach(([label, formats]) => {
    const group = document.createElement("optgroup");
    group.label = label;
    formats.forEach(([value, text]) => {
      if (!select.querySelector(`option[value="${value}"]`)) group.appendChild(new Option(text, value));
    });
    if (group.children.length) select.appendChild(group);
  });

  if (typeof twoD !== "undefined") {
    [
      "rectangularmicroqrcode", "datamatrixrectangular", "datamatrixrectangularextension",
      "micropdf417", "pdf417compact", "azteccodecompact", "aztecrune", "dotcode", "hanxin",
      "codablockf", "code16k", "gs1dlqrcode", "gs1dldatamatrix",
    ].forEach((format) => twoD.add(format));
  }

  if (typeof bHints !== "undefined") {
    Object.assign(bHints, {
      rectangularmicroqrcode: "Rectangular Micro QR — compact and wide; short payloads work best.",
      datamatrixrectangular: "Rectangular Data Matrix for narrow labels and constrained layouts.",
      datamatrixrectangularextension: "DMRE — extended rectangular Data Matrix sizes.",
      micropdf417: "Compact stacked 2D code for smaller labels.",
      pdf417compact: "PDF417 with compact row indicators.",
      azteccodecompact: "Compact Aztec — dense short payloads, no quiet zone required.",
      aztecrune: "Aztec Rune — numeric values 0–255 only.",
      dotcode: "DotCode — dotted 2D symbology for high-speed printing.",
      hanxin: "Han Xin Code — 2D matrix commonly used in China.",
      codablockf: "Codablock F — stacked Code 128 for longer payloads.",
      code16k: "Code 16K — compact stacked linear code.",
      databaromni: "GS1 DataBar Omnidirectional — GTIN data.",
      databarlimited: "GS1 DataBar Limited — restricted GTIN range for small labels.",
      databarexpanded: "GS1 DataBar Expanded — variable-length GS1 AI data.",
      gs1dlqrcode: "GS1 Digital Link URI encoded as QR.",
      gs1dldatamatrix: "GS1 Digital Link URI encoded as Data Matrix.",
    });
  }
})();
