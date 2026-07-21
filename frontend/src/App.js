import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "@/App.css";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import ErrorBoundary from "@/components/ErrorBoundary";
import LoginPage from "@/pages/LoginPage";
import GrandparentView from "@/pages/GrandparentView";
import ParentApp from "@/pages/ParentApp";
import KidHome from "@/pages/KidHome";
import ChildPicker from "@/pages/ChildPicker";
import InstallPrompt from "@/components/InstallPrompt";
import PushPermissionPrompt from "@/components/PushPermissionPrompt";
import LabelProvider from "@/components/LabelProvider";
import AppBadgeSync from "@/components/AppBadgeSync";

function ConnectionErrorScreen() {
  const { refresh } = useAuth();
  return (
    <div className="min-h-screen kid-shell flex flex-col items-center justify-center font-parent text-slate-600 gap-3 px-6 text-center">
      <div className="text-4xl">🔌</div>
      <div className="font-bold">Tidak bisa terhubung ke server</div>
      <div className="text-sm text-slate-500">Sesi kamu masih aman — coba lagi ya.</div>
      <button
        onClick={() => refresh()}
        className="mt-2 bg-[#FF9D23] hover:bg-[#f08e14] text-white font-bold px-5 py-2.5 rounded-xl"
      >
        Coba Lagi
      </button>
    </div>
  );
}

function MaintenanceScreen({ message }) {
  const { refresh } = useAuth();
  return (
    <div className="min-h-screen kid-shell flex flex-col items-center justify-center font-parent text-slate-700 gap-4 px-6 text-center">
      <div className="text-6xl">🛠️</div>
      <div className="font-bold text-xl">Aplikasi Sedang Nonaktif Sementara</div>
      <div className="text-sm text-slate-500 max-w-sm">{message}</div>
      <button
        onClick={() => refresh()}
        className="mt-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold px-5 py-2.5 rounded-xl text-sm"
      >
        Cek Lagi
      </button>
    </div>
  );
}

function Protected({ children, role }) {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div className="min-h-screen kid-shell flex items-center justify-center font-parent text-slate-500">
        Memuat…
      </div>
    );
  }
  if (user === "error") return <ConnectionErrorScreen />;
  if (user && typeof user === "object" && user.maintenance) return <MaintenanceScreen message={user.message} />;
  if (user === false) return <Navigate to="/login" replace />;
  if (role && user.role !== role) {
    return <Navigate to={user.role === "parent" ? "/parent" : `/kid/${user.id}`} replace />;
  }
  return children;
}

function HomeRedirect() {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div className="min-h-screen kid-shell flex items-center justify-center font-parent text-slate-500">
        Memuat…
      </div>
    );
  }
  if (user === "error") return <ConnectionErrorScreen />;
  if (user && typeof user === "object" && user.maintenance) return <MaintenanceScreen message={user.message} />;
  if (user === false) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === "parent" ? "/parent" : `/kid/${user.id}`} replace />;
}

function MaintenanceGate({ children }) {
  const { user } = useAuth();
  // Covers every route — including /login — since someone who's blocked
  // shouldn't be able to sit on the login form retrying forever; they should
  // see the same clear "app is paused" screen no matter where they land.
  if (user && typeof user === "object" && user.maintenance) {
    return <MaintenanceScreen message={user.message} />;
  }
  return children;
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <LabelProvider>
          <MaintenanceGate>
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/view/:token" element={<GrandparentView />} />
            <Route
              path="/parent/*"
              element={
                <Protected role="parent">
                  <ParentApp />
                </Protected>
              }
            />
            <Route
              path="/kid"
              element={
                <Protected role="parent">
                  <ChildPicker />
                </Protected>
              }
            />
            <Route
              path="/kid/:childId"
              element={
                <Protected>
                  <KidHome />
                </Protected>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </MaintenanceGate>
          </LabelProvider>
        </BrowserRouter>
        <Toaster position="top-center" richColors />
        <InstallPrompt />
        <PushPermissionPrompt />
        <AppBadgeSync />
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
