import { createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { enokiWalletsInitializer } from "@mysten/enoki";

const GRPC_URLS = {
  testnet: "https://fullnode.testnet.sui.io:443",
} as const;

const ENOKI_API_KEY = process.env.NEXT_PUBLIC_ENOKI_API_KEY;
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

// Set explicitly (rather than relying on dApp Kit's 5000ms default) so
// ConnectGuard can import the exact same value and debounce its
// "give up and redirect" decision against it — auto-connect's internal
// restore race can resolve straight to `connected` without ever exposing
// an observable `reconnecting` tick, so guards must not trust an early
// `disconnected` reading until this window has elapsed.
export const AUTO_CONNECT_TIMEOUT_MS = 2000;

export const dAppKit = createDAppKit({
  networks: ["testnet"],
  autoConnectTimeout: AUTO_CONNECT_TIMEOUT_MS,
  createClient: (network) =>
    new SuiGrpcClient({ network, baseUrl: GRPC_URLS[network] }),
  // Registers "Sign in with Google" as a Wallet Standard wallet, so it
  // shows up in ConnectButton's wallet list automatically — no custom
  // OAuth UI needed. Scoped to Google only for now; more providers can be
  // added under `providers` later (facebook, twitch, onefc, playtron).
  // Skipped entirely when unconfigured so browser-wallet connection still
  // works out of the box before Enoki/Google credentials are set up.
  walletInitializers:
    ENOKI_API_KEY && GOOGLE_CLIENT_ID
      ? [
          enokiWalletsInitializer({
            apiKey: ENOKI_API_KEY,
            providers: {
              google: {
                clientId: GOOGLE_CLIENT_ID,
              },
            },
          }),
        ]
      : [],
});

declare module "@mysten/dapp-kit-react" {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
