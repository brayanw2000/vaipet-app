
import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import RoleLanding from "./components/RoleLanding";
import PetwalkerPainel from "./pages/petwalker/Painel";
import PetwalkerDashboard from "./pages/PetwalkerDashboard";
import PetwalkerOnboarding from "./pages/PetwalkerOnboarding";
import { PetwalkerProtectedRoute } from "./components/PetwalkerProtectedRoute";
import { AdminProtectedRoute } from "./components/admin/AdminProtectedRoute";
import AdminDashboard from "./pages/admin/AdminDashboard";
import PetwalkerAdmin from "./pages/admin/PetwalkerAdmin";
import PetwalkerInscricao from "./pages/PetwalkerInscricao";
import PetwalkerPerfil from "./pages/petwalker/perfil";
import PetwalkerGanhos from "./pages/petwalker/ganhos";
import PetwalkerHistorico from "./pages/petwalker/historico";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { PetwalkerGpsProvider } from "./components/PetwalkerGpsProvider";
import SearchWalk from "./pages/SearchWalk";
import NotFound from "./pages/NotFound";
import Auth from "./pages/Auth";
import SignupWizard from "./pages/SignupWizard";
import Onboarding from "./pages/Onboarding";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import TermsOfUse from "./pages/TermsOfUse";
import Petshop from "./pages/Petshop";
import RedePet from "./pages/RedePet";
import Hotelaria from "./pages/Hotelaria";
import Veterinario from "./pages/Veterinario";
import Configuracoes from "./pages/Configuracoes";
import { AddPet } from "./pages/AddPet";
import { Profile } from "./pages/Profile";
import { PetDetails } from "./pages/PetDetails";
import { PetHistory } from "./pages/PetHistory";
import { WalkDetails } from "./pages/WalkDetails";
import PetshopDashboard from "./pages/PetshopDashboard";
import PetshopProducts from "./pages/PetshopProducts";
import PetshopAddProduct from "./pages/PetshopAddProduct";
import PetshopEditProduct from "./pages/PetshopEditProduct";
import PetshopSales from "./pages/PetshopSales";
import PetshopStock from "./pages/PetshopStock";
import PetshopSettings from "./pages/PetshopSettings";
import ProductDetails from "./pages/ProductDetails";
import Home2 from "./pages/Home2";
import WalkHistory from "./pages/WalkHistory";
import Notificacoes from "./pages/Notificacoes";
import Privacidade from "./pages/Privacidade";
import Ajuda from "./pages/Ajuda";
import { isNative, ui as nativeUi, app as nativeApp, biometric, prefs } from "@/lib/native";

const BIO_LOCK_KEY = 'vaipet.bioLock';

/** Pede biometria se o usuário ativou o bloqueio em Configurações. */
const requireBiometricIfEnabled = async () => {
  const enabled = await prefs.get<boolean>(BIO_LOCK_KEY);
  if (!enabled) return;
  const ok = await biometric.authenticate('Desbloqueie o VaiPet');
  if (!ok) {
    // Se falhar/cancelar, tenta de novo em 1s para o usuário não ficar "fora"
    setTimeout(requireBiometricIfEnabled, 1000);
  }
};

const queryClient = new QueryClient();

const App = () => {
  // Inicialização nativa (no-op no browser): esconde splash, ajusta status bar,
  // intercepta o botão Voltar do Android.
  useEffect(() => {
    if (!isNative()) return;
    nativeUi.setStatusBarStyle('light');
    nativeUi.hideSplash();
    requireBiometricIfEnabled();
    const offState = nativeApp.onAppStateChange((active) => {
      // Quando volta do background, pede biometria novamente.
      if (active) requireBiometricIfEnabled();
    });
    const off = nativeApp.onBackButton(() => {
      // No Android, fecha modais via history; só sai do app se já está na raiz.
      if (window.history.length > 1) window.history.back();
    });
    return () => { off(); offState(); };
  }, []);

  return (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <PetwalkerGpsProvider>
        <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/inicio" element={<Index />} />
          <Route path="/" element={<RoleLanding />} />
          <Route path="/search-walk" element={<SearchWalk />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/signup" element={<SignupWizard initialIntent={new URLSearchParams(window.location.search).get('intent') as 'pet_owner' | 'petwalker' | null} />} />
          <Route path="/politica-de-privacidade" element={<PrivacyPolicy />} />
          <Route path="/termos-de-uso" element={<TermsOfUse />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/petshop" element={<Petshop />} />
          <Route path="/rede-pet" element={<RedePet />} />
          <Route path="/hotelaria" element={<Hotelaria />} />
          <Route path="/veterinario" element={<Veterinario />} />
          <Route path="/configuracoes" element={<Configuracoes />} />
          <Route path="/add-pet" element={<AddPet />} />
          <Route path="/perfil" element={<Profile />} />
          <Route path="/pet/:name" element={<PetDetails />} />
          <Route path="/pet/:name/history" element={<PetHistory />} />
          <Route path="/pet/:name/history/:id" element={<WalkDetails />} />
          <Route path="/petshop-dashboard" element={<PetshopDashboard />} />
          <Route path="/petshop-products" element={<PetshopProducts />} />
          <Route path="/petshop-add-product" element={<PetshopAddProduct />} />
          <Route path="/petshop-edit-product/:id" element={<PetshopEditProduct />} />
          <Route path="/petshop-sales" element={<PetshopSales />} />
          <Route path="/petshop-stock" element={<PetshopStock />} />
          <Route path="/petshop-settings" element={<PetshopSettings />} />
          <Route path="/product/:id" element={<ProductDetails />} />
          <Route path="/home2" element={<Home2 />} />
          <Route path="/historico" element={<WalkHistory />} />
          <Route path="/historico/:id" element={<WalkDetails />} />
          <Route path="/notificacoes" element={<Notificacoes />} />
          <Route path="/privacidade" element={<Privacidade />} />
          <Route path="/ajuda" element={<Ajuda />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route 
            path="/petwalker" 
            element={
              <PetwalkerProtectedRoute>
                <PetwalkerPainel />
              </PetwalkerProtectedRoute>
            } 
          />

          <Route 
            path="/petwalker/onboarding" 
            element={
              <PetwalkerProtectedRoute>
                <PetwalkerOnboarding />
              </PetwalkerProtectedRoute>
            } 
          />
          <Route path="/petwalker/inscricao" element={<PetwalkerInscricao />} />
          <Route path="/petwalker/perfil" element={<PetwalkerPerfil />} />
          <Route path="/petwalker/ganhos" element={<PetwalkerGanhos />} />
          <Route path="/petwalker/historico" element={<PetwalkerHistorico />} />
          <Route 
            path="/petwalker/passeio/:id" 
            element={
              <PetwalkerProtectedRoute>
                <WalkDetails isOperational={true} />
              </PetwalkerProtectedRoute>
            } 
          />
          <Route 
            path="/admin" 
            element={
              <AdminProtectedRoute>
                <AdminDashboard />
              </AdminProtectedRoute>
            } 
          />
          <Route 
            path="/admin/petwalkers" 
            element={
              <AdminProtectedRoute>
                <PetwalkerAdmin />
              </AdminProtectedRoute>
            } 
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
      </TooltipProvider>
      </PetwalkerGpsProvider>
    </AuthProvider>
  </QueryClientProvider>
  );
};


export default App;
