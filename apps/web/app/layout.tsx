import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: {
    default: 'Orbit by Nirvaan Tech',
    template: '%s | Orbit',
  },
  description: 'Everything connected. Business in motion.',
  icons: { icon: '/black-orbit-mark.png', apple: '/black-orbit-mark.png' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
