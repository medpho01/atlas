'use client';

import dynamic from 'next/dynamic';
import { ComponentProps } from 'react';

const PincodeMap = dynamic(() => import('./PincodeMap'), {
  ssr: false,
  loading: () => (
    <div className="rounded-lg border border-ink-100 bg-ink-50 flex items-center justify-center text-ink-400 text-sm" style={{ height: '500px' }}>
      Loading map…
    </div>
  ),
});

export default function MapClient(props: ComponentProps<typeof PincodeMap>) {
  return <PincodeMap {...props} />;
}
