import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import LeadDetailClient from './LeadDetailClient';

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { id } = await params;

  return <LeadDetailClient leadId={id} role={session.role} selfUserId={session.id} selfName={session.name} />;
}
