import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["bcrypt", "pg", "@prisma/adapter-pg"],
};

export default nextConfig;
