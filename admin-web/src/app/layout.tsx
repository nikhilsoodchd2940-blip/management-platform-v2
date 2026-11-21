import './globals.css';
import './app-shell.css';
import { AuthProvider } from '@/context/AuthContext';
import { LocaleBoundary, LocaleProvider } from '@/lib/i18n/LocaleContext';

export const metadata = {
  title: 'Admin — Management & Group Operations Platform',
  description: 'Admin panel: groups, members, hosts, events, reports.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LocaleProvider>
          <AuthProvider>
            <LocaleBoundary>{children}</LocaleBoundary>
          </AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
