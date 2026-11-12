# Diet Commitment Platform: Product and Build Plan

Working title: **DietCommit** (placeholder; rename freely).
Status: plan only, no code written yet. Date: 2026-11-12.

This document is the single source of truth for a coding model. Build it phase by phase (section 14). Every rule about money is in sections 4 to 6; do not invent money behaviour that is not written there.

---

## 1. Concept in one paragraph

A user pays a lump sum up front. A fixed part is a non-refundable **processing fee**; the rest is a **commitment deposit**. The user enters or uploads their own diet plan and commits to it for a fixed period. At every meal time they get a reminder and must report within 2 hours whether they followed the plan. Each missed or unreported meal permanently deducts a fixed amount from the deposit. At the end, whatever is left of the deposit is refunded to them. Follow everything and the full deposit comes back.

The product is **not** a diet provider. It does not create diets. It is an accountability layer on top of a plan the user brings.

Vocabulary to use everywhere in UI and code: "commitment deposit", "deduction", "refund". Never use "bet", "stake", "win", "prize", "wager", "jackpot" (see section 11 for why).

---

## 2. Market check (searched November 2026)

| Product | Where | How it works | Difference from us |
|---|---|---|---|
| StickK | Global (2008) | Commitment contract; forfeits go to a person, charity, anti-charity or StickK | Generic goals, honour or referee based, no meal schedule |
| Beeminder | Global | Tracks a numeric goal; charges your card only when you go off track | No upfront deposit; data-nerd product, not meal-level |
| Forfeit | iOS (released March 2026) | Habit contracts with money and proof (photo/timelapse) | Generic habits, not diet-plan-aware, not India-focused |
| HealthyWage, DietBet-style | US | Bet on weight loss, winners paid from a pool | Pool/winnings model, which is the risky model in India |
| NoBacksies | Indie project (India-linked listing) | Refundable deposit, daily check-in for 14/30/60 days, forfeits go to charity | Closest idea; generic habit, single daily check-in, could not confirm it is live |
| FITPASS "Thoda Fit Thoda Rich" | India (Sept 2026) | Pays rewards for gym streaks and healthy eating | Reward model, no user deposit |
| HealthifyMe | India | Calorie tracking, AI and human coaches, subscription | No money-at-risk mechanic |

Conclusion: the commitment-deposit mechanic is proven abroad, but no established product was found in India that ties a deposit to a **per-meal, plan-specific, time-windowed** check-in. That is the gap.

Sources:
- https://blog.beeminder.com/competitors
- https://help.beeminder.com/article/49-why-should-i-use-beeminder-over-stickk
- https://habi.app/insights/accountability-apps/
- https://appgoblin.info/apps/6760597781
- https://peerlist.io/sahanshah/project/nobacksies--commit-for-real
- https://www.medianews4u.com/fitpass-launches-thoda-fit-thoda-rich-turning-gym-streaks-into-real-income/
- https://dollarsprout.com/get-paid-to-lose-weight/

---

## 3. Tiers

All numbers live in the `plans` database table and are editable from the admin panel. Nothing below is hard-coded.

| | **Lite** | **Plus** | **Pro** | **Coach** (phase 2) |
|---|---|---|---|---|
| User pays | Rs 3,000 | Rs 6,000 | Rs 10,000 | Rs 15,000 |
| Processing fee (kept) | Rs 400 | Rs 700 | Rs 1,000 | Rs 2,500 |
| Commitment deposit (refundable) | Rs 2,600 | Rs 5,300 | Rs 9,000 | Rs 12,500 |
| Proof of meal | Tap to report | Photo required | Photo required | Photo required |
| Checking | None (honour) | AI checks about 1 in 3 photos at random, plus duplicate-photo detection | AI checks every photo | AI on every photo plus weekly human dietitian review |
| Reminders | Web push, email | Web push, email, WhatsApp | Web push, email, WhatsApp | Same, plus SMS fallback |
| Grace passes per 30 days | 2 | 2 | 3 | 3 |
| Diet plan upload with AI extraction | Yes | Yes | Yes | Yes, plus dietitian sign-off |
| Dispute handling | Standard (72 h) | Standard (72 h) | Priority (24 h) | Priority (24 h) |

