import { ReactNode } from "react";

import AppSidebar from "@/components/app-sidebar";
import AppTopbar from "@/components/app-topbar";
import ConnectGuard from "@/components/auth/connect-guard";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <ConnectGuard>
      <div className="flex h-screen overflow-hidden">
        <AppSidebar />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <AppTopbar />

          <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </ConnectGuard>
  );
}
