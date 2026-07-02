import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/guru/crypto/scanner", destination: "/scanner", permanent: false },
    ];
  },
};

export default nextConfig;
