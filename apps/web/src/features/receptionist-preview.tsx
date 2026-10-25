'use client';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {VoiceCheckpoint} from './voice-checkpoint';

type Draft = { id: string; draftRevision: number; checksum: string };
type Snapshot = { id: string; checksum: string; sourceDraftRevision: number };
type Candidate = { serviceId: string; resourceId: string; startsAt: string; readback: string };
type Receipt = { actionReceiptId: string; kind: string; bookingRef?: string; label: string; recordId: string };
type Session = { id: string; stateRevision: number; block: { kind: string; label: string }; directive: string; slots: Record<string, string>; candidates: Candidate[]; pending: null | { id: string; revision: number; stateRevision: number; readback: string; simulated: boolean }; proof: null | { handle: string; appointmentId: string; expiresAt: number }; management: string | null; receipts: Receipt[]; checksum: string; status: string };
type ApiError = { error?: { message?: string } };

export function ReceptionistPreview({ businessId, csrf }: { businessId: string; csrf: string }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [capability, setCapability] = useState('');
  const [text, setText] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [date, setDate] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [inquiry, setInquiry] = useState('');
  const [reference, setReference] = useState('');
  const [privateToken, setPrivateToken] = useState('');
  const [intent, setIntent] = useState('book');
  const [catalog, setCatalog] = useState<{ services: { id: string; name: string }[]; resources: { id: string; displayName: string }[] }>({ services: [], resources: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const base = `/businesses/${businessId}/receptionist`;
  async function api<T>(path: string, method = 'GET', body?: unknown, extra?: Record<string, string>): Promise<T> {
    let response: Response;
    try { response = await fetch(`/api/v1${path}`, { method, credentials: 'same-origin', cache: 'no-store', headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { 'x-csrf-token': csrf, 'idempotency-key': crypto.randomUUID() } : {}), ...(capability ? { 'x-session-capability': capability } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined }); }
    catch { throw new Error('The server is unavailable. Keep your input and try again.'); }
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The server returned an unreadable response. Keep your input and try again.');
    let data: T & ApiError;
    try { data = await response.json() as T & ApiError; } catch { throw new Error('The server returned invalid JSON. Keep your input and try again.'); }
    if (!response.ok) throw new Error(data.error?.message ?? `Request failed (${response.status})`);
    return data;
  }
  async function run(work: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  function update(result: { session: Session }) { setSession(result.session); }
  async function loadDraft() { await run(async () => { const result = await api<{ draft: Draft }>(`${base}/draft`); setDraft(result.draft); setNotice('Draft loaded. A test snapshot copies this revision.'); }); }
  async function start() { if (!draft) return; await run(async () => {
    const selected = await api<{ snapshot: Snapshot }>(`${base}/test-snapshots`, 'POST', { draftId: draft.id, revision: draft.draftRevision });
    const created = await api<{ session: Session; capability: string }>('/simulations', 'POST', { businessId, testSnapshotId: selected.snapshot.id, mode: 'preview', transport: 'simulator', acknowledgeRealActions: false });
    setSnapshot(selected.snapshot); setCapability(created.capability); setSession(created.session); setReference(''); setPrivateToken('');
    const detail = await api<{ catalog: typeof catalog }>(`/simulations/${created.session.id}`, 'GET', undefined, { 'x-session-capability': created.capability });
    setCatalog(detail.catalog); setNotice('Simulation started. No real appointment will be created.');
  }); }
  async function send(event: FormEvent) { event.preventDefault(); if (!session || !text.trim()) return; await run(async () => {
    const result = await api<{ session: Session }>(`/simulations/${session.id}/turns`, 'POST', { expectedStateRevision: session.stateRevision, text: text.trim() }); update(result); setText('');
  }); }
  async function structured(kind: 'intent' | 'booking' | 'contact' | 'inquiry' | 'candidate') { if (!session) return; await run(async () => {
    const changes: { key: string; op: 'set'; value: string; evidence: string }[] = [];
    const add = (key: string, value: string) => { if (value.trim()) changes.push({ key, op: 'set', value: value.trim(), evidence: value.trim() }); };
    if (kind === 'booking') { add('service_id', serviceId); add('preferred_date', date); }
    if (kind === 'candidate') { add('resource_id', resourceId); add('starts_at', startsAt); }
    if (kind === 'contact') { add('name', customerName); add('email', customerEmail); }
    if (kind === 'inquiry') add('inquiry_summary', inquiry);
    const words = kind === 'intent' ? intent : changes.map(x => x.value).join(' ');
    if (!words) throw new Error('Enter the details for this step.');
    const result = await api<{ session: Session }>(`/simulations/${session.id}/turns`, 'POST', { expectedStateRevision: session.stateRevision, text: words, interpretation: { intent: kind === 'intent' ? intent : 'unknown', slot_changes: changes, requested_operation: null, question_text: null, uncertain_fields: [] } }); update(result);
  }); }
  async function confirm() { if (!session?.pending) return; const p = session.pending; await run(async () => { const result = await api<{ session: Session; managementToken?: string }>(`/simulations/${session.id}/proposals/${p.id}/confirm`, 'POST', { revision: p.revision, stateRevision: p.stateRevision, confirm: true }); update(result); if (result.managementToken) { setPrivateToken(result.managementToken); setReference(result.session.receipts.at(-1)?.bookingRef ?? ''); } }); }
  async function reject() { if (!session?.pending) return; const p = session.pending; await run(async () => { update(await api<{ session: Session }>(`/simulations/${session.id}/proposals/${p.id}/reject`, 'POST', { revision: p.revision, stateRevision: p.stateRevision })); }); }
  async function verify(event: FormEvent) { event.preventDefault(); if (!session) return; await run(async () => { update(await api<{ session: Session }>(`/simulations/${session.id}/appointment-verifications`, 'POST', { reference, token: privateToken })); setNotice('Synthetic booking verified for this session.'); }); }
  async function manage(action: 'cancel' | 'reschedule' | 'availability') { if (!session?.proof) return; await run(async () => {
    const requested_operation = action === 'cancel' ? { type: 'prepare_cancellation', verified_appointment_handle: session.proof!.handle } : action === 'reschedule' ? { type: 'prepare_reschedule', verified_appointment_handle: session.proof!.handle, starts_at: startsAt, ...(resourceId ? { resource_id: resourceId } : {}) } : { type: 'check_availability', service_id: session.slots.service_id, from: date, to: date, ...(resourceId ? { resource_id: resourceId } : {}) };
    const result = await api<{ session: Session }>(`/simulations/${session.id}/turns`, 'POST', { expectedStateRevision: session.stateRevision, text: action === 'cancel' ? 'cancel this booking' : action === 'reschedule' ? 'reschedule this booking' : 'show available times', interpretation: { intent: 'unknown', slot_changes: [], requested_operation, question_text: null, uncertain_fields: [] } }); update(result);
  }); }
  return <Card role="region" aria-label="Receptionist text preview" className="md:col-span-2"><h2 className="text-xl font-semibold">Receptionist text preview</h2><p className="mt-1 text-sm text-stone-600">Simulation only. Receipts are synthetic and do not change the real schedule.</p>
    {error && <p role="alert" className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}{notice && <p role="status" className="mt-4 text-sm text-green-800">{notice}</p>}
    <div className="mt-4 flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy} onClick={loadDraft}>Load draft</Button><Button type="button" disabled={busy || !draft} onClick={start}>Start snapshot preview</Button></div>
    {draft && <p className="mt-2 text-xs text-stone-600">Draft revision {draft.draftRevision}</p>}
    {snapshot && <p className="mt-2 text-xs text-stone-600">Pinned snapshot of revision {snapshot.sourceDraftRevision} · {snapshot.checksum.slice(0, 12)}</p>}
    {session && <div className="mt-5 space-y-4"><div role="status" className="rounded bg-stone-100 p-4"><p className="text-sm font-semibold">{session.block.label} · {session.block.kind}</p><p className="mt-2 whitespace-pre-wrap text-sm">{session.directive}</p></div>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Request<select className="mt-1 block w-full rounded border p-2" value={intent} onChange={e => setIntent(e.target.value)}>{['book', 'inquiry', 'manage', 'human', 'finish'].map(x => <option key={x}>{x}</option>)}</select></label><Button type="button" className="self-end" disabled={busy} onClick={() => void structured('intent')}>Send request</Button>
      <label className="text-sm">Service<select className="mt-1 block w-full rounded border p-2" value={serviceId} onChange={e => setServiceId(e.target.value)}><option value="">Select service</option>{catalog.services.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label className="text-sm">Local date<Input type="date" value={date} onChange={e => setDate(e.target.value)} /></label><Button type="button" disabled={busy} onClick={() => void structured('booking')}>Choose service and date</Button><span />
      <label className="text-sm">Resource<select className="mt-1 block w-full rounded border p-2" value={resourceId} onChange={e => setResourceId(e.target.value)}><option value="">Select resource</option>{catalog.resources.map(x => <option key={x.id} value={x.id}>{x.displayName}</option>)}</select></label><label className="text-sm">Start time with offset<Input placeholder="2026-11-10T09:00:00+05:00" value={startsAt} onChange={e => setStartsAt(e.target.value)} /></label><Button type="button" disabled={busy} onClick={() => void structured('candidate')}>Choose time</Button><span />
      <label className="text-sm">Customer name<Input value={customerName} onChange={e => setCustomerName(e.target.value)} /></label><label className="text-sm">Customer email<Input type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} /></label><Button type="button" disabled={busy} onClick={() => void structured('contact')}>Send contact</Button><span />
      <label className="text-sm sm:col-span-2">Inquiry summary<Input value={inquiry} onChange={e => setInquiry(e.target.value)} /></label><Button type="button" disabled={busy} onClick={() => void structured('inquiry')}>Send inquiry summary</Button></div>
      {session.candidates.length > 0 && <div className="text-sm"><p className="font-medium">Suggested times</p>{session.candidates.map(x => <button key={x.startsAt} type="button" className="mt-1 block text-left underline" onClick={() => { setResourceId(x.resourceId); setStartsAt(x.startsAt); }}>{x.readback || x.startsAt}</button>)}</div>}
      <form onSubmit={send} className="flex gap-2"><label className="grow text-sm">Text turn<Input value={text} onChange={e => setText(e.target.value)} placeholder="Ask an exact FAQ question, say yes, no, or correct a detail" /></label><Button type="submit" className="self-end" disabled={busy || !text.trim()}>Send</Button></form>
      {session.pending && <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm"><p className="font-semibold">Review before confirming · simulation</p><p className="mt-2">{session.pending.readback}</p><div className="mt-3 flex gap-2"><Button type="button" disabled={busy} onClick={confirm}>Confirm synthetic action</Button><Button type="button" variant="outline" disabled={busy} onClick={reject}>Reject</Button></div></div>}
      {session.receipts.some(x => x.kind === 'book') && <form onSubmit={verify} className="grid gap-2 rounded border p-4 sm:grid-cols-2"><p className="font-semibold sm:col-span-2">Manage synthetic booking</p><label className="text-sm">Booking reference<Input value={reference} onChange={e => setReference(e.target.value)} /></label><label className="text-sm">Private management token<Input type="password" value={privateToken} onChange={e => setPrivateToken(e.target.value)} /></label><Button type="submit" disabled={busy || !reference || !privateToken}>Verify private booking</Button><p className="text-xs text-stone-500 sm:col-span-2">This synthetic token is shown once in this page. It is never sent as a conversation turn.</p></form>}
      {session.management === 'choose' && session.proof && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => void manage('availability')}>Find change times</Button><Button type="button" variant="outline" disabled={busy} onClick={() => void manage('reschedule')}>Review synthetic reschedule</Button><Button type="button" variant="outline" disabled={busy} onClick={() => void manage('cancel')}>Review synthetic cancellation</Button></div>}
      {session.receipts.map(x => <div key={x.actionReceiptId} role="status" className="rounded border p-3 text-sm"><strong>{x.label}</strong><p>{x.kind} · {x.bookingRef ?? x.recordId}</p></div>)}
    </div>}
    <VoiceCheckpoint businessId={businessId} snapshotId={snapshot?.id??null} csrf={csrf}/>
  </Card>;
}
