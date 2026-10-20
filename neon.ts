import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  projectId: "summer-sunset-23039689",
  orgId: "org-polished-brook-14444910",
  // Declare your Neon services here
  services: {
    postgres: {
      branch: "production",
    },
  },
  auth: false,
  branch: (branch) => {
    if (branch.isDefault) {
      return {};
    }
    if (!branch.exists) {
      return { ttl: "7d" };
    }
    return {};
  },
});
