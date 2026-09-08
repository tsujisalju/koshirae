import type { Metadata } from "next";
import { Flow_Circular, Roboto, Stack_Sans_Headline } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import LandingHeader from "@/components/landing-header";
import Providers from "./providers";
import { Toaster } from "@/components/ui/sonner";

const stackSansHeadline = Stack_Sans_Headline({
  subsets: ["latin"],
  variable: "--font-stack-sans-headline",
  adjustFontFallback: false,
});

const flowCircular = Flow_Circular({
  subsets: ["latin"],
  variable: "--font-flow-circular",
  weight: "400",
  adjustFontFallback: false,
});

const roboto = Roboto({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Oronyx",
  description: "Scoped Agent Wallets on Sui Blockchain",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={cn(
        "h-full",
        "antialiased",
        "font-sans",
        roboto.variable,
        stackSansHeadline.variable,
        flowCircular.variable,
        "dark",
      )}
    >
      <body className="min-h-full flex flex-col">
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
