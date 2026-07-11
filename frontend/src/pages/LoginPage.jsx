import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Rocket } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { formatApiError } from "@/lib/api";
import { TEST_IDS } from "@/constants/testIds/app";

export default function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      toast.success("Welcome back!");
      nav("/parent");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen kid-shell flex items-center justify-center px-4 font-body">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 justify-center mb-8">
          <div className="w-10 h-10 rounded-2xl bg-[#FF9D23] flex items-center justify-center chunky-shadow">
            <Rocket className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-fun font-bold text-2xl text-slate-800">ChoreQuest</span>
        </Link>

        <div className="bg-white rounded-3xl p-8 chunky-shadow-lg border-2 border-slate-100">
          <h1 className="font-fun font-bold text-3xl text-slate-900 mb-1">Welcome back</h1>
          <p className="text-slate-500 mb-6">Sign in to your parent account</p>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Email</label>
              <input
                data-testid={TEST_IDS.auth.emailInput}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl border-2 border-slate-200 focus:border-[#FF9D23] focus:outline-none font-body"
                placeholder="parent@family.com"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Password</label>
              <input
                data-testid={TEST_IDS.auth.passwordInput}
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl border-2 border-slate-200 focus:border-[#FF9D23] focus:outline-none font-body"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              data-testid={TEST_IDS.auth.submitBtn}
              className="press-btn chunky-shadow w-full bg-[#FF9D23] hover:bg-[#f08e14] disabled:opacity-50 text-white font-fun font-semibold text-lg py-3.5 rounded-2xl transition-colors"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="text-center mt-6 text-sm text-slate-500">
            No account?{" "}
            <Link to="/register" data-testid={TEST_IDS.auth.switchToRegister} className="text-[#FF9D23] font-semibold hover:underline">
              Create one
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
