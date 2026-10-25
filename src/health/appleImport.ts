import { Unzip, UnzipInflate } from 'fflate';
import { appleSourceKind, createAppleParser, type ImportSample } from './appleParse.ts';

export type ImportProgress = { phase: 'reading' | 'uploading'; fraction: number; records: number };

/** Main export file inside the zip; the clinical records (export_cda.xml) and workout routes are skipped. */
const isExportXml = (name: string) => /^(apple_health_export\/)?[^/]+\.xml$/i.test(name) && !/cda/i.test(name);

/**
 * Reads an Apple Health export (the zip from Health > profile > Export All Health Data, or the
 * export.xml inside it) entirely in the browser and returns readings grouped by source.
 */
export async function readAppleExport(file: File, sinceDays: number, onProgress: (p: ImportProgress) => void) {
  const parser = createAppleParser(Date.now() - sinceDays * 86_400_000);
  const reader = file.stream().getReader();
  let read = 0;
  let found = !/\.zip$/i.test(file.name);
  let failure: unknown = null;

  let push: (chunk: Uint8Array, final: boolean) => void;
  if (found) {
    const dec = new TextDecoder();
    push = (chunk, final) => parser.feed(dec.decode(chunk, { stream: !final }));
  } else {
    const unzip = new Unzip();
    unzip.register(UnzipInflate);
    unzip.onfile = entry => {
      if (found || !isExportXml(entry.name)) return;
      found = true;
      const dec = new TextDecoder();
      entry.ondata = (err, chunk, final) => {
        if (err) failure = err;
        else parser.feed(dec.decode(chunk, { stream: !final }));
      };
      entry.start();
    };
    push = (chunk, final) => unzip.push(chunk, final);
  }

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      push(new Uint8Array(0), true);
      break;
    }
    read += value.length;
    push(value, false);
    if (failure) throw new Error(`Could not unzip the export: ${String(failure)}`);
    onProgress({ phase: 'reading', fraction: read / file.size, records: parser.records });
  }
  if (!found) throw new Error('No export.xml found. Choose the export.zip from the Health app, or the export.xml inside it.');
  return { bySource: parser.finish(), records: parser.records };
}

export type SourceBatch = { source: string; kind: string; samples: ImportSample[] };

/** Splits readings into reducer-sized batches, one source at a time. */
export function batches(bySource: Map<string, ImportSample[]>, size = 2000): SourceBatch[] {
  const out: SourceBatch[] = [];
  for (const [source, samples] of bySource) {
    const kind = appleSourceKind(source);
    for (let i = 0; i < samples.length; i += size) out.push({ source, kind, samples: samples.slice(i, i + size) });
  }
  return out;
}
