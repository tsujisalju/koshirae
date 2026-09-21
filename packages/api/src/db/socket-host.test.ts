import { test } from "node:test";
import assert from "node:assert/strict";
import { socketHostFromUrl } from "./socket-host";

test("unix socket form is decoded", () => {
  assert.equal(
    socketHostFromUrl("postgres://tsujisalju@%2Fvar%2Frun%2Fpostgresql/koshirae"),
    "/var/run/postgresql",
  );
  assert.equal(
    socketHostFromUrl("postgresql://u:p@%2fvar%2frun%2fpostgresql/db?sslmode=disable"),
    "/var/run/postgresql",
  );
});

test("TCP urls pass through untouched", () => {
  for (const u of [
    "postgres://u:p@db.example.com:5432/app?sslmode=require",
    "postgres://u:p%2Fw%40rd@db.example.com/app",
    "postgres://u:p@[::1]:5432/app",
    "postgres://u:p@h1:5432,h2:5432/app",
    "postgres://u@localhost/app?host=%2Fvar%2Frun",
  ])
    assert.equal(socketHostFromUrl(u), undefined, u);
});