Why tiered this way (cost reasoning):
- **Lite** costs almost nothing to run: no AI, no WhatsApp. The fee is nearly all margin after gateway charges.
- **AI photo checks are cheap** (a small vision model, one image per meal). The expensive items are WhatsApp messages (up to 3 per meal) and human review. So Plus samples photos and Pro checks all; humans appear only in Coach and in disputes.
- **The fee must always exceed gateway cost on the full amount paid.** The gateway charges its percentage on the whole payment (deposit included) even when the user gets a full refund. Rule for any new tier: `fee > (gateway % x total paid) + GST on fee + per-user AI cost + per-user messaging cost`. Verify current gateway and WhatsApp rates before fixing prices.

Options the user picks at purchase, on any tier:
- Duration: 30 days in v1. (14, 60, 90 days are config rows to enable later.)
- Meals per day: 2 to 6 (default 3). These are the meal slots in their diet plan.
- Start date: earliest is tomorrow; latest is 7 days out.

---

## 4. Money rules (exact)

All money is stored as integer **paise**. All timestamps are stored in UTC; the user's time zone (default `Asia/Kolkata`) is stored on the profile and used for display and scheduling.

### 4.1 Definitions

```
total_paid        = amount charged at checkout
fee               = plan.fee                      (non-refundable once the plan starts)
deposit           = total_paid - fee
total_meals       = duration_days x meals_per_day
base_meal_value   = floor(deposit / total_meals)
penalty_per_miss  = base_meal_value x plan.penalty_multiplier   (default multiplier = 2)
```

`penalty_per_miss` is calculated once at purchase and frozen on the commitment row. It never changes mid-plan.

### 4.2 Worked example (Pro, 30 days, 3 meals/day)

```
total_paid = 10,000   fee = 1,000   deposit = 9,000
total_meals = 90      base_meal_value = 100     penalty_per_miss = 200
```

| Outcome | Deductions | Refund |
|---|---|---|
| All 90 meals followed | 0 | Rs 9,000 |
| 5 misses | 5 x 200 = 1,000 | Rs 8,000 |
| 20 misses | 4,000 | Rs 5,000 |
| 45 or more misses | capped at 9,000 | Rs 0 |

### 4.3 Deduction rules

1. A meal counts as a **miss** when (a) the user reports "skipped" or "did not follow", or (b) no report exists when the window closes, or (c) a photo check is finally ruled a mismatch by a human (section 7).
2. Each miss deducts `min(penalty_per_miss, remaining_deposit)`. The deposit can never go below zero. The user can never owe money.
3. A meal covered by a **grace pass** or marked **excused** deducts nothing.
4. Refund at the end = `deposit - sum(deductions) + sum(deduction reversals)`. The user can never receive more than their deposit. There is no bonus, interest, pool, or reward funded by other users.
5. Deductions are created **only by server code** (scheduler or admin action). The browser can never write a deduction or change a balance.
6. Every money movement is an append-only row in `ledger_entries`. Rows are never updated or deleted; corrections are new reversing rows.

### 4.4 Open decision on the multiplier

The owner's example (Rs 200 per miss on a Rs 9,000 / 90-meal plan) implies multiplier 2, which is the default here. With multiplier 2 the whole deposit is gone after missing half the meals. Multiplier 1 means every meal is worth exactly its share. Keep it a per-plan config value.

---

## 5. Meal lifecycle and the 2-hour window

### 5.1 Schedule generation

When a commitment becomes ACTIVE-scheduled (payment confirmed), generate one `meal_events` row per meal for the whole duration:

```
scheduled_at     = the meal slot's local time on that date, converted to UTC
window_opens_at  = scheduled_at - 30 minutes
window_closes_at = scheduled_at + 120 minutes
```

Meal slot times must be at least 2 h 30 min apart so windows never overlap.

