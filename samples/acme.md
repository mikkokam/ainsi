---
logo: assets/acme-logo.png
---

<!-- pac:layout header -->

# Acme ==Gatekeeper==

Governance and policy solution for production AI

![Architectural timber workspace with natural sunlight](https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=1600&q=80)

---


# Fast-growing companies adopt AI faster than they can govern it

A fifty-person engineering team might now connect eight model <kbd>providers</kbd> across product, support, and `internal` tools - with zero unified audit trail, unpredictable monthly token invoices, and no automated compliance checks.

---

# What that costs them

<!-- pac: boxes stretch -->
1. Customer audit failures when enterprise clients ask
2. Surprise token spikes discovered only at billing
3. Fragmented policies written in ad-hoc prompt code
4. Unchecked PII and secret leaks across ==shadow tools==

---

<!-- pac:layout split side=right -->

<!-- pac: prose size=small -->
How does it work

<!-- pac: prose size=small -->
# A single deterministic gateway in front of every model

Every outbound LLM call passes through Acme before reaching upstream providers.
**Policies** evaluate through Open Policy Agent (OPA), keeping rules declarative, version-controlled, and testable in CI/CD.

> [!NOTE]
> Zero changes to existing application code: swap one base URL in your client configuration and enforce policy on day one.

![Tactile notebook and fountain pen on warm oak desk](https://images.unsplash.com/photo-1449247709967-d4461a6a6103?w=1600&q=80)

---

# How Acme protects your workload

<!-- pac: boxes -->
1. **Enforce** OPA inspects and validates requests before egress
2. **Record** Immutable event stream of prompt hashes, latency, and tokens
3. **Redact** Real-time PII masking and secret prevention at the wire
4. **Comply** Instant audit packages for EU AI Act, SOC 2, and GDPR

---

# Operating with & without Acme

|                     | Today                    | With Acme                   |
| ------------------- | ------------------------ | --------------------------- |
| Audit trail         | Ad-hoc log queries       | Signed event stream (7 yrs) |
| Cost allocation     | Aggregate month-end bill | Per-team attribution, live  |
| Policy enforcement  | Confluence guidelines    | Declarative OPA bundles     |
| Provider onboarding | Weeks of security review | 15-minute credential update |
| Data residency      | Unknown routing          | Guaranteed EU-only egress   |

---

<!-- pac: quote -->

> When our enterprise bank clients asked for our AI data governance records, we delivered verified OPA enforcement logs in under an hour. Acme turned a potential sales blocker into our strongest trust proof.
>
> — VP of Engineering, Series B Fintech (Stockholm)

---

# Product roadmap

<!-- pac: timeline -->
- **Q1** Turnkey OPA policy bundles for EU AI Act Article 12 compliance
- **Q2** Real-time semantic budget limits and anomalous spend throttling
- **Q3** Air-gapped on-premise appliances and self-hosted VPC agents
- **Q4** Native zero-trust egress connectors for sovereign European LLMs

---

# Transparent, usage-based pricing

| Tier       | Workspaces | Monthly Requests | Retention & Compliance | Price        |
| ---------- | ---------- | ---------------- | ---------------------- | ------------ |
| Team       | 3          | Up to 500k reqs  | 90-day signed logs     | 490 € / mo   |
| Business   | 10         | Up to 5M reqs    | 2-year audit vault     | 1 450 € / mo |
| Enterprise | Unlimited  | Custom volume    | 7-year vault + VPC     | Custom       |

---

# Built by infrastructure engineers

![Founding team in a sunlit Nordic workshop studio](https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1600&q=80)

Founded by former payment security and distributed systems leads from Pay More Inc and Bank of Tor. We built Acme after managing compliance across 40+ LLM services internally. Today, Acme governs production traffic across 18 European tech companies.

---

<!-- pac:layout header align=center -->

# Start governing AI in production today

Get in touch for a 30-minute architecture review or deploy a self-hosted trial.

![Warm minimalist architectural interior](https://images.unsplash.com/photo-1497366216548-37526070297c?w=1600&q=80)
