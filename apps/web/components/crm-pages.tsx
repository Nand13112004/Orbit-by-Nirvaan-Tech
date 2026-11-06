'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownUp, ArrowLeft, ArrowUpRight, BarChart3, CalendarClock, Check, CircleAlert, Copy, Download, Plus, Search, Sparkles, Users } from 'lucide-react';
import { api, apiWithMetadata, dashboardForRole, mutate } from '@/lib/api';

type Lead = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  other?: string | null;
  status: string;
  sourceId?: string | null;
  assigneeId: string;
  assignee?: { id: string; name: string } | null;
  source?: { id: string; name: string } | null;
  createdAt?: string;
  updatedAt: string;
};
type LeadListItem = Lead & { followUps: { description: string; dueAt: string; destination?: string | null }[] };
type LeadPageData = { items: LeadListItem[]; total: number; page: number; pageSize: number; totalPages: number };
type User = { id: string; name: string; email: string; role: string; active: boolean; managerId?: string | null };
type FollowUp = { id: string; leadId: string; description: string; dueAt: string; destination?: string | null; completed: boolean; lead: { id: string; name: string } };
type Analytics = { totalLeads: number; byStatus: { status: string; _count: { _all: number } }[]; openFollowUps: number };
const STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST'];
const STATUS_LABELS: Record<string, string> = {
  NEW: 'New', CONTACTED: 'Contacted', QUALIFIED: 'Qualified', PROPOSAL: 'Proposal', WON: 'Won', LOST: 'Lost',
};

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="crm-page-header"><div><p className="crm-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function LoadingPanel({ label = 'Loading data' }: { label?: string }) {
  return <div className="panel crm-state" role="status"><div className="crm-spinner" /><span>{label}…</span></div>;
}

function ErrorPanel({ message }: { message: string }) {
  return <div className="panel crm-state crm-error" role="alert"><CircleAlert size={18} />{message}</div>;
}

function StatusPill({ status }: { status: string }) {
  return <span className={`crm-status crm-status-${status.toLowerCase()}`}>{STATUS_LABELS[status] ?? status}</span>;
}

