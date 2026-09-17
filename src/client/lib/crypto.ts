/**
 * Passphrase stretching, done in the browser.
 *
 * The server can't afford 600k PBKDF2 iterations inside Cloudflare's 10ms CPU
 * budget, so the work happens here and only the 32-byte derived key is sent.
 * The work factor is unchanged from an attacker's point of view: guessing the
 * passphrase still means running these iterations once per guess.
 */

export interface KdfParams {
  salt: string;
  iterations: number;
  hash: string;
  keyLengthBytes: number;
}

export async function deriveKey(passphrase: string, params: KdfParams): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: fromBase64(params.salt),
      iterations: params.iterations,
      hash: params.hash,
    },
    keyMaterial,
    params.keyLengthBytes * 8,
  );

  return toBase64(new Uint8Array(bits));
}

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

/**
 * A blunt but honest passphrase check: length first, because length is what
 * actually matters, then a nudge away from single-character-class strings.
 */
export function passphraseProblem(passphrase: string): string | null {
  if (passphrase.length < 12) return "Use at least 12 characters. A short sentence works well.";
  if (/^\d+$/.test(passphrase)) return "All digits is easy to guess. Add words.";
  if (/^(.)\1+$/.test(passphrase)) return "That's one character repeated.";
  return null;
}
