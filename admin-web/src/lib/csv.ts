/**
 * Minimal RFC-4180-ish CSV parser — handles quoted fields (with embedded
 * commas/newlines/escaped "") and bare fields. Deliberately
 * dependency-free (no papaparse) since the admin bulk-upload use case is
 * small, well-defined files exported from a spreadsheet, not arbitrary
 * user-supplied CSV in the wild.
 */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  // Normalize line endings so \r\n and \r don't produce phantom blank rows.
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  // Flush the last field/row if the file doesn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

/**
 * Parses a CSV with a header row into objects keyed by (trimmed,
 * lowercased) header name. Extra/missing columns per row are tolerated —
 * missing values just come back as ''.
 */
export function parseCsvWithHeader(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? '').trim();
    });
    return obj;
  });
}

/**
 * Converts a raw row-of-cells array (as read from an .xlsx sheet) into
 * the same shape parseCsvWithHeader produces for .csv — lowercased,
 * trimmed header keys, trimmed string values — so the rest of the
 * import pipeline doesn't need to care which file format was uploaded.
 * Fully-blank rows are dropped (an .xlsx template may have empty
 * text-formatted cells reserved below the real data purely to lock in
 * column formatting; those shouldn't show up as data rows).
 */
export function recordsFromRows(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => (h ?? '').trim().toLowerCase());
  return rows
    .slice(1)
    .map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, idx) => {
        obj[h] = (r[idx] ?? '').toString().trim();
      });
      return obj;
    })
    .filter((obj) => Object.values(obj).some((v) => v !== ''));
}
