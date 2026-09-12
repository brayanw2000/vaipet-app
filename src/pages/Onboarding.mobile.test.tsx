import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import Onboarding from "./Onboarding";
import { PermissionsStep } from "@/components/onboarding/PermissionsStep";

// Framer Motion no jsdom: as animações não rodam; garante que o conteúdo
// animado fique no DOM para as asserções.
vi.mock("framer-motion", () => ({
  motion: {
    div: (props: { children?: React.ReactNode }) => <div>{props.children}</div>,
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

const refreshProfile = vi.fn(async () => {});
const sessionUser = { id: "user-1", email: "dono@teste.com" };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: sessionUser,
    loading: false,
    profile: { onboarding_completed: false, phone: "" },
    refreshProfile,
  }),
}));

// Cadeia fluente do supabase-js: update().eq()[.select().single()] e insert().
// Permite que UserInfoStep/PetRegistrationStep/SuccessStep completem o fluxo
// (onNext) sem backend real.
const makeChain = () => {
  const chain: Record<string, unknown> = {};
  const self = chain as unknown as {
    update: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
    error: null;
  };
  self.update = vi.fn(() => self);
  self.insert = vi.fn(() => self);
  self.eq = vi.fn(() => self);
  self.select = vi.fn(() => self);
  self.single = vi.fn(async () => ({
    data: { onboarding_completed: true },
    error: null,
  }));
  self.error = null;
  return self;
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => makeChain()),
    auth: { getSession: vi.fn(async () => ({ data: { session: null } })) },
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const VIEWPORTS = [
  { name: "390x844 (iPhone 14/15)", width: 390, height: 844 },
  { name: "375x667 (iPhone SE/8)", width: 375, height: 667 },
];

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
  window.dispatchEvent(new Event("resize"));
};

// Instala um stub de geolocalização com comportamento configurável por
// teste. IMPORTANTE: o setup global (src/test/setup.ts) define geolocation
// como propriedade própria de window.navigator (auto-concedida) — o stub do
// teste deve SUBSTITUIR essa propriedade na instância, não no protótipo.
// Retorna o spy de getCurrentPosition.
const installGeolocation = (
  impl: (success: PositionCallback, error: PositionErrorCallback) => void,
) => {
  const getCurrentPosition = vi.fn(impl);
  (window.navigator as unknown as { geolocation: unknown }).geolocation = {
    getCurrentPosition,
  };
  return getCurrentPosition;
};

// Geolocalização concedida: a etapa de Permissões resolve imediatamente
// quando o componente chama getCurrentPosition.
const grantGeolocation = () =>
  installGeolocation((success) =>
    success({
      coords: { latitude: -23.55, longitude: -46.63, accuracy: 10 },
      timestamp: Date.now(),
    } as GeolocationPosition),
  );

/**
 * Contrato estrutural de layout mobile (o que a correção garante):
 * — raiz usa 100dvh e NUNCA overflow-hidden (rolagem vertical sempre possível);
 * — etapas usam altura segura com safe areas (calc(100dvh − env(safe-area-*)));
 * — sem centralização vertical rígida (min-h-[80vh] + justify-center) nos wrappers;
 * — sem h-screen rígido.
 * A geometria real dos viewports 390×844/375×667 é certificada na suíte E2E
 * (Playwright, viewports reais) — jsdom não tem motor de layout.
 */
const expectMobileSafeLayout = () => {
  const root = screen.getByTestId("onboarding-root");
  expect(root.className).toContain("min-h-[100dvh]");
  expect(root.className).not.toContain("overflow-hidden");

  const stepContainers = root.querySelectorAll("div");
  stepContainers.forEach((el) => {
    const cls = el.className;
    // Padrão que causava o bug: página inteira centrada verticalmente com
    // altura rígida — conteúdo não cabível fica inacessível.
    if (cls.includes("min-h-[80vh]") && cls.includes("justify-center")) {
      throw new Error(
        `Centralização vertical rígida (min-h-[80vh] + justify-center) em <div class="${cls}">`,
      );
    }
    // Bloqueadores de rolagem/acesso ao conteúdo.
    if (cls.includes("overflow-hidden")) {
      throw new Error(`overflow-hidden bloqueia rolagem em <div class="${cls}">`);
    }
    if (/\bh-screen\b/.test(cls)) {
      throw new Error(
        `h-screen rígido em <div class="${cls}"> (use 100dvh/altura segura)`,
      );
    }
  });
};