export function LeadsPage() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [deferredSearch, setDeferredSearch] = useState(search);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ user: User }>('/auth/me') });

  useEffect(() => {
    const timer = window.setTimeout(() => setDeferredSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useQuery({
    queryKey: ['leads', 'page', deferredSearch, status, page, order],
    queryFn: () => api<LeadPageData>(`/leads?${new URLSearchParams({ page: String(page), sort: 'updatedAt', order, ...(deferredSearch ? { search: deferredSearch } : {}), ...(status ? { status } : {}) })}`),
  });
  const statusUpdate = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: string }) => mutate(`/leads/${id}`, 'PATCH', { status: nextStatus }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leads'] }),
  });
  const deleteLead = useMutation({
    mutationFn: (id: string) => mutate(`/leads/${id}`, 'DELETE'),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['leads'] }),
        queryClient.invalidateQueries({ queryKey: ['analytics'] }),
        queryClient.invalidateQueries({ queryKey: ['follow-ups'] }),
      ]);
    },
  });

  function confirmDelete(lead: Lead) {
    if (deleteLead.isPending) return;
    if (window.confirm(`Delete "${lead.name}"? This will permanently remove this lead and its notes and follow-ups.`)) {
      deleteLead.mutate(lead.id);
    }
  }

  function exportCsv() {
    const rows = query.data?.items ?? [];
    const csv = [
      ['Name', 'Company', 'Email', 'Phone', 'Status', 'Follow-up'].map(csvCell).join(','),
      ...rows.map((lead) => [lead.name, lead.company ?? '', lead.email ?? '', lead.phone ?? '', STATUS_LABELS[lead.status] ?? lead.status, lead.followUps?.[0] ? formatDate(lead.followUps[0].dueAt) : ''].map(csvCell).join(',')),
    ].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'orbit-leads.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="crm-page">
      <PageHeader eyebrow="Customer relationships" title="Lead management" description="Review, search, and move your assigned leads through the sales process." action={<div className="crm-actions"><button className="quiet crm-button" onClick={exportCsv} disabled={!query.data?.items.length}><Download size={15} /> Export current page</button><Link className="primary crm-button" href="leads/new"><Plus size={16} /> New lead</Link></div>} />
      {statusUpdate.isError && <ErrorPanel message={statusUpdate.error.message} />}
      {deleteLead.isError && <ErrorPanel message={deleteLead.error.message} />}
      <section className="panel crm-table-panel">
        <div className="crm-toolbar">
          <label className="crm-search"><Search size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search name, company, or email" /></label>
          <select className="field crm-filter" aria-label="Filter leads by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{STATUSES.map((item) => <option key={item} value={item}>{STATUS_LABELS[item]}</option>)}</select>
          <button className="quiet crm-button" onClick={() => setOrder((value) => value === 'asc' ? 'desc' : 'asc')}><ArrowDownUp size={15} /> Updated {order === 'desc' ? 'newest' : 'oldest'}</button>
          {query.data && <span className="crm-count">{query.data.total} lead{query.data.total === 1 ? '' : 's'}</span>}
        </div>
        {query.isLoading ? <LoadingPanel label="Loading leads" /> : query.isError ? <ErrorPanel message={query.error.message} /> : query.data?.items.length ? (
          <div className="crm-table-scroll"><table className="crm-table"><thead><tr><th>Lead</th><th>Status</th><th>Follow-up</th><th>Last updated</th><th aria-label="Actions" /></tr></thead><tbody>
            {query.data.items.map((lead) => <tr key={lead.id}>
              <td><Link className="crm-lead-link" href={`leads/${lead.id}`}>{lead.name}<small>{lead.company ?? lead.email ?? 'No company or email provided'}</small></Link></td>
              <td><select className={`crm-status-select crm-status-${lead.status.toLowerCase()}`} aria-label={`Status for ${lead.name}`} value={lead.status} disabled={statusUpdate.isPending} onChange={(event) => statusUpdate.mutate({ id: lead.id, nextStatus: event.target.value })}>{STATUSES.map((item) => <option key={item} value={item}>{STATUS_LABELS[item]}</option>)}</select></td>
              <td>{lead.followUps?.[0] ? <div className="crm-followup-cell">{lead.followUps[0].destination && <a className="primary crm-small-button" href={lead.followUps[0].destination} target="_blank" rel="noreferrer">Go to follow-up</a>}<strong>{lead.followUps[0].description}</strong><small>{formatDate(lead.followUps[0].dueAt)}</small></div> : '—'}</td>
              <td>{formatDate(lead.updatedAt)}</td>
              <td><div className="crm-row-actions"><Link className="crm-icon-link" href={`leads/${lead.id}`} aria-label={`View ${lead.name}`}><ArrowUpRight size={17} /></Link>{(me.data?.user.role === 'ADMIN' || me.data?.user.role === 'MANAGER') && <button type="button" className="crm-delete-row" disabled={deleteLead.isPending} onClick={() => confirmDelete(lead)}>Delete</button>}</div></td>
            </tr>)}
          </tbody></table></div>
        ) : <div className="crm-empty"><Users size={25} /><strong>{deferredSearch || status ? 'No matching leads' : 'No leads yet'}</strong><p>{deferredSearch || status ? 'Try another search or status filter.' : 'Create a lead to start building your pipeline.'}</p>{!deferredSearch && !status && <Link className="primary crm-button" href="leads/new"><Plus size={16} /> Create a lead</Link>}</div>}
        {query.data && query.data.totalPages > 1 && <div className="crm-pagination"><span>Page {page} of {query.data.totalPages}</span><div><button className="quiet" disabled={page <= 1 || query.isFetching} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="quiet" disabled={page >= query.data.totalPages || query.isFetching} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>}
      </section>
    </section>
  );
}

