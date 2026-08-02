import { redirect } from 'next/navigation';

/**
 * Serviceability moved into /pincodes as a tab — same object, two questions.
 * Kept as a redirect so shared links and bookmarks still land in the right place.
 */
export default function CoverageRedirect() {
  redirect('/pincodes?tab=serviceability');
}
