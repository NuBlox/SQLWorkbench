import type { DesktopAdministrationOperationsApi } from "$lib/administration-operations";
import type { DesktopApi } from "$lib/desktop-api";

declare global {
  interface Window {
    nublox: DesktopApi;
    nubloxOperations: DesktopAdministrationOperationsApi;
  }
}

export {};
