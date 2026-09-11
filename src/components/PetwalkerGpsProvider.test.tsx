import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { PetwalkerGpsProvider } from "./PetwalkerGpsProvider";
import { usePetwalkerGpsContext } from "@/contexts/PetwalkerGpsContext";

// Estado compartilhado com as fábricas de mock (vi.mock é içado — todo o
// estado fechado pelas fábricas DEVE nascer em vi.hoisted).
const h = vi.hoisted(() => ({
  mockAuth: { user: null as { id: string } | null, roles: [] as string[], profile: null as { signup_intent?: string } | null },
  mockProfileRow: null as Record<string, unknown> | null,
  onMock: vi.fn().mockReturnThis(),
  subscribeMock: vi.fn().mockReturnValue("channel-mock"),
  removeChannel: vi.fn(),
}));

// useAuth é mockado para controlar `roles` (autoridade canônica RBAC) e
// `profile` (signup_intent) independentemente — provando que o runtime NÃO
// deriva autoridade de signup_intent.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => h.mockAuth,
}));

// Supabase mockado: somente a leitura read-only de petwalker_profiles usada
// pelo efeito de autoridade + realtime chainable. Nenhuma mutação.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: h.mockProfileRow, error: null }),
        }),
      }),
    }),
    channel: () => ({ on: h.onMock, subscribe: h.subscribeMock }),
    removeChannel: h.removeChannel,
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}));

const Probe = () => {
  const { isOnline } = usePetwalkerGpsContext();
  return <div data-testid="gps-online">{String(isOnline)}</div>;
};

const renderProvider = () =>
  render(
    <PetwalkerGpsProvider>
      <Probe />
    </PetwalkerGpsProvider>,
  );

const approvedAvailable = {
  approval_status: "approved",
  availability_status: "available",
  current_walk_id: null,
};

describe("PetwalkerGpsProvider — autoridade canônica de papel", () => {
  beforeEach(() => {
    h.mockAuth.user = null;
    h.mockAuth.roles = [];
    h.mockAuth.profile = null;
    h.mockProfileRow = null;
    h.onMock.mockClear();
    h.subscribeMock.mockClear();
    h.removeChannel.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("CASO A: signup_intent=pet_owner + roles inclui petwalker + aprovado/disponível → runtime ativo", async () => {
    h.mockAuth.user = { id: "u1" };
    h.mockAuth.roles = ["user", "petwalker"];
    h.mockAuth.profile = { signup_intent: "pet_owner" };
    h.mockProfileRow = approvedAvailable;

    renderProvider();
    await act(async () => {});

    expect(screen.getByTestId("gps-online").textContent).toBe("true");
  });

  it("CASO B: signup_intent=petwalker mas roles NÃO inclui petwalker → NUNCA ativo", async () => {
    h.mockAuth.user = { id: "u2" };
    h.mockAuth.roles = ["user"];
    h.mockAuth.profile = { signup_intent: "petwalker" };
    h.mockProfileRow = approvedAvailable;

    renderProvider();
    await act(async () => {});

    expect(screen.getByTestId("gps-online").textContent).toBe("false");
  });

  it("carregamento assíncrono de roles: [] → ['petwalker'] reexecuta a autoridade naturalmente", async () => {
    h.mockAuth.user = { id: "u3" };
    h.mockAuth.roles = []; // AuthProvider ainda carregando
    h.mockAuth.profile = { signup_intent: "pet_owner" };
    h.mockProfileRow = approvedAvailable;

    const utils = renderProvider();
    await act(async () => {});
    expect(screen.getByTestId("gps-online").textContent).toBe("false");

    // AuthProvider termina de carregar os papéis do user_roles canônico.
    h.mockAuth.roles = ["petwalker"];
    utils.rerender(
      <PetwalkerGpsProvider>
        <Probe />
      </PetwalkerGpsProvider>,
    );
    await act(async () => {});

    expect(screen.getByTestId("gps-online").textContent).toBe("true");
  });

  it("papel canônico presente mas NÃO aprovado → runtime inativo (aprovação segue exigida)", async () => {
    h.mockAuth.user = { id: "u4" };
    h.mockAuth.roles = ["petwalker"];
    h.mockAuth.profile = { signup_intent: "petwalker" };
    h.mockProfileRow = { ...approvedAvailable, approval_status: "pending" };

    renderProvider();
    await act(async () => {});

    expect(screen.getByTestId("gps-online").textContent).toBe("false");
  });
});
