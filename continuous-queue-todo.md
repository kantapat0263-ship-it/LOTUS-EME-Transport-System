# Continuous queue feature

- [x] `how` over the affected subsystem.
- [x] `architect` for parallel design exploration. Project override: Lead chose materialized daily trips plus a preserved range master; independent investigator checked the integration.
- [x] Write the throughput checkpoint as four todo items.
  - Blocking first steps. Read team/module rules; isolate from the stop-note branch; settle the contract and security boundary.
  - Independent workstreams. Domain/API/rules and frontend can use separate worktrees. Final review is independent.
  - Shared mutable state. One owner for schemas, transactions and guard semantics. All allocations touch resource/date guard documents.
  - Smallest safe decomposition. Reuse ordinary daily Trip documents so existing GPS, driver links and date queries still work. No new menu.
- [x] Integrate isolated frontend and server writers; Lead owns shared contracts, allocation guards and rules.
- [x] Verify the feature on local demo emulators and desktop/mobile browser surfaces. Source tests 462/462, queue tests 50/50 and existing rules tests 27/27 passed before integration with the latest main.
- [x] Obtain an independent read-only review of the integrated feature diff.
- [x] Preserve and integrate main b2a21a1 (notes, route modes and GPS end time), add ended-use regression coverage, and rerun checks. Source 488/488; queue 54/54; rules 27/27; TypeScript and final build passed. Final independent integration review found no outstanding defects; reviewed source hashes match the release files. Latest desktop/mobile browser checks passed.
- [x] Deploy application e68709a and matching Firestore rules after verification. User authorized DEPLOY on 2026-10-06. Production build ID matches; public pages200; unauthenticated queue GET401; live rules hash matches source.
- [ ] Repair pre-existing CI dependency installation mismatch and verify the next GitHub run. No application-source or runtime-package changes are part of this repair.
- [x] Skip an unrequested PR, design panel and unrelated cleanup under project overrides.

## Acceptance

- Existing dispatcher screen can set a range; RequestForm shows a notice under the date without blocking submission.
- Borrowing affects one day, preserves range and IDs, audits actor/time/reason, keeps unused original resources reserved, and avoids duplicate report credit.
- Explicit return is available before declared work starts. It cancels the target allocation and restores the original day.
- Compensation is optional and has owed/scheduled/completed states. A future date or default report outcome cannot complete it.
- Concurrent creation and ordinary assignment serialize through the same resource/date guards. Managed links cannot be cleared, revived, edited or deleted via ordinary UI writes.
- Test against demo emulators only. No production data, LINE, deployment, push or paid action.
