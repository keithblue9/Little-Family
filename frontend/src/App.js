import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "@/App.css";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import ErrorBoundary from "@/components/ErrorBoundary";
import LoginPage from "@/pages/LoginPage";
import ParentApp from "@/pages/ParentApp";
import KidHome from "@/pages/KidHome";
import ChildPicker from "@/pages/ChildPicker";
import InstallPrompt from "@/components/InstallPrompt";

function Protected({ children, role }) {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div className="min-h-screen kid-shell flex items-center justify-center font-parent text-slate-500">
        Memuat…
      </div>
    );
  }
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
  if (user === false) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === "parent" ? "/parent" : `/kid/${user.id}`} replace />;
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/login" element={<LoginPage />} />
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
        </BrowserRouter>
        <Toaster position="top-center" richColors />
        <InstallPrompt />
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
