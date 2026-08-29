import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import HourlyReportClient from './HourlyReportClient';

export default async function HourlyReportPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return <HourlyReportClient defaultAgent={session.role === 'presales_agent' ? session.name : 'All'} />;
}
