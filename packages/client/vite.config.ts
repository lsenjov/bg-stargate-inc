import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export const defaultDevServerUrl = "http://localhost:3001";

export function devServerUrl(
  environment: { readonly VITE_DEV_SERVER_URL?: string } = process.env,
): string {
  return environment.VITE_DEV_SERVER_URL ?? defaultDevServerUrl;
}

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/socket.io": {
        target: devServerUrl(),
        ws: true,
      },
    },
  },
});
