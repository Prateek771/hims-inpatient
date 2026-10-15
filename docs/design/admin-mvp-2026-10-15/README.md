# Approved Admin MVP dashboard


**Current status:** the owner accepted this dashboard direction and authorized whole-MVP implementation including local PostgreSQL on15October2026. The [implementation progress](../../agent/MVP_IMPLEMENTATION_PROGRESS.md) records actual source/runtime checks. The creation record below is historical; its design-only stop was superseded.

## Historical creation and visual verification

Created **15 October 2026**, after implementation-document updates. **Awaiting owner review. No app implementation is authorized by this checkpoint.**

- [Open native editable Figma dashboard](https://www.figma.com/design/kxdaQE7WdLC5UcXrChvXVE?node-id=2-131)
- [Saved dashboard screenshot](admin-dashboard.png)
- [New design brief](brief.md), [native generation source](build-dashboard.js), [Figma node ledger](figma-state.json), [verification](verification.json)
- [Controlling scope](../../PROJECT_SCOPE.md), [future phased implementation plan](../../MVP_IMPLEMENTATION_PLAN.md), [authorized handoff](../../agent/MVP_DASHBOARD_HANDOFF.md)

One native Design file, one Admin dashboard at `2:131`, 1600 × 1320. Six hospital sections, five patient action rows and Meera's selected episode. The forest/linen/Public Sans design replaces the prior navy/teal/card-grid visual world for this proposal. The app and both protected Figma files remain unchanged. The [incumbent screenshot](incumbent-reference.png) is retained as anti-reference only.

Editable structure check: 173 dashboard descendants, 105 text layers, 10 component instances, no overflowing child bounds and no image fills. Outside the review frame: two local component sets, nine variants (seven button states, two navigation states), 31 variables including primitive aliases/spacing, six text styles. Visual inspection at 1600px found no clipped/overlapping content. One corrective pass changed the Admin action to View admissions and reconciled fictional physical-bed counts; the post-fix screenshot is final. Buttons are static design affordances; no working navigation, search, forms or clinical/financial actions are claimed.

Fictional census: 12 current episodes = 11 occupied beds + 1 vacant held bed. Total 20 beds = 11 occupied + 7 available + 1 held + 1 cleaning. Meera has ₹25,000 settled patient responsibility and ₹90,000 accepted insurer receivable with ₹0 insurer cash; final finance/papers/actual exit remain pending. These figures illustrate the approved future rules, not the current app.

The current Vercel guidelines were fetched and applied to visual labels, state clarity, type and layout. Browser semantics, keyboard interaction, actual responsive reflow, server authorization and persistence require future app checks. No application suite or database command ran. Original source-reference hashes and Git/document checks are in the verification record. No files were staged, committed or pushed. Stop here for dashboard review before other screens or application changes.


## Implemented runtime comparison — 15 October 2026

The approved world is implemented in all six routine staff workspaces. The focused five-journey Chromium MVP gate passed on the reviewed source, with real synthetic commands and protected documents. Actual Admin [desktop](runtime-qa/mvp-admin-desktop.png) and [narrow-screen](runtime-qa/mvp-admin-narrow.png) captures were visually inspected: readable forest header controls, aligned money, responsive detail and contained horizontal table scrolling. [Later insurer settlement](runtime-qa/mvp-late-insurer-settlement.png) records the retained historical episode. All pictured identities, money and configuration are synthetic test fixtures. Full local verification and ordinary migration/runtime release are tracked separately in [implementation progress](../../agent/MVP_IMPLEMENTATION_PROGRESS.md).
