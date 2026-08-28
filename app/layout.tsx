import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://mira-private-companion.imran-4151.chatgpt.site'),
  title: 'KhanTech — Private live companion',
  description: 'A no-API, local-first companion for live location, authorized devices, camera, recording, playback, search, and voice control.',
  manifest: '/manifest.webmanifest',
  openGraph: {
    title: 'KhanTech — Private live companion',
    description: 'Your world, live and clear. No API key required.',
    images: [{ url: '/og.png', width: 1733, height: 909, alt: 'KhanTech private live companion' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'KhanTech — Private live companion',
    description: 'Your world, live and clear. No API key required.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head><meta name="theme-color" content="#143c2a" /><link rel="apple-touch-icon" href="/og.png" /></head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
