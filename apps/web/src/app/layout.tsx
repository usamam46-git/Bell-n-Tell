import './globals.css';
export const metadata = { title: 'BellnTell', description: 'Business receptionist setup' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
