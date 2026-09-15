import { redirect } from 'next/navigation';

/** Mission control moved into the console top bar; engines carry the detail. */
export default function SimulationRedirect() {
  redirect('/engines');
}
