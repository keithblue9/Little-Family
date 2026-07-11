import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "@/App.css";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import LandingPage from "@/pages/LandingPage";
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";
import ParentApp from "@/pages/ParentApp";
import KidHome from "@/pages/KidHome";
import ChildPicker from "@/pages/ChildPicker";

function Protected({ children }) {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div className="min-h-screen flex items-center justify-center font-parent text-slate-500">
        Loading…
      </div>
    );
  }
  if (user === false) return <Navigate to="/login" replace />;
  return children;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/parent/*"
            element={
              <Protected>
                <ParentApp />
              </Protected>
            }
          />
          <Route
            path="/kid"
            element={
              <Protected>
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
    </AuthProvider>
  );
}

export default App;
