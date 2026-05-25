/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 'standalone' produces a self-contained .next/standalone/server.js that
  // includes only the production dependencies it actually needs. Cuts the
  // Docker image size from ~900MB to ~150MB.
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['pg', 'bcryptjs'],
  },
};

module.exports = nextConfig;
