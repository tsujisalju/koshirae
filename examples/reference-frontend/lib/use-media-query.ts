"use client";

import { useEffect, useState } from "react";

// SSR-safe: the lazy useState initializer reads matchMedia synchronously
// on the client (falling back to false during SSR, before hydration can
// touch `window`), so there's no setState-on-mount inside the effect —
// the effect only subscribes to subsequent changes.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mediaQueryList = window.matchMedia(query);

    function handleChange(event: MediaQueryListEvent) {
      setMatches(event.matches);
    }

    mediaQueryList.addEventListener("change", handleChange);
    return () => mediaQueryList.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}
