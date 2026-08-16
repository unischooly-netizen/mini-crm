import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import DataUploadClient from './DataUploadClient';

export default async function DataUploadPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'data_team' && session.role !== 'admin') redirect('/login');

  return <DataUploadClient userName={session.name} />;
}
