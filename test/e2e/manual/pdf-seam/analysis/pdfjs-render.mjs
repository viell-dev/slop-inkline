// Renders page 1 of a PDF with pdf.js, as Firefox's viewer and Obsidian's
// PDF view do. Usage: node pdfjs-render.mjs <in.pdf> <dpi> <out.png>
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/opt/pdfjs5/node_modules/pdfjs-dist/");
const napi = require("@napi-rs/canvas");
const { createCanvas } = napi;
const pdfjs = await import("/opt/pdfjs5/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
const [file, dpi, out] = process.argv.slice(2);
const doc = await pdfjs.getDocument({
  data: new Uint8Array(readFileSync(file)),
  standardFontDataUrl: "/opt/pdfjs5/node_modules/pdfjs-dist/standard_fonts/",
  verbosity: 0,
}).promise;
const page = await doc.getPage(1);
const viewport = page.getViewport({ scale: Number(dpi) / 72 });
const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
const context = canvas.getContext("2d");
context.fillStyle = "white";
context.fillRect(0, 0, canvas.width, canvas.height);
await page.render({ canvasContext: context, viewport }).promise;
writeFileSync(out, canvas.toBuffer("image/png"));
