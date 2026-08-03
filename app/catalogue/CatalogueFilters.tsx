'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { MultiSelect, type MultiSelectOption } from '@/components/ui/MultiSelect';

/**
 * Lab and account pickers for the catalogue.
 *
 * Selections live in the URL rather than component state, so a filtered view
 * is a link someone can send — which is the whole point when the person asking
 * "what can Thyrocare fulfil?" isn't the person answering.
 *
 * The rest of the filter bar is server-rendered chips; only these two need
 * client state, so only these two are a client component.
 */
export function CatalogueFilters({
  labs,
  stores,
}: {
  labs: MultiSelectOption[];
  stores: MultiSelectOption[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const read = (key: string) => {
    const raw = params.get(key);
    return raw ? raw.split(',').filter(Boolean) : [];
  };

  const write = (key: string, values: string[]) => {
    const next = new URLSearchParams(params.toString());
    if (values.length) next.set(key, values.join(','));
    else next.delete(key);
    const qs = next.toString();
    startTransition(() => router.push(qs ? `/catalogue?${qs}` : '/catalogue'));
  };

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${pending ? 'opacity-60' : ''}`}>
      <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-1">Fulfilled by</span>
      <MultiSelect
        options={labs}
        selected={read('labs')}
        onChange={(v) => write('labs', v)}
        allLabel="Any lab"
        nounSingular="lab"
        nounPlural="labs"
        searchPlaceholder="Search labs"
        footerFor={(n) =>
          n === 0
            ? 'Showing packages from every lab'
            : `Showing packages any of the ${n} selected lab${n > 1 ? 's' : ''} can quote`
        }
      />

      <span className="text-[11px] uppercase tracking-wide text-ink-400 ml-3 mr-1">Mapped to</span>
      <MultiSelect
        options={stores}
        selected={read('stores')}
        onChange={(v) => write('stores', v)}
        allLabel="Any account"
        nounSingular="account"
        nounPlural="accounts"
        searchPlaceholder="Search accounts"
        footerFor={(n) =>
          n === 0
            ? 'Showing every package, mapped or not'
            : `Showing packages mapped to any of the ${n} selected account${n > 1 ? 's' : ''}`
        }
      />
    </div>
  );
}
