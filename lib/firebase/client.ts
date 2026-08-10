"use client";

import { FirebaseApp, getApp, getApps, initializeApp } from "firebase/app";
import { Auth, getAuth } from "firebase/auth";

const requiredConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const requiredConfigKeys = [
  "apiKey",
  "authDomain",
  "projectId",
  "databaseURL",
  "appId",
] as const;

export const missingFirebaseConfig = requiredConfigKeys
  .map((key) => [key, requiredConfig[key]] as const)
  .filter(([, value]) => !value)
  .map(([key]) => key);

export function isFirebaseConfigured() {
  return missingFirebaseConfig.length === 0;
}

function getFirebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured()) {
    throw new Error("FIREBASE_CLIENT_NOT_CONFIGURED");
  }

  return getApps().length
    ? getApp()
    : initializeApp({
        apiKey: requiredConfig.apiKey!,
        authDomain: requiredConfig.authDomain!,
        projectId: requiredConfig.projectId!,
        databaseURL: requiredConfig.databaseURL!,
        storageBucket: requiredConfig.storageBucket,
        messagingSenderId: requiredConfig.messagingSenderId,
        appId: requiredConfig.appId!,
      });
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}
