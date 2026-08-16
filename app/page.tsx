import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { roleHomePath } from '@/lib/auth';

export default async function Home() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  redirect(roleHomePath(session.role));
}
