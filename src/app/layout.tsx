import type {Metadata, Viewport} from 'next';
import './globals.css';
import {Toaster} from '@/components/ui/toaster';
import { FirebaseClientProvider } from '@/firebase';

export const metadata: Metadata = {
  title: 'LOTUS GROUP Transport Management',
  description: 'Logistics and material delivery management for LOTUS GROUP',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'LOTUS Transport',
  },
  icons: {
    icon: '/favicon.ico',
    apple: '/icons/icon-192x192.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#f97316',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* กัน chunk error ตอนเปิดครั้งแรกหลัง deploy (service worker เสิร์ฟ JS เก่าค้าง) —
            ดักไฟล์ /_next/static โหลดไม่ขึ้น แล้วรีโหลดเอง 1 ครั้ง (กันลูปด้วย throttle 10 วิ) */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){function c(m){m=String(m||"");return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported|Importing a module script failed|dynamically imported module/i.test(m)}function r(){try{var k="chunkReloadAt",l=+(sessionStorage.getItem(k)||0);if(Date.now()-l>1e4){sessionStorage.setItem(k,String(Date.now()));location.reload()}}catch(e){location.reload()}}window.addEventListener("error",function(e){var t=e&&e.target;if(t&&t.tagName==="SCRIPT"&&t.src&&t.src.indexOf("/_next/static/")>-1){r()}else if(c(e&&e.message)){r()}},true);window.addEventListener("unhandledrejection",function(e){var x=e&&e.reason;if(c(x&&(x.message||x))){r()}})})();',
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        {/* PWA Tags */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="LOTUS Transport" />
      </head>
      <body className="font-body antialiased selection:bg-accent/30">
        <FirebaseClientProvider>
          {children}
          <Toaster />
        </FirebaseClientProvider>
      </body>
    </html>
  );
}