import type {NextConfig} from 'next';
const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  // manifest.json ห้ามผ่านแคชของ SW (เดิม precache = cache-first) — เครื่องที่ติดตั้งแอปไว้จะเห็น manifest ใหม่
  // (เช่น launch_handler) ช้าไปอีกรอบ เพราะ Chrome ตรวจ manifest ราววันละครั้ง · ค่าแรกคือค่าเริ่มต้นของ next-pwa
  publicExcludes: ['!noprecache/**/*', '!manifest.json'],
  // ข้อมูลน้ำท่วมต้องสด — ห้าม SW คืนชุดเก่าจาก Cache Storage ตอนเน็ตล้ม (กฎแรกที่ตรงชนะ จึงต้องอยู่หน้าชุดเดิม)
  runtimeCaching: [
    { urlPattern: ({ url }: { url: URL }) => url.pathname === '/api/road-events', handler: 'NetworkOnly', method: 'GET' },
    // manifest ไม่ผ่านแคช (กฎ .json เดิมของ next-pwa เป็น NetworkFirst ที่ยังเก็บสำเนา)
    { urlPattern: ({ url }: { url: URL }) => url.pathname === '/manifest.json', handler: 'NetworkOnly', method: 'GET' },
    // รายงานส่วนตัวห้ามคืนแคชของแอดมินเดิมหลัง logout หรือเปลี่ยนบัญชี
    { urlPattern: ({ url }: { url: URL }) => url.pathname === '/api/reports/weekly-stops', handler: 'NetworkOnly', method: 'GET' },
    ...require('next-pwa/cache'),
  ],
});

/**
 * รหัสเวอร์ชันของ build นี้ — ถูกฝังทั้งใน bundle ฝั่ง client และอ่านได้จาก /api/version
 * แท็บที่เปิดค้างไว้จะถือรหัสเก่า พอเทียบกับของเซิร์ฟเวอร์แล้วไม่ตรง = มีเวอร์ชันใหม่ให้รีเฟรช
 * (บน Vercel ใช้ commit sha ; ตอน dev/เครื่องตัวเองใช้เวลา build แทน)
 */
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || `local-${Date.now()}`

const nextConfig: NextConfig = {
  /* config options here */
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
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
