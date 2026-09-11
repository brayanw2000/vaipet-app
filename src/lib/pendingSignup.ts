// Persistência do cadastro pendente (etapa OTP de signup) entre recargas da página.
// Cenário real: no celular, o usuário sai do VaiPet para abrir o Gmail e pegar o
// código; o iOS pode descartar a aba em segundo plano e a página remonta zerada.
// Armazena o MÍNIMO indispensável para reabrir a etapa de verificação —
// e-mail e intenção — NUNCA senha, NUNCA código OTP e nunca dados de perfil.
const STORAGE_KEY = "vaipet_pending_signup_v1";

// TTL igual à expiração padrão do OTP de signup no Supabase (1 hora):
// depois disso o código não é mais válido e o estado pendente é descartado.
export const PENDING_SIGNUP_TTL_MS = 60 * 60 * 1000;

export type PendingSignup = {
  email: string;
  signupIntent: "pet_owner" | "petwalker";
  savedAt: number;
};

// Estrutura EXATA aceita na leitura — qualquer campo extra/inexistente invalida.
const EXPECTED_KEYS = ["email", "savedAt", "signupIntent"].sort().join(",");

export function savePendingSignup(
  state: Omit<PendingSignup, "savedAt">,
): void {
  try {
    const record: PendingSignup = { ...state, savedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage indisponível — o fluxo segue sem persistência.
  }
}

export function readPendingSignup(): PendingSignup | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: Partial<PendingSignup> | null = null;
  try {
    parsed = JSON.parse(raw) as Partial<PendingSignup> | null;
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // noop
    }
    return null;
  }

  // Validação rigorosa: estrutura exata, campos com tipos corretos e
  // timestamp finito. Registro inválido é descartado.
  const malformed =
    !parsed ||
    typeof parsed.email !== "string" ||
    parsed.email.length === 0 ||
    (parsed.signupIntent !== "pet_owner" &&
      parsed.signupIntent !== "petwalker") ||
    typeof parsed.savedAt !== "number" ||
    !Number.isFinite(parsed.savedAt) ||
    Object.keys(parsed).sort().join(",") !== EXPECTED_KEYS;
  if (malformed) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // noop
    }
    return null;
  }

  if (Date.now() - parsed.savedAt > PENDING_SIGNUP_TTL_MS) {
    // Expirado — OTP não é mais válido; cadastro pendente é descartado.
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // noop
    }
    return null;
  }

  return parsed as PendingSignup;
}

export function clearPendingSignup(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
}
