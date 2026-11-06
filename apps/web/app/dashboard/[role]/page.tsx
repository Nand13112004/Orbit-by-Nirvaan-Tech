'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import dynamic from 'next/dynamic';
import { BarChart3, CalendarClock, ChevronsRight, KeyRound, LayoutDashboard, ListChecks, LogOut, Moon, Plus, Search, Settings2, Sun, Users } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Brand } from '@/components/brand';
import { api, apiWithMetadata, clearCsrfToken, dashboardForRole, mutate } from '@/lib/api';
import { useTheme } from '@/app/providers';

type User = { id: string; name: string; email: string; role: 'ADMIN' | 'MANAGER' | 'MEMBER'; active: boolean; managerId?: string | null };
type Analytics = { totalLeads: number; byStatus: { status: string; _count: { _all: number } }[]; openFollowUps: number };
type FollowUp = { id: string; leadId: string; description: string; dueAt: string; destination?: string | null; completed: boolean; lead: { id: string; name: string } };
const PipelineChart = dynamic(
  () => import('@/components/pipeline-chart').then((module) => module.PipelineChart),
  { ssr: false, loading: () => <div className="mt-4 h-56 animate-pulse rounded-lg bg-gray-50" aria-label="Loading chart" /> },
);

export default function DashboardPage() {
  const router = useRouter();
  const params = useParams<{ role: string }>();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState('');
  const [leadSearch, setLeadSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [deferredUserSearch, setDeferredUserSearch] = useState('');
  const [userPage, setUserPage] = useState(1);
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [showSourceForm, setShowSourceForm] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { isDark, toggleTheme } = useTheme();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const todayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDeferredUserSearch(userSearch.trim());
      setUserPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [userSearch]);

  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: User }>('/auth/me'),
    retry: false,
  });
  const user = me.data?.user;
  const analytics = useQuery({ queryKey: ['analytics'], queryFn: () => api<Analytics>('/analytics'), enabled: !!user });
  const followUps = useQuery({
    queryKey: ['follow-ups', 'today', todayKey],
    queryFn: () => api<FollowUp[]>(`/follow-ups?take=25&completed=false&dueFrom=${encodeURIComponent(todayStart.toISOString())}&dueBefore=${encodeURIComponent(tomorrowStart.toISOString())}`),
    enabled: !!user,
  });
  const todayFollowUps = (followUps.data ?? []).filter((item) => {
    const dueAt = new Date(item.dueAt);
    return !item.completed
      && dueAt.getFullYear() === now.getFullYear()
      && dueAt.getMonth() === now.getMonth()
      && dueAt.getDate() === now.getDate();
  });
  const users = useQuery({
    queryKey: ['users', user?.id, user?.role, userPage, deferredUserSearch],
    queryFn: () => apiWithMetadata<User[]>(`/users?page=${userPage}&search=${encodeURIComponent(deferredUserSearch)}`),
    enabled: user?.role === 'MANAGER',
    placeholderData: keepPreviousData,
  });
  const totalUsers = Number(users.data?.headers.get('x-total-count') ?? users.data?.data.length ?? 0);
  const userItems = useMemo(() => users.data?.data ?? [], [users.data]);
  const managerOptions = useQuery({
    queryKey: ['users', user?.id, user?.role, 'managers'],
    queryFn: () => api<User[]>('/users?active=true'),
    enabled: (user?.role === 'ADMIN' || user?.role === 'MANAGER') && showLeadForm,
    staleTime: 30_000,
  });
  const sources = useQuery({
    queryKey: ['sources'],
    queryFn: () => api<{ id: string; name: string }[]>('/sources'),
    enabled: !!user && (showLeadForm || showSourceForm),
  });

  useEffect(() => {
    if (me.isError) router.replace('/');
    if (user && dashboardForRole(user.role) !== `/dashboard/${params.role}`) router.replace(dashboardForRole(user.role));
  }, [me.isError, user, params.role, router]);

  const refreshLeads = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['leads'] }),
    queryClient.invalidateQueries({ queryKey: ['analytics'] }),
    queryClient.invalidateQueries({ queryKey: ['follow-ups'] }),
  ]);
  const refreshFollowUps = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['follow-ups'] }),
    queryClient.invalidateQueries({ queryKey: ['analytics'] }),
  ]);
  const refreshSources = () => queryClient.invalidateQueries({ queryKey: ['sources'] });
  const logout = useMutation({
    mutationFn: async () => mutate('/auth/logout', 'POST'),
    onSuccess: () => { clearCsrfToken(); queryClient.clear(); router.replace('/'); },
  });
  const deleteFollowUp = useMutation({
    mutationFn: ({ leadId, id }: { leadId: string; id: string }) =>
      mutate(`/leads/${leadId}/follow-ups/${id}`, 'DELETE'),
    onSuccess: refreshFollowUps,
    onError: (error) => setNotice(error.message),
  });
  const updateFollowUp = useMutation({
    mutationFn: ({ leadId, id, data }: { leadId: string; id: string; data: unknown }) =>
      mutate(`/leads/${leadId}/follow-ups/${id}`, 'PATCH', data),
    onSuccess: refreshFollowUps,
    onError: (error) => setNotice(error.message),
  });
  const admin = user?.role === 'ADMIN';
  const manager = user?.role === 'MANAGER';
  if (me.isLoading || !user) return (
    <main className="grid min-h-screen place-items-center p-5">
      <div className="w-full max-w-5xl space-y-5" role="status" aria-label="Loading your workspace">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-24 rounded-2xl" />)}
        </div>
        <Skeleton className="h-56 rounded-2xl" />
        <div className="grid gap-5 xl:grid-cols-[2fr_1fr]">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      </div>
    </main>
  );
  const title = admin ? 'Admin dashboard' : manager ? 'Manager dashboard' : 'Team member dashboard';

  async function onLogout() {
    try {
      await logout.mutateAsync();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not sign out');
    }
  }

  return (
    <main className="page-shell lg:flex">
      <aside className={`sidebar hidden min-h-screen shrink-0 flex-col border-r py-6 transition-[width,padding] duration-300 lg:fixed lg:inset-y-0 lg:flex ${sidebarOpen ? 'w-64 px-4' : 'w-16 px-2'}`}>
        <div className={`flex items-center border-b border-slate-100 pb-5 ${sidebarOpen ? 'justify-between px-2' : 'justify-center'}`}>
          <div className={sidebarOpen ? '' : 'sidebar-brand-collapsed'}><Brand href="#overview" /></div>
          <button className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-gray-800 dark:hover:text-white" type="button" aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'} onClick={() => setSidebarOpen((open) => !open)}>
            <ChevronsRight className={`size-4 transition-transform duration-300 ${sidebarOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
        {sidebarOpen && <p className="mb-3 mt-7 px-3 text-[10px] font-bold uppercase tracking-[.15em] text-slate-400">Workspace</p>}
        <nav className="space-y-1" aria-label="Main navigation">
          <a className={`nav-item nav-item-active ${sidebarOpen ? 'justify-between' : 'justify-center'}`} title={sidebarOpen ? undefined : 'Overview'} href="#overview"><span className="flex items-center gap-3"><LayoutDashboard size={17} />{sidebarOpen && 'Overview'}</span>{sidebarOpen && <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />}</a>
          <a className={`nav-item ${sidebarOpen ? 'justify-between' : 'justify-center'}`} title={sidebarOpen ? undefined : 'Leads'} href={`${dashboardForRole(user.role)}/leads`}><span className="flex items-center gap-3"><ListChecks size={17} />{sidebarOpen && 'Leads'}</span></a>
          <a className={`nav-item ${sidebarOpen ? 'justify-between' : 'justify-center'}`} title={sidebarOpen ? undefined : 'Follow-ups'} href="#follow-ups"><span className="flex items-center gap-3"><CalendarClock size={17} />{sidebarOpen && 'Follow-ups'}</span>{sidebarOpen && <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-mono text-[10px] text-amber-700">{analytics.data?.openFollowUps ?? '—'}</span>}</a>
          {(admin || manager) && <a className={`nav-item ${sidebarOpen ? 'justify-between' : 'justify-center'}`} title={sidebarOpen ? undefined : 'Your team'} href="#team"><span className="flex items-center gap-3"><Users size={17} />{sidebarOpen && 'Your team'}</span></a>}
          {admin && <button className={`nav-item w-full ${sidebarOpen ? '' : 'justify-center'}`} title={sidebarOpen ? undefined : 'Settings'} onClick={() => router.push(`${dashboardForRole(user.role)}/settings`)}><Settings2 size={17} />{sidebarOpen && 'Settings'}</button>}
        </nav>
        <div className="mt-auto border-t border-slate-200 pt-5">
          {sidebarOpen && <div className="mb-3 flex items-center gap-3 rounded-xl bg-slate-50 p-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-xs font-semibold text-white ring-2 ring-blue-100">{user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
            <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-800">{user.name}</span><span className="mt-1 block text-xs text-slate-500">{user.role === 'MEMBER' ? 'Team member' : user.role[0] + user.role.slice(1).toLowerCase()}</span></span>
          </div>}
          <button className={`nav-item w-full ${sidebarOpen ? '' : 'justify-center'}`} title={sidebarOpen ? undefined : 'Sign out'} onClick={onLogout}><LogOut size={17} />{sidebarOpen && 'Sign out'}</button>
          {sidebarOpen && <a className="mt-4 block px-3 text-[11px] font-medium text-slate-400 hover:text-blue-700" href="https://nirvaantech.in" target="_blank" rel="noreferrer">Nirvaan Tech ↗</a>}
        </div>
      </aside>
      <div className={`min-w-0 flex-1 transition-[margin] duration-300 ${sidebarOpen ? 'lg:ml-64' : 'lg:ml-16'}`}>
        <header className="dashboard-header sticky top-0 z-10 border-b border-slate-200/90 bg-white/90 backdrop-blur-md">
          <div className="flex min-h-16 items-center justify-between gap-4 px-4 sm:px-7 lg:px-8">
            <div className="lg:hidden"><Brand compact href="#overview" /></div>
            <div className="hidden items-center gap-2 text-xs font-medium text-slate-500 lg:flex"><span>Workspace</span><span className="text-slate-300">/</span><span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 font-semibold text-blue-700">{title}</span></div>
            <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-4">
              <button type="button" className="quiet grid size-9 shrink-0 place-items-center p-0" aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'} title={isDark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggleTheme}>{isDark ? <Sun size={16} /> : <Moon size={16} />}</button>
              <form className="relative hidden min-w-0 md:block" onSubmit={(event) => { event.preventDefault(); router.push(`${dashboardForRole(user.role)}/leads${leadSearch.trim() ? `?search=${encodeURIComponent(leadSearch.trim())}` : ''}`); }}>
                <span className="sr-only">Search leads</span>
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="field h-9 min-h-9 w-56 py-1.5 pl-9 pr-3 lg:w-64" placeholder="Search leads..." value={leadSearch} onChange={(event) => setLeadSearch(event.target.value)} />
              </form>
              <span className="hidden h-5 w-px bg-slate-200 sm:block" />
              <span className="hidden text-xs font-semibold text-slate-700 sm:block">{user.name}</span>
              <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-[11px] font-bold text-white ring-2 ring-blue-100">{user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
              <button className="quiet flex items-center gap-2 px-2.5 text-xs lg:hidden" onClick={onLogout}><LogOut size={15} />Sign out</button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:hidden" aria-label="Mobile navigation">
            <a className="nav-item nav-item-active min-h-9 shrink-0 whitespace-nowrap px-3 py-2 text-xs" href="#overview"><LayoutDashboard size={15} /> Overview</a>
            <a className="nav-item min-h-9 shrink-0 whitespace-nowrap px-3 py-2 text-xs" href={`${dashboardForRole(user.role)}/leads`}><ListChecks size={15} /> Leads</a>
            <a className="nav-item min-h-9 shrink-0 whitespace-nowrap px-3 py-2 text-xs" href="#follow-ups"><CalendarClock size={15} /> Follow-ups</a>
            {(admin || manager) && <a className="nav-item min-h-9 shrink-0 whitespace-nowrap px-3 py-2 text-xs" href="#team"><Users size={15} /> Team</a>}
            {admin && <button className="nav-item min-h-9 shrink-0 whitespace-nowrap px-3 py-2 text-xs" onClick={() => router.push(`${dashboardForRole(user.role)}/settings`)}><Settings2 size={15} /> Settings</button>}
          </nav>
        </header>
        <div id="overview" className="dashboard-content dashboard-main mx-auto px-4 py-6 sm:px-7 sm:py-8 lg:px-8">
        <div className="mb-7 flex flex-col gap-5 pb-1 lg:flex-row lg:items-end lg:justify-between">
          <div><p className="mb-2 text-[11px] font-semibold uppercase tracking-[.15em] text-blue-600">Your workspace · High velocity</p><h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">A unified view of your pipeline, customer relationships, and next steps.</p></div>
          <div className="dashboard-actions flex flex-wrap gap-2">
            <button className="quiet flex items-center gap-2 text-xs font-semibold" onClick={() => setShowPasswordForm(true)}><KeyRound size={15} /> Change password</button>
            {admin && <button className="quiet flex items-center gap-2 text-xs font-semibold" onClick={() => setShowSourceForm(true)}><Settings2 size={15} /> Lead sources</button>}
            <button className="primary flex items-center gap-2 text-xs font-bold" onClick={() => setShowLeadForm(true)}><Plus size={16} /> New lead</button>
          </div>
        </div>
        {notice && <p role="status" className="mb-5 rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-[#92400e]">{notice}</p>}

        <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Workspace metrics">
          <Metric icon={<Users size={18} />} label="Total leads" value={analytics.data?.totalLeads ?? '—'} loading={analytics.isLoading} />
          <Metric icon={<CalendarClock size={18} />} label="Open follow-ups" value={analytics.data?.openFollowUps ?? '—'} loading={analytics.isLoading} />
          <Metric icon={<BarChart3 size={18} />} label="Won leads" value={analytics.data?.byStatus.find((item) => item.status === 'WON')?._count._all ?? 0} loading={analytics.isLoading} />
          <Metric icon={<ListChecks size={18} />} label="Qualified leads" value={analytics.data?.byStatus.find((item) => item.status === 'QUALIFIED')?._count._all ?? 0} loading={analytics.isLoading} />
        </section>

        <section className="panel mb-5 p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4"><div><h2 className="font-bold tracking-wide text-slate-900">Lead pipeline</h2><p className="mt-1 text-xs text-slate-500">Stage distribution across your authorized leads.</p></div><span className="status-chip border border-blue-200 bg-blue-50 font-mono uppercase text-blue-700">Realtime</span></div>
          {analytics.isError ? <p role="alert" className="mt-4 text-sm text-red-700">Could not load pipeline analytics.</p> : analytics.data ? <PipelineChart data={analytics.data.byStatus} /> : <div className="mt-4 h-56 animate-pulse rounded-lg bg-gray-50" aria-label="Loading chart" />}
        </section>

        <section id="follow-ups" className="panel scroll-mt-24">
            <div className="border-b border-[#e5e7eb] px-5 py-4"><h2 className="font-semibold text-[#111827]">Today’s pending follow-ups</h2><p className="mt-1 text-xs text-[#6b7280]">Follow-ups due today</p></div>
            <div className="divide-y divide-[#edf0ed]">
              {followUps.isLoading ? <div className="space-y-5 p-5" role="status" aria-label="Loading follow-ups">{Array.from({ length: 3 }, (_, index) => <div key={index} className="space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-1/3" /></div>)}</div> : followUps.isError ? <p role="alert" className="p-5 text-sm text-red-700">Could not load follow-ups.</p> : todayFollowUps.length ? todayFollowUps.map((item) => <div key={item.id} className="px-5 py-4"><p className="text-sm font-medium text-[#111827]">{item.lead.name}</p><p className="mt-1 text-xs text-[#6b7280]">{item.description}</p><p className="mt-2 text-xs font-medium text-blue-700">{new Date(item.dueAt).toLocaleString()}</p><div className="mt-3 flex gap-2">{item.destination && <a className="primary rounded-md px-2 py-1 text-xs" href={item.destination} target="_blank" rel="noreferrer">Go to follow-up</a>}<button className="quiet px-2 py-1 text-xs" onClick={() => updateFollowUp.mutate({ leadId: item.leadId, id: item.id, data: { completed: true } })}>Mark complete</button><button className="quiet px-2 py-1 text-xs text-red-700" onClick={() => deleteFollowUp.mutate({ leadId: item.leadId, id: item.id })}>Delete</button></div></div>) : <p className="p-5 text-sm text-[#6b7280]">No pending follow-ups due today.</p>}
            </div>
        </section>

        {manager && <section id="team" className="panel mt-5 scroll-mt-24">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e7eb] px-5 py-4 sm:px-6"><div><div className="flex items-center gap-2"><Users size={17} className="text-blue-600" /><h2 className="font-semibold text-[#111827]">Your team</h2></div><p className="mt-1 text-xs text-[#6b7280]">Team member access is read-only.</p></div><span className="status-chip bg-blue-50 text-blue-700">{totalUsers} accounts</span></div>
          <div className="border-b border-[#e5e7eb] px-5 py-3 sm:px-6"><label className="relative block"><span className="sr-only">Search users</span><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" /><input className="field pl-9" placeholder="Search users…" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} /></label></div>
          {users.isLoading ? <p className="p-5 text-sm text-[#6b7280]">Loading users…</p> : users.isError ? <p role="alert" className="p-5 text-sm text-red-700">Could not load users.</p> : userItems.length ? <div className="divide-y divide-slate-100">{userItems.map((item) => <div key={item.id} className="team-row flex flex-col items-start justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center"><div className="flex items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-xs font-bold text-white">{item.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><div><p className="text-sm font-semibold text-slate-900">{item.name}{!item.active && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Disabled</span>}</p><p className="mt-0.5 text-xs text-slate-500">{item.email}</p></div></div><span className="status-chip bg-blue-50 text-blue-700">{item.role === 'MEMBER' ? 'Team member' : item.role[0] + item.role.slice(1).toLowerCase()}</span></div>)}</div> : <p className="p-5 text-sm text-[#6b7280]">No users found.</p>}
          {users.data && <div className="flex items-center justify-between border-t border-[#e5e7eb] px-5 py-3.5 text-xs text-[#6b7280]"><span>Page {userPage} · {userItems.length} shown</span><div className="flex gap-2"><button className="quiet px-3 py-1.5" disabled={userPage <= 1 || users.isFetching} onClick={() => setUserPage((page) => page - 1)}>Previous</button><button className="quiet px-3 py-1.5" disabled={userPage * 50 >= totalUsers || users.isFetching} onClick={() => setUserPage((page) => page + 1)}>Next</button></div></div>}
        </section>}
        </div>
      </div>
      {showLeadForm && <LeadFormModal currentUser={user} users={managerOptions.data ?? userItems} sources={sources.data ?? []} onClose={() => setShowLeadForm(false)} onDone={() => { setShowLeadForm(false); setNotice('Lead created successfully.'); void refreshLeads(); }} onError={setNotice} />}
      {showPasswordForm && <Modal title="Change password" onClose={() => setShowPasswordForm(false)}><PasswordForm onDone={() => { clearCsrfToken(); setShowPasswordForm(false); router.replace('/'); }} onError={setNotice} /></Modal>}
      {showSourceForm && <Modal title="Manage lead sources" onClose={() => setShowSourceForm(false)}><SourceForm sources={sources.data ?? []} onDone={() => { setShowSourceForm(false); void refreshSources(); }} onError={setNotice} /></Modal>}
    </main>
  );
}

function Metric({ icon, label, value, loading = false }: { icon: React.ReactNode; label: string; value: React.ReactNode; loading?: boolean }) {
  return <div className="panel metric-card flex items-center gap-4 p-4 sm:p-5"><div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-blue-600">{icon}</div><div><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>{loading ? <Skeleton className="mt-2 h-7 w-16" /> : <p className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">{value}</p>}</div></div>;
}

function Skeleton({ className }: { className: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-slate-200 ${className}`} />;
}

