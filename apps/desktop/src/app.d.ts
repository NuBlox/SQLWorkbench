import type { DesktopApi } from "$lib/desktop-api";

declare global {
  interface Window {
    nublox: DesktopApi;
  }
}

export {};
