import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import OperationsDashboardClient from './OperationsDashboardClient';

export default async function OperationsDashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return <OperationsDashboardClient />;
}
