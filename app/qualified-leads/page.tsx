import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getSession } from '@/lib/auth';
import QualifiedLeadsClient from './QualifiedLeadsClient';

export default async function QualifiedLeadsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <Suspense fallback={<div style={{ padding: 40, fontFamily: 'system-ui, sans-serif' }}>Loading…</div>}>
      <QualifiedLeadsClient role={session.role} selfUserId={session.id} selfName={session.name} />
    </Suspense>
  );
}
