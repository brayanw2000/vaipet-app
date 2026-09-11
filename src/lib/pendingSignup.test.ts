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
    // Mínimo indispensável: exatamente email + signupIntent + savedAt.
    expect(Object.keys(JSON.parse(raw))).toEqual([
      "email",
      "signupIntent",
      "savedAt",
    ]);
  });

  it("NUNCA persiste dados de perfil (nome/telefone) — registro legado é invalidado", () => {
    savePendingSignup(validState);
    const raw = localStorage.getItem(KEY) ?? "";
    expect(raw).not.toContain("fullName");
    expect(raw).not.toContain("phone");

    // Registro legado (ou adulterado) com campos extras é descartado e removido.
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...validState, fullName: "Maria", phone: "119", savedAt: Date.now() }),
    );
    expect(readPendingSignup()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
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

  it("descarta savedAt não-numérico (timestamp deve ser finito)", () => {
    localStorage.setItem(KEY, JSON.stringify({ ...validState, savedAt: "agora" }));
    expect(readPendingSignup()).toBeNull();

    // NaN/Infinity não são serializáveis em JSON — viram null e são rejeitados.
    localStorage.setItem(KEY, JSON.stringify({ ...validState, savedAt: null }));
    expect(readPendingSignup()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
