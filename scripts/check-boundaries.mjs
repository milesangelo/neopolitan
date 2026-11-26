import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = path.join(rootDir, 'packages');
const violations = [];

function walkTsFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTsFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      results.push(full);
    }
  }
  return results;
}

function extractImports(content) {
  const specs = [];
  const staticRe = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const re of [staticRe, dynamicRe]) {
    for (const m of content.matchAll(re)) {
      specs.push(m[1]);
    }
  }
  return specs;
}

// 1. @neopolitan/core purity guard
for (const file of walkTsFiles(path.join(packagesDir, 'core', 'src'))) {
  const content = fs.readFileSync(file, 'utf8');
  for (const spec of extractImports(content)) {
    if (
      spec === 'node:child_process' ||
      spec === 'child_process' ||
      spec === 'node-pty' ||
      spec === 'electron' ||
      spec === 'effect' ||
      spec.startsWith('effect/') ||
      spec.startsWith('@neopolitan/')
    ) {
      violations.push(
        `@neopolitan/core boundary violation in ${path.relative(rootDir, file)}: forbidden import "${spec}"`,
      );
    }
  }
}

// 2. node-pty isolation outside adapter-pty & optional peerDependency check
for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkgName = entry.name;
  const pkgDir = path.join(packagesDir, pkgName);
  const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));

  if (pkgName !== 'adapter-pty') {
    for (const file of walkTsFiles(path.join(pkgDir, 'src'))) {
      const content = fs.readFileSync(file, 'utf8');
      for (const spec of extractImports(content)) {
        if (spec === 'node-pty') {
          violations.push(
            `node-pty must be isolated to packages/adapter-pty; found import in ${path.relative(rootDir, file)}`,
          );
        }
      }
    }
    if (pkgJson.dependencies?.['node-pty'] || pkgJson.peerDependencies?.['node-pty']) {
      violations.push(`node-pty declared in ${pkgName}/package.json`);
    }
  } else {
    if (
      !pkgJson.peerDependencies?.['node-pty'] ||
      !pkgJson.peerDependenciesMeta?.['node-pty']?.optional
    ) {
      violations.push('packages/adapter-pty must declare node-pty as an optional peerDependency');
    }
    if (pkgJson.dependencies?.['node-pty']) {
      violations.push('packages/adapter-pty must not list node-pty under direct dependencies');
    }
  }
}

// 3. @neopolitan/testing Vitest runtime isolation guard
for (const rel of ['src/index.ts', 'src/mock-adapter.ts']) {
  const file = path.join(packagesDir, 'testing', rel);
  if (fs.existsSync(file)) {
    const specs = extractImports(fs.readFileSync(file, 'utf8'));
    if (specs.some((s) => s === 'vitest' || s.startsWith('vitest/'))) {
      violations.push(
        `@neopolitan/testing runtime helper ${rel} must not import vitest (keep vitest isolated to src/conformance.ts)`,
      );
    }
  }
}

// 4. Package DAG, tsconfig parity & publish hygiene
const rootTsconfig = JSON.parse(fs.readFileSync(path.join(rootDir, 'tsconfig.json'), 'utf8'));
const rootRefs = new Set((rootTsconfig.references ?? []).map((r) => r.path));
const pkgGraph = new Map();
const nameToDir = new Map();

for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dirName = entry.name;
  const pkgPath = path.join(packagesDir, dirName, 'package.json');
  const tsconfigPath = path.join(packagesDir, dirName, 'tsconfig.json');
  const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));

  nameToDir.set(pkgJson.name, dirName);

  const expectedRef = `packages/${dirName}`;
  if (!rootRefs.has(expectedRef)) {
    violations.push(`Root tsconfig.json missing project reference "${expectedRef}"`);
  }

  // Publish hygiene
  if (!pkgJson.private) {
    if (pkgJson.publishConfig?.access !== 'public') {
      violations.push(`${pkgJson.name}: missing publishConfig.access = "public"`);
    }
    if (pkgJson.publishConfig?.provenance !== true) {
      violations.push(`${pkgJson.name}: missing publishConfig.provenance = true`);
    }
    if (pkgJson.repository?.directory !== expectedRef) {
      violations.push(`${pkgJson.name}: repository.directory must equal "${expectedRef}"`);
    }
    if (!pkgJson.engines?.node) {
      violations.push(`${pkgJson.name}: missing engines.node`);
    }
    if (!pkgJson.license) {
      violations.push(`${pkgJson.name}: missing license`);
    }
    if (!pkgJson.exports || !pkgJson.types) {
      violations.push(`${pkgJson.name}: missing exports or types`);
    }
    if (!Array.isArray(pkgJson.files) || !pkgJson.files.includes('dist')) {
      violations.push(`${pkgJson.name}: files array must include "dist"`);
    }
  }

  const allDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
  const workspaceDeps = [];
  for (const [depName, spec] of Object.entries(allDeps)) {
    if (String(spec).startsWith('file:')) {
      violations.push(`${pkgJson.name}: disallowed file: dependency "${depName}": "${spec}"`);
    }
    if (depName === 'neopolitan' || depName.startsWith('@neopolitan/')) {
      workspaceDeps.push(depName);
    }
  }
  pkgGraph.set(pkgJson.name, workspaceDeps);

  const tsRefs = new Set((tsconfig.references ?? []).map((r) => path.posix.basename(r.path)));
  for (const depName of workspaceDeps) {
    const depDir = depName === 'neopolitan' ? 'neopolitan' : depName.replace('@neopolitan/', '');
    if (!tsRefs.has(depDir)) {
      violations.push(
        `${pkgJson.name} tsconfig.json missing project reference "../${depDir}" required by package.json`,
      );
    }
  }
}

// Topological cycle detection across packages/*
const visitState = new Map(); // 0=unvisited, 1=visiting, 2=done
function visit(node, stack) {
  const state = visitState.get(node) ?? 0;
  if (state === 1) {
    violations.push(`Cycle detected in package graph: ${[...stack, node].join(' -> ')}`);
    return;
  }
  if (state === 2) return;
  visitState.set(node, 1);
  for (const dep of pkgGraph.get(node) ?? []) {
    if (pkgGraph.has(dep)) {
      visit(dep, [...stack, node]);
    }
  }
  visitState.set(node, 2);
}
for (const pkgName of pkgGraph.keys()) {
  visit(pkgName, []);
}

if (violations.length > 0) {
  console.error('Architectural boundary checks FAILED:');
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

console.log(`check-boundaries: verified ${pkgGraph.size} packages with 0 violations.`);
