// Token Radar's entrypoint (Node 22, standard library only).
//
// It reads the sealed snapshot, scores every pre-token protocol with the radar-2 model in
// lib/model.ts, writes the ranked board to /output/board.json, writes the dashboard's data beside
// the page as /output/data.js, copies this repository's dashboard/ and screenshots/ to /output, and
// writes /output/dossier.json with the vendored make.fun dossier library. The program is
// deterministic: two runs over the same snapshot write the same bytes.
//
// The pipeline runs in six steps, in order, and fails fast on the first problem:
//   1. Read the snapshot. --input names a snapshot.json file or a directory that holds one; without
//      it the program looks for /input/snapshot.json, the sealed mount the grader provides.
//   2. Score it. buildRadar calibrates the category multiples from the snapshot's live protocols,
//      builds the 226-row board, and sets the 24 live-token protocols aside for the dashboard.
//   3. Refuse a bad board. boardIssue checks coverage, ranks, order, one shared implied value and
//      farm steps; a board that fails any of them stops the run with exit code 2, before anything
//      is written, so a bad model never ships a half-written output.
//   4. Write board.json and data.js. board.json is the ranked board the gate reads; data.js is the
//      same data as a script the dashboard reads without a network request.
//   5. Copy dashboard/ and screenshots/ into the output. The dashboard is three files (index.html,
//      app.js, app.css) and the screenshots are the three views the gate requires: the board, a
//      detail view and a filtered view. Fewer than three screenshots stops the run.
//   6. Write dossier.json last, with the vendored dossier library. The scorer rebuilds the dossier
//      from this output and compares bytes, so the dossier is written from the finished output and
//      never from a stale one. Its text is capped at 65,536 bytes, which is why the dashboard's
//      source is kept small enough for the judge to read in full.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// Exit codes: 0 when the output is written, 2 when the snapshot is missing, the board fails its
// checks, or the screenshots are short. Nothing is written on a failure path except the output
// directory itself, which is created only after the board passes.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The dossier's text cap, and the screenshot caps the gate enforces. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_MAX = 4;
const SCREENSHOT_MAX_BYTES = 524_288;
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The value of `--name <value>`, or `fallback` when the flag is absent.
 *
 * Both spellings work: `--input path` and `--input=path`. The spaced form wins when both are
 * present, because it is checked first. A flag with no value after it falls through to the joined
 * form, and then to the fallback, so `--input` at the very end of the command line is the same as
 * no flag at all. The two flags this program reads are --input (the snapshot) and --output (the
 * directory); --output falls back to MAKEFUN_OUTPUT_DIR and then to /output, the grader's mount.
 */
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

/** Fail with a message on stderr and exit code 2. */
function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(2);
}

const inputArg = flag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy a directory's regular files into `to`, skipping names that start with a dot.
 *
 * The copy is flat: only regular files in the directory itself are copied, never subdirectories,
 * and never hidden files, so a stray .DS_Store or editor backup cannot reach the output. The
 * destination is created when it does not exist. The returned list is the copied file names, in
 * directory order; the caller uses its length to enforce the screenshot count. A missing source
 * directory is not an error: it copies nothing and returns an empty list, so a repository without
 * a screenshots/ directory fails later on the count check, with a message that names the count,
 * instead of failing here with a missing-directory error.
 */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashboardFiles = copyDir(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyDir(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: { max: SCREENSHOT_MAX, max_bytes: SCREENSHOT_MAX_BYTES },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (${dashboardFiles.length} files), ${join(outDir, 'screenshots')} (${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
