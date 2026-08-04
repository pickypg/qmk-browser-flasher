import { defineConfig } from "vite";

export default defineConfig({
  server: {
    // WebUSB/WebHID require a secure context; localhost is exempt by
    // browsers, but a fixed host makes device-permission grants stick
    // across restarts during development.
    host: "localhost",
  },
});