const goThroughUserInfo = async () => {
  fireEvent.change(screen.getByPlaceholderText("(00) 00000-0000"), {
    target: { value: "11988887777" },
  });
  const selects = document.querySelectorAll("select");
  fireEvent.change(selects[0], { target: { value: "10" } });
  fireEvent.change(selects[1], { target: { value: "5" } });
  fireEvent.change(selects[2], { target: { value: "1990" } });
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  await screen.findByText(/Permissões/i);
};

// ---- PermissionsStep: localização opcional, avanço nunca bloqueado ----

describe("PermissionsStep — localização opcional", () => {
  const renderStep = (onNext = vi.fn()) => {
    render(<PermissionsStep onNext={onNext} />);
    return onNext;
  };

  const clickLocationCard = async () => {
    fireEvent.click(screen.getByTestId("location-card"));
    // Deixa o callback assíncrono do stub resolver antes das asserções.
    await act(async () => {});
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("permissão concedida → botão principal vira 'Continuar' e avança", async () => {
    installGeolocation((success) =>
      success({
        coords: { latitude: -23.55, longitude: -46.63, accuracy: 10 },
        timestamp: Date.now(),
      } as GeolocationPosition),
    );
    const onNext = renderStep();

    await clickLocationCard();

    const btn = screen.getByTestId("continue-permissions");
    expect(btn).toHaveTextContent("Continuar");
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("permissão negada → mensagem clara e 'Continuar sem localização' avança", async () => {
    installGeolocation((_success, error) =>
      error({ code: 1, message: "User denied Geolocation", PERMISSION_DENIED: 1 } as GeolocationPositionError),
    );
    const onNext = renderStep();

    await clickLocationCard();

    // Mensagem clara para negação.
    expect(screen.getByTestId("location-message")).toHaveTextContent(
      "Localização não autorizada. Você pode continuar e ativar depois nos ajustes.",
    );

    const btn = screen.getByTestId("continue-permissions");
    expect(btn).toHaveTextContent("Continuar sem localização");
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("geolocalização não suportada → usuário consegue avançar", async () => {
    // Sem suporte: substitui o stub global por undefined.
    (window.navigator as unknown as { geolocation: unknown }).geolocation =
      undefined;
    const onNext = renderStep();

    fireEvent.click(screen.getByTestId("location-card"));
    await act(async () => {});

    const btn = screen.getByTestId("continue-permissions");
    expect(btn).toHaveTextContent("Continuar sem localização");
    fireEvent.click(btn);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("timeout/erro → usuário consegue avançar", async () => {
    installGeolocation((_success, error) =>
      error({ code: 3, message: "Position retrieval timed out", TIMEOUT: 3 } as GeolocationPositionError),
    );
    const onNext = renderStep();

    await clickLocationCard();

    expect(screen.getByTestId("location-message")).toHaveTextContent(
      "Localização indisponível neste dispositivo. Você pode continuar e ativar depois nos ajustes.",
    );
    const btn = screen.getByTestId("continue-permissions");
    expect(btn).toHaveTextContent("Continuar sem localização");
    fireEvent.click(btn);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("clique repetido durante a solicitação não cria chamadas duplicadas", async () => {
    // Solicitação que nunca resolve dentro do teste: simula o usuário
    // clicando repetidamente enquanto o prompt de permissão está aberto.
    const getCurrentPosition = installGeolocation(() => {
      /* pendente até o fim do teste */
    });
    const onNext = renderStep();

    fireEvent.click(screen.getByTestId("location-card"));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("location-card"));
    fireEvent.click(screen.getByTestId("location-card"));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);

    // O avanço continua possível enquanto a solicitação está em andamento.
    fireEvent.click(screen.getByTestId("continue-permissions"));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});

describe("Onboarding mobile — layout sem sobreposição e rolagem garantida", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    grantGeolocation();
  });

  afterEach(() => {
    cleanup();
  });

  describe.each(VIEWPORTS)("viewport $name", ({ width, height }) => {
    it("etapa 1 (Sobre você): layout mobile-seguro, todos os campos visíveis e fluxo avança", async () => {
      setViewport(width, height);
      render(<Onboarding />);

      await screen.findByText(/Sobre você/i);
      expectMobileSafeLayout();

      // Todos os campos da etapa 1 presentes e visíveis.
      const phone = screen.getByPlaceholderText("(00) 00000-0000");
      expect(phone).toBeVisible();
      expect(screen.getByRole("button", { name: "Continuar" })).toBeVisible();

      // Fluxo completa na largura estreita do viewport.
      fireEvent.change(phone, { target: { value: "11988887777" } });
      const selects = document.querySelectorAll("select");
      fireEvent.change(selects[0], { target: { value: "10" } });
      fireEvent.change(selects[1], { target: { value: "5" } });
      fireEvent.change(selects[2], { target: { value: "1990" } });
      fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
      await screen.findByText(/Permissões/i);
      expectMobileSafeLayout();
    });

    it("etapa 2 (Permissões): cards visíveis sem bloqueio de rolagem e botão principal alcançável", async () => {
      setViewport(width, height);
      render(<Onboarding />);
      await screen.findByText(/Sobre você/i);
      await goThroughUserInfo();

      // Âncora "^Localização": distingue o card do botão "Ative a localização".
      const locationCard = screen.getByRole("button", {
        name: /^Localização/,
      });
      const notificationCard = screen.getByRole("button", {
        name: /Notificações/i,
      });
      expect(locationCard).toBeVisible();
      expect(notificationCard).toBeVisible();
      expectMobileSafeLayout();

      // Geolocalização concedida → tocar no card habilita o botão principal.
      fireEvent.click(locationCard);
      const continueBtn = await screen.findByTestId("continue-permissions");
      await waitFor(() => expect(continueBtn).toBeEnabled());
      expect(continueBtn).toBeVisible();
    });

    it("etapa 3 (Pet) e etapa 4 (Sucesso): campos e botão final visíveis sem bloqueio de rolagem", async () => {
      setViewport(width, height);
      render(<Onboarding />);
      await screen.findByText(/Sobre você/i);
      await goThroughUserInfo();

      // Localização concedida → tocar no card habilita o Continuar.
      fireEvent.click(
        screen.getByRole("button", { name: /^Localização/ }),
      );
      const continuePermissions = await screen.findByTestId(
        "continue-permissions",
      );
      await waitFor(() => expect(continuePermissions).toBeEnabled());
      fireEvent.click(continuePermissions);

      await screen.findByText(/Conte sobre/i);
      const petName = screen.getByPlaceholderText("Nome do pet");
      const breed = screen.getByPlaceholderText("Raça");
      const age = screen.getByPlaceholderText("Idade");
      expect(petName).toBeVisible();
      expect(breed).toBeVisible();
      expect(age).toBeVisible();
      expectMobileSafeLayout();

      // Fluxo alternativo certificado: pular cadastro do pet → tela de sucesso.
      fireEvent.click(
        screen.getByRole("button", { name: /Pular e adicionar depois/i }),
      );
      await screen.findByText(/Aproveite a VaiPet/i);
      const startBtn = screen.getByRole("button", { name: /Começar agora/i });
      expect(startBtn).toBeVisible();
      expectMobileSafeLayout();
    });
  });
});
