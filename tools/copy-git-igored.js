import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// TODO: adjust this to be usable by all agents

function logInfo(message, details) {
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  process.stderr.write(`[copilot-session-bootstrap] ${message}${suffix}\n`);
}

function isVerboseLoggingEnabled() {
  return process.env.COPILOT_BOOTSTRAP_VERBOSE === '1';
}

function logVerbose(message, details) {
  if (!isVerboseLoggingEnabled()) {
    return;
  }

  logInfo(message, details);
}

async function readStdin() {
  if (process.stdin.isTTY) {
    logVerbose('Skipping stdin read because stdin is a TTY');
    return {};
  }

  const chunks = [];

  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
  }

  const rawInput = chunks.join('');

  if (!rawInput.trim()) {
    logVerbose('Hook stdin was empty, falling back to empty object');
    return {};
  }

  try {
    const input = JSON.parse(rawInput);
    logVerbose('Parsed hook stdin', {
      hookEventName: input.hookEventName ?? null,
      cwd: input.cwd ?? null,
      sessionId: input.sessionId ?? null,
      source: input.source ?? null,
    });
    return input;
  } catch {
    logVerbose('Failed to parse hook stdin, falling back to empty object');
    return {};
  }
}

function runGit(args, cwd) {
  logVerbose('Running git command', { cwd, args });
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.status !== 0) {
    const errorText =
      result.stderr.trim() || result.stdout.trim() || `git ${args.join(' ')} failed`;
    throw new Error(errorText);
  }

  return result.stdout;
}

function tryRealpath(targetPath) {
  try {
    return realpathSync(targetPath);
  } catch {
    return targetPath;
  }
}

function getCurrentRoot() {
  return runGit(['rev-parse', '--show-toplevel'], process.cwd()).trim();
}

function getCurrentBranch(currentRoot) {
  return runGit(['branch', '--show-current'], currentRoot).trim();
}

function parseWorktreeList(currentRoot) {
  const raw = runGit(['worktree', 'list', '--porcelain'], currentRoot);
  const entries = [];
  let currentEntry = null;

  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      if (currentEntry) {
        entries.push(currentEntry);
        currentEntry = null;
      }
      continue;
    }

    const separator = line.indexOf(' ');
    const key = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? '' : line.slice(separator + 1);

    if (key === 'worktree') {
      if (currentEntry) {
        entries.push(currentEntry);
      }

      currentEntry = {
        path: value,
        branch: '',
        isPrunable: false,
      };
      continue;
    }

    if (!currentEntry) {
      continue;
    }

    if (key === 'branch') {
      currentEntry.branch = value;
    }

    if (key === 'prunable') {
      currentEntry.isPrunable = true;
    }
  }

  if (currentEntry) {
    entries.push(currentEntry);
  }

  return entries;
}

function chooseDonorRoot(currentRoot, currentBranch, worktrees) {
  const overrideRoot = process.env.COPILOT_BOOTSTRAP_SOURCE_ROOT;

  if (overrideRoot && existsSync(overrideRoot)) {
    const resolvedOverride = tryRealpath(overrideRoot);
    if (resolvedOverride !== tryRealpath(currentRoot)) {
      logInfo('Using donor override root', {
        overrideRoot,
        resolvedOverride,
      });
      return resolvedOverride;
    }

    logInfo('Ignoring donor override because it resolves to current root', {
      overrideRoot,
      resolvedOverride,
    });
  } else if (overrideRoot) {
    logInfo('Ignoring donor override because the path does not exist', {
      overrideRoot,
    });
  }

  const currentRealpath = tryRealpath(currentRoot);
  const candidates = worktrees.filter((worktree) => {
    if (worktree.isPrunable) {
      return false;
    }

    if (!existsSync(worktree.path)) {
      return false;
    }

    return tryRealpath(worktree.path) !== currentRealpath;
  });

  if (candidates.length === 0) {
    logInfo('No eligible donor worktrees found', {
      currentRoot,
      currentBranch,
      discoveredWorktrees: worktrees.length,
    });
    return null;
  }

  const nonAgentCandidates = candidates.filter(
    (worktree) => worktree.branch && !worktree.branch.startsWith('refs/heads/agents/'),
  );

  logInfo('Evaluated donor worktrees', {
    currentRoot,
    currentBranch,
    candidateCount: candidates.length,
    candidates: candidates.map((worktree) => ({
      path: worktree.path,
      branch: worktree.branch,
    })),
  });

  if (currentBranch.startsWith('agents/') && nonAgentCandidates.length > 0) {
    logInfo('Selected non-agent donor worktree for agent branch', {
      selectedPath: nonAgentCandidates[0].path,
      selectedBranch: nonAgentCandidates[0].branch,
    });
    return tryRealpath(nonAgentCandidates[0].path);
  }

  logInfo('Selected first eligible donor worktree', {
    selectedPath: candidates[0].path,
    selectedBranch: candidates[0].branch,
  });
  return tryRealpath(candidates[0].path);
}