### 5.2 Meal event states

```
UPCOMING -> OPEN -> FOLLOWED                (self-report, or photo accepted)
                 -> UNDER_REVIEW -> FOLLOWED | MISSED_REVIEWED
                 -> MISSED_REPORTED         (user said skipped / did not follow)
                 -> MISSED_NO_REPORT        (window closed with no report)
                 -> GRACE                   (grace pass applied)
                 -> EXCUSED                 (admin, pause, or platform outage)
MISSED_* -> DISPUTED -> MISSED_* (upheld) | EXCUSED (reversed)
```

### 5.3 Reporting rules

- The report button is enabled only between `window_opens_at` and `window_closes_at`. **Server time decides**, never the phone clock.
- Report choices: "Followed the plan", "Did not follow / skipped". Optional short note.
- The user may change their answer until the window closes. After that it is final (dispute is the only route).
- Photo tiers: the report is timestamped when the user taps submit. If the photo upload is slow, the upload may finish up to 10 minutes after the window closes, as long as the submit request arrived in time.
- A grace pass can be applied to a meal any time before its window closes, or up to 12 hours after (covers "I was in hospital / on a flight"). Passes do not carry over.

### 5.4 Reminders (per meal)

| When | Message |
|---|---|
| `scheduled_at` | "Time for lunch: <meal description>. Report by 3:00 PM." |
| +60 min, if no report | "1 hour left to report lunch." |
| +105 min, if no report | "15 minutes left. Rs 200 will be deducted if you don't report." |
| On window close with a miss | "Lunch was not reported. Rs 200 deducted. Balance Rs 8,800." |

Channels by tier (section 3). Every send is logged in `notifications` with an idempotency key `meal_event_id + reminder_type + channel` so retries never double-send. Terms must state that the schedule is always visible in the app and that reminders are a convenience; a missed notification is not by itself grounds for reversal (but see outage rule below).

### 5.5 Fairness rules (important because the company keeps deductions)

- **Outage protection:** if the platform was unavailable for any part of a meal's window, admin runs "excuse range" and those meals become EXCUSED automatically. Log outages in `outages`.
- **AI never deducts on its own.** A model verdict can only send a meal to review; only a human ruling creates a photo-based deduction (section 7).
- **Disputes:** any miss can be disputed within 48 hours with a note and optional evidence. Settlement waits until all disputes close.
- **Full transparency:** the user sees a live ledger of every deduction with meal, time and reason.

---

## 6. Commitment lifecycle

```
DRAFT -> PENDING_PAYMENT -> SCHEDULED -> ACTIVE -> COMPLETED -> SETTLING -> SETTLED
                         -> CANCELLED_BEFORE_START
                                        ACTIVE -> PAUSED -> ACTIVE
                                        ACTIVE -> EXIT_NOTICE -> EXITED -> SETTLING -> SETTLED
```

| Event | Rule |
|---|---|
| Cancel before start date | Deposit refunded in full. Fee refunded minus actual gateway charges (open decision). |
| Diet plan edits after start | Plan is locked. An edit request takes effect 48 hours later, maximum 2 edits per 30 days. Prevents editing the plan to match what was already eaten. |
| Voluntary exit | Allowed with **7 days' notice**. Meals during the notice period count normally. Meals after the exit date are cancelled and their share of the deposit is untouched. Without this delay, quitting would be a free escape from every penalty. |
| Medical exit | User uploads a doctor's note; admin approves; exit is immediate, remaining deposit refunded. |
| Pause | Once per commitment, up to 5 days, requested at least 24 hours ahead. The end date moves out by the paused days. Emergency pause (no notice) needs admin approval. |
| Completion | After the last meal window closes, status COMPLETED. Wait 48 hours for disputes, then settle. |
| Settlement | Compute refund from the ledger, create the refund, write the `REFUND_OUT` ledger row, notify the user with a statement. Target: initiated within 3 working days of completion. |
| One active commitment per user | v1 allows only one ACTIVE or SCHEDULED commitment at a time. |

