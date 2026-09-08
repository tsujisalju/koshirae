"use client";

import dynamic from "next/dynamic";
import { ReactNode } from "react";

const DAppKitClientProvider = dynamic(
  () =>
    import("./dapp-kit-client-provider").then(
      (mod) => mod.DAppKitClientProvider,
    ),
  { ssr: false },
);

export default function Providers({ children }: { children: ReactNode }) {
  return <DAppKitClientProvider>{children}</DAppKitClientProvider>;
}
