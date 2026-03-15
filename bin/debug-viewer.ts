#!/usr/bin/env node

/**
 * CLI tool for analyzing uplink debug log exports.
 *
 * Usage:
 *   npx tsx bin/debug-viewer.ts <file.json> [command]
 *
 * Commands:
 *   (none)           Summary overview
 *   events           Full event timeline
 *   conn             Connection events only
 *   proto            Protocol events only
 *   ui               UI state events only
 *   server           Server events only
 *   timeline         Merged client+server timeline
 *   around <ms>      Events +/-5s around a wall-clock timestamp (ms)
 */

import { readFileSync } from 'node:fs';
import type { DebugLogExport, DebugEntry } from '../src/shared/debug-log.js';

// ─── Colors ───────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

const catColors: Record<string, string> = {
  conn: c.cyan,
  proto: c.yellow,
  ui: c.green,
};

// ─── Helpers ──────────────────────────────────────────────────────────

function formatTime(wall: number, baseWall: number): string {
  const rel = wall - baseWall;
  const sign = rel >= 0 ? '+' : '';
  const sec = (rel / 1000).toFixed(3);
  return `${sign}${sec}s`;
}

function formatEntry(entry: DebugEntry, baseWall: number, source: string): string {
  const time = formatTime(entry.wall, baseWall);
  const color = catColors[entry.cat] ?? c.reset;
  const src = source === 'server' ? `${c.magenta}S${c.reset}` : `${c.blue}C${c.reset}`;
  const data = entry.data ? ` ${c.dim}${JSON.stringify(entry.data)}${c.reset}` : '';
  return `${c.dim}${time.padStart(12)}${c.reset} ${src} ${color}${entry.cat.padEnd(5)}${c.reset} ${entry.evt}${data}`;
}

// ─── Commands ─────────────────────────────────────────────────────────

function showSummary(data: DebugLogExport): void {
  console.log(`${c.bold}Uplink Debug Log${c.reset}`);
  console.log(`  Exported:    ${data.exportedAt}`);
  console.log(`  Session:     ${data.sessionId ?? '(none)'}`);
  console.log(`  User Agent:  ${data.userAgent}`);
  console.log(`  Uptime:      ${(data.uptime / 1000).toFixed(1)}s`);
  console.log();

  const snap = data.client.snapshot;
  console.log(`${c.bold}Client Snapshot${c.reset}`);
  console.log(`  Connection:  ${snap.connectionState ?? 'unknown'}`);
  console.log(`  Messages:    ${snap.messageCount ?? 0}`);
  console.log(`  Tool calls:  ${snap.toolCallCount ?? 0}`);
  console.log(`  Timeline:    ${snap.timelineLength ?? 0}`);
  console.log(`  Permissions: ${snap.pendingPermissions ?? 0}`);
  if (snap.localStorage) {
    console.log(`  Storage keys: ${Object.keys(snap.localStorage).join(', ')}`);
  }
  console.log();

  console.log(`${c.bold}Entry Counts${c.reset}`);
  const clientEntries = data.client.entries;
  const serverEntries = data.server.entries;
  const clientConn = clientEntries.filter(e => e.cat === 'conn').length;
  const clientProto = clientEntries.filter(e => e.cat === 'proto').length;
  const clientUi = clientEntries.filter(e => e.cat === 'ui').length;
  console.log(`  Client:  ${clientEntries.length} total (conn: ${clientConn}, proto: ${clientProto}, ui: ${clientUi})`);
  console.log(`  Server:  ${serverEntries.length} total`);
  console.log();

  // Show state transitions
  const stateChanges = clientEntries.filter(e => e.evt === 'state_change');
  if (stateChanges.length > 0) {
    console.log(`${c.bold}State Transitions${c.reset}`);
    for (const e of stateChanges) {
      const d = e.data as { from?: string; to?: string } | undefined;
      console.log(`  ${c.dim}${new Date(e.wall).toISOString()}${c.reset}  ${d?.from} -> ${d?.to}`);
    }
  }
}

