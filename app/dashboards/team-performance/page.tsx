import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import TeamPerformanceClient from './TeamPerformanceClient';

export default async function TeamPerformancePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return <TeamPerformanceClient role={session.role} selfName={session.name} />;
}
