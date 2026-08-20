import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { BASIS_LABEL, BASIS_STRENGTH, type RequestRow } from '@/lib/requests';

const inr = (v: string | null) =>
  v == null ? null : '₹' + Math.round(Number(v)).toLocaleString('en-IN');

/**
 * The quote, shown as the chain it was built from.
 *
 * A single number invites the question "where did that come from?", and the
 * person being asked is on a call with the store. Showing what the store
 * already pays, what labs actually charge, and what we added answers it before
 * it is asked — and makes an obviously wrong quote obviously wrong.
 */
export function PriceBreakdown({ row }: { row: RequestRow }) {
  const store = inr(row.store_price);
  const quote = inr(row.quote_price);
  const ref = inr(row.reference_cost);
  const best = inr(row.best_lab_cost);

  const margin =
    row.quote_price && row.reference_cost
      ? Math.round(Number(row.quote_price) - Number(row.reference_cost))
      : null;

  // A quote below what the store already pays us is not automatically wrong,
  // but it is always worth a second look before it is sent.
  const underStore =
    row.quote_price && row.store_price && Number(row.quote_price) < Number(row.store_price);

  return (
    <Card>
      <CardHeader title="How the price was built" subtitle="Every input, so the number can be defended." />
      <CardBody className="pt-0">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-ink-100">
            <tr>
              <td className="py-1.5 text-ink-600">Store price on record</td>
              <td className="py-1.5 text-right num text-ink-900">
                {store ?? <span className="text-ink-400 text-xs">no rate for this store</span>}
              </td>
            </tr>
            {row.store_mrp && (
              <tr>
                <td className="py-1.5 text-ink-600">Store MRP</td>
                <td className="py-1.5 text-right num text-ink-500">{inr(row.store_mrp)}</td>
              </tr>
            )}
            <tr>
              <td className="py-1.5 text-ink-600">
                Cost across the network
                {row.cost_labs ? (
                  <span className="block text-[10px] text-ink-400">{row.cost_labs} lab rates</span>
                ) : null}
              </td>
              <td className="py-1.5 text-right num text-ink-900">
                {row.cost_avg ? (
                  <>
                    {inr(row.cost_avg)}
                    <span className="block text-[10px] text-ink-400">
                      {inr(row.cost_min)}–{inr(row.cost_max)}
                    </span>
                  </>
                ) : <span className="text-ink-400 text-xs">no rates</span>}
              </td>
            </tr>
            {best && (
              <tr>
                <td className="py-1.5 text-ink-600">Cheapest covering lab</td>
                <td className="py-1.5 text-right num text-ink-900">{best}</td>
              </tr>
            )}
            <tr>
              <td className="py-1.5 text-ink-600">
                Basis used
                <span className={`block text-[10px] ${
                  BASIS_STRENGTH[row.price_basis] === 'strong' ? 'text-success-600'
                  : BASIS_STRENGTH[row.price_basis] === 'moderate' ? 'text-warn-600' : 'text-danger-500'}`}>
                  {BASIS_LABEL[row.price_basis] ?? row.price_basis}
                </span>
              </td>
              <td className="py-1.5 text-right num text-ink-900">{ref ?? '—'}</td>
            </tr>
            {row.markup_pct && (
              <tr>
                <td className="py-1.5 text-ink-600">Markup for distance</td>
                <td className="py-1.5 text-right num text-ink-700">
                  +{Number(row.markup_pct)}%
                  {margin != null && (
                    <span className="block text-[10px] text-ink-400">
                      +₹{margin.toLocaleString('en-IN')}
                    </span>
                  )}
                </td>
              </tr>
            )}
            <tr className="bg-brand-50/40">
              <td className="py-2 font-medium text-ink-900">Suggested quote</td>
              <td className="py-2 text-right num text-lg font-bold text-ink-900">
                {quote ?? <span className="text-sm font-normal text-danger-500">no basis</span>}
              </td>
            </tr>
          </tbody>
        </table>
        {underStore && (
          <p className="text-[11px] text-warn-600 mt-2">
            This quote is below the rate this store already pays for the same package. Worth a
            look before sending.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
