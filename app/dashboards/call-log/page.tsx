import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import CallLogClient from './CallLogClient';

export default async function CallLogPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return <CallLogClient role={session.role} selfName={session.name} />;
}
