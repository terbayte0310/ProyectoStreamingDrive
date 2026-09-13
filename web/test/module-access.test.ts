import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260913020000_module_access_rls.sql", import.meta.url), "utf8");

test("module migration starts existing accounts in Courses and keeps future modules separate", () => {
  assert.match(migration, /create type public\.library_module as enum \('courses', 'movies', 'series'\)/);
  assert.match(migration, /insert into public\.user_module_access[\s\S]*where profile\.is_authorized/);
  assert.match(migration, /create or replace function public\.has_module_access/);
  assert.match(migration, /create or replace function public\.get_my_module_access/);
  assert.match(migration, /returns table \(module public\.library_module\)/);
  assert.match(migration, /security definer[\s\S]*set search_path = public/);
});

test("module migration replaces broad course reads with a module check", () => {
  assert.match(migration, /drop policy if exists "Authorized users can read courses"/);
  assert.match(migration, /Course members can read courses[\s\S]*public\.has_module_access\('courses'\)/);
  assert.match(migration, /Course members can read lessons[\s\S]*public\.has_module_access\('courses'\)/);
  assert.match(migration, /Course members can read course resources[\s\S]*public\.has_module_access\('courses'\)/);
  assert.match(migration, /Course members manage their own notes[\s\S]*public\.has_module_access\('courses'\)/);
  assert.doesNotMatch(migration, /create policy "Admins manage courses"/);
});

test("module migration has an explicit rollback script", () => {
  const rollback = readFileSync(new URL("../supabase/rollbacks/20260913020000_module_access_rls.rollback.sql", import.meta.url), "utf8");
  assert.match(rollback, /drop table public\.user_module_access/);
  assert.match(rollback, /drop type public\.library_module/);
  assert.match(rollback, /Authorized users can read courses/);
});
