import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Express } from "express";
import { isSamePath, isWithin } from "../infra/path-within.js";
import { expandTilde } from "./pathContainment.js";

export interface DirectoryPickerEntry {
  name: string;
  path: string;
}

export interface DirectoryListing {
  path: string;
  parent: string | null;
  directories: DirectoryPickerEntry[];
}

function existingDirectoryRealpath(dir: string): string | null {
  try {
    if (!fs.statSync(dir).isDirectory()) return null;
    return fs.realpathSync.native(dir);
  } catch {
    return null;
  }
}

function uniqueRoots(roots: string[]): string[] {
  const out: string[] = [];
  for (const root of roots) {
    if (!out.some((known) => isSamePath(known, root))) out.push(root);
  }
  return out;
}

function pickerRoots(defaultCwd: string, homeDir: string): string[] {
  return uniqueRoots([existingDirectoryRealpath(homeDir), existingDirectoryRealpath(defaultCwd)].filter((root): root is string => root !== null));
}

function resolveRequestedPath(requested: string | null, fallback: string, homeDir: string): string {
  const raw = requested?.trim();
  if (!raw) return fallback;
  const expanded = expandTilde(raw, homeDir);
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(homeDir, expanded);
}

function rootContaining(realPath: string, roots: string[]): string | null {
  return roots.find((root) => isWithin(root, realPath)) ?? null;
}

function safeDirectoryPath(abs: string, roots: string[]): { real: string; root: string } | null {
  const real = existingDirectoryRealpath(abs);
  if (!real) return null;
  const root = rootContaining(real, roots);
  return root ? { real, root } : null;
}

function parentWithinRoot(realPath: string, root: string): string | null {
  if (isSamePath(realPath, root)) return null;
  const parent = path.dirname(realPath);
  return isWithin(root, parent) ? parent : null;
}

export function listDirectories(absDir: string): DirectoryPickerEntry[] {
  return fs
    .readdirSync(absDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, path: path.join(absDir, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function directoryListing(defaultCwd: string, requested: string | null, homeDir = os.homedir()): DirectoryListing | null {
  const roots = pickerRoots(defaultCwd, homeDir);
  if (roots.length === 0) return null;
  const firstRoot = roots[0];
  if (!firstRoot) return null;
  const fallback = rootContaining(path.resolve(defaultCwd), roots) ? defaultCwd : firstRoot;
  const resolved = resolveRequestedPath(requested, fallback, homeDir);
  const safe = safeDirectoryPath(resolved, roots);
  if (!safe) return null;
  return {
    path: safe.real,
    parent: parentWithinRoot(safe.real, safe.root),
    directories: listDirectories(safe.real),
  };
}

export function mountDirectoryPickerRoutes(app: Express, deps: { defaultCwd: string }): void {
  app.get("/api/directories", (req, res) => {
    const requested = typeof req.query.path === "string" ? req.query.path : null;
    try {
      const listing = directoryListing(deps.defaultCwd, requested);
      if (!listing) return res.status(403).json({ error: "directory is outside the browsable roots" });
      res.json(listing);
    } catch {
      res.status(500).json({ error: "failed to list directories" });
    }
  });
}
