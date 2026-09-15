import { redirect } from 'next/navigation';

/** The dashboard is now the console Overview. Kept so old links still work. */
export default function DashboardRedirect() {
  redirect('/overview');
}
