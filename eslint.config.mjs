import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Profil Chrome spike Gemini Nano (berisi JS bawaan Chrome).
    "spike/.chrome-profile/**",
    // Aset OCR tesseract.js hasil salinan (pnpm ocr:assets), bukan kode proyek.
    "public/tesseract/**",
  ]),
]);

export default eslintConfig;
