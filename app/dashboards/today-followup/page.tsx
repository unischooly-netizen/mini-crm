import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import TodayFollowupClient from './TodayFollowupClient';

export default async function TodayFollowupPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return <TodayFollowupClient role={session.role} selfName={session.name} />;
}
