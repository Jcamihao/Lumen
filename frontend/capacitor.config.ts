import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.codestage.lumen",
  appName: "Lumen",
  webDir: "dist/frontend",
  backgroundColor: "#151923",
  ios: {
    backgroundColor: "#151923",
    contentInset: "automatic",
  },
};

export default config;
