import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson, getEncryptionKey, secretsMatch } from "../src/lib/crypto.js";

const key = Buffer.alloc(32, 7);

describe("token encryption", () => {
  it("round-trips a token blob", () => {
    // Dates would deserialize as strings, so the stored shape uses epoch ms.
    const tokens = {
      accessToken: "at-123",
      refreshToken: "rt-456",
      expiresAtMs: 1_000_000_000_000,
      scope: "https://www.googleapis.com/auth/calendar.freebusy",
    };
    const blob = encryptJson({ tokens }, key);
    expect(decryptJson(blob, key)).toEqual({ tokens });
  });

  it("never stores plaintext", () => {
    const blob = encryptJson({ accessToken: "super-secret-token" }, key);
    expect(blob).not.toContain("super-secret-token");
    // IV is random, so the same plaintext encrypts differently.
    expect(blob).not.toBe(encryptJson({ accessToken: "super-secret-token" }, key));
  });

  it("detects tampering", () => {
    const blob = Buffer.from(encryptJson({ secret: 1 }, key), "base64");
    const last = blob.length - 1;
    blob[last] = blob[last]! ^ 0xff;
    expect(() =>
      decryptJson(blob.toString("base64"), key),
    ).toThrow();
  });

  it("refuses blobs from another key", () => {
    const blob = encryptJson({ secret: 1 }, key);
    expect(() => decryptJson(blob, Buffer.alloc(32, 9))).toThrow();
  });

  it("validates the configured key", () => {
    const previous = process.env.TOKEN_ENCRYPTION_KEY;
    try {
      delete process.env.TOKEN_ENCRYPTION_KEY;
      expect(() => getEncryptionKey()).toThrow(/TOKEN_ENCRYPTION_KEY is not set/);
      process.env.TOKEN_ENCRYPTION_KEY = "short";
      expect(() => getEncryptionKey()).toThrow(/64 hex/);
      process.env.TOKEN_ENCRYPTION_KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
      expect(getEncryptionKey()).toHaveLength(32);
    } finally {
      if (previous === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
      else process.env.TOKEN_ENCRYPTION_KEY = previous;
    }
  });

  it("compares secrets without leaking length", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abc", "abd")).toBe(false);
    expect(secretsMatch("abc", "abcd")).toBe(false);
    expect(secretsMatch("", "")).toBe(true);
  });
});
