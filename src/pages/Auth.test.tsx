import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import Auth from "./Auth";
import {
  savePendingSignup,
  readPendingSignup,
  clearPendingSignup,
} from "@/lib/pendingSignup";

// Estado compartilhado com as fábricas de mock (vi.mock é içado — todo o
// estado fechado pelas fábricas DEVE nascer em vi.hoisted).
const h = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  verifyOtp: vi.fn(),
  resend: vi.fn(),
  getSession: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: h },
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => h.toastError(...args),
    success: (...args: unknown[]) => h.toastSuccess(...args),
  },
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => h.navigate,
  useSearchParams: () => [new URLSearchParams()],
  Link: (props: { to: string; children?: React.ReactNode }) =>
    React.createElement("a", { href: props.to }, props.children),
}));

const PENDING = {
  email: "dono@teste.com",
  signupIntent: "pet_owner" as const,
  fullName: "Maria Teste",
  phone: "11999999999",
};

const noSession = () => h.getSession.mockResolvedValue({ data: { session: null } });

// Preenche o formulário de cadastro e submete (passando pela escolha de intenção).
// AnimatePresence mode="wait" exige que a tela anterior termine a animação de
// saída antes da próxima montar — cada transição usa waitFor com folga.
const WAIT = { timeout: 3000 };

const submitRegistration = async (email = "novo@teste.com") => {
  fireEvent.click(screen.getByText("Crie uma"));
  await waitFor(
    () => expect(screen.getByTestId("intent-owner-btn")).toBeInTheDocument(),
    WAIT,
  );
  fireEvent.click(screen.getByTestId("intent-owner-btn"));
  await waitFor(
    () =>
      expect(screen.getByPlaceholderText("Nome Completo")).toBeInTheDocument(),
    WAIT,
  );
  fireEvent.change(screen.getByPlaceholderText("Nome Completo"), {
    target: { value: "Novo Usuário" },
  });
  fireEvent.change(screen.getByPlaceholderText("Telefone"), {
    target: { value: "11988887777" },
  });
  fireEvent.change(screen.getByPlaceholderText("E-mail"), {
    target: { value: email },
  });
  fireEvent.change(screen.getByPlaceholderText("Senha"), {
    target: { value: "senha123" },
  });
  fireEvent.change(screen.getByPlaceholderText("Confirmar Senha"), {
    target: { value: "senha123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cadastrar" }));
  await waitFor(() => expect(h.signUp).toHaveBeenCalledTimes(1));
};

const fillOtp = () => {
  const digits = document.querySelectorAll<HTMLInputElement>(".otp-digit-input");
  "123456".split("").forEach((d, i) => {
    fireEvent.change(digits[i], { target: { value: d } });
  });
};

