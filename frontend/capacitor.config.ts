import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.codestage.lumen",
  appName: "Lumen",
  webDir: "dist/frontend",
  ios: {
    contentInset: "automatic",
  },
};

export default config;
