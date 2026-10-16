/* ==========================================================================
   visual.test.mjs  -  the golden-image gate, in a temp folder
   --------------------------------------------------------------------------
   Approve a page, re-render it unchanged, and require silence. Then change one
   visible pixel and require the tool to notice. Nothing touches books/.
   ========================================================================== */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ok, group, report, cli } from './harness.mjs';

const dir = path.join(os.tmpdir(), 'paper-visual-test');
const file = path.join(dir, 'v.html');
const snaps = path.join(dir, '.snapshots');

const html = (colour) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0}
  .sheet{width:176mm;height:250mm;box-sizing:border-box;padding:14mm;background:#fff;font-family:serif}
  h1{font-size:32px;margin:0;color:${colour}}
</style></head><body><section class="sheet"><h1>Golden page</h1>
<p style="color:#111;font-size:16px">A paragraph, dark on white, long enough to look like real text on the page.</p>
</section></body></html>`;

fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(file, html('#111111'), 'utf8');

try {
  group('approve, then verify, then catch a change');
  const up = cli('visual.mjs', file, '--update');
  ok('--update exits 0', up.code === 0, up.stderr.trim());
  ok('--update writes a snapshot and a manifest',
    fs.existsSync(path.join(snaps, 'page1.png')) && fs.existsSync(path.join(snaps, 'manifest.json')));

  const same = cli('visual.mjs', file, '--json');
  const sj = JSON.parse(same.stdout);
  ok('an unchanged page passes', same.code === 0 && sj.ready === true, JSON.stringify(sj));
  ok('and its page list is stable', sj.pages === 1 && sj.changed.length === 0);

  fs.writeFileSync(file, html('#cc0000'), 'utf8');
  const moved = cli('visual.mjs', file, '--json');
  const mj = JSON.parse(moved.stdout);
  ok('a changed pixel fails the gate', moved.code === 1 && mj.ready === false, JSON.stringify(mj));
  ok('the changed page is named', mj.changed.includes(1), JSON.stringify(mj.changed));
  ok('the fresh pixels are kept for the eye', fs.existsSync(path.join(snaps, 'diff', 'page1.png')));

  const fixed = cli('visual.mjs', file, '--update');
  ok('re-approving clears it', fixed.code === 0 && cli('visual.mjs', file).code === 0);

  group('no snapshots is a refusal, not a pass');
  fs.rmSync(snaps, { recursive: true, force: true });
  const none = cli('visual.mjs', file, '--json');
  ok('a book with no snapshots fails', none.code === 1 && JSON.parse(none.stdout).error === 'no snapshots yet');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

report('visual');
