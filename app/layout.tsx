import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'SOLAXIUM INTELLIGENCE',
    template: '%s — SOLAXIUM INTELLIGENCE',
  },
  description:
    'An evolutionary intelligence laboratory where autonomous AI agents must generate wealth to survive.',
  icons: { icon: '/solaxium-mark.png' },
};

export const viewport: Viewport = {
  themeColor: '#04050B',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
