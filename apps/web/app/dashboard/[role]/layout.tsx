'use client';

import { WorkspaceLayout } from '@/components/workspace-layout';

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <WorkspaceLayout>{children}</WorkspaceLayout>;
}
