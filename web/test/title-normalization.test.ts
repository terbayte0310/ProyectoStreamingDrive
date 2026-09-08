import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDetectedTitle } from "../src/lib/drive/title-normalization.ts";

test("strips file extension and leading numeric prefix from lesson names", () => {
  assert.equal(normalizeDetectedTitle("01 - Introducción.mp4", false), "Introducción");
  assert.equal(normalizeDetectedTitle("001.Bienvenida.mp4", false), "Bienvenida");
});

test("replaces underscores and hyphens with spaces", () => {
  assert.equal(normalizeDetectedTitle("03_Variables_y_tipos.mp4", false), "Variables y tipos");
  assert.equal(normalizeDetectedTitle("guia-rapida-de-hooks.mp4", false), "guia rapida de hooks");
});

test("does not mangle titles that merely start with a digit", () => {
  assert.equal(normalizeDetectedTitle("3D Animation", true), "3D Animation");
  assert.equal(normalizeDetectedTitle("3D Animation.mp4", false), "3D Animation");
});

test("leaves folder names without a pure numeric-separator prefix untouched", () => {
  assert.equal(normalizeDetectedTitle("Módulo 1 - Fundamentos", true), "Módulo 1 - Fundamentos");
});

test("preserves acronyms and casing", () => {
  assert.equal(normalizeDetectedTitle("AWS", true), "AWS");
  assert.equal(normalizeDetectedTitle("02 - API Gateway.mp4", false), "API Gateway");
});

test("collapses extra whitespace left after normalization", () => {
  assert.equal(normalizeDetectedTitle("01  -  Doble   espacio.mp4", false), "Doble espacio");
});

test("falls back to the raw name when normalization would empty the title", () => {
  assert.equal(normalizeDetectedTitle("01 - .mp4", false), "01 - .mp4");
});

test("does not touch names without a real extension", () => {
  assert.equal(normalizeDetectedTitle("Versión 2.0", true), "Versión 2.0");
});
