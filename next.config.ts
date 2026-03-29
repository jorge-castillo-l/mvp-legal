import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ['pdfjs-dist', 'canvas'],
};

export default nextConfig;
