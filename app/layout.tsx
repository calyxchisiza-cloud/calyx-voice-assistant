import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'CALYX — Synthetic voice console',
  description: 'A three-dimensional, voice-first assistant console.',
};

export const viewport: Viewport = {
  themeColor: '#04060d',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