---

## 7. Verification by tier

### 7.1 Lite: honour reporting
Tap only. Deductions come from honest "skipped" reports and from missed windows.

### 7.2 Plus and Pro: photo
- Capture **inside the app with the live camera** (`getUserMedia`), not from the gallery. Server stamps the time.
- Compute a perceptual hash of each photo; reject a photo that near-matches any earlier photo from the same user ("this looks like a photo you already used").
- Photos go to a private storage bucket, readable only by the owner and admins, deleted 90 days after settlement.

### 7.3 AI check (Plus: random ~33% of photos; Pro: all)

Server-side call to a vision model. Input: the planned meal (items and quantities as text) and the photo. Required JSON output:

```json
{
  "verdict": "MATCH | PARTIAL | MISMATCH | NOT_FOOD | UNCLEAR",
  "confidence": 0.0,
  "detected_items": ["..."],
  "reason": "one sentence shown to the user"
}
```

| Verdict | Action |
|---|---|
| MATCH, PARTIAL | Meal becomes FOLLOWED. |
| UNCLEAR | Meal becomes FOLLOWED (benefit of the doubt); logged for quality stats. |
| MISMATCH or NOT_FOOD, first time for this meal | Ask the user to retake or add a note, if the window is still open. |
| MISMATCH or NOT_FOOD after retake, or window closed | Meal becomes UNDER_REVIEW. No deduction yet. Admin rules within the tier's SLA. If admin does not rule in time, it auto-resolves to FOLLOWED. |

State the limits honestly in the product: a photo proves a matching meal was in front of the user, not that they ate it or the exact quantity. It is a deterrent, not proof.

### 7.4 Diet plan intake (all tiers)

Two routes:
1. **Manual builder:** for each meal slot: name, time, description, items, and which days of the week it applies to (same every day, or a 7-day rotation).
2. **Upload** (PDF, image, or pasted text from a dietitian): an AI call extracts the same structure. The user must review and confirm every slot before it is saved. The upload is kept as the reference copy.

Safety checks at intake (section 12) run before the plan can be locked.

---

## 8. Recommended architecture

The repo currently holds an unrelated AI Studio starter ("Photo to Cartoon Converter", Vite + React 19 + TypeScript, Gemini key injected into the client bundle through `vite.config.ts`). Keep the toolchain, replace the app code, and **remove the client-side API key injection**: no secret may ever ship in the browser bundle.

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vite + React 19 + TypeScript (existing), React Router, Tailwind CSS, TanStack Query, `vite-plugin-pwa` | Already in repo; PWA gives install-to-home-screen and web push |
| Backend | Supabase: Postgres, Auth, Storage, Edge Functions, `pg_cron` | One managed service, relational DB suits a ledger, row-level security, built-in cron, little ops work |
| Auth | Google sign-in and email OTP in v1; phone number collected and verified for WhatsApp | Avoids SMS OTP cost at launch |
| Payments | Razorpay Standard Checkout (test mode first); refunds as **partial refund to the original payment** | No bank details needed, cleanest "refund" trail |
| AI | Anthropic API, small vision-capable model, default `claude-haiku-5-5`, set via `AI_MODEL` env var, called only from Edge Functions | Low cost per image; swappable |
| Push | Web Push (VAPID) through the service worker | Free. On iPhone it works only after the user adds the PWA to the home screen; onboarding must walk them through it |
| WhatsApp | WhatsApp Business Cloud API (or a BSP), approved utility templates, explicit opt-in | Most reliable reminder channel in India; behind a feature flag |
| Email | Resend or Amazon SES | Fallback and statements |
| Hosting | Any static host for the frontend (Vercel, Netlify, Firebase Hosting) | Open decision |

Payment-method restriction: enable UPI, cards and netbanking only. Disable EMI and pay-later, because those support only full refunds, not partial ones. Refunds normally take 5 to 10 working days to reach the user; say so in the UI. Build payouts behind a `RefundProvider` interface so a bank/UPI payout provider can be added as a fallback if a refund to source fails.

