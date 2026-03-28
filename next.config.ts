import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  cacheComponents: true,
  serverExternalPackages: ['pdfjs-dist', 'canvas'],
};

export default nextConfig;
