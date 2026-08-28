import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import HelpClient from './HelpClient';

export default async function HelpPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  return <HelpClient role={session.role} name={session.name} />;
}
