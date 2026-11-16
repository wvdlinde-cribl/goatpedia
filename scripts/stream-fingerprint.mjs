// A stable fingerprint of what an optimization's Cribl check ran: the pipeline, the events and
// the expectations. scripts/stream-verify.mjs stores it with each result; scripts/build.js only
// shows a result as "checked in Cribl" while the article still produces the same fingerprint.
import { createHash } from 'node:crypto';
import '../site/stream.js';

const { pipelineFor, logOf } = globalThis.GoatpediaStream;

export function fingerprint(entry, opt) {
  const log = logOf(entry, opt.stream);
  const what = { pipeline: pipelineFor(entry, opt), events: [log.sample, ...(opt.stream.test || [])], expect: opt.stream.expect || {} };
  return createHash('sha256').update(JSON.stringify(what)).digest('hex').slice(0, 16);
}
