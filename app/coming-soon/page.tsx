import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { BrandHeader } from '@/app/components/BrandHeader';

export default async function ComingSoonPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <div style={{ maxWidth: 500, margin: '80px auto', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}><BrandHeader subtitle={`Hi ${session.name}`} /></div>
      <p>
        Your view (for {session.role.replace('_', ' ')}) is part of Stage 2 — the Qualified Leads menu —
        which we&apos;ll build next. Your login already works, nothing else to do here yet.
      </p>
      <form action="/api/logout" method="post">
        <button
          type="submit"
          style={{ padding: '8px 14px', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer' }}
        >
          Log out
        </button>
      </form>
    </div>
  );
}
