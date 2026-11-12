import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * CSP dasar tanpa nonce (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md, "Without Nonces").
 * - connect-src: hanya origin sendiri (aset OCR /tesseract/*, HMR dev) + Firebase AI Logic & App Check.
 * - worker-src 'self': worker tesseract dimuat dari /tesseract/worker.min.js (workerBlobURL: false), tanpa blob:/CDN.
 * - 'wasm-unsafe-eval': core OCR WebAssembly. 'unsafe-eval' hanya di dev (React debug).
 * - reCAPTCHA Enterprise (App Check) butuh script/frame dari google.com/gstatic.com.
 */
const csp = [
  "default-src 'self'",
  // 'unsafe-eval' hanya dev (React debug). 'unsafe-inline' tetap di prod: payload RSC inline (self.__next_f.push) tidak
  // tercakup SRI, nonce tidak kompatibel dengan PPR (cacheComponents) menurut docs, dan hash tidak bisa dimasukkan karena
  // header dibekukan saat build sebelum HTML statis ada. Diuji: tanpa 'unsafe-inline' halaman prod tidak ter-hydrate.
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://www.google.com https://www.gstatic.com${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "worker-src 'self'",
  // data:: adapter on-device Firebase AI Logic men-decode inlineData lewat fetch(data:…) — tetap di perangkat.
  "connect-src 'self' data: https://firebasevertexai.googleapis.com https://content-firebaseappcheck.googleapis.com https://www.google.com",
  "frame-src https://www.google.com https://recaptcha.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Content-Security-Policy", value: csp }] }];
  },
};

export default nextConfig;