export function NewLeadPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => api<{ id: string; name: string }[]>('/sources') });
  const users = useQuery({ queryKey: ['users', 'active'], queryFn: () => api<User[]>('/users?active=true') });
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ user: User }>('/auth/me') });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const data = Object.fromEntries(form.entries());
    const payload = {
      name: String(data.name).trim(),
      company: String(data.company).trim() || null,
      email: String(data.email).trim() || null,
      phone: String(data.phone).trim() || null,
      other: String(data.other).trim() || null,
      status: String(data.status),
      ...(data.sourceId ? { sourceId: String(data.sourceId) } : {}),
      ...(data.assigneeId ? { assigneeId: String(data.assigneeId) } : {}),
    };
    try {
      const created = await mutate<Lead>('/leads', 'POST', payload);
      await queryClient.invalidateQueries({ queryKey: ['leads'] });
      router.replace(`../leads/${created.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create lead');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return <section className="crm-page">
    <PageHeader eyebrow="Lead management" title="Create a lead" description="Capture the contact details and ownership needed to start a relationship." />
    <form className="panel crm-form" onSubmit={submit}>
      <div className="crm-form-grid">
        <label><span>Full name *</span><input className="field" name="name" required maxLength={160} /></label>
        <label><span>Company</span><input className="field" name="company" maxLength={160} /></label>
        <label><span>Email</span><input className="field" name="email" type="email" maxLength={254} /></label>
        <label><span>Phone</span><input className="field" name="phone" type="tel" maxLength={40} /></label>
        <label><span>Other</span><input className="field" name="other" maxLength={2000} /></label>
        <label><span>Lead source</span><select className="field" name="sourceId"><option value="">Not specified</option>{sources.data?.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
        <label><span>Starting status</span><select className="field" name="status" defaultValue="NEW">{STATUSES.map((item) => <option key={item} value={item}>{STATUS_LABELS[item]}</option>)}</select></label>
        {me.data?.user.role !== 'MEMBER' && <label><span>Assigned employee *</span><select className="field" name="assigneeId" required defaultValue=""><option value="" disabled>Select an employee</option>{users.data?.filter((item) => item.active && item.role !== 'ADMIN').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      </div>
      {sources.isError && <ErrorPanel message={`Could not load lead sources: ${sources.error.message}`} />}
      {users.isError && <ErrorPanel message={`Could not load employees: ${users.error.message}`} />}
      {error && <ErrorPanel message={error} />}
      <div className="crm-form-actions"><Link className="quiet crm-button" href="../leads">Cancel</Link><button className="primary crm-button" disabled={saving}>{saving ? 'Creating…' : 'Create lead'}</button></div>
    </form>
  </section>;
}

export function LeadDetailsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [followUpMethod, setFollowUpMethod] = useState('');
  const [followUpDestination, setFollowUpDestination] = useState('');
  const [aiDrafts, setAiDrafts] = useState<Record<string, string>>({});
  const [draftingFollowUpId, setDraftingFollowUpId] = useState<string | null>(null);
  const [happyFollowUpId, setHappyFollowUpId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ user: User }>('/auth/me') });
  const leadQuery = useQuery({
    queryKey: ['lead', params.id],
    queryFn: () => api<Lead & { notes: { id: string; content: string; createdAt: string; author: { name: string } }[]; followUps: FollowUp[] }>(`/leads/${params.id}`),
  });

  async function submitAction(event: FormEvent<HTMLFormElement>, kind: 'note' | 'follow-up') {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const value = String(form.get('content') ?? '').trim();
    try {
      const method = String(form.get('method') ?? '');
      const savedFollowUp = kind === 'follow-up' ? leadQuery.data?.followUps[0] : undefined;
      const description = savedFollowUp?.description ?? (method === 'Other' ? `Other: ${value}` : method);
      const destination = kind === 'follow-up'
        ? savedFollowUp?.destination ?? followUpDestinationFor(method, followUpDestination)
        : undefined;
      const body = kind === 'note' ? { content: value } : {
        description,
        dueAt: dateOnlyAtNoonIso(String(form.get('dueAt'))),
        ...(destination ? { destination } : {}),
      };
      await mutate(`/leads/${params.id}/${kind === 'note' ? 'notes' : 'follow-ups'}`, 'POST', body);
      formElement.reset();
      if (kind === 'follow-up') {
        setFollowUpMethod('');
        setFollowUpDestination('');
      }
      await queryClient.invalidateQueries({ queryKey: ['lead', params.id] });
      await queryClient.invalidateQueries({ queryKey: ['follow-ups'] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this update');
    }
  }

  async function completeFollowUp(id: string) {
    const result = leadQuery.data?.followUps.find((item) => item.id === id);
    if (!result) return;
    try {
      await mutate(`/leads/${params.id}/follow-ups/${id}`, 'PATCH', { completed: true });
      await queryClient.invalidateQueries({ queryKey: ['lead', params.id] });
      await queryClient.invalidateQueries({ queryKey: ['follow-ups'] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not complete the follow-up');
    }
  }

  async function generateAiFollowUp(item: FollowUp) {
    if (draftingFollowUpId) return;
    setDraftingFollowUpId(item.id);
    setError('');
    setAiDrafts((drafts) => {
      const remainingDrafts = { ...drafts };
      delete remainingDrafts[item.id];
      return remainingDrafts;
    });
    try {
      const result = await mutate<{ message: string }>(
        `/leads/${params.id}/follow-ups/${item.id}/ai-draft`,
        'POST',
        {},
      );
      setAiDrafts((drafts) => ({ ...drafts, [item.id]: result.message }));
      setHappyFollowUpId(item.id);
      window.setTimeout(() => {
        setHappyFollowUpId((current) => current === item.id ? null : current);
      }, 2600);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create an AI follow-up draft');
    } finally {
      setDraftingFollowUpId(null);
    }
  }

  async function copyAiFollowUp(id: string) {
    const message = aiDrafts[id];
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message);
      setAiDrafts((drafts) => {
        const remainingDrafts = { ...drafts };
        delete remainingDrafts[id];
        return remainingDrafts;
      });
    } catch {
      setError('Could not copy the draft. Check clipboard permissions and try again.');
    }
  }

  async function deleteLead() {
    if (deletingRef.current || !leadQuery.data) return;
    if (!window.confirm(`Delete "${leadQuery.data.name}"? This will permanently remove this lead and its notes and follow-ups.`)) return;
    deletingRef.current = true;
    setDeleting(true);
    setError('');
    try {
      await mutate(`/leads/${params.id}`, 'DELETE');
      queryClient.removeQueries({ queryKey: ['lead', params.id] });
      void queryClient.invalidateQueries({ queryKey: ['leads'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics'] });
      void queryClient.invalidateQueries({ queryKey: ['follow-ups'] });
      router.replace(`${dashboardForRole(me.data?.user.role ?? 'ADMIN')}/leads`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete this lead');
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  if (leadQuery.isLoading) return <LoadingPanel label="Loading lead" />;
  if (leadQuery.isError) return <ErrorPanel message={leadQuery.error.message} />;
  const lead = leadQuery.data;
  if (!lead) return null;
  const reminderDates = followUpDateOptions(lead.createdAt ?? new Date().toISOString());

  return <section className="crm-page">
    <Link className="crm-back-link" href="../leads"><ArrowLeft size={15} /> All leads</Link>
    <PageHeader eyebrow="Lead details" title={lead.name} description={lead.company || 'Contact record'} action={<StatusPill status={lead.status} />} />
    {error && <ErrorPanel message={error} />}
    <div className="crm-details-grid">
      <div className="crm-details-main">
        <section className="panel crm-detail-card">
          <h2>Contact information</h2>
          <dl className="crm-contact-grid"><Detail label="Company" value={lead.company} /><Detail label="Email" value={lead.email} /><Detail label="Phone" value={lead.phone} /><Detail label="Other" value={lead.other} /><Detail label="Source" value={lead.source?.name} /><Detail label="Assigned to" value={lead.assignee?.name} /><Detail label="Created" value={lead.createdAt ? formatDate(lead.createdAt) : '—'} /><Detail label="Last updated" value={formatDate(lead.updatedAt)} /></dl>
        </section>
        <section className="panel crm-detail-card">
          <h2>Follow-up history</h2>
          {lead.followUps.length ? <div className="crm-timeline">{lead.followUps.map((item) => <article key={item.id} className="crm-timeline-item">
            <span className={`crm-timeline-dot${item.completed ? ' is-complete' : ''}`} />
            <div className="crm-timeline-content">
              <strong>{item.description}</strong>
              <p>{formatDate(item.dueAt)} {item.completed ? '· Completed' : '· Scheduled'}</p>
              {!item.completed && <div className="crm-followup-actions">
                {item.destination && <a className="primary crm-small-button" href={item.destination} target="_blank" rel="noreferrer">Go to follow-up</a>}
                {isAiDraftableFollowUp(item) && <button className="quiet crm-small-button" disabled={draftingFollowUpId !== null} onClick={() => void generateAiFollowUp(item)}><Sparkles size={14} />{draftingFollowUpId === item.id ? 'Writing…' : happyFollowUpId === item.id ? 'Draft ready' : 'AI follow-up'}</button>}
                <button className="quiet crm-small-button" onClick={() => void completeFollowUp(item.id)}><Check size={14} /> Mark complete</button>
              </div>}
              {aiDrafts[item.id] && <div className="crm-ai-followup-draft">
                <p>{aiDrafts[item.id]}</p>
                <button className="primary crm-small-button" onClick={() => void copyAiFollowUp(item.id)}><Copy size={14} /> Copy message</button>
              </div>}
            </div>
          </article>)}</div> : <p className="crm-muted">No follow-ups recorded.</p>}
          <form className="crm-inline-form" onSubmit={(event) => void submitAction(event, 'follow-up')}>
            <h3>Schedule follow-up</h3>
            <label><span>Reminder</span><select className="field" name="dueAt" required defaultValue={reminderDates[0].value}>{reminderDates.map((date) => <option key={date.value} value={date.value}>{date.label}</option>)}</select></label>
            {lead.followUps.length === 0 && <>
              <label><span>Notes</span><select className="field" name="method" value={followUpMethod} onChange={(event) => { setFollowUpMethod(event.target.value); setFollowUpDestination(''); }} required><option value="" disabled>Select a follow-up type</option><option>WhatsApp MSG</option><option>Instagram MSG</option><option>Mail</option><option>Other</option></select></label>
              {followUpMethod.includes('WhatsApp') && <label><span>WhatsApp number</span><input className="field" name="destination" type="tel" value={followUpDestination} onChange={(event) => setFollowUpDestination(event.target.value)} placeholder="+91 81289 27827" required /></label>}
              {followUpMethod === 'Instagram MSG' && <label><span>Instagram chat URL</span><input className="field" name="destination" type="url" value={followUpDestination} onChange={(event) => setFollowUpDestination(event.target.value)} placeholder="https://www.instagram.com/" required /></label>}
              {followUpMethod === 'Mail' && <label><span>Gmail URL</span><input className="field" name="destination" type="url" value={followUpDestination} onChange={(event) => setFollowUpDestination(event.target.value)} placeholder="https://mail.google.com/" required /></label>}
              {followUpMethod === 'Other' && <label><span>Other notes</span><textarea className="field" name="content" maxLength={2000} required rows={3} /></label>}
            </>}
            <button className="primary crm-button"><CalendarClock size={15} /> Schedule</button>
          </form>
        </section>
      </div>
      <section className="panel crm-detail-card">
        <h2>Activity notes</h2>
        <form className="crm-inline-form" onSubmit={(event) => void submitAction(event, 'note')}><label><span>Add a note</span><textarea className="field" name="content" maxLength={5000} required rows={4} /></label><button className="primary crm-button"><Plus size={15} /> Add note</button></form>
        {lead.notes.length ? <div className="crm-note-list">{lead.notes.map((note) => <article key={note.id}><p>{note.content}</p><small>{note.author?.name ?? 'Workspace member'} · {formatDate(note.createdAt)}</small></article>)}</div> : <p className="crm-muted">No activity notes yet.</p>}
      </section>
    </div>
    {(me.data?.user.role === 'ADMIN' || me.data?.user.role === 'MANAGER') && <section className="panel crm-delete-lead">
      <div><h2>Delete this lead</h2><p>This permanently deletes the lead, its notes, and its follow-ups.</p></div>
      <button type="button" className="crm-delete-button" disabled={deleting} onClick={() => void deleteLead()}>{deleting ? 'Deleting…' : 'Delete lead'}</button>
    </section>}
  </section>;
}

export function PipelinePage() {
  const queryClient = useQueryClient();
  const leadsQuery = useQuery({ queryKey: ['leads', 'pipeline'], queryFn: () => api<LeadPageData>('/leads?page=1&sort=updatedAt&order=desc') });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => mutate(`/leads/${id}`, 'PATCH', { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leads'] }),
  });
  const [dragged, setDragged] = useState<string | null>(null);

  return <section className="crm-page">
    <PageHeader eyebrow="Sales" title="Sales pipeline" description="Move assigned leads across the statuses supported by your workspace." />
    {leadsQuery.isLoading ? <LoadingPanel label="Loading pipeline" /> : leadsQuery.isError ? <ErrorPanel message={leadsQuery.error.message} /> : <>
      {update.isError && <ErrorPanel message={update.error.message} />}
      <p className="crm-data-note">Showing {leadsQuery.data?.items.length ?? 0} most recently updated leads. The current backend supports six pipeline statuses.</p>
      <div className="crm-kanban">{STATUSES.map((status) => {
        const cards = leadsQuery.data?.items.filter((item) => item.status === status) ?? [];
        return <section key={status} className="crm-kanban-column" onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragged) update.mutate({ id: dragged, status }); setDragged(null); }}>
          <header><span><StatusPill status={status} /> <b>{cards.length}</b></span></header>
          <div className="crm-kanban-cards">{cards.map((lead) => <article key={lead.id} draggable onDragStart={() => setDragged(lead.id)} className="panel crm-kanban-card"><Link href={`leads/${lead.id}`}><strong>{lead.name}</strong><small>{lead.company ?? lead.email ?? 'Contact'}</small></Link><footer><span>{lead.assignee?.name ?? 'Unassigned'}</span><select aria-label={`Move ${lead.name} to status`} value={lead.status} onChange={(event) => update.mutate({ id: lead.id, status: event.target.value })}>{STATUSES.map((item) => <option key={item} value={item}>{STATUS_LABELS[item]}</option>)}</select></footer></article>)}</div>
        </section>;
      })}</div>
    </>}
  </section>;
}

export function FollowUpsPage({ calendar = false }: { calendar?: boolean }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'open' | 'today' | 'overdue' | 'completed'>('open');
  const followUpsQuery = useQuery({
    queryKey: ['follow-ups', 'manager', filter],
    queryFn: () => api<FollowUp[]>(`/follow-ups?take=25&completed=${filter === 'completed' ? 'true' : 'false'}`),
  });
  const update = useMutation({
    mutationFn: (item: FollowUp) => mutate(`/leads/${item.leadId}/follow-ups/${item.id}`, 'PATCH', { completed: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['follow-ups'] }),
  });
  const filtered = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const end = start + 24 * 60 * 60 * 1000;
    return (followUpsQuery.data ?? []).filter((item) => {
      if (filter === 'completed') return item.completed;
      if (item.completed) return false;
      const due = new Date(item.dueAt).getTime();
      if (filter === 'today') return due >= start && due < end;
      if (filter === 'overdue') return due < start;
      return true;
    }).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }, [filter, followUpsQuery.data]);

  return <section className="crm-page">
    <PageHeader eyebrow={calendar ? 'Schedule' : 'Customer relationships'} title={calendar ? 'Calendar' : 'Follow-up management'} description={calendar ? 'A date-ordered view of your scheduled lead conversations.' : 'Keep track of today’s reminders, upcoming conversations, and overdue follow-ups.'} />
    <div className="crm-filter-tabs" role="group" aria-label="Filter follow-ups">
      {(['open', 'today', 'overdue', 'completed'] as const).map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item === 'open' ? 'Upcoming & open' : item[0].toUpperCase() + item.slice(1)}</button>)}
    </div>
    {update.isError && <ErrorPanel message={update.error.message} />}
    <section className="panel crm-followup-list">
      {followUpsQuery.isLoading ? <LoadingPanel label="Loading follow-ups" /> : followUpsQuery.isError ? <ErrorPanel message={followUpsQuery.error.message} /> : filtered.length ? filtered.map((item) => <article className="crm-followup-row" key={item.id}>
        <div className="crm-followup-date"><strong>{new Date(item.dueAt).toLocaleDateString(undefined, { day: '2-digit' })}</strong><span>{new Date(item.dueAt).toLocaleDateString(undefined, { month: 'short' })}</span></div>
        <div className="crm-followup-copy"><Link href={`leads/${item.leadId}`}><strong>{item.lead.name}</strong></Link><p>{item.description}</p><small>{new Date(item.dueAt).toLocaleString()}</small></div>
        <div className="crm-followup-actions">{!item.completed && item.destination && <a className="primary crm-small-button" href={item.destination} target="_blank" rel="noreferrer">Go to follow-up</a>}{item.completed ? <span className="crm-status crm-status-won">Completed</span> : <button className="quiet crm-small-button" disabled={update.isPending} onClick={() => update.mutate(item)}><Check size={14} /> Complete</button>}</div>
      </article>) : <div className="crm-empty"><CalendarClock size={25} /><strong>No follow-ups in this view</strong><p>Follow-ups scheduled on lead records will appear here.</p></div>}
      {!followUpsQuery.isError && !followUpsQuery.isLoading && (followUpsQuery.data?.length ?? 0) >= 25 && <p className="crm-data-note">Showing the first 25 matching follow-ups. Open a lead to view its complete history.</p>}
    </section>
  </section>;
}

export function TeamPage() {
  const query = useQuery({ queryKey: ['users', 'team-page'], queryFn: () => api<User[]>('/users?active=all') });
  return <section className="crm-page">
    <PageHeader eyebrow="People" title="Team management" description="Review workspace accounts and manage access according to your role." />
    {query.isLoading ? <LoadingPanel label="Loading team" /> : query.isError ? <ErrorPanel message={query.error.message} /> : <>
      <section className="panel crm-team-list">{query.data?.length ? query.data.map((person) => <article className="crm-team-row" key={person.id}>
        <span className="crm-avatar">{person.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
        <div className="crm-team-person"><strong>{person.name}{!person.active && <span className="crm-inactive">Inactive</span>}</strong><small>{person.email}</small></div>
        <span className="crm-role">{person.role === 'MEMBER' ? 'Team member' : person.role[0] + person.role.slice(1).toLowerCase()}</span>
      </article>) : <div className="crm-empty"><Users size={25} /><strong>No team accounts found</strong></div>}</section>
      <p className="crm-data-note">Account and access changes are managed from Settings.</p>
    </>}
  </section>;
}

export function ReportsPage() {
  const query = useQuery({ queryKey: ['analytics'], queryFn: () => api<Analytics>('/analytics') });
  const statusCounts = useMemo(() => new Map((query.data?.byStatus ?? []).map((item) => [item.status, item._count._all])), [query.data]);
  return <section className="crm-page">
    <PageHeader eyebrow="Performance" title="Reports & analytics" description="Lead and follow-up totals calculated from the records you are authorized to see." />
    {query.isLoading ? <LoadingPanel label="Calculating reports" /> : query.isError ? <ErrorPanel message={query.error.message} /> : <>
      <div className="crm-report-kpis"><article className="panel"><span>Total leads</span><strong>{query.data?.totalLeads ?? 0}</strong></article><article className="panel"><span>Open follow-ups</span><strong>{query.data?.openFollowUps ?? 0}</strong></article><article className="panel"><span>Won leads</span><strong>{statusCounts.get('WON') ?? 0}</strong></article><article className="panel"><span>Lost leads</span><strong>{statusCounts.get('LOST') ?? 0}</strong></article></div>
      <section className="panel crm-report-panel"><div className="crm-section-heading"><div><h2>Lead distribution by status</h2><p>Counts returned by the live workspace analytics API.</p></div></div>
        {(query.data?.byStatus.length ?? 0) ? <div className="crm-bars">{STATUSES.map((status) => {
          const value = statusCounts.get(status) ?? 0;
          const max = Math.max(1, ...Array.from(statusCounts.values()));
          return <div className="crm-bar-row" key={status}><span>{STATUS_LABELS[status]}</span><div className="crm-bar-track"><span style={{ width: `${value ? Math.max(3, value / max * 100) : 0}%` }} /></div><strong>{value}</strong></div>;
        })}</div> : <div className="crm-empty"><BarChart3 size={25} /><strong>No lead data available</strong><p>As leads are added, their current status totals will appear here.</p></div>}
      </section>
      <p className="crm-data-note">Monthly conversion, revenue, project, and employee performance reports require database records and analytics APIs that are not present in the current backend.</p>
    </>}
  </section>;
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ user: User }>('/auth/me') });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<{ key: string; value: string }[]>('/settings'), enabled: me.data?.user.role === 'ADMIN' });
  const [userSearch, setUserSearch] = useState('');
  const [deferredUserSearch, setDeferredUserSearch] = useState('');
  const [userPage, setUserPage] = useState(1);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [createRole, setCreateRole] = useState('MEMBER');
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDeferredUserSearch(userSearch.trim());
      setUserPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [userSearch]);
  const users = useQuery({
    queryKey: ['users', 'settings', userPage, deferredUserSearch],
    queryFn: () => apiWithMetadata<User[]>(`/users?page=${userPage}&search=${encodeURIComponent(deferredUserSearch)}`),
    enabled: me.data?.user.role === 'ADMIN',
    placeholderData: (previous) => previous,
  });
  const managerOptions = useQuery({
    queryKey: ['users', 'settings', 'active'],
    queryFn: () => api<User[]>('/users?active=true'),
    enabled: me.data?.user.role === 'ADMIN',
  });
  const updateUser = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { role?: string; active?: boolean; managerId?: string | null } }) => mutate(`/users/${id}`, 'PATCH', data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
  const totalUsers = Number(users.data?.headers.get('x-total-count') ?? users.data?.data.length ?? 0);
  const userItems = users.data?.data ?? [];
  const save = useMutation({
    mutationFn: (data: { key: string; value: string }) => mutate('/settings', 'POST', data),
    onSuccess: async () => { setKey(''); setValue(''); await queryClient.invalidateQueries({ queryKey: ['settings'] }); },
  });
  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setError('');
    try {
      await mutate('/users', 'POST', {
        name: form.get('name'),
        email: form.get('email'),
        password: form.get('password'),
        role: createRole,
        managerId: form.get('managerId') || undefined,
      });
      formElement.reset();
      setShowCreateUser(false);
      setCreateRole('MEMBER');
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create user');
    }
  }
  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetUser) return;
    const newPassword = new FormData(event.currentTarget).get('newPassword');
    setError('');
    try {
      await mutate(`/users/${resetUser.id}/reset-password`, 'POST', { newPassword });
      setResetUser(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not reset password');
    }
  }
  if (me.isLoading) return <LoadingPanel />;
  if (me.isError) return <ErrorPanel message={me.error.message} />;
  return <section className="crm-page">
    <PageHeader eyebrow="Workspace administration" title="Settings" description="Manage user access and application settings for your workspace." />
    {me.data?.user.role !== 'ADMIN' ? <div className="panel crm-state">Settings are available to administrators only.</div> : <>
      {error && <ErrorPanel message={error} />}
      <section className="panel crm-settings">
        <div className="crm-section-heading crm-settings-heading"><div><h2>User management</h2><p>Create accounts, update roles and team assignments, reset passwords, and activate or deactivate users.</p></div><button className="primary crm-button" onClick={() => { setShowCreateUser((visible) => !visible); setError(''); }}>{showCreateUser ? 'Cancel' : 'Add user'}</button></div>
        {showCreateUser && <form className="crm-user-form" onSubmit={createUser}>
          <label><span>Full name</span><input className="field" name="name" required maxLength={120} /></label>
          <label><span>Email address</span><input className="field" name="email" type="email" required maxLength={254} /></label>
          <label><span>Temporary password</span><input className="field" name="password" type="password" required minLength={12} autoComplete="new-password" /></label>
          <label><span>Role</span><select className="field" name="role" value={createRole} onChange={(event) => setCreateRole(event.target.value)}><option value="MEMBER">Team member</option><option value="MANAGER">Manager</option></select></label>
          <label><span>Manager (optional)</span><select className="field" name="managerId" defaultValue="" disabled={createRole !== 'MEMBER'}><option value="">No manager</option>{managerOptions.data?.filter((person) => person.role === 'MANAGER' && person.active).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          {managerOptions.isError && <ErrorPanel message={managerOptions.error.message} />}
          <button className="primary crm-button">Create account</button>
        </form>}
        <label className="crm-search crm-users-search"><Search size={16} /><input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Search users by name or email" /></label>
        {users.isLoading ? <LoadingPanel label="Loading users" /> : users.isError ? <ErrorPanel message={users.error.message} /> : userItems.length ? <div className="crm-user-list">{userItems.map((person) => <article className="crm-user-row" key={person.id}>
          <span className="crm-avatar">{person.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
          <div className="crm-team-person"><strong>{person.name}{!person.active && <span className="crm-inactive">Inactive</span>}</strong><small>{person.email}</small></div>
          {person.id === me.data?.user.id ? <span className="crm-role">You · {person.role === 'MEMBER' ? 'Team member' : person.role[0] + person.role.slice(1).toLowerCase()}</span> : <>
            <label className="crm-user-control"><span className="sr-only">Role for {person.name}</span><select className="field" value={person.role} onChange={(event) => updateUser.mutate({ id: person.id, data: { role: event.target.value } })}><option value="MANAGER">Manager</option><option value="MEMBER">Team member</option><option value="ADMIN">Admin</option></select></label>
            {person.role === 'MEMBER' && <label className="crm-user-control"><span className="sr-only">Manager for {person.name}</span><select className="field" value={person.managerId ?? ''} onChange={(event) => updateUser.mutate({ id: person.id, data: { managerId: event.target.value || null } })}><option value="">No manager</option>{(managerOptions.data ?? []).filter((candidate) => candidate.role === 'MANAGER' && candidate.active).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>}
            <button type="button" className="quiet crm-small-button" onClick={() => { setResetUser(person); setError(''); }}>Reset password</button>
            <button type="button" className="quiet crm-small-button" onClick={() => updateUser.mutate({ id: person.id, data: { active: !person.active } })}>{person.active ? 'Deactivate' : 'Reactivate'}</button>
          </>}
        </article>)}</div> : <div className="crm-empty"><Users size={25} /><strong>{deferredUserSearch ? 'No matching users' : 'No user accounts found'}</strong></div>}
        {users.data && <div className="crm-pagination"><span>{totalUsers} account{totalUsers === 1 ? '' : 's'} · Page {userPage}</span><div><button className="quiet" disabled={userPage <= 1 || users.isFetching} onClick={() => setUserPage((page) => page - 1)}>Previous</button><button className="quiet" disabled={userPage * 50 >= totalUsers || users.isFetching} onClick={() => setUserPage((page) => page + 1)}>Next</button></div></div>}
        {updateUser.isError && <div className="crm-user-feedback"><ErrorPanel message={updateUser.error.message} /></div>}
        {resetUser && <form className="crm-reset-form" onSubmit={resetPassword}><h3>Reset password for {resetUser.name}</h3><label><span>Temporary password</span><input className="field" name="newPassword" type="password" required minLength={12} autoComplete="new-password" /></label><button className="primary crm-button">Reset password</button><button type="button" className="quiet crm-button" onClick={() => setResetUser(null)}>Cancel</button></form>}
      </section>
      <section className="panel crm-settings">
        <h2>Workspace values</h2>
        {settings.isLoading ? <LoadingPanel label="Loading settings" /> : settings.isError ? <ErrorPanel message={settings.error.message} /> : settings.data?.length ? <div className="crm-setting-list">{settings.data.map((setting) => <article key={setting.key}><strong>{setting.key}</strong><span>{setting.value}</span></article>)}</div> : <p className="crm-muted">No custom workspace settings have been saved.</p>}
        <form className="crm-inline-form" onSubmit={async (event) => { event.preventDefault(); setError(''); try { await save.mutateAsync({ key: key.trim(), value }); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save setting'); } }}>
          <h3>Add or update a setting</h3><label><span>Key</span><input className="field" value={key} onChange={(event) => setKey(event.target.value)} maxLength={100} required /></label><label><span>Value</span><textarea className="field" value={value} onChange={(event) => setValue(event.target.value)} maxLength={2000} required rows={3} /></label>
          {save.isError && <ErrorPanel message={save.error.message} />}
          <button className="primary crm-button" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save setting'}</button>
        </form>
      </section>
    </>}
  </section>;
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return <div><dt>{label}</dt><dd>{value || '—'}</dd></div>;
}

function isAiDraftableFollowUp(item: FollowUp) {
  const description = item.description.toLowerCase();
  return description.includes('whatsapp') || description.includes('instagram') || description.includes('mail');
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function followUpDateOptions(createdAt: string) {
  const start = new Date(createdAt);
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: 31 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return { value, label: `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}` };
  });
}

function dateOnlyAtNoonIso(value: string) {
  return new Date(`${value}T12:00:00`).toISOString();
}

function whatsappDestination(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) {
    throw new Error('Enter a valid WhatsApp number with its country code');
  }
  return `https://wa.me/+${digits}`;
}

function followUpDestinationFor(method: string, value: string) {
  if (method.includes('WhatsApp')) return whatsappDestination(value);
  if (method.includes('Instagram') || method.includes('Mail')) return secureDestination(value);
  return undefined;
}

function secureDestination(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a valid destination URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error('Destination URL must start with https://');
  }
  return url.toString();
}