function listIgnoredEntries(donorRoot) {
  const raw = runGit(
    ['ls-files', '-z', '--others', '-i', '--exclude-standard', '--directory'],
    donorRoot,
  );

  return raw
    .split('\0')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function isDryRunEnabled() {
  return process.env.COPILOT_BOOTSTRAP_DRY_RUN === '1';
}

function copyIgnoredEntries(donorRoot, currentRoot, entries) {
  const copied = [];
  const skipped = [];
  const dryRun = isDryRunEnabled();

  logInfo('Starting ignored-file bootstrap copy pass', {
    donorRoot,
    currentRoot,
    entryCount: entries.length,
    dryRun,
  });

  for (const relativePath of entries) {
    const sourcePath = path.join(donorRoot, relativePath);
    const destinationPath = path.join(currentRoot, relativePath);

    if (!existsSync(sourcePath)) {
      skipped.push(relativePath);
      logVerbose('Skipping ignored entry because source is missing', {
        relativePath,
        sourcePath,
      });
      continue;
    }

    if (existsSync(destinationPath)) {
      skipped.push(relativePath);
      logVerbose('Skipping ignored entry because destination already exists', {
        relativePath,
        destinationPath,
      });
      continue;
    }

    if (dryRun) {
      copied.push(relativePath);
      logVerbose('Dry-run would copy ignored entry', {
        relativePath,
        sourcePath,
        destinationPath,
      });
      continue;
    }

    mkdirSync(path.dirname(destinationPath), { recursive: true });
    cpSync(sourcePath, destinationPath, {
      recursive: true,
      force: false,
      preserveTimestamps: true,
    });
    copied.push(relativePath);
    logVerbose('Copied ignored entry', {
      relativePath,
      sourcePath,
      destinationPath,
    });
  }

  logInfo('Finished ignored-file bootstrap copy pass', {
    copiedCount: copied.length,
    skippedCount: skipped.length,
  });

  return { copied, skipped };
}

function buildAdditionalContext(currentRoot, donorRoot, copied, skipped) {
  const currentName = path.basename(currentRoot);
  const donorName = donorRoot ? path.basename(donorRoot) : 'none';
  const actionVerb = isDryRunEnabled() ? 'would copy' : 'copied';

  if (!donorRoot) {
    return 'Ignored-file bootstrap skipped: no donor worktree found. Set COPILOT_BOOTSTRAP_SOURCE_ROOT to force one.';
  }

  if (copied.length === 0) {
    return `Ignored-file bootstrap found no missing entries to copy into ${currentName} from ${donorName}.`;
  }

  return `Ignored-file bootstrap ${actionVerb} ${copied.length} ignored entr${copied.length === 1 ? 'y' : 'ies'} into ${currentName} from ${donorName}. Skipped ${skipped.length} existing or missing entr${skipped.length === 1 ? 'y' : 'ies'}.`;
}

function emitHookOutput(message) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: message,
      },
    })}\n`,
  );
}

async function main() {
  logInfo('Bootstrap hook started', {
    cwd: process.cwd(),
    dryRun: isDryRunEnabled(),
    verbose: isVerboseLoggingEnabled(),
  });
  await readStdin();

  try {
    const currentRoot = getCurrentRoot();
    const currentBranch = getCurrentBranch(currentRoot);
    logInfo('Resolved current repository context', {
      currentRoot,
      currentBranch,
    });
    const donorRoot = chooseDonorRoot(currentRoot, currentBranch, parseWorktreeList(currentRoot));

    if (!donorRoot) {
      logInfo('Bootstrap hook completed without donor worktree');
      emitHookOutput(buildAdditionalContext(currentRoot, donorRoot, [], []));
      return;
    }

    const ignoredEntries = listIgnoredEntries(donorRoot);
    logInfo('Resolved ignored entries from donor worktree', {
      donorRoot,
      ignoredEntryCount: ignoredEntries.length,
    });
    const { copied, skipped } = copyIgnoredEntries(donorRoot, currentRoot, ignoredEntries);

    logInfo('Bootstrap hook completed successfully', {
      donorRoot,
      copiedCount: copied.length,
      skippedCount: skipped.length,
    });
    emitHookOutput(buildAdditionalContext(currentRoot, donorRoot, copied, skipped));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown bootstrap failure';
    logInfo('Bootstrap hook failed', { message });
    emitHookOutput(`Ignored-file bootstrap failed: ${message}`);
  }
}

await main();