function Modal({ title, onClose, children, preventClose = false }: { title: string; onClose: () => void; children: React.ReactNode; preventClose?: boolean }) {
  return <Dialog.Root open onOpenChange={(open) => { if (!open && !preventClose) onClose(); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-20 bg-[#101114]/45 backdrop-blur-[2px]" /><Dialog.Content className="panel fixed left-1/2 top-1/2 z-20 max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-6 shadow-xl"><div className="mb-5 flex items-center justify-between"><Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title><Dialog.Close asChild><button type="button" className="quiet" disabled={preventClose}>Close</button></Dialog.Close></div>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function LeadFormModal({ currentUser, users, sources, onClose, onDone, onError }: { currentUser: User; users: User[]; sources: { id: string; name: string }[]; onClose: () => void; onDone: () => void; onError: (message: string) => void }) {
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      await mutate('/leads', 'POST', {
        name: form.get('name'), email: form.get('email') || undefined, company: form.get('company') || undefined,
        phone: form.get('phone') || undefined, other: form.get('other') || undefined, sourceId: form.get('sourceId') || undefined,
        assigneeId: form.get('assigneeId') || currentUser.id,
      });
      onDone();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not create lead');
      submittingRef.current = false;
      setSubmitting(false);
    }
  }
  const assignees = currentUser.role === 'ADMIN' ? users.filter((item) => item.active && item.role !== 'ADMIN') : currentUser.role === 'MANAGER' ? users.filter((item) => item.active && (item.id === currentUser.id || item.managerId === currentUser.id)) : [];
  return <Modal title="Create a lead" onClose={onClose} preventClose={submitting}>
    <form className="space-y-4" onSubmit={submit} aria-busy={submitting}>
      <Field name="name" label="Lead name" required /><Field name="email" label="Email" type="email" /><Field name="company" label="Company" /><Field name="phone" label="Phone" /><Field name="other" label="Other" />
      {sources.length > 0 && <div><label className="label" htmlFor="sourceId">Source</label><select className="field" name="sourceId" id="sourceId"><option value="">Select a source</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select></div>}
      {currentUser.role !== 'MEMBER' && <div><label className="label" htmlFor="assigneeId">Assign to</label><select className="field" name="assigneeId" id="assigneeId" defaultValue={currentUser.role === 'MANAGER' ? currentUser.id : assignees[0]?.id ?? ''} required><option value="" disabled>Select an assignee</option>{assignees.map((item) => <option key={item.id} value={item.id}>{item.id === currentUser.id ? `${item.name} (you)` : item.name}</option>)}</select>{assignees.length === 0 && <p className="mt-1 text-xs text-amber-800">Create an eligible user before adding a lead.</p>}</div>}
      <button className="primary w-full" disabled={submitting || (currentUser.role !== 'MEMBER' && assignees.length === 0)}>{submitting ? 'Creating lead…' : 'Create lead'}</button>
      {submitting && <p className="text-center text-xs text-slate-500" role="status">Saving your lead. Please wait…</p>}
    </form>
  </Modal>;
}

function PasswordForm({ onDone, onError }: { onDone: () => void; onError: (message: string) => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await mutate('/auth/password', 'POST', { currentPassword: form.get('currentPassword'), newPassword: form.get('newPassword') });
      onDone();
    } catch (error) { onError(error instanceof Error ? error.message : 'Could not change password'); }
  }
  return <form className="space-y-4" onSubmit={submit}><Field name="currentPassword" label="Current password" type="password" required /><Field name="newPassword" label="New password (12+ characters, upper/lowercase, number and symbol)" type="password" required /><button className="primary w-full">Update password</button></form>;
}

