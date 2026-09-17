/**
 * Single-user authentication.
 *
 * The expensive key derivation runs in the *browser*, not here: Cloudflare's
 * free tier caps a request at 10ms of CPU, which a 600k-iteration PBKDF2 would
 * blow through instantly. So the client stretches the passphrase and sends the
 * derived key; the server stores and compares a fast SHA-256 of it.
 *
 * That keeps the work factor intact — an attacker holding the database still has
 * to run the same 600k iterations per guess — while the server does almost no
 * work. The derived key only ever crosses the wire under TLS.
 */

import type { Db } from "./db/driver.js";
import { getSetting, setSetting } from "./db/repo.js";

/** Published to the client so it can derive the same key. Changing these invalidates the passphrase. */
export const KDF = {
  algorithm: "PBKDF2" as const,
  hash: "SHA-256" as const,
  iterations: 600_000,
  keyLengthBytes: 32,
};

export const SESSION_COOKIE = "fm_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

const KEY_SALT = "auth.salt";
const KEY_VERIFIER = "auth.verifier";
const KEY_FAILURES = "auth.failures";
const KEY_LOCKED_UNTIL = "auth.locked_until";

const MAX_FAILURES = 8;
const LOCKOUT_MINUTES = 15;

/* ------------------------------ byte plumbing ------------------------------ */

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return fromBase64(padded + "=".repeat((4 - (padded.length % 4)) % 4));
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares without leaking where two values diverge. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(new Uint8Array(digest));
}

/* -------------------------------- passphrase ------------------------------- */

export async function isConfigured(db: Db): Promise<boolean> {
  return (await getSetting(db, KEY_VERIFIER)) !== undefined;
}

/** The per-install salt, created on first request. Public by design — a salt is not a secret. */
export async function getOrCreateSalt(db: Db): Promise<string> {
  const existing = await getSetting(db, KEY_SALT);
  if (existing) return existing;
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
  await setSetting(db, KEY_SALT, salt);
  return salt;
}

export type SetupResult = { ok: true } | { ok: false; error: string };

export async function setupPassphrase(db: Db, derivedKeyB64: string): Promise<SetupResult> {
  if (await isConfigured(db)) {
    return { ok: false, error: "A passphrase is already set for this database." };
  }
  const verifier = await verifierFor(derivedKeyB64);
  if (verifier === null) return { ok: false, error: "Malformed key." };
  await setSetting(db, KEY_VERIFIER, verifier);
  return { ok: true };
}

export type LoginResult =
  | { ok: true }
  | { ok: false; error: string; retryAfterSeconds?: number };

export async function verifyPassphrase(db: Db, derivedKeyB64: string): Promise<LoginResult> {
  const lockedUntil = await getSetting(db, KEY_LOCKED_UNTIL);
  if (lockedUntil) {
    const remaining = Math.ceil((Date.parse(lockedUntil) - Date.now()) / 1000);
    if (remaining > 0) {
      return {
        ok: false,
        error: `Too many attempts. Try again in ${Math.ceil(remaining / 60)} minute(s).`,
        retryAfterSeconds: remaining,
      };
    }
  }

  const stored = await getSetting(db, KEY_VERIFIER);
  if (!stored) return { ok: false, error: "No passphrase has been set yet." };

  const candidate = await verifierFor(derivedKeyB64);
  if (candidate !== null && timingSafeEqual(candidate, stored)) {
    await setSetting(db, KEY_FAILURES, "0");
    await setSetting(db, KEY_LOCKED_UNTIL, "");
    return { ok: true };
  }

  const failures = Number((await getSetting(db, KEY_FAILURES)) ?? "0") + 1;
  await setSetting(db, KEY_FAILURES, String(failures));
  if (failures >= MAX_FAILURES) {
    const until = new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString();
    await setSetting(db, KEY_LOCKED_UNTIL, until);
    await setSetting(db, KEY_FAILURES, "0");
    return {
      ok: false,
      error: `Too many attempts. Locked for ${LOCKOUT_MINUTES} minutes.`,
      retryAfterSeconds: LOCKOUT_MINUTES * 60,
    };
  }
  return { ok: false, error: "That passphrase doesn't match." };
}

async function verifierFor(derivedKeyB64: string): Promise<string | null> {
  try {
    const bytes = fromBase64(derivedKeyB64);
    if (bytes.length !== KDF.keyLengthBytes) return null;
    return await sha256Hex(bytes);
  } catch {
    return null;
  }
}

/* --------------------------------- sessions -------------------------------- */

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function sign(payload: string, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(payload),
  );
  return toBase64Url(new Uint8Array(signature));
}

/** A signed, self-contained session cookie: no server-side session table to keep. */
export async function issueSession(secret: string): Promise<{ value: string; maxAge: number }> {
  const payload = toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }),
    ),
  );
  return { value: `${payload}.${await sign(payload, secret)}`, maxAge: SESSION_TTL_SECONDS };
}

export async function isSessionValid(cookie: string | undefined, secret: string): Promise<boolean> {
  if (!cookie) return false;
  const dot = cookie.lastIndexOf(".");
  if (dot <= 0) return false;

  const payload = cookie.slice(0, dot);
  const signature = cookie.slice(dot + 1);
  if (!timingSafeEqual(signature, await sign(payload, secret))) return false;

  try {
    const { exp } = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as { exp?: number };
    return typeof exp === "number" && exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
