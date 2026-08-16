import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import QualifiedLeadsClient from './QualifiedLeadsClient';

export default async function QualifiedLeadsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return <QualifiedLeadsClient role={session.role} selfUserId={session.id} selfName={session.name} />;
}
