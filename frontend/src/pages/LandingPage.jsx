import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Sparkles, Trophy, ShieldCheck, Star, Heart, Rocket } from "lucide-react";
import { TEST_IDS } from "@/constants/testIds/app";
import LanguageToggle from "@/components/LanguageToggle";

export default function LandingPage() {
  return (
    <div className="min-h-screen kid-shell grain relative overflow-hidden font-body">
      {/* Floating shapes */}
      <div className="absolute top-20 left-8 w-24 h-24 rounded-full bg-[#FF9D23]/30 blur-2xl float" />
      <div className="absolute top-40 right-10 w-32 h-32 rounded-full bg-[#4DB8FF]/30 blur-2xl float" style={{ animationDelay: "1s" }} />
      <div className="absolute bottom-20 left-1/3 w-40 h-40 rounded-full bg-[#34D399]/25 blur-3xl float" style={{ animationDelay: "2s" }} />

      <nav className="relative z-10 flex items-center justify-between px-6 md:px-16 py-6">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-2xl bg-[#FF9D23] flex items-center justify-center chunky-shadow">
            <Rocket className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-fun font-bold text-2xl text-slate-800">My Lil Famz</span>
        </div>
        <div className="flex items-center gap-3">
          <LanguageToggle />
          <Link
            to="/login"
            data-testid={TEST_IDS.landing.login}
            className="font-fun font-semibold text-slate-700 hover:text-[#FF9D23] transition-colors"
          >
            Log in →
          </Link>
        </div>
      </nav>

      <div className="relative z-10 max-w-6xl mx-auto px-6 md:px-16 pt-8 md:pt-16 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="grid md:grid-cols-2 gap-12 items-center"
        >
          <div>
            <div className="inline-flex items-center gap-2 bg-white/70 backdrop-blur px-4 py-2 rounded-full mb-6 border border-slate-200/60">
              <Sparkles className="w-4 h-4 text-[#FF9D23]" strokeWidth={2.5} />
              <span className="text-sm font-semibold text-slate-700">Fun chores, real rewards</span>
            </div>
            <h1 className="font-fun font-bold text-5xl md:text-6xl lg:text-7xl text-slate-900 leading-[0.95] mb-6">
              Turn chores into
              <span className="text-[#FF9D23]"> quests </span>
              your kids actually
              <span className="text-[#4DB8FF]"> love</span>.
            </h1>
            <p className="text-lg text-slate-600 mb-8 max-w-lg font-body">
              Assign tasks, set rewards & consequences, and watch your kids build good habits — with points, streaks, and badges that make it a game.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                to="/login"
                data-testid={TEST_IDS.landing.getStarted}
                className="press-btn chunky-shadow-lg inline-flex items-center gap-2 bg-[#FF9D23] hover:bg-[#f08e14] text-white font-fun font-semibold text-lg px-8 py-4 rounded-2xl transition-colors"
              >
                Get started
                <Rocket className="w-5 h-5" strokeWidth={2.5} />
              </Link>
              <Link
                to="/login"
                className="press-btn inline-flex items-center gap-2 bg-white hover:bg-slate-50 border-2 border-slate-200 text-slate-800 font-fun font-semibold text-lg px-8 py-4 rounded-2xl transition-colors"
              >
                I have an account
              </Link>
            </div>
          </div>

          <div className="relative">
            <motion.div
              initial={{ rotate: -3, scale: 0.9 }}
              animate={{ rotate: -3, scale: 1 }}
              transition={{ delay: 0.2, type: "spring" }}
              className="bg-white rounded-3xl p-6 chunky-shadow-lg border-2 border-slate-100"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-14 h-14 rounded-2xl bg-[#4DB8FF] flex items-center justify-center text-3xl">🦁</div>
                <div>
                  <div className="font-fun font-bold text-xl text-slate-900">Maya&apos;s Quests</div>
                  <div className="text-sm text-slate-500">Age 8 · 5-day streak 🔥</div>
                </div>
                <div className="ml-auto bg-[#FFF4D1] px-3 py-1.5 rounded-full flex items-center gap-1">
                  <Star className="w-4 h-4 text-[#FF9D23] fill-[#FF9D23]" strokeWidth={2.5} />
                  <span className="font-fun font-bold text-slate-800">240</span>
                </div>
              </div>
              {[
                { t: "Make the bed", p: 5, done: true },
                { t: "Read for 20 min", p: 15, done: true },
                { t: "Feed the puppy", p: 10, done: false },
              ].map((task, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-3 p-3 rounded-2xl mb-2 ${task.done ? "bg-[#E6F9F0]" : "bg-slate-50"}`}
                >
                  <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center ${task.done ? "bg-[#34D399] border-[#34D399]" : "border-slate-300"}`}>
                    {task.done && <span className="text-white font-bold">✓</span>}
                  </div>
                  <span className={`flex-1 font-fun font-semibold ${task.done ? "text-slate-400 line-through" : "text-slate-800"}`}>{task.t}</span>
                  <span className="text-sm font-bold text-[#FF9D23]">+{task.p}</span>
                </div>
              ))}
            </motion.div>
          </div>
        </motion.div>

        {/* Features */}
        <div className="grid md:grid-cols-3 gap-6 mt-24">
          {[
            {
              icon: Trophy,
              color: "#FF9D23",
              title: "Rewards store",
              desc: "Parents create custom rewards. Kids save points and redeem the good stuff.",
            },
            {
              icon: ShieldCheck,
              color: "#4DB8FF",
              title: "Fair consequences",
              desc: "Configure penalties and screen-time consequences that make sense for your family.",
            },
            {
              icon: Heart,
              color: "#FF5C5C",
              title: "Parent monitoring",
              desc: "See what's done, what's pending, and every point earned or spent.",
            },
          ].map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="bg-white/80 backdrop-blur rounded-3xl p-6 border border-slate-200/60"
            >
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center chunky-shadow mb-4" style={{ background: f.color }}>
                <f.icon className="w-6 h-6 text-white" strokeWidth={2.5} />
              </div>
              <h3 className="font-fun font-bold text-xl text-slate-900 mb-2">{f.title}</h3>
              <p className="text-slate-600">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
