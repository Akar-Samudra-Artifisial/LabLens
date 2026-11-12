"use client";

import { type FirebaseApp, getApp, getApps, initializeApp } from "firebase/app";
import {
  type AppCheck,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "firebase/app-check";

declare global {
  // Dibaca App Check SDK saat init; true = SDK mencetak debug token baru di console.
  var FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string | undefined;
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let appCheck: AppCheck | null = null;

/** Inisialisasi Firebase + App Check. Hanya boleh dipanggil di browser. */
export function getFirebaseApp(): FirebaseApp {
  if (typeof window === "undefined") {
    throw new Error("getFirebaseApp() hanya untuk client (browser).");
  }
  const missing = Object.entries(firebaseConfig)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(
      `Konfigurasi Firebase belum lengkap: ${missing.join(", ")}. Isi .env.local (lihat .env.example).`,
    );
  }

  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

  if (!appCheck) {
    const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
    if (!siteKey && process.env.NODE_ENV !== "production") {
      // Dev lokal: App Check belum di-enforce, jadi boleh dilewati sampai site key reCAPTCHA Enterprise diisi.
      console.warn("[LabLens] NEXT_PUBLIC_RECAPTCHA_SITE_KEY kosong — App Check dilewati (dev saja).");
      return app;
    }
    if (!siteKey) {
      throw new Error(
        "NEXT_PUBLIC_RECAPTCHA_SITE_KEY kosong — App Check wajib untuk Firebase AI Logic.",
      );
    }
    if (process.env.NODE_ENV !== "production") {
      globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN =
        process.env.NEXT_PUBLIC_APPCHECK_DEBUG_TOKEN || true;
    }
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }

  return app;
}
