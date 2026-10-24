// scripts/check-contrast.mjs — WCAG contrast check for theme token pairs.
const colors = {
  light: {
    text: "#0f172a",
    surface: "#ffffff",
    surfacePopover: "#ffffff",
    muted: "#64748b",
    accent: "#4f46e5",
    rowSelectedBg: "#e8e7fb",
    rowSelectedText: "#0f172a",
  },
  dark: {
    text: "#e2e8f0",
    surface: "#0f172a",
    surfacePopover: "#0f172a",
    muted: "#94a3b8",
    accent: "#818cf8",
    rowSelectedBg: "#2a2f4a",
    rowSelectedText: "#e2e8f0",
  },
};

function hexToRgb(c) {
  if (c.startsWith("rgba")) {
    const m = c.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    const a = parseFloat(m[4]);
    // blend over black/white? approximate by mixing with surface not needed for text bg; use as-is alpha over surface handled separately.
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  const h = c.replace("#", "");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
}

function luminance({ r, g, b }) {
  const chan = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

function contrast(fg, bg) {
  // If fg/bg alpha <1, blend fg? Simplify: treat provided as opaque-ish.
  const l1 = luminance(hexToRgb(fg));
  const l2 = luminance(hexToRgb(bg));
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

const pairs = [
  { name: "dropdown text/surface", fg: "text", bg: "surface" },
  { name: "dropdown text/popover", fg: "text", bg: "surfacePopover" },
  { name: "muted text/surface", fg: "muted", bg: "surface" },
  { name: "accent text/surface", fg: "accent", bg: "surface" },
  { name: "row-selected text/bg", fg: "rowSelectedText", bg: "rowSelectedBg" },
];

let failed = false;
for (const theme of ["light", "dark"]) {
  console.log(`\n== ${theme} ==`);
  for (const p of pairs) {
    const ratio = contrast(colors[theme][p.fg], colors[theme][p.bg]);
    const ok = ratio >= 4.5;
    if (!ok) failed = true;
    console.log(`${p.name}: ${ratio.toFixed(2)}:1 ${ok ? "OK" : "FAIL"}`);
  }
}
if (failed) {
  console.error("\nContrast check FAILED");
  process.exit(1);
}
console.log("\nContrast check passed");