### 8.1 Server functions (Edge Functions)

| Function | Does |
|---|---|
| `create-order` | Validates draft commitment, creates gateway order, sets PENDING_PAYMENT |
| `payment-webhook` | Verifies signature, idempotent on payment id, writes ledger rows, generates meal events, sets SCHEDULED |
| `extract-diet-plan` | AI extraction of an uploaded plan into structured slots |
| `submit-meal-report` | Validates window by server time, saves report, triggers AI check where the tier requires |
| `verify-meal-photo` | AI verdict and state change per section 7.3 |
| `scheduler-tick` | Runs every minute from `pg_cron`: opens windows, sends due reminders, closes expired windows and writes deductions, activates and completes commitments |
| `use-grace-pass`, `request-pause`, `request-exit`, `request-plan-edit`, `open-dispute` | User actions with rule checks |
| `settle-commitment` | Computes refund from ledger, calls refund provider, writes ledger, sends statement |
| `refund-webhook` | Marks refund processed or failed |
| `admin-*` | Review ruling, dispute ruling, excuse range, plan config, manual adjustment (all write to `admin_audit_log`) |

`scheduler-tick` must be idempotent: running it twice in the same minute, or after a 10-minute gap, must give the same result. Use `UPDATE ... WHERE status = 'OPEN' AND window_closes_at < now() RETURNING` in one transaction with the ledger insert.

---

## 9. Data model (Postgres)

Money columns are `bigint` paise. All tables have `id uuid`, `created_at`, `updated_at`.

| Table | Key columns |
|---|---|
| `profiles` | user_id, full_name, phone, phone_verified, timezone, dob, role (`user`/`admin`/`coach`), whatsapp_opt_in, health_screening jsonb |
| `plans` | code (`lite`/`plus`/`pro`/`coach`), name, total_price, fee, duration_days, penalty_multiplier, verification_mode (`self`/`photo_sampled`/`photo_all`/`photo_coach`), ai_sample_rate, grace_passes, channels text[], dispute_sla_hours, is_active |
| `diet_plans` | user_id, title, source (`manual`/`upload`), upload_path, status (`draft`/`locked`), meals_per_day, safety_flags jsonb |
| `diet_plan_meals` | diet_plan_id, slot_index, slot_name, local_time, days_of_week int[], description, items jsonb |
| `commitments` | user_id, plan_id, diet_plan_id, status, start_date, end_date, meals_per_day, total_paid, fee, deposit, total_meals, penalty_per_miss, grace_remaining, pause_used, exit_effective_at, terms_version, consent_at |
| `meal_events` | commitment_id, user_id, diet_plan_meal_id, local_date, scheduled_at, window_opens_at, window_closes_at, status, planned_snapshot jsonb, resolved_at |
| `meal_reports` | meal_event_id, answer (`followed`/`not_followed`), note, photo_path, photo_phash, submitted_at |
| `ai_checks` | meal_report_id, model, verdict, confidence, detected_items jsonb, reason, raw jsonb |
| `ledger_entries` | commitment_id, user_id, type (`PAYMENT_IN`,`FEE`,`DEDUCTION`,`DEDUCTION_REVERSAL`,`REFUND_OUT`,`FEE_REFUND`,`ADJUSTMENT`), amount, meal_event_id, reference, note |
| `payments` | commitment_id, gateway, order_id, payment_id (unique), amount, method, status, raw jsonb |
| `refunds` | commitment_id, payment_id, gateway_refund_id, amount, status, raw jsonb |
| `notifications` | user_id, meal_event_id, kind, channel, idempotency_key (unique), status, sent_at, error |
| `push_subscriptions` | user_id, endpoint, keys jsonb, user_agent |
| `disputes` | meal_event_id, user_id, reason, evidence_path, status, ruling, ruled_by, ruled_at |
| `reviews` | meal_event_id, reason, status, due_at, ruling, ruled_by |
| `plan_edit_requests`, `pause_requests`, `exit_requests` | commitment_id, details, effective_at, status |
| `outages` | starts_at, ends_at, note |
| `admin_audit_log` | admin_id, action, target, before jsonb, after jsonb |
| `app_config` | key, value jsonb (window minutes, reminder offsets, feature flags, terms version) |

