import type { Metadata, Viewport } from 'next';
import './globals.css'; // Global styles
import { Toaster } from 'sonner';
import { AuthProvider } from '@/hooks/useAuth';
import { PWAInstallPrompt } from '@/components/pwa/PWAInstallPrompt';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export const metadata: Metadata = {
  title: 'Pixel Project',
  description: 'Seguimiento inteligente de proyectos, tareas, calidad, presupuesto e inventario.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Pixel Project',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Pixel Project',
  },
  icons: {
    icon: [
      { url: '/icons/pixel-project-icon.svg', type: 'image/svg+xml' },
      { url: '/icons/pixel-project-icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/pixel-project-icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/pixel-project-apple.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#4f46e5',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="es">
      <body className="font-sans" suppressHydrationWarning>
        <ErrorBoundary>
          <AuthProvider>
            {children}
            <PWAInstallPrompt />
            <Toaster position="top-right" richColors />
          </AuthProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