function SourceForm({ sources, onDone, onError }: { sources: { id: string; name: string }[]; onDone: () => void; onError: (message: string) => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get('name');
    try { await mutate('/sources', 'POST', { name }); onDone(); }
    catch (error) { onError(error instanceof Error ? error.message : 'Could not add source'); }
  }
  async function update(id: string, name: string) {
    try { await mutate(`/sources/${id}`, 'PATCH', { name }); onDone(); }
    catch (error) { onError(error instanceof Error ? error.message : 'Could not update source'); }
  }
  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete lead source "${name}"? Leads using it will keep their records without a source.`)) return;
    try { await mutate(`/sources/${id}`, 'DELETE'); onDone(); }
    catch (error) { onError(error instanceof Error ? error.message : 'Could not delete source'); }
  }
  return <div className="space-y-5">
    <form className="space-y-3" onSubmit={submit}><Field name="name" label="New source" required /><button className="primary w-full">Add source</button></form>
    <div className="max-h-64 space-y-2 overflow-y-auto">{sources.map((source) => <form key={source.id} className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); update(source.id, String(new FormData(event.currentTarget).get('name'))); }}><input className="field" aria-label={`Source name ${source.name}`} name="name" defaultValue={source.name} required /><button className="quiet text-xs">Save</button><button type="button" className="quiet text-xs text-red-700" onClick={() => remove(source.id, source.name)}>Delete</button></form>)}</div>
  </div>;
}

function Field({ name, label, type = 'text', required = false }: { name: string; label: string; type?: string; required?: boolean }) {
  return <div><label className="label" htmlFor={name}>{label}</label><input className="field" id={name} name={name} type={type} required={required} /></div>;
}
