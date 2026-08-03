import localFont from 'next/font/local';
import './globals.css';

const montserrat = localFont({
  src: [
    { path: '../fonts/montserrat-400.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/montserrat-500.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/montserrat-600.woff2', weight: '600', style: 'normal' },
    { path: '../fonts/montserrat-700.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
});

export const metadata = {
  title: 'OptiPass',
  description: 'Optinet Solutions team password manager - end-to-end encrypted.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={montserrat.className}>{children}</body>
    </html>
  );
}
