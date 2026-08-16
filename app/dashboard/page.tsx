import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'presales_agent') redirect('/login');

  return <DashboardClient agentName={session.name} />;
}
