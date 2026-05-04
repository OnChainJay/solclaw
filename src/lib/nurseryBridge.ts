/**
 * Nursery Bridge
 *
 * Exposes Nursery engine token data to the multi-token scanner
 * via window.__nurseryTokens. This avoids circular imports between
 * nurseryEngine (which renders in React) and the scanner (a standalone singleton).
 *
 * Mount this hook in the NurseryPanel or at the app level.
 */

import { useEffect } from "react";

declare global {
  interface Window {
    __nurseryTokens?: {
      zombie: Array<{ mint: string; name: string }>;
      bonding: Array<{ mint: string; name: string }>;
      prebond: Array<{ mint: string; name: string }>;
    };
  }
}

/**
 * Call this hook wherever Nursery data is available (NurseryPanel or AppShell).
 * It writes the current token lists to window.__nurseryTokens so the
 * multi-token scanner can read them without importing React state.
 */
export function useNurseryBridge(
  zombie: Array<{ mint: string; name: string }>,
  bonding: Array<{ mint: string; name: string }>,
  prebond: Array<{ mint: string; name: string }>
): void {
  useEffect(() => {
    window.__nurseryTokens = { zombie, bonding, prebond };
    return () => {
      delete window.__nurseryTokens;
    };
  }, [zombie, bonding, prebond]);
}