`planned_snapshot` copies the meal description into each event when it is generated, so later plan edits never rewrite history.

Row-level security: users can read their own rows. Users can insert and update only `diet_plans` and `diet_plan_meals` while in draft, and `push_subscriptions`. Everything else is written by Edge Functions using the service role. `ledger_entries` has no update or delete policy for anyone.

---

## 10. Screens

**Public:** landing (how it works in 4 steps, tier table, refund calculator slider: "miss N meals, get back Rs X"), FAQ, terms, refund policy, privacy policy, contact and grievance officer.

**User app:**
1. Sign in.
2. Onboarding: name, date of birth (18+ gate), phone, time zone, health screening, notification permission, install-PWA prompt.
3. Diet plan: manual builder or upload-then-review. Safety check result.
4. Choose tier, duration, start date. Summary screen showing fee, deposit, per-miss deduction and worst case.
5. Consent: separate unticked checkboxes for the fee being non-refundable, the deduction rule, the 2-hour rule, the exit rule, and terms. Then pay.
6. **Today** (home): timeline of today's meals with state and countdown, deposit balance meter, grace passes left.
7. Check-in: planned meal shown; Followed / Did not follow; camera on photo tiers; AI feedback inline.
8. History: calendar heat-map; tap a day for details.
9. Ledger: every rupee in and out; projected refund.
10. Disputes, pause, exit, plan edit requests.
11. Settings: notification channels, account, data deletion request.
12. Settlement statement at the end, plus "start another commitment".

**Admin:** dashboard (active commitments, compliance rate, deductions, refunds due), review queue with SLA timers, disputes, users and commitments, settlements (run, retry failed refunds), plans and config editor, outage excuse tool, audit log.

---

## 11. Legal and compliance checklist (India)

This section is risk-spotting, not legal advice. **Get written sign-off from an Indian lawyer and a chartered accountant before taking the first live payment.** These points drive real design choices above.

1. **Online gaming law.** The Promotion and Regulation of Online Gaming Act, 2025 and its 2026 Rules (in force 1 May 2026) ban "online money games": paying or depositing money in expectation of monetary or other enrichment, whether skill or chance. Design choices that keep distance from that definition: it is a service contract, not a game; the user can never receive more than they deposited; no pools, no winnings from other users, no leaderboards with prizes, no betting vocabulary. Do not add a "winners share the forfeits" feature without a legal opinion. Ask the lawyer whether to seek a determination from the Online Gaming Authority.
2. **Deposit-taking law.** The Banning of Unregulated Deposit Schemes Act, 2019 defines "deposit" broadly and includes refundable advances. Commentary mentions carve-outs for advances and security deposits taken in the ordinary course of business for performance of a contract, but the sources found disagree on scope. This is the most important point for the lawyer: how to structure and word the refundable amount.
3. **Payments regulation.** Do not build a wallet or hold user balances outside a regulated payment gateway. Confirm with the gateway (in writing) that the business model is permitted on their platform, and what their maximum refund window is; the commitment period plus settlement must fit inside it.
4. **Conflict of interest.** The company keeps deductions, so it earns more when users fail. Mitigations already designed in: AI cannot deduct alone, outage protection, disputes, grace passes, live ledger, 7-day exit. Also publish aggregate stats (average refund percentage).
5. **Consumer protection.** Clear pre-payment disclosure of all charges, no pre-ticked boxes, easy exit path, named grievance officer, refund timelines stated. Avoid dark patterns (false urgency, hidden charges, hard-to-find cancellation).
6. **GST.** GST at 18% likely applies to the processing fee. Treatment of forfeited deductions is unsettled (CBIC Circular 178/10/2022 distinguishes compensation for breach from payment for "tolerating an act", and rulings conflict). The CA must decide before pricing is final.
7. **Data protection.** Diet, health screening answers and meal photos are personal data under the Digital Personal Data Protection Act, 2023. Collect explicit consent, state purpose and retention, allow deletion, keep photos private, sign data-processing terms with vendors.
8. **Health claims.** No promise of weight loss or medical outcome anywhere in marketing.

