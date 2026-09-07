import type { RawRecord, ReconciliationInput } from './reconciliation.ts';

export type UploadKey = 'payments' | 'invoices' | 'settlements' | 'bank_transactions' | 'settlement_recon_items' | 'ground_truth';
export type UploadState = Partial<Record<UploadKey, RawRecord[]>>;
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function parseCsv(input: string): RawRecord[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;
  const finishField = () => { row.push(field.trim()); field = ''; closedQuote = false; };
  const finishRow = () => {
    finishField();
    if (row.some(Boolean)) rows.push(row);
    row = [];
    if (rows.length > 100_001) throw new Error('CSV exceeds the 100,000-record file limit.');
  };
  const text = input.replace(/^\uFEFF/, '');
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; }
        else { quoted = false; closedQuote = true; }
      } else field += character;
    } else if (character === ',') finishField();
    else if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      finishRow();
    } else if (character === '"') {
      if (closedQuote || field.trim()) throw new Error('CSV contains a quote inside an unquoted field.');
      field = ''; quoted = true;
    } else {
      if (closedQuote && character.trim()) throw new Error('CSV has characters after a closing quote.');
      field += character;
    }
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  if (field || row.length || closedQuote) finishRow();
  const headers = rows.shift() ?? [];
  if (!headers.length) throw new Error('CSV is empty. Supply a header row and records.');
  const normalizedHeaders = headers.map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ''));
  if (normalizedHeaders.some((header) => !header) || new Set(normalizedHeaders).size !== headers.length) throw new Error('CSV has empty or duplicate column names.');
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV record ${index + 1} has ${values.length} fields; expected ${headers.length}. No records were imported.`);
    return Object.fromEntries(headers.map((header, column) => [header, values[column]]));
  });
}

export async function parseUploadFile(file: Pick<File,'size'|'name'|'text'>): Promise<RawRecord[]> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('File exceeds the 20 MiB upload limit.');
  const content = await file.text();
  if (file.name.toLowerCase().endsWith('.csv')) return parseCsv(content);
  if (!file.name.toLowerCase().endsWith('.json')) throw new Error('Upload a CSV or JSON file.');
  const parsed: unknown = JSON.parse(content.replace(/^\uFEFF/, ''));
  if (!Array.isArray(parsed) || parsed.some((record) => !record || typeof record !== 'object' || Array.isArray(record))) throw new Error('JSON files must contain an array of record objects.');
  if (parsed.length > 100_000) throw new Error('JSON exceeds the 100,000-record file limit.');
  return parsed as RawRecord[];
}

export function buildUploadRequest(uploads: UploadState): ReconciliationInput & {response_mode:'full'|'summary'} {
  const paymentLoop = Boolean(uploads.payments?.length && uploads.invoices?.length);
  const settlementLoop = Boolean(uploads.settlements?.length && uploads.bank_transactions?.length);
  if (!paymentLoop && !settlementLoop) throw new Error('Add payments + invoices or settlements + bank transactions.');
  const total = [uploads.payments,uploads.invoices,uploads.settlements,uploads.bank_transactions,uploads.settlement_recon_items].reduce((sum,rows) => sum + (rows?.length ?? 0),0);
  if (total > 100_000) throw new Error('Combined primary and settlement-proof records exceed 100,000. Split the batch.');
  const truth = uploads.ground_truth?.map((record,index) => {
    const left = record.left_id ?? record.left;
    const right = record.right_id ?? record.right;
    if (typeof left !== 'string' || !left.trim() || typeof right !== 'string' || !right.trim()) throw new Error(`Ground-truth record ${index + 1} needs non-empty left_id and right_id. No labels were discarded.`);
    return {left_id:left.trim(),right_id:right.trim()};
  });
  return {...uploads,ground_truth:truth,response_mode:total > 20_000 ? 'summary' : 'full'};
}

export function csvCell(value: string | number) {
  const raw = String(value);
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(raw) || /^[\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"','""')}"`;
}
