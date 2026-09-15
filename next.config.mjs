/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // The simulation runner is a long-lived in-process singleton; keep it on the
  // Node.js runtime and out of the bundler's externalisation path.
  serverExternalPackages: ['@prisma/client', '@anthropic-ai/sdk'],
};

export default nextConfig;
