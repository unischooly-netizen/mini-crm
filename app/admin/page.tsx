import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import AdminClient from './AdminClient';

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin' && session.role !== 'data_team') redirect('/login');

  return <AdminClient adminName={session.name} role={session.role} />;
}
