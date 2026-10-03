import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import App from "@/App";
import { registerServiceWorker } from "@/serviceWorkerRegistration";
import { startVersionWatcher } from "@/lib/versionCheck";
import { watchThemeFonts } from "@/lib/fonts";
import { startOfflineSync } from "@/lib/offlineQueue";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);

watchThemeFonts();
startOfflineSync();
registerServiceWorker();
startVersionWatcher();
