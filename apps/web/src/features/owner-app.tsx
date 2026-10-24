'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Operations } from './operations';

type User = { id: string; name: string; email: string };
type Business = { id: string; name: string; slug: string; timezone: string; status: string; revision: number; role: string };
type Settings = { revision: number; publicEmail: string | null; publicPhone: string | null; publicAddress: string | null; publicWebsite: string | null; publicDescription: string; faqs: { id: string; question: string; answer: string }[]; greeting: string; consentSourceCopy: string; transcriptRetentionDays: number };
type ApiError = { error?: { message?: string } };
async function api<T>(path: string, method = 'GET', body?: unknown, csrf?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, { method, credentials: 'same-origin', headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...(method !== 'GET' && !path.startsWith('/auth/') ? { 'idempotency-key': crypto.randomUUID() } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  } catch {
    throw new Error('The server is unavailable. Please try again shortly.');
  }
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The server is unavailable. Please try again shortly.');
  let data: T & ApiError;
  try { data = await response.json() as T & ApiError; }
  catch { throw new Error('The server sent an invalid response. Please try again shortly.'); }
  if (!response.ok) throw new Error(data.error?.message ?? 'Request failed');
  return data;
}
function Field({ label, value, onChange, type = 'text', required = false, placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; placeholder?: string }) {
  return <label className="block space-y-1 text-sm font-medium"><span>{label}</span><Input value={value} onChange={(event) => onChange(event.target.value)} type={type} required={required} placeholder={placeholder} /></label>;
}
export function OwnerApp() {
  const [user, setUser] = useState<User | null>(null);
  const [csrf, setCsrf] = useState('');
  const [business, setBusiness] = useState<Business | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mode, setMode] = useState<'login' | 'register' | 'recover'>('login');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState(''); const [codeInput, setCodeInput] = useState('');
  const [recoveryCode, setRecoveryCode] = useState(''); const [saved, setSaved] = useState(false);
  const [businessName, setBusinessName] = useState(''); const [slug, setSlug] = useState(''); const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [publicEmail, setPublicEmail] = useState(''); const [publicPhone, setPublicPhone] = useState(''); const [publicAddress, setPublicAddress] = useState(''); const [publicWebsite, setPublicWebsite] = useState(''); const [publicDescription, setPublicDescription] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  async function loadBusiness() {
    const list = await api<{ businesses: Business[] }>('/businesses');
    const current = list.businesses[0] ?? null; setBusiness(current);
    if (current) {
      setBusinessName(current.name); setSlug(current.slug); setTimezone(current.timezone);
      const detail = await api<{ settings: Settings }>(`/businesses/${current.id}/settings`);
      setSettings(detail.settings); setPublicEmail(detail.settings.publicEmail ?? ''); setPublicPhone(detail.settings.publicPhone ?? ''); setPublicAddress(detail.settings.publicAddress ?? ''); setPublicWebsite(detail.settings.publicWebsite ?? ''); setPublicDescription(detail.settings.publicDescription);
    }
  }
  useEffect(() => { api<{ user: User; csrfToken: string }>('/auth/session').then(async (session) => { setUser(session.user); setCsrf(session.csrfToken); await loadBusiness(); }).catch(() => {}); }, []);
  async function submitAuth(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice(''); setBusy(true);
    try {
      if (mode === 'recover') {
        const result = await api<{ recoveryCode: string }>('/auth/recover', 'POST', { email, recoveryCode: codeInput, newPassword: password });
        setRecoveryCode(result.recoveryCode); setSaved(false); setUser(null); setCsrf(''); setNotice('Password reset. Save your new recovery code, then sign in.');
      } else {
        const result = await api<{ user: User; csrfToken: string; recoveryCode?: string }>(`/auth/${mode}`, 'POST', mode === 'register' ? { email, password, name } : { email, password });
        setUser(result.user); setCsrf(result.csrfToken); setPassword('');
        if (result.recoveryCode) { setRecoveryCode(result.recoveryCode); setSaved(false); } else await loadBusiness();
      }
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function createBusiness(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try { await api('/businesses', 'POST', { name: businessName, slug: slug || businessName, timezone }, csrf); await loadBusiness(); setNotice('Business created. Add public contact details next.'); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function saveBusiness(event: FormEvent) {
    event.preventDefault(); if (!business) return; setError(''); setBusy(true);
    try { const result = await api<{ business: Business }>(`/businesses/${business.id}`, 'PATCH', { revision: business.revision, name: businessName, timezone }, csrf); setBusiness({ ...result.business, role: business.role }); setNotice('Business details saved.'); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function saveSettings(event: FormEvent) {
    event.preventDefault(); if (!business || !settings) return; setError(''); setBusy(true);
    try {
      const result = await api<{ settings: Settings }>(`/businesses/${business.id}/settings`, 'PATCH', { revision: settings.revision, publicEmail: publicEmail || null, publicPhone: publicPhone || null, publicAddress: publicAddress || null, publicWebsite: publicWebsite || null, publicDescription, faqs: settings.faqs, greeting: settings.greeting, consentSourceCopy: settings.consentSourceCopy, transcriptRetentionDays: settings.transcriptRetentionDays }, csrf);
      setSettings(result.settings); setNotice('Contact details saved.');
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function logout() { try { await api('/auth/logout', 'POST', {}, csrf); setUser(null); setBusiness(null); setSettings(null); setCsrf(''); setMode('login'); setNotice('Signed out.'); } catch (err) { setError((err as Error).message); } }
  return <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
    <header className="mb-10 flex items-start justify-between gap-4"><div><p className="text-sm font-semibold tracking-wide text-stone-500">BELLNTELL</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{user ? 'Business setup' : 'Owner access'}</h1></div>{user && <Button variant="outline" onClick={logout}>Sign out</Button>}</header>
    {error && <p role="alert" className="mb-5 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="mb-5 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">{notice}</p>}
    {recoveryCode && <Card className="mb-6 border-amber-300 bg-amber-50"><h2 className="text-lg font-semibold">Save your recovery code</h2><p className="mt-2 text-sm">This code is shown once. Store it privately. It can reset your password if you lose access.</p><code className="mt-4 block break-all rounded bg-white p-3 text-sm select-all">{recoveryCode}</code><label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} /> I saved this code in a safe place</label><Button className="mt-4" disabled={!saved} onClick={() => { setRecoveryCode(''); setSaved(false); if (!user) setMode('login'); else void loadBusiness(); }}>Continue</Button></Card>}
    {!user && !recoveryCode && <Card className="max-w-md"><div className="mb-6 flex gap-2"><Button variant={mode === 'login' ? 'default' : 'ghost'} onClick={() => setMode('login')}>Sign in</Button><Button variant={mode === 'register' ? 'default' : 'ghost'} onClick={() => setMode('register')}>Create account</Button></div><form onSubmit={submitAuth} className="space-y-4">{mode === 'register' && <Field label="Your name" value={name} onChange={setName} required />}<Field label="Email" value={email} onChange={setEmail} type="email" required />{mode === 'recover' && <Field label="Recovery code" value={codeInput} onChange={setCodeInput} required />}<Field label={mode === 'recover' ? 'New password' : 'Password'} value={password} onChange={setPassword} type="password" required /><Button type="submit" disabled={busy}>{mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Reset password'}</Button></form><button className="mt-5 text-sm underline" onClick={() => setMode(mode === 'recover' ? 'login' : 'recover')}>{mode === 'recover' ? 'Back to sign in' : 'Use a recovery code'}</button></Card>}
    {user && !recoveryCode && !business && <Card className="max-w-xl"><h2 className="text-xl font-semibold">Create your business</h2><p className="mt-2 mb-6 text-sm text-stone-600">Start with the name and local timezone. You can add public contact details next.</p><form onSubmit={createBusiness} className="space-y-4"><Field label="Business name" value={businessName} onChange={setBusinessName} required /><Field label="Public slug" value={slug} onChange={setSlug} placeholder="Generated from the name if blank" /><Field label="IANA timezone" value={timezone} onChange={setTimezone} required /><p className="text-xs text-stone-500">Example: America/New_York</p><Button type="submit" disabled={busy}>Create business</Button></form></Card>}
    {user && !recoveryCode && business && settings && <div className="grid gap-6 md:grid-cols-[1fr_1fr]"><Card><p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Setup · 1 of 2</p><h2 className="mt-2 text-xl font-semibold">Business identity</h2><form onSubmit={saveBusiness} className="mt-5 space-y-4"><Field label="Business name" value={businessName} onChange={setBusinessName} required /><p className="text-xs text-stone-500">Public slug: {business.slug}</p><p className="text-xs text-stone-500">Timezone controls future availability. Current: {business.timezone}</p><Field label="IANA timezone" value={timezone} onChange={setTimezone} required /><Button type="submit" disabled={busy}>Save business</Button></form></Card><Card><p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Setup · 2 of 2</p><h2 className="mt-2 text-xl font-semibold">Public contact</h2><form onSubmit={saveSettings} className="mt-5 space-y-4"><Field label="Email" value={publicEmail} onChange={setPublicEmail} type="email" /><Field label="Phone" value={publicPhone} onChange={setPublicPhone} /><Field label="Address" value={publicAddress} onChange={setPublicAddress} /><Field label="Website" value={publicWebsite} onChange={setPublicWebsite} type="url" /><label className="block space-y-1 text-sm font-medium"><span>Short description</span><textarea className="w-full rounded-md border border-stone-300 bg-white p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900" rows={3} maxLength={2000} value={publicDescription} onChange={(event) => setPublicDescription(event.target.value)} /></label><Button type="submit" disabled={busy}>Save contact</Button></form></Card><Operations business={business} csrf={csrf} /></div>}
  </main>;
}
