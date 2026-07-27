import type { Express } from "express";

// Keep stack traces out of HTTP responses, whatever the environment says.
//
// Express reads `process.env.NODE_ENV` once, into its `env` setting, and hands that setting to
// finalhandler — which puts the thrown error's stack in the response body for any value other
// than "production". The launcher used to guarantee that value by exporting NODE_ENV=production
// for the server process, but the server passes its own environment to every PTY it spawns, so
// that guarantee arrived in every user terminal and made yarn v1 skip devDependencies (#955).
//
// Setting it on the app instead makes the two independent: a `yarn dev` run hides stacks too
// (it did not before), and nothing about how the server was started can put one in a response.
export function hideErrorStacks(app: Express): void {
  app.set("env", "production");
}
