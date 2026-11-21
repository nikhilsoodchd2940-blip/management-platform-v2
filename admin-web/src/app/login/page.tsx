'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { sendOtp, verifyOtp } from '@/lib/functions';
import { DEFAULT_DIAL, DIAL_CODES, withDialCode } from '@/lib/dialCodes';
import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/lib/i18n/LocaleContext';
import type { Dictionary } from '@/lib/i18n/translations';
import { tx } from '@/lib/i18n/tr';
import LanguageSwitch from '@/components/LanguageSwitch';

/** Maps Firebase Auth error codes to a translated, human message. */
function authErrorMessage(code: string | null, t: Dictionary): string | null {
  if (!code) return null;
  const e = t.login.errors;
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/missing-password':
      return e.invalidCredential;
    case 'auth/invalid-email':
      return e.invalidEmail;
    case 'auth/user-disabled':
      return e.userDisabled;
    case 'auth/too-many-requests':
      return e.tooManyRequests;
    case 'auth/network-request-failed':
      return e.network;
    default:
      return t.login.failed;
  }
}

export default function LoginPage() {
  const { signIn, error, user, role, loading } = useAuth();
  const router = useRouter();
  const { t } = useLocale();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<'admin' | 'member'>('admin');
  const [dial, setDial] = useState(DEFAULT_DIAL);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [phoneError, setPhoneError] = useState('');

  /** Members and supervisors sign in with their phone number and the code they receive, like in the app. */
  async function handlePhone(e: FormEvent) {
    e.preventDefault();
    setPhoneError('');
    setSubmitting(true);
    try {
      const num = withDialCode(dial, phone);
      if (!sent) {
        if (!/^\+\d{8,15}$/.test(num)) throw new Error('Choose the country code, then type your number without it, for example 77 123 45 67.');
        await sendOtp({ phone: num });
        setSent(true);
      } else {
        const res = await verifyOtp({ phone: num, code: code.trim() });
        await signInWithCustomToken(auth, res.data.customToken);
        router.push('/dashboard');
      }
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setSubmitting(false);
    }
  }

  // Already signed in as an admin (e.g. opened /login in a second tab): go straight in.
  useEffect(() => {
    if (!loading && user && role === 'admin') router.replace('/dashboard');
  }, [loading, user, role, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      router.push('/dashboard');
    } catch {
      // error surfaced via useAuth().error
    } finally {
      setSubmitting(false);
    }
  }

  const message = authErrorMessage(error, t);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
      }}
    >
      <div className="login-lang"><LanguageSwitch /></div>
      {mode === 'member' ? (
      <form onSubmit={handlePhone} className="card" style={{ width: '100%', maxWidth: 440 }}>
        <h1 style={{ fontSize: '1.25rem', marginTop: 0, marginBottom: '1.25rem' }}>{t.login.title}</h1>
        <div className="lb-tabs" style={{ marginBottom: '1rem' }}>
          <button type="button" className={(mode as string) === 'admin' ? 'on' : ''} onClick={() => setMode('admin')}>{tx("Administrator")}</button>
          <button type="button" className={(mode as string) === 'member' ? 'on' : ''} onClick={() => setMode('member')}>{tx("Member or supervisor")}</button>
        </div>
        <div className="field">
          <label htmlFor="phone">{tx("Phone number")}</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select aria-label={tx("Country code")} disabled={sent} value={dial} onChange={(e) => setDial(e.target.value)} style={{ flex: '0 0 auto', maxWidth: 170 }}>
              {DIAL_CODES.map((d) => <option key={d.code + d.label} value={d.code}>{d.label}</option>)}
            </select>
            <input id="phone" type="tel" inputMode="tel" autoComplete="tel-national" autoFocus required disabled={sent} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={tx("Number without the country code")} style={{ flex: 1, minWidth: 0 }} />
          </div>
        </div>
        {sent && (
          <div className="field">
            <label htmlFor="code">{tx("Code received by SMS")}</label>
            <input id="code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
        )}
        {phoneError && <p className="error-text" role="alert">{phoneError}</p>}
        <button type="submit" className="btn btn-primary" disabled={submitting} style={{ width: '100%', justifyContent: 'center' }}>
          {submitting ? t.login.submitting : sent ? tx("Sign in") : tx("Send me a code")}
        </button>
        {sent && <button type="button" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }} onClick={() => { setSent(false); setCode(''); }}>{tx("Use another number")}</button>}
        <p className="fx3-hint" style={{ marginTop: '0.8rem' }}>{tx("Supervisors use the same phone number and code as in the member app. After signing in they see only the events they supervise.")}</p>
      </form>
      ) : (
      <form onSubmit={handleSubmit} className="card" style={{ width: '100%', maxWidth: 380 }} noValidate={false}>
        <h1 style={{ fontSize: '1.25rem', marginTop: 0, marginBottom: '1.25rem' }}>{t.login.title}</h1>
        <div className="lb-tabs" style={{ marginBottom: '1rem' }}>
          <button type="button" className={(mode as string) === 'admin' ? 'on' : ''} onClick={() => setMode('admin')}>{tx("Administrator")}</button>
          <button type="button" className={(mode as string) === 'member' ? 'on' : ''} onClick={() => setMode('member')}>{tx("Member or supervisor")}</button>
        </div>

        <div className="field">
          <label htmlFor="email">{t.login.email}</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="password">{t.login.password}</label>
          <div className="password-wrap">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="password-toggle"
              aria-label={showPassword ? t.login.hidePassword : t.login.showPassword}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </div>

        {message && (
          <p className="error-text" role="alert">
            {message}
          </p>
        )}

        <button type="submit" className="btn btn-primary" disabled={submitting} style={{ width: '100%', justifyContent: 'center' }}>
          {submitting ? t.login.submitting : t.login.submit}
        </button>
      </form>
      )}
    </main>
  );
}
