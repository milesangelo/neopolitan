import path from 'node:path';
import type { ExecutionRuntime } from '@neopolitan/core';

export const MAX_ACP_CHANGED_PATHS = 256;

/**
 * Fail-closed workspace boundary guard (ported from `t3code: packages/provider-acp/src/server/clientPolicy.ts`).
 * Rejects `~`, URL schemes, NUL bytes, Windows drive-letter escapes on POSIX, and paths escaping `workspaceRoot`.
 */
export async function assertPathWithinWorkspace(
  runtime: ExecutionRuntime,
  workspaceRoot: string,
  candidatePath: string,
): Promise<string> {
  if (!candidatePath || candidatePath.includes('\0')) {
    throw new Error('Invalid ACP path: empty or contains NUL byte');
  }
  if (candidatePath.startsWith('~') || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidatePath)) {
    throw new Error(`ACP path "${candidatePath}" uses disallowed tilde or URI scheme`);
  }
  if (runtime.platform !== 'win32' && /^[A-Za-z]:[\\/]/.test(candidatePath)) {
    throw new Error(`ACP path "${candidatePath}" contains Windows drive letter on POSIX`);
  }
  if (runtime.platform !== 'win32' && candidatePath.includes('\\')) {
    throw new Error(`ACP path "${candidatePath}" contains backslash on POSIX`);
  }

  const resolvedRoot = await runtime.realpath(workspaceRoot);
  const absCandidate = path.isAbsolute(candidatePath)
    ? candidatePath
    : path.resolve(resolvedRoot, candidatePath);

  let resolvedTarget: string;
  try {
    resolvedTarget = await runtime.realpath(absCandidate);
  } catch {
    // Walk up to nearest existing ancestor so new files inside workspace succeed
    let current = path.dirname(absCandidate);
    const tail: string[] = [path.basename(absCandidate)];
    while (current !== path.dirname(current)) {
      try {
        const realAncestor = await runtime.realpath(current);
        resolvedTarget = path.join(realAncestor, ...tail.reverse());
        break;
      } catch {
        tail.push(path.basename(current));
        current = path.dirname(current);
      }
    }
    resolvedTarget ??= absCandidate;
  }

  const rel = path.relative(resolvedRoot, resolvedTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`ACP path "${candidatePath}" escapes workspace root "${resolvedRoot}"`);
  }
  return resolvedTarget;
}
