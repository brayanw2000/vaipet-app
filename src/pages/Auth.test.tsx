import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
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
  // useSearchParams é configurável por teste (ex.: /auth?type=recovery).
  searchParams: new URLSearchParams(),
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
  useSearchParams: () => [h.searchParams],
  Link: (props: { to: string; children?: React.ReactNode }) =>
    React.createElement("a", { href: props.to }, props.children),
}));

// Forma MÍNIMA persistida: e-mail + intenção + savedAt (gerado no save).
// Nunca nome, telefone, senha ou código OTP.
const PENDING = {
  email: "dono@teste.com",
  signupIntent: "pet_owner" as const,
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
    h.searchParams = new URLSearchParams();
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

  it("recuperação de senha (/auth?type=recovery) vence: OTP não aparece e pendente é limpo", async () => {
    savePendingSignup(PENDING);
    h.searchParams = new URLSearchParams("type=recovery");

    render(<Auth />);

    await waitFor(
      () => expect(screen.getByText("Nova Senha")).toBeInTheDocument(),
      WAIT,
    );
    expect(screen.queryByText("Verificar E-mail")).not.toBeInTheDocument();
    // Cadastro pendente é resíduo na recuperação — descartado.
    expect(readPendingSignup()).toBeNull();
  });

  it("resposta atrasada de getSession após cancelamento NÃO reabre a tela OTP", async () => {
    savePendingSignup(PENDING);
    noSession();

    render(<Auth />);
    await waitFor(
      () => expect(screen.getByText("Verificar E-mail")).toBeInTheDocument(),
      WAIT,
    );

    // Segunda restauração (visibilitychange) com resposta em atraso.
    let resolveLate!: (value: { data: { session: null } }) => void;
    h.getSession.mockImplementation(
      () =>
        new Promise<{ data: { session: null } }>((resolve) => {
          resolveLate = resolve;
        }),
    );
    fireEvent(document, new Event("visibilitychange"));
    expect(h.getSession).toHaveBeenCalledTimes(2);

    // Usuário cancela enquanto a resposta atrasada está em voo.
    fireEvent.click(screen.getByTestId("otp-cancel"));
    await waitFor(
      () => expect(screen.getByText("Entrar no VaiPet")).toBeInTheDocument(),
      WAIT,
    );

    // A resposta antiga chega agora — jamais pode reabrir a OTP.
    await act(async () => {
      resolveLate({ data: { session: null } });
    });
    expect(screen.queryByText("Verificar E-mail")).not.toBeInTheDocument();
    expect(readPendingSignup()).toBeNull();
  });

  it("componente desmontado antes da resolução: nenhuma atualização tardia", async () => {
    savePendingSignup(PENDING);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    let resolveLate!: (value: { data: { session: null } }) => void;
    h.getSession.mockImplementation(
      () =>
        new Promise<{ data: { session: null } }>((resolve) => {
          resolveLate = resolve;
        }),
    );

    const { unmount } = render(<Auth />);
    expect(h.getSession).toHaveBeenCalledTimes(1);
    unmount();

    await act(async () => {
      resolveLate({ data: { session: null } });
    });

    // Nenhum setState tardio: sem erro/warning de atualização pós-desmonte.
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
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

  it("dois cliques rápidos em reenviar disparam apenas UMA chamada", async () => {
    savePendingSignup(PENDING);
    let resolveResend!: (value: { error: null }) => void;
    h.resend.mockImplementation(
      () =>
        new Promise<{ error: null }>((resolve) => {
          resolveResend = resolve;
        }),
    );

    render(<Auth />);
    await waitFor(() =>
      expect(screen.getByText("Verificar E-mail")).toBeInTheDocument(),
    );

    const resendBtn = screen.getByRole("button", { name: /Enviar novamente/i });
    expect(resendBtn).toBeEnabled();

    fireEvent.click(resendBtn);
    fireEvent.click(resendBtn);

    expect(h.resend).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveResend({ error: null });
    });
    // Guarda liberada somente após a conclusão da primeira chamada.
    await waitFor(() => expect(resendBtn).toBeEnabled());
    expect(h.resend).toHaveBeenCalledTimes(1);
  });

  it("nome, telefone, senha e OTP nunca são persistidos — storage mínimo (email/intenção/savedAt)", async () => {
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
    expect(raw).not.toContain("Novo Usuário");
    expect(raw).not.toContain("11988887777");
    expect(raw).not.toContain("fullName");
    expect(raw).not.toContain("phone");
    expect(raw).toContain("seguro@teste.com");

    // Estrutura exata: apenas email, signupIntent e savedAt.
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      "email",
      "savedAt",
      "signupIntent",
    ]);
    clearPendingSignup();
  });

  it("o cadastro inicial não exibe o campo Telefone", async () => {
    render(<Auth />);

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

    expect(screen.queryByPlaceholderText("Telefone")).not.toBeInTheDocument();
    // Nome, e-mail, senha e confirmação seguem presentes.
    expect(screen.getByPlaceholderText("Nome Completo")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("E-mail")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Senha")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Confirmar Senha"),
    ).toBeInTheDocument();
  });

  it("signUp não recebe phone no metadata (telefone passa a ser coletado no onboarding)", async () => {
    h.signUp.mockResolvedValue({
      data: { session: null, user: { identities: [{ provider: "email" }] } },
      error: null,
    });

    render(<Auth />);
    await submitRegistration("semphone@teste.com");

    const payload = h.signUp.mock.calls[0][0] as {
      email?: string;
      password?: string;
      options?: { data?: Record<string, unknown> };
    };
    const metadata = payload?.options?.data ?? {};

    expect(metadata).not.toHaveProperty("phone");
    // Nome e intenção seguem no metadata; e-mail/senha seguem no payload.
    expect(metadata.full_name).toBe("Novo Usuário");
    expect(metadata.signup_intent).toBe("pet_owner");
    expect(payload.email).toBe("semphone@teste.com");
    expect(payload.password).toBe("senha123");

    // Fluxo OTP existente continua funcionando.
    await waitFor(
      () => expect(screen.getByText("Verificar E-mail")).toBeInTheDocument(),
      WAIT,
    );
  });

  // ——— Edição e reset do código OTP (seis posições independentes) ———

  const getOtpInputs = () =>
    Array.from(
      document.querySelectorAll<HTMLInputElement>(".otp-digit-input"),
    );

  it("Backspace apaga o dígito preenchido e, no campo vazio, volta ao anterior com foco", async () => {
    savePendingSignup(PENDING);

    render(<Auth />);
    await waitFor(() =>
      expect(screen.getByText("Verificar E-mail")).toBeInTheDocument(),
    );

    fillOtp();
    const inputs = getOtpInputs();
    // O foco avança junto com a digitação: o último campo fica em foco.
    expect(document.activeElement).toBe(inputs[5]);

    // Campo preenchido: apaga e permanece nele.
    fireEvent.keyDown(inputs[5], { key: "Backspace" });
    expect(inputs[5].value).toBe("");
    expect(document.activeElement).toBe(inputs[5]);

    // Campo vazio: volta ao anterior, apaga e foca nele.
    fireEvent.keyDown(inputs[5], { key: "Backspace" });
    expect(inputs[4].value).toBe("");
    expect(document.activeElement).toBe(inputs[4]);
    // Demais dígitos permanecem intactos.
    expect(inputs.slice(0, 4).map((i) => i.value)).toEqual([
      "1", "2", "3", "4",
    ]);
  });

  it("dígito preenchido pode ser substituído e o código derivado reflete a edição", async () => {
    savePendingSignup(PENDING);
    h.verifyOtp.mockResolvedValue({ error: null });

    render(<Auth />);
    await waitFor(() =>
      expect(screen.getByText("Verificar E-mail")).toBeInTheDocument(),
    );

    fillOtp();
    const inputs = getOtpInputs();
    fireEvent.change(inputs[2], { target: { value: "9" } });
    expect(inputs[2].value).toBe("9");

    fireEvent.click(
      screen.getByRole("button", { name: /Confirmar Código/i }),
    );
    await waitFor(() => expect(h.verifyOtp).toHaveBeenCalledTimes(1));
    // Código final derivado de digits.join('') — "129456", não "123456".
    expect(h.verifyOtp).toHaveBeenCalledWith({
      email: "dono@teste.com",
      token: "129456",
      type: "signup",
    });
  });

  it("colar um código de seis números preenche todos os campos", async () => {
    savePendingSignup(PENDING);
    h.verifyOtp.mockResolvedValue({ error: null });

    render(<Auth />);
    await waitFor(() =>
      expect(screen.getByText("Verificar E-mail")).toBeInTheDocument(),
    );

    const inputs = getOtpInputs();
    fireEvent.paste(inputs[0], {
      clipboardData: { getData: () => "654321" },
    });
    expect(inputs.map((i) => i.value)).toEqual([
      "6", "5", "4", "3", "2", "1",
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: /Confirmar Código/i }),
    );
    await waitFor(() => expect(h.verifyOtp).toHaveBeenCalledTimes(1));
    expect(h.verifyOtp).toHaveBeenCalledWith({
      email: "dono@teste.com",
      token: "654321",
      type: "signup",
    });
  });

  it("código inválido limpa os seis campos, foca o primeiro e mantém a tela de verificação", async () => {
    savePendingSignup(PENDING);
    h.verifyOtp.mockResolvedValue({ error: { message: "Invalid OTP" } });

    render(<Auth />);
    await waitFor(() =>
      expect(screen.getByText("Verificar E-mail")).toBeInTheDocument(),
    );

    fillOtp();
    fireEvent.click(
      screen.getByRole("button", { name: /Confirmar Código/i }),
    );

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        "Código inválido ou expirado. Tente novamente.",
      ),
    );
    const inputs = getOtpInputs();
    expect(inputs.every((i) => i.value === "")).toBe(true);
    expect(document.activeElement).toBe(inputs[0]);
    // Usuário permanece na verificação; botão desabilitado até redigir.
    // (waitFor: aguarda o finally do handler sair do estado "Verificando...".)
    expect(screen.getByText("Verificar E-mail")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Confirmar Código/i }),
      ).toBeDisabled(),
    );
  });

  it("após erro, o usuário digita o código correto e verifyOtp recebe exatamente os novos seis números", async () => {
    savePendingSignup(PENDING);
    h.verifyOtp
      .mockResolvedValueOnce({ error: { message: "Invalid OTP" } })
      .mockResolvedValueOnce({ error: null });

    render(<Auth />);
    await waitFor(() =>
      expect(screen.getByText("Verificar E-mail")).toBeInTheDocument(),
    );

    fillOtp();
    fireEvent.click(
      screen.getByRole("button", { name: /Confirmar Código/i }),
    );
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        "Código inválido ou expirado. Tente novamente.",
      ),
    );

    // Aguarda o handler sair do estado "Verificando..." (nome do botão volta
    // a "Confirmar Código") antes de redigitar; os campos foram limpos no erro.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Confirmar Código/i }),
      ).toBeInTheDocument(),
    );

    // Redigita o código correto do zero.
    fillOtp();
    const confirmBtn = screen.getByRole("button", {
      name: /Confirmar Código/i,
    });
    await waitFor(() => expect(confirmBtn).toBeEnabled());
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(h.verifyOtp).toHaveBeenCalledTimes(2));
    expect(h.verifyOtp).toHaveBeenLastCalledWith({
      email: "dono@teste.com",
      token: "123456",
      type: "signup",
    });
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith("/inicio"));
  });

  it("reenvio bem-sucedido limpa os seis campos e foca o primeiro", async () => {
    savePendingSignup(PENDING);
    h.resend.mockResolvedValue({ error: null });

    render(<Auth />);
    await waitFor(() =>
      expect(screen.getByText("Verificar E-mail")).toBeInTheDocument(),
    );

    fillOtp();
    fireEvent.click(
      screen.getByRole("button", { name: /Enviar novamente/i }),
    );

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("Novo código enviado!"),
    );
    const inputs = getOtpInputs();
    expect(inputs.every((i) => i.value === "")).toBe(true);
    expect(document.activeElement).toBe(inputs[0]);
  });
});
