import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import LanguageGapClient from './LanguageGapClient';

// *** TEMPORARY DEV DIAGNOSTIC — NOT PART OF THE APP'S PRODUCT SURFACE. ***
// A browsable worklist for the Aug 2026 Language data-quality finding:
// leads that reached qualification_status = 'Qualified' with an empty
// Language field (neither full-import nor upload validates/requires it —
// see app/api/dev/language-gap/route.ts's doc comment for the full root
// cause). Not linked from any nav — reached only by typing this URL
// directly, same as the earlier temporary /shifu-test and
// /api/dev/shifu-parity diagnostics. Read-only: it only lists leads and
// links to each one's real edit page (app/leads/[id]) where an Admin or
// Data Team member fills in the correct Language by hand — no values are
// guessed or written here. Should be deleted (ask Claude to remove the
// app/dev/language-gap and app/api/dev/language-gap folders) once the
// worklist is cleared.
export default async function LanguageGapPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/dashboard');
  return <LanguageGapClient />;
}