Alternative model to raise with the lawyer if point 2 or 3 blocks the upfront deposit: take a card or UPI Autopay **mandate** and charge only the fee up front, then charge each deduction as it happens (the Beeminder approach). No deposit is held and no refund is needed, at the cost of a weaker "money already on the table" effect.

Sources:
- https://www.mondaq.com/india/social-media/1785870/the-promotion-and-regulation-of-online-gaming-act-2025-and-the-promotion-and-regulation-of-online-gaming-rules-2026
- https://www.legal500.com/developments/?p=56276
- https://prsindia.org/billtrack/the-promotion-and-regulation-of-online-gaming-bill-2025
- https://financialservices.gov.in/beta/sites/default/files/2022-10/7.%20THE%20BANNING%20OF%20UNREGULATED%20DEPOSIT%20SCHEMES%20ACT,%202019.pdf
- https://bcajonline.org/journal/ban-on-unregulated-deposit-schemes/
- https://www.barandbench.com/law-firms/view-point/compensation-is-not-consideration-gst-on-liquidated-damages-penalties-and-forfeiture
- https://razorpay.com/docs/payments/refunds/faqs.md
- https://razorpay.com/docs/payments/refunds/emi-pay-later/

---

## 12. User safety

Attaching money to eating can harm some people. Required safeguards:

- Adults only (18+).
- Health screening at onboarding: pregnancy or breastfeeding, diabetes on medication, kidney or heart disease, history of an eating disorder. Any "yes" requires an uploaded plan from a qualified dietitian or doctor; "eating disorder history" blocks sign-up with a kind message and support resources.
- AI sanity check of the diet plan before lock: flag very low estimated intake, single-food plans, long fasts, or fewer than 2 meals a day. A flag shows a warning and requires a professional's plan to proceed.
- "Did not follow" must never shame. Neutral copy only.
- Medical exit is always available and never penalised.
- Standing disclaimer: the platform does not give medical or nutrition advice.

---

## 13. Rules for the coding model

1. TypeScript strict mode everywhere. No `any` in money or scheduling code.
2. Money is integer paise. Format to rupees only at the display edge. Never use floating point for money.
3. Store UTC, display in the user's time zone. Use one date library (`date-fns` with `date-fns-tz`).
4. The server is the only authority for time, balances and states. The client sends intents; Edge Functions validate and write.
5. Every webhook and scheduled job is idempotent and safe to retry.
6. No secrets in the frontend. Only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY` and the gateway's public key id are allowed there.
7. All tunable numbers come from `plans` or `app_config`. No magic numbers in code.
8. Pure functions for money and time rules live in `src/domain/` (shared with Edge Functions) and have unit tests: `computePenalty`, `computeRefund`, `buildMealSchedule`, `isWindowOpen`, `canUseGracePass`.
9. Feature flags in `app_config`: `whatsapp_enabled`, `ai_check_enabled`, `payments_live`.
10. Do one phase per session. Finish its acceptance checks before starting the next. Do not build phase 2 items (Coach tier, native apps, referral, leaderboards).

Suggested layout:

```
src/
  domain/        pure rules + tests
  lib/           supabase client, api wrappers, push registration
  features/      auth, onboarding, diet-plan, commitment, today, checkin, history, ledger, disputes, settings, admin
  components/    shared UI
  pages/         route components
supabase/
  migrations/    SQL schema + RLS + cron
  functions/     edge functions (one folder each) + _shared/
