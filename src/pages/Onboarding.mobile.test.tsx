import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import Onboarding from "./Onboarding";

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

// Geolocalização concedida: o stub vai no protótipo, pois o jsdom define
// geolocation lá (não redefinível na instância do navigator).
const grantGeolocation = () => {
  Object.defineProperty(Object.getPrototypeOf(navigator), "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (success: PositionCallback) =>
        success({
          coords: { latitude: -23.55, longitude: -46.63, accuracy: 10 },
          timestamp: Date.now(),
        } as GeolocationPosition),
    },
  });
};

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
      const continueBtn = await screen.findByRole("button", {
        name: "Continuar",
      });
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
      const continuePermissions = await screen.findByRole("button", {
        name: "Continuar",
      });
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
