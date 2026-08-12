import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/",
          has: [{type: "host", value: "davolatechnologies.com"}],
          destination: "/company",
        },
        {
          source: "/",
          has: [{type: "host", value: "www.davolatechnologies.com"}],
          destination: "/company",
        },
      ],
    };
  },
};

export default nextConfig;