public/          manifest, icons
```

---

## 14. Build phases

| # | Phase | Deliverables | Acceptance check |
|---|---|---|---|
| 0 | Clean start | Remove cartoon-converter code and Gemini dependency; add Router, Tailwind, TanStack Query, PWA plugin, Vitest, ESLint; env example file | `npm run build` and `npm test` pass; no API key in the bundle |
| 1 | Schema and auth | All migrations, RLS policies, seed `plans` and `app_config`; Google and email OTP sign-in; onboarding with screening | A user cannot read another user's rows or write to `ledger_entries` (tested) |
| 2 | Domain rules | `src/domain` functions with tests, including the section 4.2 table as test cases | All unit tests pass |
| 3 | Diet plan | Manual builder; upload plus AI extraction plus review; safety check; lock | A 3-slot plan can be created both ways and locked |
| 4 | Commitment and payment | Tier picker, summary, consent, Razorpay test checkout, `create-order`, `payment-webhook`, meal event generation | Test payment creates a SCHEDULED commitment with 90 meal events and correct ledger rows; replayed webhook changes nothing |
| 5 | Check-in and scheduler | Today screen, self-report, `scheduler-tick`, window closing, deductions, grace pass, ledger screen | With a simulated clock: an unreported meal is deducted exactly once; a reported one is not; grace pass prevents deduction |
| 6 | Notifications | Web push, email, reminder schedule, notification log; WhatsApp behind flag | Each reminder is sent once per channel; reporting stops later reminders |
| 7 | Photo and AI | In-app camera, upload, perceptual-hash duplicate check, `verify-meal-photo`, sampling for Plus, review queue | Mismatch goes to review with no deduction; unresolved review auto-clears at SLA |
| 8 | Settlement | Completion, dispute window, `settle-commitment`, partial refund in test mode, statement, pause, exit, plan edit | Refund amount equals ledger balance in all section 4.2 scenarios |
| 9 | Admin | All admin screens, audit log, outage excuse tool, metrics | Every admin money action appears in the audit log |
| 10 | Launch readiness | Landing, legal pages (lawyer-supplied text), PWA install flow, error monitoring, backups, load test of scheduler | Checklist in section 16 signed off |

---

## 15. Tests that must exist

- Money: every row of section 4.2; deposit not divisible by meal count; deduction capped at zero balance; reversal after dispute.
- Time: meal at 23:30 local with window crossing midnight; commitment start and end boundaries; user in a non-IST time zone.
- Scheduler: double run in one minute; run after a 30-minute gap; 10,000 open events in one tick.
- Reports: submit at window close minus 1 second (accepted) and plus 1 second (rejected); answer changed inside the window; photo arriving 9 minutes late after an in-time submit.
- Payments: duplicate webhook; webhook before the browser returns; failed payment; refund failure and retry.
- Security: user A reading or modifying user B's data; client attempting to write a ledger row or change a meal status.

---

## 16. Before going live (owner's checklist)

- [ ] Registered business entity, bank account, GST registration as advised.
- [ ] Lawyer's written opinion on section 11 points 1, 2 and 3; terms, refund policy and privacy policy drafted by them.
- [ ] CA's decision on GST for the fee and for deductions.
- [ ] Payment gateway approval of this exact business model, and their refund window confirmed.
- [ ] WhatsApp Business account and message templates approved.
- [ ] Prices re-checked against real gateway, AI and messaging costs.
- [ ] Closed pilot with 20 to 30 known users at small amounts before public launch.

---

## 17. Decisions still open for the owner

1. Penalty multiplier: 2 (as in the original example) or 1.
2. Fee refund when a user cancels before the start date: full, or minus gateway charges.
3. Final tier prices after cost verification.
4. Backend: Supabase as recommended, or another stack already in use.
5. Frontend hosting provider.
6. Sign-in method: Google and email OTP (cheaper), or phone OTP from day one.
7. Whether the existing cartoon-converter code in this repo can be deleted (phase 0 assumes yes).
8. Brand name and domain.

## 18. Later phases (not in v1)

Coach tier with dietitian marketplace, native Android and iOS apps, charity option for deductions, corporate wellness plans, family or buddy accountability (no money pooling), wearable and weight-log integration, regional languages, referral credit against the processing fee.
