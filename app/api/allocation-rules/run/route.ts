import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { allocateUnassignedLeads } from '@/lib/allocation';
import { logAction } from '@/lib/audit';

export async function POST() {
  const session = await getSession();
  if (!session || (session.role !== 'admin' && session.role !== 'data_team')) {
    return NextResponse.json({ error: 'Admin or Data Team login required.' }, { status: 403 });
  }

  const result = await allocateUnassignedLeads();

  await logAction(session, 'RUN_ALLOCATION', 'leads', null, {
    assignedCount: result.assignments.length,
    skippedLanguages: result.skippedLanguages,
  });

  return NextResponse.json(result);
}
