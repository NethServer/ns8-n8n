---
name: ns8-n8n-tests
description: Qualify an NS8 n8n installation or in-place upgrade through Cluster Admin, the n8n editor, and authenticated webhook executions.
---

Run these checks on a dedicated test instance. Use the instance ID returned by NS8 and reserve its hostname before the first setup. Keep the baseline instance, hostname and fixture file through the upgrade.

Use Node.js and the Playwright package with its matching Chromium browser on the machine running the checks. An installed Chrome can be selected with `QA_CHROME_CHANNEL=chrome`. With Robot Framework Browser, use the supplied `check.resource` keyword or include the wrapper's `node_modules` in `NODE_PATH`.

Set these environment variables on the test machine:

| Variable | Value |
|---|---|
| `NODE_ADDR`, `MODULE_ID`, `APP_HOST` | Cluster Admin host, module instance ID, dedicated n8n hostname |
| `ADMIN_USER`, `ADMIN_PASSWORD` | English-language Cluster Admin login from the runtime credential source |
| `FIXTURE_STATE` | Durable private file path in an existing private directory outside test outputs |
| `QA_NODE_IP` | Node IP for Chromium's app hostname mapping when `NODE_ADDR` is a DNS name |
| `QA_REQUEST_CERT` | Set to `1` to request and verify a Let’s Encrypt certificate for the dedicated hostname |
| `QA_IGNORE_TLS` | Set to `1` for a test cluster using a self-signed certificate |
| `QA_SCREENSHOT_DIR` | Optional directory for a screenshot of the NS8 Status page |

1. Run `node check.cjs seed` from this skill directory. It applies the dedicated hostname, forced HTTPS and UTC, creates a disposable n8n owner, imports and saves workflows in the editor, creates a header credential, and publishes the webhook. The fixture file saves the generated secrets and baseline IDs with owner-only permissions. Rerun with the same file to resume a partial seed.
2. Confirm the module's reported configuration and status. In its rootless context check the n8n pod and three containers, the PostgreSQL readiness probe, and the journal for unexpected startup or runner errors. Save a recoverable NS8 backup including the database and the n8n data volume.
3. Restart or update the same module. Run `node check.cjs verify` using the same inputs and original fixture file. For release qualification run the copy from the installed image. It signs into the original account, checks configuration and original execution IDs, opens both saved workflows, and runs new successful and deliberately failing executions. The webhook must reject the invalid credential and return the exact JavaScript and Python results with the saved credential.
4. Report the exit status, module image digest, original and fresh execution IDs, and any failed check. The expected failed workflow produces an error in n8n's execution history. Keep the private fixture file outside evidence bundles.

For a subsequent independent installation use a new hostname and fixture file. The checks leave the workflow, account and credential on the test instance for upgrade verification.
