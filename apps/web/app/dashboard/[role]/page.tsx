'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import * as Dialog from '@radix-ui/react-dialog';
import dynamic from 'next/dynamic';
import { BarChart3, CalendarClock, ChevronsRight, CircleUserRound, KeyRound, LayoutDashboard, ListChecks, LogOut, Moon, Plus, Search, Settings2, Sun, Users } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Brand } from '@/components/brand';
import { api, apiWithMetadata, ApiPerformanceMetric, clearCsrfToken, dashboardForRole, mutate } from '@/lib/api';
import { useTheme } from '@/app/providers';

type User = { id: string; name: string; email: string; role: 'ADMIN' | 'MANAGER' | 'MEMBER'; active: boolean; managerId?: string | null };
type Lead = {
  id: string; name: string; email?: string | null; company?: string | null;
  status: string; updatedAt: string; assignee: { id: string; name: string }; assigneeId: string;
};
type LeadPage = { items: Lead[]; total: number; page: number; pageSize: number; totalPages: number };
type Analytics = { totalLeads: number; byStatus: { status: string; _count: { _all: number } }[]; openFollowUps: number };
type FollowUp = { id: string; leadId: string; description: string; dueAt: string; completed: boolean; lead: { id: string; name: string } };
const statuses = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST'];
const PipelineChart = dynamic(
  () => import('@/components/pipeline-chart').then((module) => module.PipelineChart),
  { ssr: false, loading: () => <div className="mt-4 h-56 animate-pulse rounded-lg bg-gray-50" aria-label="Loading chart" /> },
);

