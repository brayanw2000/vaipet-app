import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  savePendingSignup,
  readPendingSignup,
  clearPendingSignup,
  PENDING_SIGNUP_TTL_MS,
} from "./pendingSignup";

const KEY = "vaipet_pending_signup_v1";

const validState = {
  email: "dono@teste.com",
  signupIntent: "pet_owner" as const,
  fullName: "Maria Teste",
  phone: "11999999999",
};

describe("pendingSignup — persistência do cadastro pendente (OTP)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("salva, lê e limpa o cadastro pendente com namespace próprio", () => {
    savePendingSignup(validState);

    const raw = localStorage.getItem(KEY);
    expect(raw).not.toBeNull();

    const pending = readPendingSignup();
    expect(pending).toEqual({ ...validState, savedAt: expect.any(Number) });

    clearPendingSignup();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(readPendingSignup()).toBeNull();
  });

  it("NUNCA persiste senha ou código OTP", () => {
    savePendingSignup(validState);

    const raw = localStorage.getItem(KEY) ?? "";
    expect(raw).not.toContain("password");
    expect(raw).not.toContain("senha");
    expect(raw).not.toContain("otp");
    expect(Object.keys(JSON.parse(raw))).toEqual([
      "email",
      "signupIntent",
      "fullName",
      "phone",
      "savedAt",
    ]);
  });

  it("expira pelo TTL (1h — expiração do OTP no Supabase) e descarta sozinho", () => {
    savePendingSignup(validState);
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...stored, savedAt: Date.now() - PENDING_SIGNUP_TTL_MS - 1 }),
    );

    expect(readPendingSignup()).toBeNull();
    // Registro expirado é removido do storage.
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("descarta registro corrompido sem lançar", () => {
    localStorage.setItem(KEY, "{not-json");
    expect(readPendingSignup()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("descarta registro com campos inválidos (intenção desconhecida / e-mail vazio)", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...validState, signupIntent: "hacker" }),
    );
    expect(readPendingSignup()).toBeNull();

    localStorage.setItem(KEY, JSON.stringify({ ...validState, email: "" }));
    expect(readPendingSignup()).toBeNull();
  });
});