function showEvents(entries: DebugEntry[], baseWall: number, source: string): void {
  for (const entry of entries) {
    console.log(formatEntry(entry, baseWall, source));
  }
  console.log(`${c.dim}(${entries.length} entries)${c.reset}`);
}

function showTimeline(data: DebugLogExport): void {
  const clientEntries = data.client.entries.map(e => ({ ...e, _source: 'client' as const }));
  const serverEntries = data.server.entries.map(e => ({ ...e, _source: 'server' as const }));
  const merged = [...clientEntries, ...serverEntries].sort((a, b) => a.wall - b.wall);
  const baseWall = merged[0]?.wall ?? 0;

  for (const entry of merged) {
    console.log(formatEntry(entry, baseWall, entry._source));
  }
  console.log(`${c.dim}(${merged.length} entries)${c.reset}`);
}

function showAround(data: DebugLogExport, targetMs: number, windowMs = 5000): void {
  const allEntries = [
    ...data.client.entries.map(e => ({ ...e, _source: 'client' as const })),
    ...data.server.entries.map(e => ({ ...e, _source: 'server' as const })),
  ].sort((a, b) => a.wall - b.wall);

  const filtered = allEntries.filter(
    e => Math.abs(e.wall - targetMs) <= windowMs,
  );

  if (filtered.length === 0) {
    console.log(`No events within ${windowMs / 1000}s of timestamp ${targetMs}`);
    return;
  }

  console.log(`${c.bold}Events around ${new Date(targetMs).toISOString()} (+/-${windowMs / 1000}s)${c.reset}`);
  const baseWall = targetMs - windowMs;
  for (const entry of filtered) {
    console.log(formatEntry(entry, targetMs, entry._source));
  }
  console.log(`${c.dim}(${filtered.length} entries)${c.reset}`);
}

// ─── Main ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const file = args[0];
const command = args[1];

if (!file) {
  console.log('Usage: npx tsx bin/debug-viewer.ts <file.json> [command]');
  console.log();
  console.log('Commands:');
  console.log('  (none)           Summary overview');
  console.log('  events           Full client event timeline');
  console.log('  conn             Connection events only');
  console.log('  proto            Protocol events only');
  console.log('  ui               UI state events only');
  console.log('  server           Server events only');
  console.log('  timeline         Merged client+server timeline');
  console.log('  around <ms>      Events +/-5s around a wall-clock timestamp');
  process.exit(0);
}

let data: DebugLogExport;
try {
  data = JSON.parse(readFileSync(file, 'utf-8'));
} catch (err) {
  console.error(`Failed to read ${file}: ${err}`);
  process.exit(1);
}

if (data.version !== 1) {
  console.error(`Unsupported debug log version: ${data.version}`);
  process.exit(1);
}

const baseWall = data.client.entries[0]?.wall ?? data.server.entries[0]?.wall ?? 0;

switch (command) {
  case undefined:
  case 'summary':
    showSummary(data);
    break;
  case 'events':
    showEvents(data.client.entries, baseWall, 'client');
    break;
  case 'conn':
    showEvents(data.client.entries.filter(e => e.cat === 'conn'), baseWall, 'client');
    break;
  case 'proto':
    showEvents(data.client.entries.filter(e => e.cat === 'proto'), baseWall, 'client');
    break;
  case 'ui':
    showEvents(data.client.entries.filter(e => e.cat === 'ui'), baseWall, 'client');
    break;
  case 'server':
    showEvents(data.server.entries, baseWall, 'server');
    break;
  case 'timeline':
    showTimeline(data);
    break;
  case 'around': {
    const ts = Number(args[2]);
    if (Number.isNaN(ts)) {
      console.error('Usage: around <wall-clock-timestamp-ms>');
      process.exit(1);
    }
    showAround(data, ts);
    break;
  }
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