export default function DashboardPage() {
  const router = useRouter();
  const params = useParams<{ role: string }>();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [leadPage, setLeadPage] = useState(1);
  const [leadSearch, setLeadSearch] = useState('');
  const [leadStatus, setLeadStatus] = useState('');
  const [deferredSearch, setDeferredSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [deferredUserSearch, setDeferredUserSearch] = useState('');
  const [userPage, setUserPage] = useState(1);
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [showUserForm, setShowUserForm] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [showSourceForm, setShowSourceForm] = useState(false);
  const [showSettingsForm, setShowSettingsForm] = useState(false);
  const [actionLead, setActionLead] = useState<{ id: string; name: string; action: 'note' | 'follow-up' } | null>(null);
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [apiMetrics, setApiMetrics] = useState<ApiPerformanceMetric[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { isDark, toggleTheme } = useTheme();

  useEffect(() => {
    const timeout = window.setTimeout(() => setDeferredSearch(leadSearch.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [leadSearch]);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDeferredUserSearch(userSearch.trim());
      setUserPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [userSearch]);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const onApiPerformance = (event: Event) => {
      const metric = (event as CustomEvent<ApiPerformanceMetric>).detail;
      setApiMetrics((metrics) => [...metrics.slice(-7), metric]);
    };
    window.addEventListener('api:performance', onApiPerformance);
    return () => window.removeEventListener('api:performance', onApiPerformance);
  }, []);

  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: User }>('/auth/me'),
    retry: false,
  });
  const user = me.data?.user;
  const sortBy = sorting[0]?.id === 'name' || sorting[0]?.id === 'status' ? sorting[0].id : 'updatedAt';
  const sortOrder = sorting[0]?.desc ? 'desc' : sorting.length ? 'asc' : 'desc';
  const leadParams = new URLSearchParams({
    page: String(leadPage),
    sort: sortBy,
    order: sortOrder,
    ...(deferredSearch ? { search: deferredSearch } : {}),
    ...(leadStatus ? { status: leadStatus } : {}),
  });
  const leads = useQuery({
    queryKey: ['leads', leadPage, deferredSearch, leadStatus, sortBy, sortOrder],
    queryFn: () => api<LeadPage>(`/leads?${leadParams.toString()}`),
    enabled: !!user,
    placeholderData: keepPreviousData,
  });
  const analytics = useQuery({ queryKey: ['analytics'], queryFn: () => api<Analytics>('/analytics'), enabled: !!user });
  const followUps = useQuery({
    queryKey: ['follow-ups', includeCompleted],
    queryFn: () => api<FollowUp[]>(`/follow-ups?take=10&completed=${includeCompleted ? 'all' : 'false'}`),
    enabled: !!user,
  });
  const users = useQuery({
    queryKey: ['users', user?.id, user?.role, userPage, deferredUserSearch],
    queryFn: () => apiWithMetadata<User[]>(`/users?page=${userPage}&search=${encodeURIComponent(deferredUserSearch)}`),
    enabled: user?.role === 'ADMIN' || user?.role === 'MANAGER',
    placeholderData: keepPreviousData,
  });
  const totalUsers = Number(users.data?.headers.get('x-total-count') ?? users.data?.data.length ?? 0);
  const userItems = useMemo(() => users.data?.data ?? [], [users.data]);
  const managerOptions = useQuery({
    queryKey: ['users', user?.id, user?.role, 'managers'],
    queryFn: () => api<User[]>('/users?active=true'),
    enabled: (user?.role === 'ADMIN' || user?.role === 'MANAGER') && (showLeadForm || showUserForm),
    staleTime: 30_000,
  });
  const sources = useQuery({
    queryKey: ['sources'],
    queryFn: () => api<{ id: string; name: string }[]>('/sources'),
    enabled: !!user && showLeadForm,
  });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<{ key: string; value: string }[]>('/settings'),
    enabled: user?.role === 'ADMIN' && showSettingsForm,
  });

  useEffect(() => {
    if (me.isError) router.replace('/');
    if (user && dashboardForRole(user.role) !== `/dashboard/${params.role}`) router.replace(dashboardForRole(user.role));
  }, [me.isError, user, params.role, router]);

  useEffect(() => {
    if (leads.data && (leads.data.totalPages === 0 ? leadPage !== 1 : leadPage > leads.data.totalPages)) {
      setLeadPage(Math.max(1, leads.data.totalPages));
    }
  }, [leadPage, leads.data]);

  const refreshLeads = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['leads'] }),
    queryClient.invalidateQueries({ queryKey: ['analytics'] }),
    queryClient.invalidateQueries({ queryKey: ['follow-ups'] }),
  ]);
  const refreshUsers = () => Promise.all([
    refreshLeads(),
    queryClient.invalidateQueries({ queryKey: ['users'] }),
  ]);
  const refreshFollowUps = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['follow-ups'] }),
    queryClient.invalidateQueries({ queryKey: ['analytics'] }),
  ]);
  const refreshSources = () => queryClient.invalidateQueries({ queryKey: ['sources'] });
  const refreshSettings = () => queryClient.invalidateQueries({ queryKey: ['settings'] });
  const logout = useMutation({
    mutationFn: async () => mutate('/auth/logout', 'POST'),
    onSuccess: () => { clearCsrfToken(); queryClient.clear(); router.replace('/'); },
  });
  const updateLead = useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) => mutate(`/leads/${id}`, 'PATCH', data),
    onSuccess: refreshLeads,
    onError: (error) => setNotice(error.message),
  });
  const deleteFollowUp = useMutation({
    mutationFn: ({ leadId, id }: { leadId: string; id: string }) =>
      mutate(`/leads/${leadId}/follow-ups/${id}`, 'DELETE'),
    onSuccess: refreshFollowUps,
    onError: (error) => setNotice(error.message),
  });
  const deleteLead = useMutation({
    mutationFn: (id: string) => mutate(`/leads/${id}`, 'DELETE'),
    onSuccess: refreshLeads,
    onError: (error) => setNotice(error.message),
  });
  const updateUser = useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) => mutate(`/users/${id}`, 'PATCH', data),
    onSuccess: refreshUsers,
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
  const updateLeadMutation = updateLead.mutate;
  const deleteLeadMutation = deleteLead.mutate;
  const columns = useMemo<ColumnDef<Lead>[]>(() => [
    {
      accessorKey: 'name',
      header: ({ column }) => <button onClick={column.getToggleSortingHandler()}>Lead {column.getIsSorted() === 'asc' ? '↑' : column.getIsSorted() === 'desc' ? '↓' : ''}</button>,
      cell: ({ row }) => <><p className="font-medium text-[#111827]">{row.original.name}</p><p className="mt-1 text-xs text-[#6b7280]">{row.original.company ?? row.original.email ?? 'No company details'}</p></>,
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <button onClick={column.getToggleSortingHandler()}>Status {column.getIsSorted() === 'asc' ? '↑' : column.getIsSorted() === 'desc' ? '↓' : ''}</button>,
      cell: ({ row }) => <select aria-label={`Status for ${row.original.name}`} className="field min-w-32 py-2 text-xs" value={row.original.status} onChange={(event) => updateLeadMutation({ id: row.original.id, data: { status: event.target.value } })}>{statuses.map((status) => <option key={status} value={status}>{status.replace('_', ' ')}</option>)}</select>,
    },
    {
      id: 'assignee',
      accessorFn: (lead) => lead.assignee?.name ?? 'Unassigned',
      header: 'Owner',
      cell: ({ row, getValue }) => (admin || manager)
        ? <select aria-label={`Assignee for ${row.original.name}`} className="field min-w-32 py-2 text-xs" value={row.original.assigneeId} onChange={(event) => updateLeadMutation({ id: row.original.id, data: { assigneeId: event.target.value } })}>{(managerOptions.data ?? userItems).filter((item) => item.active && item.role !== 'ADMIN' && (admin || item.id === user?.id || item.managerId === user?.id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        : getValue(),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => <div className="flex flex-wrap gap-1"><button className="quiet px-2 py-1 text-xs" onClick={() => setActionLead({ id: row.original.id, name: row.original.name, action: 'note' })}>Note</button><button className="quiet px-2 py-1 text-xs" onClick={() => setActionLead({ id: row.original.id, name: row.original.name, action: 'follow-up' })}>Follow-up</button>{admin && <button className="quiet px-2 py-1 text-xs text-red-700" onClick={() => { if (window.confirm(`Delete ${row.original.name}?`)) deleteLeadMutation(row.original.id); }}>Delete</button>}</div>,
    },
  ], [admin, manager, user?.id, managerOptions.data, userItems, updateLeadMutation, deleteLeadMutation]);
  // TanStack Table's instance is intentionally mutable and cannot be React-Compiler memoized.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: leads.data?.items ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
  });

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
          <a className={`nav-item ${sidebarOpen ? 'justify-between' : 'justify-center'}`} title={sidebarOpen ? undefined : 'Leads'} href="#leads"><span className="flex items-center gap-3"><ListChecks size={17} />{sidebarOpen && 'Leads'}</span>{sidebarOpen && <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-600">{leads.data?.total ?? '—'}</span>}</a>
          <a className={`nav-item ${sidebarOpen ? 'justify-between' : 'justify-center'}`} title={sidebarOpen ? undefined : 'Follow-ups'} href="#follow-ups"><span className="flex items-center gap-3"><CalendarClock size={17} />{sidebarOpen && 'Follow-ups'}</span>{sidebarOpen && <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-mono text-[10px] text-amber-700">{analytics.data?.openFollowUps ?? '—'}</span>}</a>
          {(admin || manager) && <a className={`nav-item ${sidebarOpen ? 'justify-between' : 'justify-center'}`} title={sidebarOpen ? undefined : admin ? 'User management' : 'Your team'} href="#team"><span className="flex items-center gap-3"><Users size={17} />{sidebarOpen && (admin ? 'User management' : 'Your team')}</span>{sidebarOpen && admin && <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-600">{users.data ? totalUsers : '—'}</span>}</a>}
          {admin && <button className={`nav-item w-full ${sidebarOpen ? '' : 'justify-center'}`} title={sidebarOpen ? undefined : 'Settings'} onClick={() => setShowSettingsForm(true)}><Settings2 size={17} />{sidebarOpen && 'Settings'}</button>}
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
              <label className="relative hidden min-w-0 md:block">
                <span className="sr-only">Search leads</span>
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="field h-9 min-h-9 w-56 py-1.5 pl-9 pr-3 lg:w-64" placeholder="Search leads..." value={leadSearch} onChange={(event) => { setLeadSearch(event.target.value); setLeadPage(1); }} />
              </label>
              <span className="hidden h-5 w-px bg-slate-200 sm:block" />
              <span className="hidden text-xs font-semibold text-slate-700 sm:block">{user.name}</span>
              <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-[11px] font-bold text-white ring-2 ring-blue-100">{user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
              <button className="quiet flex items-center gap-2 px-2.5 text-xs lg:hidden" onClick={onLogout}><LogOut size={15} />Sign out</button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:hidden" aria-label="Mobile navigation">
            <a className="nav-item nav-item-active min-h-9 shrink-0 whitespace-nowrap px-3 py-2 text-xs" href="#overview"><LayoutDashboard size={15} /> Overview</a>
            <a className="nav-item min-h-9 shrink-0 whitespace-nowrap px-3 py-2 text-xs" href="#leads"><ListChecks size={15} /> Leads</a>
            <a className="nav-item min-h-9 shrink-0 whitespace-nowrap px-3 py-2 text-xs" href="#follow-ups"><CalendarClock size={15} /> Follow-ups</a>
            {(admin || manager) && <a className="nav-item min-h-9 shrink-0 whitespace-nowrap px-3 py-2 text-xs" href="#team"><Users size={15} /> Team</a>}
            {admin && <button className="nav-item min-h-9 shrink-0 whitespace-nowrap px-3 py-2 text-xs" onClick={() => setShowSettingsForm(true)}><Settings2 size={15} /> Settings</button>}
          </nav>
        </header>
        <div id="overview" className="dashboard-content dashboard-main mx-auto px-4 py-6 sm:px-7 sm:py-8 lg:px-8">
        <div className="mb-7 flex flex-col gap-5 pb-1 lg:flex-row lg:items-end lg:justify-between">
          <div><p className="mb-2 text-[11px] font-semibold uppercase tracking-[.15em] text-blue-600">Your workspace · High velocity</p><h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">A unified view of your pipeline, customer relationships, and next steps.</p></div>
          <div className="dashboard-actions flex flex-wrap gap-2">
            <button className="quiet flex items-center gap-2 text-xs font-semibold" onClick={() => setShowPasswordForm(true)}><KeyRound size={15} /> Change password</button>
            {admin && <button className="quiet flex items-center gap-2 text-xs font-semibold" onClick={() => setShowUserForm(true)}><Users size={15} className="text-blue-600" /> Add user</button>}
            <button className="primary flex items-center gap-2 text-xs font-bold" onClick={() => setShowLeadForm(true)}><Plus size={16} /> New lead</button>
          </div>
        </div>
        {notice && <p role="status" className="mb-5 rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-[#92400e]">{notice}</p>}

        {/* {process.env.NODE_ENV === 'development' && <section className="panel mb-5 p-4" aria-label="Frontend API performance">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">API response timings · development</h2>
            <span className="font-mono text-xs text-slate-500">{apiMetrics.length} recent request{apiMetrics.length === 1 ? '' : 's'}</span>
          </div>
          {apiMetrics.length ? <ul className="mt-3 flex flex-wrap gap-2">
            {[...apiMetrics].reverse().map((metric, index) => (
              <li key={`${metric.path}-${index}`} className="rounded-lg bg-slate-50 px-2.5 py-1.5 font-mono text-[11px] text-slate-600">
                {metric.method} {metric.path} · {metric.durationMs} ms
                {metric.controllerDurationMs === undefined ? '' : ` · handler ${metric.controllerDurationMs} ms`}
                {' · '}{metric.status || 'network error'}
              </li>
            ))}
          </ul> : <p className="mt-2 text-xs text-slate-500">Waiting for API requests…</p>}
        </section>} */}

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

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(300px,.9fr)]">
          <section id="leads" className="panel min-w-0 overflow-hidden scroll-mt-24">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e5e7eb] px-5 py-4 sm:px-6"><div><h2 className="font-semibold text-[#111827]">Leads</h2><p className="mt-1 text-xs text-[#6b7280]">Manage customer relationships and ownership.</p></div><span className="text-xs text-[#6b7280]">{leads.data?.total ?? 0} total</span></div>
            <div className="flex flex-col gap-3 border-b border-[#e5e7eb] px-5 py-4 sm:flex-row sm:items-center sm:px-6">
              <label className="relative min-w-0 flex-1"><span className="sr-only">Search leads</span><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" /><input className="field pl-9" placeholder="Search leads…" value={leadSearch} onChange={(event) => { setLeadSearch(event.target.value); setLeadPage(1); }} /></label>
              <label><span className="sr-only">Filter by status</span><select className="field min-w-40" value={leadStatus} onChange={(event) => { setLeadStatus(event.target.value); setLeadPage(1); }}><option value="">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{status.replace('_', ' ')}</option>)}</select></label>
            </div>
            {leads.isLoading ? <div className="space-y-4 p-6" role="status" aria-label="Loading leads">{Array.from({ length: 5 }, (_, index) => <div key={index} className="flex items-center gap-4"><Skeleton className="h-10 w-10 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-1/2" /></div><Skeleton className="h-8 w-24" /></div>)}</div> : leads.isError ? <p role="alert" className="p-6 text-sm text-red-700">Could not load leads. Please try again.</p> : leads.data?.items.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="table-head">{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <th key={header.id} className="px-5 py-3.5 font-semibold">{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr>)}</thead>
                  <tbody>{table.getRowModel().rows.map((row) => <tr key={row.id} className="table-row border-t border-[#f0f1f3]">{row.getVisibleCells().map((cell) => <td key={cell.id} className="px-5 py-4">{cell.column.id === 'status' ? <StatusBadge status={row.original.status} onChange={(status) => updateLead.mutate({ id: row.original.id, data: { status } })} /> : flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody>
                </table>
              </div>
            ) : <div className="p-10 text-center"><CircleUserRound className="mx-auto text-[#9ca3af]" size={28} /><p className="mt-3 text-sm font-medium text-[#111827]">{leadSearch || leadStatus ? 'No matching leads' : 'No leads yet'}</p><p className="mt-1 text-xs text-[#6b7280]">{leadSearch || leadStatus ? 'Try adjusting your search or filters.' : 'Create your first lead to get started.'}</p>{!leadSearch && !leadStatus && <button className="primary mt-4" onClick={() => setShowLeadForm(true)}>Create a lead</button>}</div>}
            {leads.data && leads.data.totalPages > 0 && <div className="flex items-center justify-between border-t border-[#e5e7eb] px-5 py-3.5 text-xs text-[#6b7280]"><span>Page {leads.data.page} of {leads.data.totalPages}</span><div className="flex gap-2"><button className="quiet px-3 py-1.5" disabled={leadPage <= 1 || leads.isFetching} onClick={() => setLeadPage((page) => page - 1)}>Previous</button><button className="quiet px-3 py-1.5" disabled={leadPage >= leads.data.totalPages || leads.isFetching} onClick={() => setLeadPage((page) => page + 1)}>Next</button></div></div>}
          </section>
          <section id="follow-ups" className="panel scroll-mt-24">
            <div className="flex items-start justify-between gap-3 border-b border-[#e5e7eb] px-5 py-4"><div><h2 className="font-semibold text-[#111827]">Follow-ups</h2><p className="mt-1 text-xs text-[#6b7280]">Your team’s next steps</p></div><button className="quiet px-2 py-1 text-xs" onClick={() => setIncludeCompleted((value) => !value)}>{includeCompleted ? 'Open only' : 'Show completed'}</button></div>
            <div className="divide-y divide-[#edf0ed]">
              {followUps.isLoading ? <div className="space-y-5 p-5" role="status" aria-label="Loading follow-ups">{Array.from({ length: 3 }, (_, index) => <div key={index} className="space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-1/3" /></div>)}</div> : followUps.isError ? <p role="alert" className="p-5 text-sm text-red-700">Could not load follow-ups.</p> : followUps.data?.length ? followUps.data.map((item) => <div key={item.id} className="px-5 py-4"><p className="text-sm font-medium text-[#111827]">{item.lead.name}{item.completed && <span className="status-chip ml-2 bg-gray-100 text-gray-600">Completed</span>}</p><p className="mt-1 text-xs text-[#6b7280]">{item.description}</p><p className="mt-2 text-xs font-medium text-blue-700">{new Date(item.dueAt).toLocaleString()}</p><div className="mt-3 flex gap-2">{!item.completed && <button className="quiet px-2 py-1 text-xs" onClick={() => updateFollowUp.mutate({ leadId: item.leadId, id: item.id, data: { completed: true } })}>Mark complete</button>}<button className="quiet px-2 py-1 text-xs text-red-700" onClick={() => deleteFollowUp.mutate({ leadId: item.leadId, id: item.id })}>Delete</button></div></div>) : <p className="p-5 text-sm text-[#6b7280]">No follow-ups scheduled.</p>}
            </div>
          </section>
        </div>

        {(admin || manager) && <section id="team" className="panel mt-5 scroll-mt-24">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e7eb] px-5 py-4 sm:px-6"><div><div className="flex items-center gap-2"><Users size={17} className="text-blue-600" /><h2 className="font-semibold text-[#111827]">{admin ? 'User management' : 'Your team'}</h2></div><p className="mt-1 text-xs text-[#6b7280]">{admin ? 'Manage access, roles, and team assignments.' : 'Team member access is read-only.'}</p></div><span className="status-chip bg-blue-50 text-blue-700">{totalUsers} accounts</span></div>
          <div className="border-b border-[#e5e7eb] px-5 py-3 sm:px-6"><label className="relative block"><span className="sr-only">Search users</span><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" /><input className="field pl-9" placeholder="Search users…" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} /></label></div>
          {users.isLoading ? <p className="p-5 text-sm text-[#6b7280]">Loading users…</p> : users.isError ? <p role="alert" className="p-5 text-sm text-red-700">Could not load users.</p> : userItems.length ? <div className="divide-y divide-slate-100">{userItems.map((item) => <div key={item.id} className="team-row flex flex-col items-start justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center"><div className="flex items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-xs font-bold text-white">{item.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><div><p className="text-sm font-semibold text-slate-900">{item.name}{!item.active && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Disabled</span>}</p><p className="mt-0.5 text-xs text-slate-500">{item.email}</p></div></div>{admin && item.id !== user.id ? <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto"><select className="field w-auto min-w-32 py-2 text-xs" aria-label={`Role for ${item.name}`} value={item.role} onChange={(event) => updateUser.mutate({ id: item.id, data: { role: event.target.value } })}><option value="MANAGER">Manager</option><option value="MEMBER">Team member</option><option value="ADMIN">Admin</option></select>{item.role === 'MEMBER' && <select className="field w-auto min-w-32 py-2 text-xs" aria-label={`Manager for ${item.name}`} value={item.managerId ?? ''} onChange={(event) => updateUser.mutate({ id: item.id, data: { managerId: event.target.value || null } })}><option value="">No manager</option>{(managerOptions.data ?? userItems).filter((candidate) => candidate.role === 'MANAGER' && candidate.active).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select>}<button className="quiet px-2 py-1 text-xs" onClick={() => setResetUser(item)}>Reset password</button><button className="quiet px-2 py-1 text-xs" onClick={() => updateUser.mutate({ id: item.id, data: { active: !item.active } })}>{item.active ? 'Disable' : 'Enable'}</button></div> : <span className="status-chip bg-blue-50 text-blue-700">{item.role === 'MEMBER' ? 'Team member' : item.role[0] + item.role.slice(1).toLowerCase()}</span>}</div>)}</div> : <p className="p-5 text-sm text-[#6b7280]">No users found.</p>}
          {users.data && <div className="flex items-center justify-between border-t border-[#e5e7eb] px-5 py-3.5 text-xs text-[#6b7280]"><span>Page {userPage} · {userItems.length} shown</span><div className="flex gap-2"><button className="quiet px-3 py-1.5" disabled={userPage <= 1 || users.isFetching} onClick={() => setUserPage((page) => page - 1)}>Previous</button><button className="quiet px-3 py-1.5" disabled={userPage * 50 >= totalUsers || users.isFetching} onClick={() => setUserPage((page) => page + 1)}>Next</button></div></div>}
          {admin && <div className="flex flex-wrap gap-2 border-t border-[#e5e7eb] px-5 py-4"><button className="quiet text-sm" onClick={() => setShowSourceForm(true)}>Manage lead sources</button><button className="quiet text-sm" onClick={() => setShowSettingsForm(true)}>Manage settings</button></div>}
        </section>}
        </div>
      </div>
      {showLeadForm && <Modal title="Create a lead" onClose={() => setShowLeadForm(false)}><LeadForm currentUser={user} users={managerOptions.data ?? userItems} sources={sources.data ?? []} onDone={() => { setShowLeadForm(false); setLeadPage(1); void refreshLeads(); }} onError={setNotice} /></Modal>}
      {showUserForm && <Modal title="Create a team account" onClose={() => setShowUserForm(false)}><UserForm users={managerOptions.data ?? userItems} onDone={() => { setShowUserForm(false); void refreshUsers(); }} onError={setNotice} /></Modal>}
      {showPasswordForm && <Modal title="Change password" onClose={() => setShowPasswordForm(false)}><PasswordForm onDone={() => { clearCsrfToken(); setShowPasswordForm(false); router.replace('/'); }} onError={setNotice} /></Modal>}
      {showSourceForm && <Modal title="Manage lead sources" onClose={() => setShowSourceForm(false)}><SourceForm sources={sources.data ?? []} onDone={() => { setShowSourceForm(false); void refreshSources(); }} onError={setNotice} /></Modal>}
      {showSettingsForm && <Modal title="Manage portal settings" onClose={() => setShowSettingsForm(false)}><SettingsForm settings={settings.data ?? []} onDone={() => { setShowSettingsForm(false); void refreshSettings(); }} onError={setNotice} /></Modal>}
      {actionLead && <Modal title={`${actionLead.action === 'note' ? 'Add note to' : 'Schedule follow-up for'} ${actionLead.name}`} onClose={() => setActionLead(null)}><LeadActionForm lead={actionLead} onDone={() => { const shouldRefresh = actionLead.action === 'follow-up'; setActionLead(null); if (shouldRefresh) void refreshFollowUps(); }} onError={setNotice} /></Modal>}
      {resetUser && <Modal title={`Reset password for ${resetUser.name}`} onClose={() => setResetUser(null)}><ResetPasswordForm user={resetUser} onDone={() => { setResetUser(null); }} onError={setNotice} /></Modal>}
    </main>
  );
}

function Metric({ icon, label, value, loading = false }: { icon: React.ReactNode; label: string; value: React.ReactNode; loading?: boolean }) {
  return <div className="panel metric-card flex items-center gap-4 p-4 sm:p-5"><div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-blue-600">{icon}</div><div><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>{loading ? <Skeleton className="mt-2 h-7 w-16" /> : <p className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">{value}</p>}</div></div>;
}

function Skeleton({ className }: { className: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-slate-200 ${className}`} />;
}

function StatusBadge({ status, onChange }: { status: string; onChange: (status: string) => void }) {
  const tone = status === 'WON' ? 'bg-green-50 text-green-700' : status === 'LOST' ? 'bg-red-50 text-red-700' : status === 'PROPOSAL' ? 'bg-violet-50 text-violet-700' : status === 'QUALIFIED' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-700';
  return <select className={`status-chip cursor-pointer border-0 ${tone}`} aria-label={`Lead status: ${status.replace('_', ' ')}`} value={status} onChange={(event) => onChange(event.target.value)}>{statuses.map((item) => <option key={item} value={item}>{item.replace('_', ' ')}</option>)}</select>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-20 bg-[#101114]/45 backdrop-blur-[2px]" /><Dialog.Content className="panel fixed left-1/2 top-1/2 z-20 max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-6 shadow-xl"><div className="mb-5 flex items-center justify-between"><Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title><Dialog.Close asChild><button type="button" className="quiet">Close</button></Dialog.Close></div>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function LeadForm({ currentUser, users, sources, onDone, onError }: { currentUser: User; users: User[]; sources: { id: string; name: string }[]; onDone: () => void; onError: (message: string) => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await mutate('/leads', 'POST', {
        name: form.get('name'), email: form.get('email') || undefined, company: form.get('company') || undefined,
        phone: form.get('phone') || undefined, sourceId: form.get('sourceId') || undefined,
        assigneeId: form.get('assigneeId') || currentUser.id,
      });
      onDone();
    } catch (error) { onError(error instanceof Error ? error.message : 'Could not create lead'); }
  }
  const assignees = currentUser.role === 'ADMIN' ? users.filter((item) => item.active && item.role !== 'ADMIN') : currentUser.role === 'MANAGER' ? users.filter((item) => item.active && (item.id === currentUser.id || item.managerId === currentUser.id)) : [];
  return <form className="space-y-4" onSubmit={submit}>
    <Field name="name" label="Lead name" required /><Field name="email" label="Email" type="email" /><Field name="company" label="Company" /><Field name="phone" label="Phone" />
    {sources.length > 0 && <div><label className="label" htmlFor="sourceId">Source</label><select className="field" name="sourceId" id="sourceId"><option value="">Select a source</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select></div>}
    {currentUser.role !== 'MEMBER' && <div><label className="label" htmlFor="assigneeId">Assign to</label><select className="field" name="assigneeId" id="assigneeId" defaultValue={currentUser.role === 'MANAGER' ? currentUser.id : assignees[0]?.id ?? ''} required><option value="" disabled>Select an assignee</option>{assignees.map((item) => <option key={item.id} value={item.id}>{item.id === currentUser.id ? `${item.name} (you)` : item.name}</option>)}</select>{assignees.length === 0 && <p className="mt-1 text-xs text-amber-800">Create an eligible user before adding a lead.</p>}</div>}
    <button className="primary w-full" disabled={currentUser.role !== 'MEMBER' && assignees.length === 0}>Create lead</button>
  </form>;
}

function UserForm({ users, onDone, onError }: { users: User[]; onDone: () => void; onError: (message: string) => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await mutate('/users', 'POST', { name: form.get('name'), email: form.get('email'), password: form.get('password'), role: form.get('role'), managerId: form.get('managerId') || undefined });
      onDone();
    } catch (error) { onError(error instanceof Error ? error.message : 'Could not create user'); }
  }
  return <form className="space-y-4" onSubmit={submit}>
    <Field name="name" label="Full name" required /><Field name="email" label="Email address" type="email" required /><Field name="password" label="Temporary password (12+ characters)" type="password" required />
    <div><label className="label" htmlFor="role">Role</label><select className="field" id="role" name="role"><option value="MEMBER">Team member</option><option value="MANAGER">Manager</option></select></div>
    <div><label className="label" htmlFor="managerId">Manager (optional)</label><select className="field" id="managerId" name="managerId"><option value="">No manager</option>{users.filter((item) => item.role === 'MANAGER').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
    <button className="primary w-full">Create account</button>
  </form>;
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

function LeadActionForm({ lead, onDone, onError }: { lead: { id: string; action: 'note' | 'follow-up' }; onDone: () => void; onError: (message: string) => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const path = lead.action === 'note' ? `/leads/${lead.id}/notes` : `/leads/${lead.id}/follow-ups`;
    const body = lead.action === 'note'
      ? { content: form.get('content') }
      : { description: form.get('description'), dueAt: new Date(String(form.get('dueAt'))).toISOString() };
    try { await mutate(path, 'POST', body); onDone(); }
    catch (error) { onError(error instanceof Error ? error.message : 'Could not save this update'); }
  }
  return <form className="space-y-4" onSubmit={submit}>
    {lead.action === 'note' ? <div><label className="label" htmlFor="content">Note</label><textarea className="field min-h-28" id="content" name="content" maxLength={5000} required /></div> : <><div><label className="label" htmlFor="description">Follow-up details</label><textarea className="field min-h-24" id="description" name="description" maxLength={2000} required /></div><Field name="dueAt" label="Due date and time" type="datetime-local" required /></>}
    <button className="primary w-full">{lead.action === 'note' ? 'Add note' : 'Schedule follow-up'}</button>
  </form>;
}

function SettingsForm({ settings, onDone, onError }: { settings: { key: string; value: string }[]; onDone: () => void; onError: (message: string) => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try { await mutate('/settings', 'POST', { key: form.get('key'), value: form.get('value') }); onDone(); }
    catch (error) { onError(error instanceof Error ? error.message : 'Could not update setting'); }
  }
  return <div className="space-y-5">
    <form className="space-y-3" onSubmit={submit}><Field name="key" label="New setting key" required /><div><label className="label" htmlFor="value">Value</label><textarea className="field min-h-20" id="value" name="value" maxLength={2000} required /></div><button className="primary w-full">Save setting</button></form>
    <div className="max-h-64 space-y-3 overflow-y-auto">{settings.map((setting, index) => <form key={setting.key} className="space-y-2 border-t border-[#e5e7eb] pt-3" onSubmit={(event) => { event.preventDefault(); const value = new FormData(event.currentTarget).get('value'); void mutate('/settings', 'POST', { key: setting.key, value }).then(onDone).catch((error: unknown) => onError(error instanceof Error ? error.message : 'Could not update setting')); }}><label className="label" htmlFor={`setting-${index}`}>{setting.key}</label><textarea className="field min-h-16" id={`setting-${index}`} name="value" defaultValue={setting.value} maxLength={2000} required /><button className="quiet text-xs">Update</button></form>)}</div>
  </div>;
}

function ResetPasswordForm({ user, onDone, onError }: { user: User; onDone: () => void; onError: (message: string) => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const newPassword = new FormData(event.currentTarget).get('newPassword');
    try { await mutate(`/users/${user.id}/reset-password`, 'POST', { newPassword }); onDone(); }
    catch (error) { onError(error instanceof Error ? error.message : 'Could not reset password'); }
  }
  return <form className="space-y-4" onSubmit={submit}><Field name="newPassword" label="Temporary password (12+ characters, upper/lowercase, number and symbol)" type="password" required /><button className="primary w-full">Reset password</button></form>;
}

function Field({ name, label, type = 'text', required = false }: { name: string; label: string; type?: string; required?: boolean }) {
  return <div><label className="label" htmlFor={name}>{label}</label><input className="field" id={name} name={name} type={type} required={required} /></div>;
}
