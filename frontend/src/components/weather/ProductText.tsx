import { useMemo, useState } from 'react';
import { Panel, Button } from '../ui/Primitives';
import { formatRelative } from '../../utils/format';
import type { TextProduct } from '../../api/types';
import './ProductText.css';

/**
 * Renders a raw NWS text product (forecast discussion, special statement)
 * readably: section headers become headings, the fixed-width body is rewrapped
 * into prose, and the original monospaced text stays one click away because
 * forecasters put meaning in the formatting.
 */

interface Section {
  heading: string | null;
  body: string;
}

/** NWS discussions delimit sections with lines like `.SYNOPSIS...`. */
function parseSections(text: string): Section[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const sections: Section[] = [];
  let current: Section = { heading: null, body: '' };

  for (const line of lines) {
    const header = line.match(/^\.([A-Z][A-Z0-9 /&()-]{2,60})\.\.\.\s*(.*)$/);
    if (header) {
      if (current.body.trim() || current.heading) sections.push(current);
      current = { heading: header[1].trim(), body: header[2] ? `${header[2]}\n` : '' };
      continue;
    }
    // `$$` terminates a section in NWS products.
    if (line.trim() === '$$') {
      if (current.body.trim() || current.heading) sections.push(current);
      current = { heading: null, body: '' };
      continue;
    }
    current.body += `${line}\n`;
  }
  if (current.body.trim() || current.heading) sections.push(current);
  return sections.filter((s) => s.heading || s.body.trim());
}

/** Rewrap the 69-column body into paragraphs, keeping deliberate breaks. */
function paragraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join(' ')
        .trim(),
    )
    .filter(Boolean);
}

export function ProductText({
  product,
  title = 'NWS Forecast Discussion',
  eyebrow,
  action,
}: {
  product: TextProduct;
  title?: string;
  eyebrow?: string;
  action?: React.ReactNode;
}) {
  const [raw, setRaw] = useState(false);
  const sections = useMemo(() => parseSections(product.text ?? ''), [product.text]);

  return (
    <Panel
      eyebrow={eyebrow ?? product.productName}
      title={title}
      action={
        <div className="nc-row">
          {action}
          <Button size="sm" variant="subtle" onClick={() => setRaw((r) => !r)}>
            {raw ? 'Formatted' : 'Raw text'}
          </Button>
        </div>
      }
    >
      <div className="nc-product__meta">
        <span>
          <em>Office</em>
          <strong>{product.office}</strong>
        </span>
        <span>
          <em>Issued</em>
          <strong>{new Date(product.issuedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</strong>
        </span>
        <span>
          <em>Updated</em>
          <strong>{formatRelative(product.issuedAt)}</strong>
        </span>
        <span>
          <em>Product</em>
          <strong>{product.productCode}</strong>
        </span>
      </div>

      {raw ? (
        <pre className="nc-product__raw">{product.text}</pre>
      ) : (
        <div className="nc-product__body">
          {sections.map((section, i) => (
            <section key={i}>
              {section.heading && <h3>{section.heading}</h3>}
              {paragraphs(section.body).map((paragraph, j) => (
                <p key={j}>{paragraph}</p>
              ))}
            </section>
          ))}
        </div>
      )}
    </Panel>
  );
}

export default ProductText;
