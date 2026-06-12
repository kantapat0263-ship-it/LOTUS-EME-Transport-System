import type {NextConfig} from 'next';
const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development'
});

const nextConfig: NextConfig = {
  /* config options here */
  // firebase-admin เป็น Node-only — อย่า bundle เข้า build (ใช้เฉพาะใน API route)
  serverExternalPackages: ['firebase-admin'],
  typescript: {
    // Type errors now fail the build — a safety net against shipping
    // broken code (e.g. the kind that was previously hidden).
    ignoreBuildErrors: false,
  },
  eslint: {
    // ESLint stays informational during builds for now; pre-existing lint
    // warnings will be addressed gradually so they don't block deploys.
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default withPWA(nextConfig);