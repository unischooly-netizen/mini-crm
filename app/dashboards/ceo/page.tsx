import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import CeoDashboardClient from './CeoDashboardClient';

export default async function CeoDashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return <CeoDashboardClient />;
}
