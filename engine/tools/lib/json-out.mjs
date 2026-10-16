/* ==========================================================================
   lib/json-out.mjs  -  the --json convention, in one place
   --------------------------------------------------------------------------
   Every tool that can be driven by the cockpit prints either a human table or
   one JSON object, and always exits nonzero when it is a failing gate. That
   rule was written out by hand in each tool; this is the one copy.
   ========================================================================== */

/** True when the argument list asks for machine output. */
export function wantsJson(argv = process.argv.slice(2)) {
  return argv.includes('--json');
}

/**
 * Print exactly one thing: JSON to stdout, or the human text. Never both, so a
 * caller that pipes stdout always gets parseable input when it asked for JSON.
 */
export function emit({ json, asJson, text }) {
  if (asJson) console.log(JSON.stringify(json, null, 2));
  else console.log(text);
}

/** Set the process exit code from a boolean gate. */
export function gate(ready) {
  process.exitCode = ready ? 0 : 1;
}
