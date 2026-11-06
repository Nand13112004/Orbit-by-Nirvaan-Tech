'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3,
  CalendarDays,
  CalendarClock,
  ChevronLeft,
  ChevronsRight,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Moon,
  Search,
  Settings2,
  Sun,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Brand } from '@/components/brand';
import { Chatbot } from '@/components/chatbot';
import { useTheme } from '@/app/providers';
import { api, clearCsrfToken, dashboardForRole, mutate } from '@/lib/api';

type User = { id: string; name: string; role: 'ADMIN' | 'MANAGER' | 'MEMBER' };

const navigation = [
  { label: 'Dashboard', path: '', icon: LayoutDashboard },
  { label: 'Leads', path: '/leads', icon: ListChecks },
  { label: 'Sales pipeline', path: '/pipeline', icon: BarChart3 },
  { label: 'Follow-ups', path: '/follow-ups', icon: CalendarClock },
  { label: 'Calendar', path: '/calendar', icon: CalendarDays },
  { label: 'Team', path: '/team', icon: Users },
  { label: 'Reports', path: '/reports', icon: BarChart3 },
];

const pageNames: Record<string, string> = {
  leads: 'Lead management',
  pipeline: 'Sales pipeline',
  'follow-ups': 'Follow-up management',
  calendar: 'Calendar',
  team: 'Team management',
  reports: 'Reports & analytics',
  settings: 'Settings',
  new: 'New lead',
};

export function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { isDark, toggleTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: User }>('/auth/me'),
    retry: false,
  });
  const user = me.data?.user;
  const root = user ? dashboardForRole(user.role) : '/dashboard/admin';
  const segment = pathname.slice(root.length).split('/').filter(Boolean);
  const currentPage = segment.length ? pageNames[segment[segment.length - 1]] ?? 'Lead details' : 'Dashboard';

  useEffect(() => {
    if (me.isError) router.replace('/');
    if (user && pathname.startsWith('/dashboard/') && !pathname.startsWith(dashboardForRole(user.role))) {
      router.replace(dashboardForRole(user.role));
    }
  }, [me.isError, pathname, router, user]);

  async function logout() {
    setError('');
    try {
      await mutate('/auth/logout', 'POST');
      clearCsrfToken();
      queryClient.clear();
      router.replace('/');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not sign out');
    }
  }

  function searchLeads(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(`${root}/leads${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''}`);
  }

  if (me.isLoading || !user) {
    return <main className="grid min-h-screen place-items-center text-sm text-slate-500">Loading your workspace…</main>;
  }

  return (
    <div className={`workspace-shell min-h-screen ${collapsed ? 'workspace-collapsed' : ''}`}>
      <aside className="workspace-sidebar">
        <div className="workspace-brand">
          <Brand href={root} />
          <button
            type="button"
            className="workspace-collapse quiet"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setCollapsed((value) => !value)}
          >
            <ChevronsRight size={17} className={collapsed ? '' : 'rotate-180'} />
          </button>
        </div>
        <p className="workspace-nav-label">Workspace</p>
        <nav className="workspace-nav" aria-label="Main navigation">
          {navigation.map(({ label, path, icon: Icon }) => {
            const href = `${root}${path}`;
            const active = path ? pathname.startsWith(href) : pathname === root;
            return (
              <Link
                key={label}
                href={href}
                title={collapsed ? label : undefined}
                className={`workspace-nav-link${active ? ' workspace-nav-link-active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={17} />
                <span>{label}</span>
              </Link>
            );
          })}
          {user.role === 'ADMIN' && (
            <Link
              href={`${root}/settings`}
              title={collapsed ? 'Settings' : undefined}
              className={`workspace-nav-link${pathname.endsWith('/settings') ? ' workspace-nav-link-active' : ''}`}
            >
              <Settings2 size={17} />
              <span>Settings</span>
            </Link>
          )}
        </nav>
        <div className="workspace-user">
          <span className="workspace-avatar">{user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
          <span className="workspace-user-copy">
            <strong>{user.name}</strong>
            <small>{user.role === 'MEMBER' ? 'Team member' : user.role[0] + user.role.slice(1).toLowerCase()}</small>
          </span>
        </div>
        <button type="button" className="workspace-nav-link workspace-logout" onClick={logout}>
          <LogOut size={17} />
          <span>Sign out</span>
        </button>
      </aside>

      <div className="workspace-main">
        <header className="workspace-header">
          <div className="workspace-heading">
            <button type="button" className="workspace-mobile-back" aria-label="Back" onClick={() => router.back()}>
              <ChevronLeft size={18} />
            </button>
            <div className="workspace-breadcrumb"><span>Workspace</span><span aria-hidden="true">/</span><strong>{currentPage}</strong></div>
          </div>
          <form className="workspace-search" onSubmit={searchLeads}>
            <Search size={16} aria-hidden="true" />
            <input aria-label="Search leads" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search leads…" />
          </form>
          <button
            type="button"
            className="quiet workspace-theme-toggle"
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={toggleTheme}
          >
            {isDark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <Link className="workspace-reminders" href={`${root}/follow-ups`} title="View scheduled follow-ups">
            <CalendarClock size={17} />
            <span>Follow-ups</span>
          </Link>
        </header>
        {error && <p className="workspace-error" role="alert">{error}</p>}
        <div className="workspace-content">{children}</div>
      </div>
      <nav className={`workspace-mobile-nav${user.role === 'ADMIN' ? ' workspace-mobile-nav-admin' : ''}`} aria-label="Mobile navigation">
        {navigation.slice(0, 5).map(({ label, path, icon: Icon }) => {
          const href = `${root}${path}`;
          const active = path ? pathname.startsWith(href) : pathname === root;
          return <Link key={label} href={href} aria-label={label} aria-current={active ? 'page' : undefined} className={active ? 'active' : ''}><Icon size={19} /><span>{label}</span></Link>;
        })}
        {user.role === 'ADMIN' && <Link href={`${root}/settings`} aria-label="Settings" aria-current={pathname.endsWith('/settings') ? 'page' : undefined} className={pathname.endsWith('/settings') ? 'active' : ''}><Settings2 size={19} /><span>Settings</span></Link>}
      </nav>
      <Chatbot />
    </div>
  );
}
