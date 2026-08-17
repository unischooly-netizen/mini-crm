import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import QualifiedDashboardClient from './QualifiedDashboardClient';

export default async function QualifiedDashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return <QualifiedDashboardClient />;
}