describe("Auth — fluxo de cadastro OTP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    noSession();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("restaura a etapa OTP no mount quando não há sessão (retorno após trocar de app)", async () => {
    savePendingSignup(PENDING);

    render(<Auth />);

    await waitFor(() =>
      expect(screen.getByText("Verificar E-mail")).toBeInTheDocument(),
    );
    expect(screen.getByText(/dono@teste\.com/)).toBeInTheDocument();
    // Nenhuma chamada de signup/resend foi disparada pela restauração.
    expect(h.signUp).not.toHaveBeenCalled();
    expect(h.resend).not.toHaveBeenCalled();
  });

  it("visibilitychange reidrata a etapa OTP (usuário volta do Gmail)", async () => {
    render(<Auth />);
    // Sem cadastro pendente: permanece na tela inicial.
    await waitFor(
      () => expect(screen.getByText("Entrar no VaiPet")).toBeInTheDocument(),
      WAIT,
    );
    expect(screen.queryByText("Verificar E-mail")).not.toBeInTheDocument();

    // Registro pendente surge enquanto a página está viva (ex.: restauração
    // após descarte/recarga) e o visibilitychange reidrata a etapa OTP.
    savePendingSignup(PENDING);
    fireEvent(document, new Event("visibilitychange"));

    await waitFor(
      () => expect(screen.getByText("Verificar E-mail")).toBeInTheDocument(),
      WAIT,
    );
  });

  it("não restaura quando já existe sessão ativa e limpa o registro pendente", async () => {
    savePendingSignup(PENDING);
    h.getSession.mockResolvedValue({
      data: { session: { user: { id: "u1" } } },
    });

    render(<Auth />);

    await waitFor(() => expect(h.getSession).toHaveBeenCalled());
    expect(screen.queryByText("Verificar E-mail")).not.toBeInTheDocument();
    expect(readPendingSignup()).toBeNull();
  });

  it("e-mail já cadastrado (identities vazio, sem sessão): NÃO mostra OTP e informa claramente", async () => {
    // Contrato Supabase com "Confirm email" habilitado: HTTP 200, error=null,
    // session=null e user.identities=[] — e nenhum novo e-mail é enviado.
    h.signUp.mockResolvedValue({
      data: { session: null, user: { identities: [] } },
      error: null,
    });

    render(<Auth />);
    await submitRegistration("ja-existe@teste.com");

    await waitFor(
      () => expect(screen.getByText("Entrar no VaiPet")).toBeInTheDocument(),
      WAIT,
    );
    expect(screen.queryByText("Verificar E-mail")).not.toBeInTheDocument();
    expect(h.toastError).toHaveBeenCalledWith(
      expect.stringContaining("já está cadastrado"),
    );
    // Nenhum registro pendente residual.
    expect(readPendingSignup()).toBeNull();
  });

  it("cadastro novo (identidade de e-mail pendente): mostra OTP e persiste estado pendente", async () => {
    h.signUp.mockResolvedValue({
      data: { session: null, user: { identities: [{ provider: "email" }] } },
      error: null,
    });

    render(<Auth />);
    await submitRegistration("novo@teste.com");

    await waitFor(
      () => expect(screen.getByText("Verificar E-mail")).toBeInTheDocument(),
      WAIT,
    );
    expect(screen.getByText(/novo@teste\.com/)).toBeInTheDocument();
    const pending = readPendingSignup();
    expect(pending?.email).toBe("novo@teste.com");
    expect(pending?.signupIntent).toBe("pet_owner");
    // signUp chamado exatamente uma vez — sem duplicação.
    expect(h.signUp).toHaveBeenCalledTimes(1);
  });

  it("confirmação de e-mail desabilitada (sessão direta no signUp): navega sem tela OTP", async () => {
    h.signUp.mockResolvedValue({
      data: { session: { user: { id: "u9" } }, user: { identities: [] } },
      error: null,
    });

    render(<Auth />);
    await submitRegistration("direto@teste.com");

    expect(screen.queryByText("Verificar E-mail")).not.toBeInTheDocument();
    expect(h.navigate).toHaveBeenCalledWith("/inicio");
    expect(readPendingSignup()).toBeNull();
  });

  it("sucesso na verificação OTP limpa o registro pendente", async () => {
    savePendingSignup(PENDING);
    h.verifyOtp.mockResolvedValue({ error: null });

    render(<Auth />);
    await waitFor(() =>
      expect(screen.getByText("Verificar E-mail")).toBeInTheDocument(),
    );

    fillOtp();
    fireEvent.click(screen.getByRole("button", { name: /Confirmar Código/i }));

    await waitFor(() => expect(h.verifyOtp).toHaveBeenCalledTimes(1));
    expect(h.verifyOtp).toHaveBeenCalledWith({
      email: "dono@teste.com",
      token: "123456",
      type: "signup",
    });
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith("/inicio"));
    expect(readPendingSignup()).toBeNull();
  });

  it("reenvio não duplica signUp e limpa ao cancelar", async () => {
    savePendingSignup(PENDING);
    h.resend.mockResolvedValue({ error: null });

    render(<Auth />);
    await waitFor(() =>
      expect(screen.getByText("Verificar E-mail")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /Enviar novamente/i }));
    await waitFor(() => expect(h.resend).toHaveBeenCalledTimes(1));
    // signUp nunca foi chamado novamente — sem duplicação de signup/OTP.
    expect(h.signUp).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("otp-cancel"));
    await waitFor(() =>
      expect(screen.getByText("Entrar no VaiPet")).toBeInTheDocument(),
    );
    expect(readPendingSignup()).toBeNull();
    expect(screen.queryByText("Verificar E-mail")).not.toBeInTheDocument();
  });

  it("senha e código OTP nunca são persistidos", async () => {
    h.signUp.mockResolvedValue({
      data: { session: null, user: { identities: [{ provider: "email" }] } },
      error: null,
    });

    render(<Auth />);
    await submitRegistration("seguro@teste.com");
    await waitFor(
      () => expect(screen.getByText("Verificar E-mail")).toBeInTheDocument(),
      WAIT,
    );

    const raw = localStorage.getItem("vaipet_pending_signup_v1") ?? "";
    expect(raw).not.toContain("senha123");
    expect(raw).not.toContain("password");
    expect(raw).not.toContain("otp");
    expect(raw).toContain("seguro@teste.com");
    clearPendingSignup();
  });
});
